import { defaultSettings, isSitePaused } from '../src/lib/settings';
import {
  loadLastFillSession,
  loadProfile,
  loadResume,
  loadSettings,
  saveLastFillSession,
  saveProfile,
  saveSettings
} from '../src/lib/storage';
import type { FieldMapping } from '../src/lib/types';
import type { RuntimeMessage } from '../src/lib/messages';
import { deterministicMappings, mergeMappings } from '../src/lib/autofill/matcher';
import { getAiProvider } from '../src/lib/ai/providers';
import { cacheKey, getCachedMappings, setCachedMappings } from '../src/lib/ai/cache';
import { learnFromFieldValues } from '../src/lib/autofill/learning';
import { buildProfileDebugData } from '../src/lib/debug';

const CONTENT_SCRIPT_ID = 'job-app-autofill';
const ALL_SITES = ['http://*/*', 'https://*/*'];

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await loadSettings();
    await saveSettings({ ...defaultSettings, ...settings });
    await syncContentScriptRegistration();
  });
  chrome.runtime.onStartup.addListener(() => void syncContentScriptRegistration());
  chrome.permissions.onAdded.addListener(() => void syncContentScriptRegistration());
  chrome.permissions.onRemoved.addListener(() => void syncContentScriptRegistration());
  void syncContentScriptRegistration();

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        console.warn('Job Autofill background error', error);
        sendResponse({ error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  });
});

async function syncContentScriptRegistration(): Promise<void> {
  try {
    const granted = await chrome.permissions.contains({ origins: ALL_SITES });
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    if (granted && !registered.length) {
      await chrome.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          js: ['content-scripts/content.js'],
          matches: ALL_SITES,
          allFrames: true,
          runAt: 'document_idle',
          persistAcrossSessions: true
        }
      ]);
    } else if (!granted && registered.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
  } catch (error) {
    console.warn('Job Autofill content script registration error', error);
  }
}

async function handleMessage(message: RuntimeMessage): Promise<unknown> {
  if (message.type === 'GET_FILL_CONTEXT') {
    const settings = await loadSettings();
    if (isSitePaused(settings, message.domain)) {
      const debugData = settings.debugMode ? buildProfileDebugData(await loadProfile()) : undefined;
      return { paused: true, mappings: [], debugMode: settings.debugMode, debugData };
    }
    if (!message.descriptors.length) {
      const debugData = settings.debugMode ? buildProfileDebugData(await loadProfile()) : undefined;
      return { paused: false, mappings: [], debugMode: settings.debugMode, debugData };
    }

    const [profile, resume] = await Promise.all([loadProfile(), loadResume().catch(() => undefined)]);
    const debugData = settings.debugMode ? buildProfileDebugData(profile) : undefined;
    const deterministic = deterministicMappings(message.descriptors, profile, resume, message.domain);
    let mappings: FieldMapping[] = deterministic;

    if (settings.autoAiAnalysis && settings.provider.enabled && settings.provider.apiKey && settings.provider.model) {
      const provider = getAiProvider(settings.provider);
      if (provider) {
        try {
          const key = cacheKey(
            settings.provider,
            message.domain,
            message.descriptors,
            message.descriptors[0]?.language ?? 'unknown',
            profile
          );
          const cached = await getCachedMappings(key);
          if (cached) {
            mappings = mergeMappings(mappings, cached);
          } else {
            const aiMappings = await provider.mapFields(settings.provider, {
              profile,
              fields: message.descriptors,
              pageTitle: message.pageTitle,
              domain: message.domain,
              ats: message.ats,
              language: message.descriptors[0]?.language ?? 'unknown'
            });
            await setCachedMappings(key, aiMappings);
            mappings = mergeMappings(mappings, aiMappings);
          }
        } catch (error) {
          console.info('AI mapping unavailable; using deterministic mappings', error);
        }
      }
    }

    return { paused: false, mappings, debugMode: settings.debugMode, debugData };
  }

  if (message.type === 'SAVE_FILL_SESSION') {
    await saveLastFillSession(message.session);
    return { ok: true };
  }

  if (message.type === 'LEARN_FIELD_VALUES') {
    const settings = await loadSettings();
    const domain = message.observations[0]?.domain;
    if (!settings.learnFromUserInput || !domain || isSitePaused(settings, domain)) {
      return { ok: true, learned: 0, updated: 0, skipped: message.observations.length };
    }
    const profile = await loadProfile();
    const result = learnFromFieldValues(profile, message.observations);
    if (result.learned || result.updated) await saveProfile(result.profile);
    return { ok: true, learned: result.learned, updated: result.updated, skipped: result.skipped };
  }

  if (message.type === 'EXTRACT_PROFILE_FROM_CV') {
    const settings = await loadSettings();
    if (!settings.provider.enabled || !settings.provider.apiKey || !settings.provider.model) {
      return { error: 'Enable an AI provider with an API key and model before parsing CVs with AI.' };
    }
    const provider = getAiProvider(settings.provider);
    if (!provider) return { error: `No AI provider found for ${settings.provider.provider}.` };
    try {
      return { extraction: await provider.extractProfile(settings.provider, message.cvText) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (message.type === 'FETCH_PROVIDER_MODELS') {
    const provider = getAiProvider(message.provider);
    if (!provider?.listModels) return { models: [] };
    return { models: await provider.listModels(message.provider) };
  }

  if (message.type === 'UNDO_LAST_FILL') {
    return { session: await loadLastFillSession() };
  }

  if (message.type === 'GET_STATUS') {
    const settings = await loadSettings();
    return {
      settings,
      sitePaused: message.domain ? isSitePaused(settings, message.domain) : settings.globalPaused
    };
  }

  if (message.type === 'SET_GLOBAL_PAUSED') {
    const settings = await loadSettings();
    await saveSettings({ ...settings, globalPaused: message.paused });
    return { ok: true };
  }

  if (message.type === 'SET_SITE_PAUSED') {
    const settings = await loadSettings();
    await saveSettings({
      ...settings,
      pausedSites: { ...settings.pausedSites, [message.domain]: message.paused }
    });
    return { ok: true };
  }

  return { ok: false };
}
