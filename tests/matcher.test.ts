import { describe, expect, it } from 'vitest';
import { emptyProfile } from '../src/lib/profile';
import { deterministicMappings, mapField, matcherText } from '../src/lib/autofill/matcher';
import type { FieldDescriptor } from '../src/lib/types';

function field(overrides: Partial<FieldDescriptor>): FieldDescriptor {
  return {
    id: overrides.id ?? 'field',
    kind: overrides.kind ?? 'text',
    tagName: 'input',
    questionText: overrides.questionText ?? '',
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

describe('deterministic matcher', () => {
  it('maps autocomplete and bilingual dictionary fields', () => {
    const profile = emptyProfile();
    profile.identity.firstName = 'Ada';
    profile.contact.email = 'ada@example.com';

    const mappings = deterministicMappings(
      [
        field({ id: 'first', autocomplete: 'given-name', questionText: 'ignored' }),
        field({ id: 'email', questionText: '电子邮件' })
      ],
      profile
    );

    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: 'first', value: 'Ada', source: 'autocomplete' }),
        expect.objectContaining({ fieldId: 'email', value: 'ada@example.com', source: 'dictionary' })
      ])
    );
  });

  it('does not map blocked legal attestations', () => {
    const profile = emptyProfile();
    profile.identity.fullName = 'Ada Lovelace';

    expect(mapField(field({ id: 'legal', questionText: 'I certify that the above is true' }), profile)).toBeUndefined();
  });

  it('does not let broad nearby text map salary and bonus fields to first name', () => {
    const profile = emptyProfile();
    profile.identity.firstName = 'Ka Ki';
    profile.preferences.salaryExpectation = '50000';
    const pollutedNearbyText =
      'Last Name First Name Preferred Name Current / Last Monthly Salary Guaranteed Allowance Guaranteed Bonus Expected Monthly Salary';

    expect(
      mapField(
        field({
          id: 'allowance-type',
          label: 'Guaranteed Allowance Type 1',
          name: 'UDFCandidatePersonalInfo_0_Guaranteed_Allowance_Type_1',
          questionText: `guaranteed allowance type 1 ${pollutedNearbyText}`,
          nearbyText: pollutedNearbyText
        }),
        profile
      )
    ).toBeUndefined();

    expect(
      mapField(
        field({
          id: 'commission',
          label: 'Commission',
          name: 'UDFCandidatePersonalInfo_0_Commission',
          questionText: `commission ${pollutedNearbyText}`,
          nearbyText: pollutedNearbyText
        }),
        profile
      )
    ).toBeUndefined();
  });

  it('maps expected salary only to the salary expectation profile value', () => {
    const profile = emptyProfile();
    profile.identity.firstName = 'Ka Ki';
    profile.preferences.salaryExpectation = '55000';

    expect(
      mapField(
        field({
          id: 'expected-salary',
          label: 'Expected Monthly Salary (HK$)',
          name: 'UDFSubmission_0_Expected_Monthly_Salary',
          questionText: 'expected monthly salary hk first name'
        }),
        profile
      )
    ).toEqual(
      expect.objectContaining({
        value: '55000',
        profilePath: 'preferences.salaryExpectation',
        source: 'dictionary'
      })
    );
  });

  it('builds matcher text from precise field attributes before unsafe nearby text', () => {
    const text = matcherText(
      field({
        label: 'Guaranteed Allowance Amount 1',
        nearbyText: 'Last Name First Name Preferred Name Current Salary Guaranteed Allowance Bonus Commission Expected Salary '.repeat(4)
      })
    );

    expect(text).toContain('guaranteed allowance amount 1');
    expect(text).not.toContain('first name');
  });
});
