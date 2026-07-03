import type { ProfileV1, UUID } from './types';

export function newId(prefix = 'id'): UUID {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`;
}

export function emptyProfile(): ProfileV1 {
  return {
    schemaVersion: 1,
    identity: {
      firstName: '',
      lastName: '',
      fullName: ''
    },
    contact: {
      email: ''
    },
    address: {},
    links: [],
    workAuthorization: {},
    preferences: {},
    education: [],
    employment: [],
    skills: [],
    languages: [],
    demographics: {},
    reusableAnswers: [],
    resume: {},
    updatedAt: new Date().toISOString()
  };
}

export function normalizeProfile(profile: Partial<ProfileV1> | undefined): ProfileV1 {
  const base = emptyProfile();
  const identity = profile?.identity as (Partial<ProfileV1['identity']> & Record<string, unknown>) | undefined;
  const merged: ProfileV1 = {
    ...base,
    ...profile,
    schemaVersion: 1,
    identity: {
      ...base.identity,
      ...profile?.identity,
      firstName: profile?.identity?.firstName || stringAlias(identity, 'givenName', 'given_name') || base.identity.firstName,
      lastName: profile?.identity?.lastName || stringAlias(identity, 'familyName', 'family_name', 'surname') || base.identity.lastName
    },
    contact: { ...base.contact, ...profile?.contact },
    address: { ...base.address, ...profile?.address },
    workAuthorization: { ...base.workAuthorization, ...profile?.workAuthorization },
    preferences: { ...base.preferences, ...profile?.preferences },
    demographics: { ...base.demographics, ...profile?.demographics },
    resume: { ...base.resume, ...profile?.resume },
    links: profile?.links ?? [],
    education: profile?.education ?? [],
    employment: profile?.employment ?? [],
    skills: profile?.skills ?? [],
    languages: profile?.languages ?? [],
    reusableAnswers: profile?.reusableAnswers ?? [],
    updatedAt: profile?.updatedAt ?? base.updatedAt
  };
  if (!merged.identity.fullName) {
    merged.identity.fullName = [merged.identity.firstName, merged.identity.lastName]
      .filter(Boolean)
      .join(' ');
  }
  return merged;
}

export function profileCompleteness(profile: ProfileV1): number {
  const required = [
    hasText(profile.identity.firstName),
    hasText(profile.identity.lastName),
    hasText(profile.contact.email),
    hasText(profile.contact.phone),
    hasText(profile.address.city),
    profile.links.some((link) => hasText(link.url)),
    profile.employment.some((entry) => hasText(entry.company)),
    profile.education.some((entry) => hasText(entry.school)),
    profile.skills.some((skill) => hasText(skill.name))
  ];
  return Math.round((required.filter(Boolean).length / required.length) * 100);
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && Boolean(value.trim());
}

function stringAlias(source: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source?.[key];
    if (hasText(value)) return value as string;
  }
  return undefined;
}

export function getProfileValue(profile: ProfileV1, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current == null) return undefined;
    if (/^\d+$/.test(segment) && Array.isArray(current)) return current[Number(segment)];
    if (typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, profile);
}

export function setProfileValue(profile: ProfileV1, path: string, value: unknown): ProfileV1 {
  const clone = structuredClone(profile);
  const parts = path.split('.');
  let cursor: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (typeof next !== 'object' || next == null) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1) ?? ''] = value;
  clone.updatedAt = new Date().toISOString();
  return clone;
}
