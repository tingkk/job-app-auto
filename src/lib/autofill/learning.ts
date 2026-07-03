import { newId } from '../profile';
import type { FieldDescriptor, LearnedFieldValue, ProfileV1, ReusableAnswer } from '../types';
import { normalizeText } from './language';

const MAX_ANSWER_LENGTH = 5000;
const BLOCKED_PATTERNS = [
  /captcha/i,
  /password/i,
  /credit\s*card|card\s*number|payment|billing/i,
  /signature|sign\s*(here|ature)?/i,
  /i\s*certify|i\s*agree|legal\s*attestation/i,
  /terms\s*(and|&)\s*conditions|privacy\s*policy/i,
  /我确认|我確認|同意|签名|簽名/
];

export interface LearningResult {
  profile: ProfileV1;
  learned: number;
  updated: number;
  skipped: number;
}

export function learnFromFieldValues(profile: ProfileV1, observations: LearnedFieldValue[]): LearningResult {
  const next = structuredClone(profile);
  let learned = 0;
  let updated = 0;
  let skipped = 0;

  for (const observation of observations) {
    if (!shouldLearnFieldValue(observation)) {
      skipped += 1;
      continue;
    }

    const question = questionForObservation(observation);
    const answer = normalizedAnswer(observation);
    const existing = next.reusableAnswers.find((item) => reusableAnswerKey(item) === learnedAnswerKey(question));
    const now = observation.observedAt || new Date().toISOString();

    if (existing) {
      if (existing.answer !== answer) existing.answer = answer;
      existing.question = question;
      existing.language = observation.descriptor.language;
      existing.tags = tagsForObservation(observation);
      existing.source = 'learned';
      existing.learnedFrom = {
        domain: observation.domain,
        pageTitle: observation.pageTitle || existing.learnedFrom?.pageTitle,
        fieldId: observation.descriptor.id || existing.learnedFrom?.fieldId,
        firstSeenAt: existing.learnedFrom?.firstSeenAt ?? now,
        lastSeenAt: now,
        observationCount: (existing.learnedFrom?.observationCount ?? 0) + 1
      };
      updated += 1;
    } else {
      next.reusableAnswers.push({
        id: newId('learned'),
        question,
        answer,
        language: observation.descriptor.language,
        tags: tagsForObservation(observation),
        source: 'learned',
        learnedFrom: {
          domain: observation.domain,
          pageTitle: observation.pageTitle || undefined,
          fieldId: observation.descriptor.id,
          firstSeenAt: now,
          lastSeenAt: now,
          observationCount: 1
        }
      });
      learned += 1;
    }
  }

  if (learned || updated) next.updatedAt = new Date().toISOString();
  return { profile: next, learned, updated, skipped };
}

export function shouldLearnFieldValue(observation: LearnedFieldValue): boolean {
  const field = observation.descriptor;
  if (!observation.domain || !field.visible || field.disabled || field.readonly) return false;
  if (['password', 'payment', 'hidden', 'file', 'unknown', 'checkbox'].includes(field.kind)) return false;
  const question = questionForObservation(observation);
  const questionKey = normalizeText(question);
  if (!isMeaningfulQuestion(questionKey)) return false;
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(question))) return false;
  const answer = normalizedAnswer(observation);
  if (!answer || answer.length > MAX_ANSWER_LENGTH) return false;
  if (field.kind === 'select' && isPlaceholderSelectValue(field, answer)) return false;
  return true;
}

export function learnedAnswerMatches(answer: ReusableAnswer, matchText: string): boolean {
  const question = normalizeText(answer.question);
  if (question.length <= 6) return question === matchText;
  return matchText.includes(question) || question.includes(matchText);
}

function questionForObservation(observation: LearnedFieldValue): string {
  const field = observation.descriptor;
  return (
    field.label ||
    field.ariaLabel ||
    field.placeholder ||
    field.questionText ||
    field.name ||
    field.idAttribute ||
    ''
  ).trim();
}

function normalizedAnswer(observation: LearnedFieldValue): string {
  return (observation.valueLabel || observation.value).trim();
}

function isMeaningfulQuestion(question: string): boolean {
  if (question.length < 3) return false;
  if (!/[\p{L}\p{N}]/u.test(question)) return false;
  if (/^(q|field|input|select|textarea)[-_ ]?\d+$/i.test(question)) return false;
  return true;
}

function isPlaceholderSelectValue(field: FieldDescriptor, answer: string): boolean {
  const option = field.options.find((item) => item.value === answer || item.label === answer);
  if (!option) return false;
  return !option.value || /select|choose|please|--|请选择|請選擇/i.test(option.label);
}

function learnedAnswerKey(question: string): string {
  return normalizeText(question);
}

function reusableAnswerKey(answer: ReusableAnswer): string {
  return learnedAnswerKey(answer.question);
}

function tagsForObservation(observation: LearnedFieldValue): string[] {
  return ['learned', `domain:${observation.domain}`, `kind:${observation.descriptor.kind}`];
}
