import type { FieldDescriptor, FieldMapping, ProfileV1 } from '../types';
import type { StoredResume } from '../storage';
import { getProfileValue } from '../profile';
import { autocompleteMap, dictionaryRules } from './dictionary';
import { atsProfileHints } from './ats';
import { normalizeText } from './language';
import { learnedAnswerMatches } from './learning';

const BLOCKED_PATTERNS = [
  /captcha/i,
  /password/i,
  /credit\s*card|card\s*number|payment|billing/i,
  /signature|sign\s*(here|ature)?/i,
  /i\s*certify|i\s*agree|legal\s*attestation/i,
  /我确认|我確認|同意|签名|簽名/
];

export function deterministicMappings(fields: FieldDescriptor[], profile: ProfileV1, resume?: StoredResume, domain?: string): FieldMapping[] {
  const mappings: FieldMapping[] = [];
  for (const field of fields) {
    const mapping = mapField(field, profile, resume, domain);
    if (mapping) mappings.push(mapping);
  }
  return dedupeMappings(mappings);
}

export function mapField(field: FieldDescriptor, profile: ProfileV1, resume?: StoredResume, domain?: string): FieldMapping | undefined {
  if (shouldSkipField(field)) return undefined;

  const matchText = matcherText(field);
  const blockProfileMapping = isUnsupportedCompensationField(matchText);

  const atsHint = atsProfileHints(field.ats as never, matchText)[0];
  if (atsHint && !blockProfileMapping) {
    const value = valueForPath(profile, atsHint, resume);
    if (value != null && value !== '') {
      return { fieldId: field.id, value, source: 'ats', confidence: 0.96, profilePath: atsHint };
    }
  }

  if (field.autocomplete) {
    const path = autocompleteMap[field.autocomplete.toLowerCase()];
    if (path && !blockProfileMapping) {
      const value = valueForPath(profile, path, resume);
      if (value != null && value !== '') {
        return { fieldId: field.id, value, source: 'autocomplete', confidence: 0.97, profilePath: path };
      }
    }
  }

  if (!blockProfileMapping) {
    for (const rule of dictionaryRules) {
      if (!rule.patterns.some((pattern) => pattern.test(matchText))) continue;
      const value = valueForPath(profile, rule.path, resume);
      if (value != null && value !== '') {
        return { fieldId: field.id, value, source: 'dictionary', confidence: rule.confidence, profilePath: rule.path };
      }
    }
  }

  const answer = profile.reusableAnswers.find((item) => learnedAnswerMatches(item, matchText));
  if (answer) {
    return {
      fieldId: field.id,
      value: answer.answer,
      source: 'reusable-answer',
      confidence: 0.86,
      profilePath: `reusableAnswers.${answer.id}`
    };
  }

  return undefined;
}

export function shouldSkipField(field: FieldDescriptor): boolean {
  if (field.disabled || field.readonly) return true;
  if (['password', 'payment', 'hidden', 'unknown'].includes(field.kind)) return true;
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(matcherText(field)))) return true;
  return false;
}

export function valueForPath(profile: ProfileV1, path: string, resume?: StoredResume): string | boolean | undefined {
  if (path === 'resume.file') return resume?.fileName ? '__RESUME_FILE__' : undefined;
  if (path === 'links.linkedin') return profile.links.find((link) => link.kind === 'linkedin' || /linkedin/i.test(link.label))?.url;
  if (path === 'links.github') return profile.links.find((link) => link.kind === 'github' || /github/i.test(link.label))?.url;
  if (path === 'links.portfolio') return profile.links.find((link) => ['portfolio', 'website'].includes(link.kind ?? ''))?.url ?? profile.links[0]?.url;
  const value = getProfileValue(profile, path);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return undefined;
}

export function mergeMappings(primary: FieldMapping[], secondary: FieldMapping[]): FieldMapping[] {
  return dedupeMappings([...primary, ...secondary]);
}

function dedupeMappings(mappings: FieldMapping[]): FieldMapping[] {
  const byField = new Map<string, FieldMapping>();
  for (const mapping of mappings) {
    const existing = byField.get(mapping.fieldId);
    if (!existing || mapping.confidence > existing.confidence) byField.set(mapping.fieldId, mapping);
  }
  return Array.from(byField.values());
}

export function matcherText(field: FieldDescriptor): string {
  const preciseParts = [
    field.label,
    field.ariaLabel,
    field.placeholder,
    field.autocomplete,
    field.name,
    field.idAttribute
  ].filter(Boolean);
  const preciseText = normalizeText(preciseParts.join(' '));
  const questionText = normalizeText(field.questionText);
  const nearbyText = normalizeText(field.nearbyText ?? '');
  const includeQuestionText = !preciseText && isCompactContextText(questionText);
  const includeNearby = !preciseText && isCompactContextText(nearbyText);
  return normalizeText(
    [preciseText, includeQuestionText ? questionText : undefined, includeNearby ? nearbyText : undefined].filter(Boolean).join(' ')
  );
}

function isCompactContextText(text: string): boolean {
  return Boolean(text && text.length <= 160 && countWordTokens(text) <= 24);
}

function countWordTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function isUnsupportedCompensationField(text: string): boolean {
  if (isExpectedCompensationField(text)) return false;
  return [
    /current.*salary|last.*salary|salary.*month|pay\s*month|curr.*salary/i,
    /allowance|bonus|commission|gratuity|guaranteed|discretionary|year\s*end|year-end/i,
    /\bother\s*(type|amount|amt)\b/i,
    /津贴|津貼|奖金|獎金|佣金|花紅|酬金|現時.*薪|当前.*薪|目前.*薪/
  ].some((pattern) => pattern.test(text));
}

function isExpectedCompensationField(text: string): boolean {
  return /expected.*(salary|compensation|pay)|desired.*(salary|compensation|pay)|salary.*expectation|compensation.*expectation|期望.*薪|預期.*薪/i.test(
    text
  );
}
