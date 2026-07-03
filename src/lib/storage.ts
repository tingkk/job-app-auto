import { emptyProfile, normalizeProfile } from './profile';
import { normalizeSettings } from './settings';
import type { ExtensionSettings, FillSession, ProfileV1 } from './types';

const PROFILE_KEY = 'profile:v1';
const SETTINGS_KEY = 'settings:v1';
const LAST_SESSION_KEY = 'last-fill-session:v1';

async function getLocal<T>(key: string): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return undefined;
  const result = await chrome.storage.local.get(key);
  return result[key] as T | undefined;
}

async function setLocal<T>(key: string, value: T): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [key]: value });
}

export async function loadProfile(): Promise<ProfileV1> {
  return normalizeProfile((await getLocal<Partial<ProfileV1>>(PROFILE_KEY)) ?? emptyProfile());
}

export async function saveProfile(profile: ProfileV1): Promise<void> {
  await setLocal(PROFILE_KEY, normalizeProfile(profile));
}

export async function loadSettings(): Promise<ExtensionSettings> {
  return normalizeSettings(await getLocal<Partial<ExtensionSettings>>(SETTINGS_KEY));
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await setLocal(SETTINGS_KEY, settings);
}

export async function saveLastFillSession(session: FillSession): Promise<void> {
  await setLocal(LAST_SESSION_KEY, session);
}

export async function loadLastFillSession(): Promise<FillSession | undefined> {
  return getLocal<FillSession>(LAST_SESSION_KEY);
}

export interface StoredResume {
  fileName: string;
  mimeType: string;
  size: number;
  importedAt: string;
  text: string;
  buffer: ArrayBuffer;
}

const DB_NAME = 'job-app-auto';
const DB_VERSION = 1;
const RESUME_STORE = 'resume';
const RESUME_KEY = 'latest';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESUME_STORE)) db.createObjectStore(RESUME_STORE);
    };
  });
}

export async function saveResume(resume: StoredResume): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RESUME_STORE, 'readwrite');
    tx.objectStore(RESUME_STORE).put(resume, RESUME_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadResume(): Promise<StoredResume | undefined> {
  const db = await openDb();
  const value = await new Promise<StoredResume | undefined>((resolve, reject) => {
    const tx = db.transaction(RESUME_STORE, 'readonly');
    const request = tx.objectStore(RESUME_STORE).get(RESUME_KEY);
    request.onsuccess = () => resolve(request.result as StoredResume | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}
