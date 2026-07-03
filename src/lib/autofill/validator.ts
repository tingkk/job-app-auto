import type { FieldDescriptor, FieldMapping } from '../types';
import { normalizeText } from './language';

export function validateMapping(field: FieldDescriptor, mapping: FieldMapping): FieldMapping | undefined {
  if (mapping.confidence < 0.65) return undefined;
  if (isUnsupportedCompensationField(field, mapping)) return undefined;
  if (field.kind === 'file') {
    return mapping.value === '__RESUME_FILE__' ? mapping : undefined;
  }
  if (field.kind === 'checkbox') {
    return { ...mapping, value: coerceBoolean(mapping.value) };
  }
  if (field.kind === 'radio' || field.kind === 'select') {
    const optionValue =
      typeof mapping.value === 'boolean'
        ? matchBooleanOption(field, mapping.value)
        : matchOption(field, String(mapping.value));
    if (optionValue == null) return undefined;
    return { ...mapping, value: optionValue };
  }
  if (field.kind === 'email' && typeof mapping.value === 'string' && !mapping.value.includes('@')) return undefined;
  if (field.kind === 'url' && typeof mapping.value === 'string' && !/^https?:\/\//i.test(mapping.value)) return undefined;
  if (expectsNumericValue(field) && typeof mapping.value === 'string' && !isNumericLike(mapping.value)) return undefined;
  return mapping;
}

export function matchOption(field: FieldDescriptor, value: string): string | undefined {
  const normalized = normalizeOption(value);
  const option = field.options.find((candidate) => {
    return normalizeOption(candidate.value) === normalized || normalizeOption(candidate.label) === normalized;
  });
  if (option) return option.value;
  const contains = field.options.find((candidate) => {
    const label = normalizeOption(candidate.label);
    const candidateValue = normalizeOption(candidate.value);
    return label.includes(normalized) || normalized.includes(label) || candidateValue.includes(normalized);
  });
  return contains?.value;
}

function matchBooleanOption(field: FieldDescriptor, value: boolean): string | undefined {
  const wanted = value ? ['yes', 'true', 'y', '是', '有'] : ['no', 'false', 'n', '否', '没有', '沒有', '无', '無'];
  const option = field.options.find(
    (candidate) => wanted.includes(normalizeOption(candidate.value)) || wanted.includes(normalizeOption(candidate.label))
  );
  return option?.value;
}

function normalizeOption(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  return ['true', 'yes', 'y', '1', 'checked', '是', '有'].includes(normalized);
}

function expectsNumericValue(field: FieldDescriptor): boolean {
  if (field.kind === 'number') return true;
  const text = normalizeText(
    [
      field.label,
      field.ariaLabel,
      field.placeholder,
      field.questionText,
      field.name,
      field.idAttribute
    ]
      .filter(Boolean)
      .join(' ')
  );
  return [
    /\b(amount|amt|salary|compensation|pay\s*month|commission|hkd|hk\$)\b/i,
    /薪|薪资|薪資|薪金|月薪|佣金|金額|金额|港幣|港币/
  ].some((pattern) => pattern.test(text));
}

function isNumericLike(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^(?=.*\d)(?:[$€£¥]|hk\$|hkd|usd|cny|rmb|eur|gbp|,|\s)*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:per\s*month|monthly|months?|个月|個月))?$/i.test(
    trimmed
  );
}

function isUnsupportedCompensationField(field: FieldDescriptor, mapping: FieldMapping): boolean {
  if (mapping.source === 'reusable-answer' || mapping.profilePath?.startsWith('reusableAnswers.')) return false;
  const text = fieldText(field);
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

function fieldText(field: FieldDescriptor): string {
  return normalizeText(
    [
      field.label,
      field.ariaLabel,
      field.placeholder,
      field.questionText,
      field.name,
      field.idAttribute
    ]
      .filter(Boolean)
      .join(' ')
  );
}
