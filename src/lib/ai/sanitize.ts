import type { AiMapFieldsInput } from './types';
import type { FieldDescriptor, ProfileV1 } from '../types';

const SAFE_PROFILE_PATHS = [
  'identity',
  'contact',
  'address',
  'links',
  'workAuthorization',
  'preferences',
  'education',
  'employment',
  'skills',
  'languages',
  'demographics',
  'reusableAnswers'
] as const;

export function sanitizeFieldForAi(field: FieldDescriptor): FieldDescriptor {
  return {
    ...field,
    path: '',
    name: field.name?.slice(0, 80),
    idAttribute: field.idAttribute?.slice(0, 80),
    questionText: field.questionText.slice(0, 500),
    nearbyText: field.nearbyText?.slice(0, 500),
    options: field.options.map((option) => ({
      label: option.label.slice(0, 200),
      value: option.value.slice(0, 200)
    }))
  };
}

export function sanitizeProfileForAi(profile: ProfileV1): Partial<ProfileV1> {
  const safe: Partial<ProfileV1> = {};
  for (const key of SAFE_PROFILE_PATHS) {
    safe[key] = structuredClone(profile[key]) as never;
  }
  return safe;
}

export function sanitizeMapFieldsInput(input: AiMapFieldsInput): AiMapFieldsInput {
  return {
    ...input,
    profile: sanitizeProfileForAi(input.profile) as ProfileV1,
    fields: input.fields
      .filter((field) => !['password', 'payment', 'hidden'].includes(field.kind))
      .map(sanitizeFieldForAi),
    pageTitle: input.pageTitle.slice(0, 200),
    jobDescription: input.jobDescription?.slice(0, 4000),
    domain: input.domain,
    ats: input.ats,
    language: input.language
  };
}
