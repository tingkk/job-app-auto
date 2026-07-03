import type {
  EducationEntry,
  EmploymentEntry,
  LanguageEntry,
  LinkProfile,
  ProfileV1,
  SkillEntry
} from './types';
import { getProfileValue, newId, normalizeProfile, setProfileValue } from './profile';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

export interface ExtractedCv {
  text: string;
  suggestedProfile: Partial<ProfileV1>;
}

export interface ProfilePatchPreviewItem {
  path: string;
  current: unknown;
  suggested: unknown;
  action: 'add' | 'update' | 'unchanged';
}

export interface ExtractCvOptions {
  onProgress?: (message: string) => void;
}

const PDF_LOAD_TIMEOUT_MS = 30000;
const PDF_PAGE_TIMEOUT_MS = 10000;

export async function extractCv(file: File, options: ExtractCvOptions = {}): Promise<ExtractedCv> {
  options.onProgress?.(`Reading ${file.name}…`);
  const buffer = await file.arrayBuffer();
  options.onProgress?.(`Extracting text from ${file.name}…`);
  const text = file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')
    ? await extractPdfText(buffer, options)
    : await extractDocxText(buffer);
  options.onProgress?.('Inferring profile fields from CV…');
  return {
    text,
    suggestedProfile: inferProfileFromText(text)
  };
}

export async function extractPdfText(buffer: ArrayBuffer, options: ExtractCvOptions = {}): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false });
  loadingTask.onProgress = (progress: { loaded?: number; total?: number }) => {
    if (!progress.total) return;
    options.onProgress?.(`Loading PDF ${Math.round((progress.loaded ?? 0) / progress.total * 100)}%…`);
  };
  const pdf = await withTimeout(
    loadingTask.promise,
    PDF_LOAD_TIMEOUT_MS,
    'PDF text extraction did not start within 30 seconds. The file may be encrypted, malformed, or blocked by the PDF worker.',
    () => void loadingTask.destroy()
  );
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    options.onProgress?.(`Extracting text from PDF page ${pageNumber} of ${pdf.numPages}…`);
    const page = await pdf.getPage(pageNumber);
    const content = await withTimeout(
      page.getTextContent(),
      PDF_PAGE_TIMEOUT_MS,
      `Timed out extracting text from PDF page ${pageNumber}.`
    );
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return cleanText(pages.join('\n'));
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser');
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return cleanText(result.value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function cleanText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function inferProfileFromText(text: string): Partial<ProfileV1> {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim();
  const linkedIn = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i)?.[0];
  const github = text.match(/https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i)?.[0];
  const candidateName = lines.find((line) => {
    if (line.includes('@') || line.length > 80) return false;
    return /^[\p{L}\s.'-]{2,}$/u.test(line);
  });

  const nameParts = (candidateName ?? '').split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? '';
  const lastName = nameParts.slice(1).join(' ');

  return normalizeProfile({
    identity: {
      firstName,
      lastName,
      fullName: candidateName ?? ''
    },
    contact: {
      email,
      phone
    },
    links: [
      ...(linkedIn ? [{ id: newId('link'), label: 'LinkedIn', url: linkedIn, kind: 'linkedin' as const }] : []),
      ...(github ? [{ id: newId('link'), label: 'GitHub', url: github, kind: 'github' as const }] : [])
    ]
  });
}

export function normalizeCvProfilePatch(suggested: Partial<ProfileV1>): Partial<ProfileV1> {
  const patch: Partial<ProfileV1> = {};
  for (const key of ['identity', 'contact', 'address', 'workAuthorization', 'preferences', 'demographics'] as const) {
    const value = compactObject(suggested[key]);
    if (value) patch[key] = value as never;
  }
  const links = normalizeLinks(suggested.links);
  if (links.length) patch.links = links;
  const education = normalizeEducation(suggested.education);
  if (education.length) patch.education = education;
  const employment = normalizeEmployment(suggested.employment);
  if (employment.length) patch.employment = employment;
  const skills = normalizeSkills(suggested.skills);
  if (skills.length) patch.skills = skills;
  const languages = normalizeLanguages(suggested.languages);
  if (languages.length) patch.languages = languages;
  return patch;
}

export function diffProfile(current: ProfileV1, suggested: Partial<ProfileV1>): ProfilePatchPreviewItem[] {
  return previewProfilePatch(current, suggested).filter((item) => item.action !== 'unchanged');
}

export function previewProfilePatch(current: ProfileV1, suggested: Partial<ProfileV1>): ProfilePatchPreviewItem[] {
  const patch = normalizeCvProfilePatch(suggested);
  const items: ProfilePatchPreviewItem[] = [];
  for (const [path, value] of flattenPatch(patch)) {
    const before = getProfileValue(current, path);
    if (!hasMeaningfulValue(value)) continue;
    items.push({
      path,
      current: before,
      suggested: value,
      action: valuesEqual(before, value) ? 'unchanged' : hasMeaningfulValue(before) ? 'update' : 'add'
    });
  }
  for (const section of ['links', 'education', 'employment', 'skills', 'languages'] as const) {
    const sectionItems = patch[section] ?? [];
    const existing = current[section] ?? [];
    sectionItems.forEach((item, index) => {
      const matchingExisting = existing.find((candidate) => arrayItemsMatch(section, candidate, item));
      items.push({
        path: `${section}[${index}]`,
        current: matchingExisting,
        suggested: item,
        action: matchingExisting ? 'unchanged' : 'add'
      });
    });
  }
  return items;
}

export function applyProfilePatch(current: ProfileV1, suggested: Partial<ProfileV1>): ProfileV1 {
  const patch = normalizeCvProfilePatch(suggested);
  let next = current;
  for (const [path, value] of flattenPatch(patch)) {
    if (!hasMeaningfulValue(value)) continue;
    next = setProfileValue(next, path, value);
  }
  for (const section of ['links', 'education', 'employment', 'skills', 'languages'] as const) {
    const items = patch[section] ?? [];
    if (!items.length) continue;
    const existing = next[section] as unknown[];
    const additions = items.filter((item) => !existing.some((candidate) => arrayItemsMatch(section, candidate, item)));
    if (additions.length) next = setProfileValue(next, section, [...existing, ...additions]);
  }
  return normalizeProfile({ ...next, updatedAt: new Date().toISOString() });
}

export function mergeCvProfilePatches(fallback: Partial<ProfileV1>, primary: Partial<ProfileV1>): Partial<ProfileV1> {
  const fallbackPatch = normalizeCvProfilePatch(fallback);
  const primaryPatch = normalizeCvProfilePatch(primary);
  const merged: Partial<ProfileV1> = {};

  for (const key of ['identity', 'contact', 'address', 'workAuthorization', 'preferences', 'demographics'] as const) {
    const value = deepMergeObjects(fallbackPatch[key], primaryPatch[key]);
    if (value) merged[key] = value as never;
  }

  for (const key of ['links', 'education', 'employment', 'skills', 'languages'] as const) {
    const primaryItems = primaryPatch[key] ?? [];
    const fallbackItems = fallbackPatch[key] ?? [];
    if (primaryItems.length) merged[key] = primaryItems as never;
    else if (fallbackItems.length) merged[key] = fallbackItems as never;
  }

  return normalizeCvProfilePatch(merged);
}

export function cleanCvWarnings(warnings: string[]): string[] {
  const seen = new Set<string>();
  return warnings
    .map((warning) => warning.replace(/\s+/g, ' ').trim())
    .filter((warning) => warning.length >= 10)
    .filter((warning) => /[\p{L}\p{N}]/u.test(warning))
    .filter((warning) => {
      const key = warning.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function flattenPatch(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const entries: Array<[string, unknown]> = [];
  for (const [key, nested] of Object.entries(value)) {
    if (['schemaVersion', 'updatedAt', 'resume', 'reusableAnswers'].includes(key)) continue;
    if (Array.isArray(nested)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (nested && typeof nested === 'object') entries.push(...flattenPatch(nested, path));
    else entries.push([path, nested]);
  }
  return entries;
}

function compactObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const compacted = compactObject(nested);
      if (compacted) result[key] = compacted;
    } else if (hasMeaningfulValue(nested)) {
      result[key] = nested;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function deepMergeObjects(fallback: unknown, primary: unknown): Record<string, unknown> | undefined {
  const fallbackObject = compactObject(fallback);
  const primaryObject = compactObject(primary);
  if (!fallbackObject && !primaryObject) return undefined;
  const result: Record<string, unknown> = { ...(fallbackObject ?? {}) };
  for (const [key, value] of Object.entries(primaryObject ?? {})) {
    const fallbackValue = result[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && fallbackValue && typeof fallbackValue === 'object' && !Array.isArray(fallbackValue)) {
      const merged = deepMergeObjects(fallbackValue, value);
      if (merged) result[key] = merged;
    } else {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeLinks(items: unknown): LinkProfile[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index): LinkProfile | undefined => {
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Partial<LinkProfile>;
      if (!record.url) return undefined;
      return {
        id: record.id || newId(`link_${index + 1}`),
        label: record.label || labelForUrl(record.url),
        url: record.url,
        kind: record.kind
      };
    })
    .filter(isDefined);
}

function normalizeEducation(items: unknown): EducationEntry[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index): EducationEntry | undefined => {
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Partial<EducationEntry>;
      if (!record.school) return undefined;
      return { id: record.id || newId(`education_${index + 1}`), school: record.school, degree: record.degree, field: record.field, startDate: record.startDate, endDate: record.endDate, gpa: record.gpa };
    })
    .filter(isDefined);
}

function normalizeEmployment(items: unknown): EmploymentEntry[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index): EmploymentEntry | undefined => {
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Partial<EmploymentEntry>;
      if (!record.company || !record.title) return undefined;
      return { id: record.id || newId(`employment_${index + 1}`), company: record.company, title: record.title, location: record.location, startDate: record.startDate, endDate: record.endDate, current: record.current, description: record.description };
    })
    .filter(isDefined);
}

function normalizeSkills(items: unknown): SkillEntry[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index): SkillEntry | undefined => {
      if (typeof item === 'string') return { id: newId(`skill_${index + 1}`), name: item };
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Partial<SkillEntry>;
      if (!record.name) return undefined;
      return { id: record.id || newId(`skill_${index + 1}`), name: record.name, level: record.level };
    })
    .filter(isDefined);
}

function normalizeLanguages(items: unknown): LanguageEntry[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index): LanguageEntry | undefined => {
      if (typeof item === 'string') return { id: newId(`language_${index + 1}`), name: item };
      if (!item || typeof item !== 'object') return undefined;
      const record = item as Partial<LanguageEntry>;
      if (!record.name) return undefined;
      return { id: record.id || newId(`language_${index + 1}`), name: record.name, proficiency: record.proficiency };
    })
    .filter(isDefined);
}

function isDefined<T>(value: T | undefined): value is T {
  return Boolean(value);
}

function arrayItemsMatch(section: string, current: unknown, suggested: unknown): boolean {
  const currentKey = arrayItemKey(section, current);
  const suggestedKey = arrayItemKey(section, suggested);
  return Boolean(currentKey && suggestedKey && currentKey === suggestedKey);
}

function arrayItemKey(section: string, item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const record = item as Record<string, unknown>;
  if (section === 'links') return normalizeKey(record.url);
  if (section === 'education') return normalizeKey([record.school, record.degree, record.field].join('|'));
  if (section === 'employment') return normalizeKey([record.company, record.title, record.startDate].join('|'));
  if (section === 'skills' || section === 'languages') return normalizeKey(record.name);
  return '';
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return value != null;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function labelForUrl(url: string): string {
  if (/linkedin/i.test(url)) return 'LinkedIn';
  if (/github/i.test(url)) return 'GitHub';
  return 'Website';
}
