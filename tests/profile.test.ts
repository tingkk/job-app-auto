import { describe, expect, it } from 'vitest';
import { emptyProfile, normalizeProfile, profileCompleteness } from '../src/lib/profile';
import type { ProfileV1 } from '../src/lib/types';

describe('profile completeness', () => {
  it('counts filled values across arrays instead of only the first entry', () => {
    const profile = emptyProfile();
    profile.identity.firstName = 'Ada';
    profile.identity.lastName = 'Lovelace';
    profile.contact.email = 'ada@example.com';
    profile.contact.phone = '+1 555 0100';
    profile.address.city = 'London';
    profile.links = [
      { id: 'empty', label: 'Website', url: '' },
      { id: 'github', label: 'GitHub', url: 'https://github.com/ada' }
    ];
    profile.employment = [
      { id: 'empty-job', company: '', title: '' },
      { id: 'job', company: 'Analytical Engines', title: 'Engineer' }
    ];
    profile.education = [
      { id: 'empty-school', school: '' },
      { id: 'school', school: 'University of London' }
    ];
    profile.skills = [
      { id: 'empty-skill', name: '' },
      { id: 'skill', name: 'TypeScript' }
    ];

    expect(profileCompleteness(profile)).toBe(100);
  });

  it('normalizes common AI name aliases into first and last name', () => {
    const profile = normalizeProfile({
      identity: {
        givenName: 'Ada',
        familyName: 'Lovelace'
      }
    } as unknown as Partial<ProfileV1>);

    expect(profile.identity.firstName).toBe('Ada');
    expect(profile.identity.lastName).toBe('Lovelace');
  });
});
