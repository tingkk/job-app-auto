import { describe, expect, it } from 'vitest';
import { sanitizeMapFieldsInput } from '../src/lib/ai/sanitize';
import { emptyProfile } from '../src/lib/profile';
import type { FieldDescriptor } from '../src/lib/types';

function descriptor(id: string, kind: FieldDescriptor['kind']): FieldDescriptor {
  return {
    id,
    kind,
    tagName: 'input',
    questionText: `${id} question`,
    options: [],
    required: false,
    visible: true,
    disabled: false,
    readonly: false,
    path: '#secret-path',
    language: 'en'
  };
}

describe('AI sanitization', () => {
  it('excludes hidden/password fields and strips DOM paths', () => {
    const profile = emptyProfile();
    profile.contact.email = 'ada@example.com';

    const sanitized = sanitizeMapFieldsInput({
      profile,
      fields: [descriptor('email', 'email'), descriptor('password', 'password'), descriptor('hidden', 'hidden')],
      pageTitle: 'Application',
      domain: 'example.com',
      language: 'en'
    });

    expect(sanitized.fields.map((field) => field.id)).toEqual(['email']);
    expect(sanitized.fields[0]?.path).toBe('');
    expect(sanitized.profile.contact?.email).toBe('ada@example.com');
  });
});
