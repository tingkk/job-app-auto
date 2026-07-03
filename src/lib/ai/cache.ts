import type { FieldDescriptor, FieldMapping, ProfileV1, ProviderConfig } from '../types';

const CACHE_KEY = 'ai-field-cache:v1';

interface CacheRecord {
  key: string;
  mappings: FieldMapping[];
  createdAt: string;
}

async function loadCache(): Promise<Record<string, CacheRecord>> {
  const result = await chrome.storage.local.get(CACHE_KEY);
  return (result[CACHE_KEY] as Record<string, CacheRecord> | undefined) ?? {};
}

async function saveCache(cache: Record<string, CacheRecord>): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

export function formSignature(fields: FieldDescriptor[]): string {
  const seed = fields
    .map((field) => [field.kind, field.autocomplete, field.questionText, field.options.map((o) => o.label).join('|')].join(':'))
    .join('\n');
  return simpleHash(seed);
}

export function cacheKey(
  provider: ProviderConfig,
  domain: string,
  fields: FieldDescriptor[],
  language: string,
  profile: ProfileV1
): string {
  return [
    provider.provider,
    provider.model,
    domain,
    formSignature(fields),
    language,
    profile.updatedAt,
    profile.schemaVersion
  ].join('|');
}

export async function getCachedMappings(key: string): Promise<FieldMapping[] | undefined> {
  const cache = await loadCache();
  const record = cache[key];
  if (!record) return undefined;
  return record.mappings.map((mapping) => ({ ...mapping, source: 'ai-cache' }));
}

export async function setCachedMappings(key: string, mappings: FieldMapping[]): Promise<void> {
  const cache = await loadCache();
  cache[key] = { key, mappings, createdAt: new Date().toISOString() };
  const records = Object.values(cache)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-100);
  await saveCache(Object.fromEntries(records.map((record) => [record.key, record])));
}

function simpleHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
