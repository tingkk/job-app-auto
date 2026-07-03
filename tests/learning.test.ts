import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../src/lib/profile';
import { learnFromFieldValues } from '../src/lib/autofill/learning';
import { mapField } from '../src/lib/autofill/matcher';
import type { FieldDescriptor, LearnedFieldValue } from '../src/lib/types';

function field(overrides: Partial<FieldDescriptor>): FieldDescriptor {
  return {
    id: overrides.id ?? 'field',
    kind: overrides.kind ?? 'text',
    tagName: 'input',
    questionText: overrides.questionText ?? 'Why are you interested in this role?',
    options: overrides.options ?? [],
    required: false,
    visible: true,
    disabled: false,
    readonly: false,
    path: '',
    language: 'en',
    ...overrides
  };
}

function observation(overrides: Partial<LearnedFieldValue>): LearnedFieldValue {
  return {
    descriptor: field({}),
    value: 'I build reliable product workflows.',
    pageTitle: 'Application',
    domain: 'jobs.example.com',
    url: 'https://jobs.example.com/apply',
    observedAt: '2026-06-24T00:00:00.000Z',
    ...overrides
  };
}

describe('learning from user-filled fields', () => {
  it('stores and updates learned answers by question', () => {
    const profile = emptyProfile();
    const first = learnFromFieldValues(profile, [
      observation({
        descriptor: field({ label: 'Why are you interested in this role?' }),
        value: 'First answer'
      })
    ]);

    expect(first.learned).toBe(1);
    expect(first.profile.reusableAnswers[0]).toEqual(
      expect.objectContaining({
        question: 'Why are you interested in this role?',
        answer: 'First answer',
        source: 'learned',
        learnedFrom: expect.objectContaining({ domain: 'jobs.example.com', observationCount: 1 })
      })
    );

    const second = learnFromFieldValues(first.profile, [
      observation({
        descriptor: field({ label: 'Why are you interested in this role?' }),
        value: 'Updated answer',
        observedAt: '2026-06-24T01:00:00.000Z'
      })
    ]);

    expect(second.learned).toBe(0);
    expect(second.updated).toBe(1);
    expect(second.profile.reusableAnswers).toHaveLength(1);
    expect(second.profile.reusableAnswers[0]?.answer).toBe('Updated answer');
    expect(second.profile.reusableAnswers[0]?.learnedFrom?.observationCount).toBe(2);
  });

  it('skips unsafe or meaningless observations', () => {
    const profile = emptyProfile();
    const result = learnFromFieldValues(profile, [
      observation({ descriptor: field({ kind: 'password', inputType: 'password', label: 'Password' }), value: 'secret' }),
      observation({ descriptor: field({ label: 'I certify that this is true' }), value: 'yes' }),
      observation({ descriptor: field({ label: 'q_1' }), value: 'answer' })
    ]);

    expect(result.skipped).toBe(3);
    expect(result.profile.reusableAnswers).toEqual([]);
  });

  it('reuses learned answers across domains', () => {
    const profile = learnFromFieldValues(emptyProfile(), [
      observation({
        descriptor: field({ label: 'What is your preferred work style?' }),
        value: 'Hybrid with focused office days.'
      })
    ]).profile;

    expect(
      mapField(
        field({ id: 'same-domain', label: 'What is your preferred work style?', questionText: '' }),
        profile,
        undefined,
        'jobs.example.com'
      )
    ).toEqual(expect.objectContaining({ value: 'Hybrid with focused office days.', source: 'reusable-answer' }));

    expect(
      mapField(
        field({ id: 'other-domain', label: 'What is your preferred work style?', questionText: '' }),
        profile,
        undefined,
        'other.example.com'
      )
    ).toEqual(expect.objectContaining({ value: 'Hybrid with focused office days.', source: 'reusable-answer' }));
  });

  it('keeps manually saved reusable answers global', () => {
    const profile = emptyProfile();
    profile.reusableAnswers.push({
      id: 'manual_1',
      question: 'What is your preferred work style?',
      answer: 'Remote-first',
      source: 'manual'
    });

    expect(
      mapField(
        field({ id: 'manual-global', label: 'What is your preferred work style?', questionText: '' }),
        profile,
        undefined,
        'other.example.com'
      )
    ).toEqual(expect.objectContaining({ value: 'Remote-first', source: 'reusable-answer' }));
  });
});
