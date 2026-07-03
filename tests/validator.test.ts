import { describe, expect, it } from 'vitest';
import { validateMapping } from '../src/lib/autofill/validator';
import type { FieldDescriptor, FieldMapping } from '../src/lib/types';

const selectField: FieldDescriptor = {
  id: 'country',
  kind: 'select',
  tagName: 'select',
  questionText: 'country',
  options: [
    { label: 'United States', value: 'US' },
    { label: 'China', value: 'CN' }
  ],
  required: false,
  visible: true,
  disabled: false,
  readonly: false,
  path: '',
  language: 'en'
};

describe('mapping validation', () => {
  it('coerces select values to available option values', () => {
    const mapping: FieldMapping = { fieldId: 'country', value: 'United States', source: 'ai-live', confidence: 0.9 };
    expect(validateMapping(selectField, mapping)?.value).toBe('US');
  });

  it('rejects invalid email values', () => {
    const mapping: FieldMapping = { fieldId: 'email', value: 'not-email', source: 'ai-live', confidence: 0.9 };
    expect(validateMapping({ ...selectField, id: 'email', kind: 'email', options: [] }, mapping)).toBeUndefined();
  });

  it('rejects non-numeric values for salary and amount fields', () => {
    const salaryField: FieldDescriptor = {
      ...selectField,
      id: 'expected-salary',
      kind: 'text',
      tagName: 'input',
      label: 'Expected Monthly Salary (HK$)',
      questionText: 'expected monthly salary hk',
      options: []
    };

    expect(
      validateMapping(salaryField, {
        fieldId: 'expected-salary',
        value: 'Ka Ki',
        source: 'dictionary',
        confidence: 0.95
      })
    ).toBeUndefined();
    expect(
      validateMapping(salaryField, {
        fieldId: 'expected-salary',
        value: '35,136.00',
        source: 'dictionary',
        confidence: 0.95
      })?.value
    ).toBe('35,136.00');
  });

  it('rejects unsupported compensation mappings unless they come from saved reusable answers', () => {
    const allowanceField: FieldDescriptor = {
      ...selectField,
      id: 'allowance-type',
      kind: 'text',
      tagName: 'input',
      label: 'Guaranteed Allowance Type 1',
      questionText: 'guaranteed allowance type 1',
      options: []
    };

    expect(
      validateMapping(allowanceField, {
        fieldId: 'allowance-type',
        value: 'Ka Ki',
        source: 'ai-live',
        confidence: 0.95,
        profilePath: 'identity.firstName'
      })
    ).toBeUndefined();
    expect(
      validateMapping(allowanceField, {
        fieldId: 'allowance-type',
        value: 'Transport',
        source: 'reusable-answer',
        confidence: 0.95,
        profilePath: 'reusableAnswers.allowance'
      })?.value
    ).toBe('Transport');
  });
});
