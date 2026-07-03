import type { FillContextDebugData } from './messages';
import type { ProfileV1 } from './types';

export function buildProfileDebugData(profile: ProfileV1): FillContextDebugData {
  return {
    profileFields: flattenProfileFields(profile),
    learnedFields: profile.reusableAnswers
      .filter((answer) => answer.source === 'learned' || answer.tags?.includes('learned'))
      .map((answer) => ({
        id: answer.id,
        question: answer.question,
        answer: answer.answer,
        source: answer.source,
        tags: answer.tags,
        domain: answer.learnedFrom?.domain,
        observationCount: answer.learnedFrom?.observationCount,
        lastSeenAt: answer.learnedFrom?.lastSeenAt
      }))
  };
}

function flattenProfileFields(profile: ProfileV1): FillContextDebugData['profileFields'] {
  const rows: FillContextDebugData['profileFields'] = [];
  const walk = (value: unknown, path: string) => {
    if (path === 'reusableAnswers') return;
    if (Array.isArray(value)) {
      if (!value.length) {
        rows.push({ path, value: [], empty: true });
        return;
      }
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    rows.push({ path, value, empty: isEmptyDebugValue(value) });
  };
  walk(profile, '');
  return rows;
}

function isEmptyDebugValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
