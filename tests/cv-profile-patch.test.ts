import { describe, expect, it } from 'vitest';
import { applyProfilePatch, cleanCvWarnings, diffProfile, mergeCvProfilePatches, previewProfilePatch } from '../src/lib/cv';
import { emptyProfile } from '../src/lib/profile';
import type { ProfileV1 } from '../src/lib/types';

describe('CV profile patch preview and merge', () => {
  it('previews scalar updates and new array entries', () => {
    const profile = emptyProfile();
    profile.contact.email = 'old@example.com';

    const diffs = diffProfile(profile, {
      contact: { email: 'new@example.com' },
      links: [{ id: 'link_1', label: 'GitHub', url: 'https://github.com/ada', kind: 'github' }],
      skills: [{ id: 'skill_1', name: 'TypeScript' }]
    } as unknown as Partial<ProfileV1>);

    expect(diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'contact.email', action: 'update', suggested: 'new@example.com' }),
        expect.objectContaining({ path: 'links[0]', action: 'add' }),
        expect.objectContaining({ path: 'skills[0]', action: 'add' })
      ])
    );
  });

  it('applies approved extracted content and creates missing profile entries', () => {
    const profile = emptyProfile();
    profile.identity.firstName = 'Ada';
    profile.links.push({ id: 'existing_link', label: 'GitHub', url: 'https://github.com/ada', kind: 'github' });

    const next = applyProfilePatch(profile, {
      identity: { fullName: 'Ada Lovelace' },
      links: [
        { id: 'duplicate_link', label: 'GitHub', url: 'https://github.com/ada', kind: 'github' },
        { id: 'portfolio_link', label: 'Portfolio', url: 'https://ada.example.com', kind: 'portfolio' }
      ],
      employment: [{ id: 'job_1', company: 'Analytical Engines', title: 'Software Engineer' }],
      skills: ['TypeScript', 'React'] as never
    } as unknown as Partial<ProfileV1>);

    expect(next.identity.fullName).toBe('Ada Lovelace');
    expect(next.links.map((link) => link.url)).toEqual(['https://github.com/ada', 'https://ada.example.com']);
    expect(next.employment).toEqual([expect.objectContaining({ company: 'Analytical Engines', title: 'Software Engineer' })]);
    expect(next.skills.map((skill) => skill.name)).toEqual(['TypeScript', 'React']);
  });

  it('previews unchanged extracted fields so the user can still review and edit them', () => {
    const profile = emptyProfile();
    profile.contact.email = 'ada@example.com';

    const preview = previewProfilePatch(profile, {
      contact: { email: 'ada@example.com' },
      skills: [{ id: 'skill_1', name: 'TypeScript' }]
    } as unknown as Partial<ProfileV1>);

    expect(preview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'contact.email', action: 'unchanged', suggested: 'ada@example.com' }),
        expect.objectContaining({ path: 'skills[0]', action: 'add' })
      ])
    );
  });

  it('uses local CV extraction fields when AI returns an empty profile patch', () => {
    const merged = mergeCvProfilePatches(
      {
        identity: { fullName: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace' },
        contact: { email: 'ada@example.com' }
      } as unknown as Partial<ProfileV1>,
      {
        profilePatch: {}
      } as unknown as Partial<ProfileV1>
    );

    expect(merged).toEqual(
      expect.objectContaining({
        identity: expect.objectContaining({ fullName: 'Ada Lovelace' }),
        contact: expect.objectContaining({ email: 'ada@example.com' })
      })
    );
  });

  it('lets AI profile fields override local fallback fields', () => {
    const merged = mergeCvProfilePatches(
      {
        identity: { fullName: 'Ada L.', firstName: 'Ada' },
        contact: { email: 'local@example.com', phone: '+852 1234 5678' }
      } as unknown as Partial<ProfileV1>,
      {
        identity: { fullName: 'Ada Lovelace' },
        contact: { email: 'ai@example.com' }
      } as unknown as Partial<ProfileV1>
    );

    expect(merged.identity?.fullName).toBe('Ada Lovelace');
    expect(merged.identity?.firstName).toBe('Ada');
    expect(merged.contact?.email).toBe('ai@example.com');
    expect(merged.contact?.phone).toBe('+852 1234 5678');
  });

  it('removes low-value provider warnings', () => {
    expect(cleanCvWarnings(['The 2', 'The _', 'The CV text is image-only', 'The CV text is image-only'])).toEqual([
      'The CV text is image-only'
    ]);
  });
});
