import type { ExtensionSettings, ProviderConfig } from './types';
import { defaultModelForProvider, providerPresets } from './ai/provider-metadata';

export const defaultSettings: ExtensionSettings = {
  onboarded: false,
  globalPaused: false,
  pausedSites: {},
  autoAiAnalysis: true,
  learnFromUserInput: true,
  debugMode: false,
  languageScope: ['en', 'zh-Hans', 'zh-Hant'],
  provider: {
    provider: 'openai',
    enabled: false,
    model: defaultModelForProvider('openai'),
    baseUrl: providerPresets.openai.defaultBaseUrl
  }
};

export function isSitePaused(settings: ExtensionSettings, hostname: string): boolean {
  return settings.globalPaused || Boolean(settings.pausedSites[hostname]);
}

export function normalizeProviderConfig(provider: Partial<ProviderConfig> | undefined): ProviderConfig {
  const selectedProvider = provider?.provider ?? defaultSettings.provider.provider;
  const preset = providerPresets[selectedProvider];
  return {
    ...defaultSettings.provider,
    ...provider,
    provider: selectedProvider,
    baseUrl: provider?.baseUrl || preset.defaultBaseUrl,
    model: provider?.model || defaultModelForProvider(selectedProvider)
  };
}

export function normalizeSettings(settings: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  return {
    ...defaultSettings,
    ...settings,
    pausedSites: settings?.pausedSites ?? defaultSettings.pausedSites,
    languageScope: settings?.languageScope ?? defaultSettings.languageScope,
    provider: normalizeProviderConfig(settings?.provider)
  };
}
