import type { SupportedProvider } from '../types';

export interface ProviderModelOption {
  id: string;
  label?: string;
}

export interface ProviderPreset {
  id: SupportedProvider;
  label: string;
  defaultBaseUrl: string;
  apiKeyUrl: string;
  docsUrl: string;
  apiKeyHint: string;
  modelHint: string;
  models: ProviderModelOption[];
}

export const providerPresets: Record<SupportedProvider, ProviderPreset> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs/models',
    apiKeyHint: 'Open OpenAI Platform → API keys → Create new secret key.',
    modelHint: 'Use Refresh models after entering your API key. Presets are current documentation examples, not an entitlement guarantee.',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano' }
    ]
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    apiKeyHint: 'Open Anthropic Console → Settings → API keys → Create key.',
    modelHint: 'Use Refresh models after entering your key. Claude model availability depends on account access.',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-mythos-5', label: 'Claude Mythos 5 (limited availability)' }
    ]
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    apiKeyHint: 'Open Google AI Studio → Get API key → Create API key.',
    modelHint: 'Use Refresh models after entering your key. Prefer stable model IDs for production.',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' }
    ]
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot Kimi',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    apiKeyUrl: 'https://platform.kimi.ai/',
    docsUrl: 'https://platform.kimi.ai/docs/models',
    apiKeyHint: 'Open Kimi API Platform → sign in → apply/create an API key.',
    modelHint: 'Use Refresh models after entering your key. Kimi also exposes an OpenAI-compatible /models endpoint.',
    models: [
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
      { id: 'kimi-k2.7-code-highspeed', label: 'Kimi K2.7 Code High-Speed' },
      { id: 'kimi-k2.6', label: 'Kimi K2.6' },
      { id: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
      { id: 'moonshot-v1-128k', label: 'Moonshot v1 128K' }
    ]
  },
  zhipu: {
    id: 'zhipu',
    label: 'Zhipu GLM',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    apiKeyHint: 'Open BigModel/Zhipu user center → API keys → create or copy a key.',
    modelHint: 'Use Refresh models if your account exposes /models. Otherwise use one of the documented GLM model IDs.',
    models: [
      { id: 'glm-5.2', label: 'GLM-5.2' },
      { id: 'glm-5.1', label: 'GLM-5.1' },
      { id: 'glm-5', label: 'GLM-5' },
      { id: 'glm-5-turbo', label: 'GLM-5-Turbo' },
      { id: 'glm-4.7', label: 'GLM-4.7' },
      { id: 'glm-4.7-flashx', label: 'GLM-4.7-FlashX' },
      { id: 'glm-4.5-air', label: 'GLM-4.5 Air' },
      { id: 'glm-4.5', label: 'GLM-4.5' }
    ]
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/',
    apiKeyHint: 'Open DeepSeek Platform → API keys → create an API key.',
    modelHint: 'Use Refresh models after entering your key. DeepSeek also documents compatibility aliases.',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat (compatibility)' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (compatibility)' }
    ]
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    docsUrl: 'https://openrouter.ai/docs/guides/overview/models',
    apiKeyHint: 'Open OpenRouter → Settings → Keys → Create key. Optional credit limits are supported.',
    modelHint: 'Use Refresh models to fetch the current OpenRouter catalog.',
    models: [
      { id: 'openrouter/fusion', label: 'OpenRouter Fusion' },
      { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5' },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'moonshotai/kimi-k2.7-code', label: 'Kimi K2.7 Code' },
      { id: 'z-ai/glm-5.2', label: 'Z.ai GLM 5.2' },
      { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
    ]
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'Custom OpenAI-compatible',
    defaultBaseUrl: '',
    apiKeyUrl: '',
    docsUrl: '',
    apiKeyHint: 'Use the API key from your compatible provider.',
    modelHint: 'Enter the exact model ID and base URL from your provider. If /models is supported, Refresh models will list them.',
    models: []
  }
};

export const providerBaseUrls: Record<SupportedProvider, string> = Object.fromEntries(
  Object.values(providerPresets).map((preset) => [preset.id, preset.defaultBaseUrl])
) as Record<SupportedProvider, string>;

export function defaultModelForProvider(provider: SupportedProvider): string {
  return providerPresets[provider].models[0]?.id ?? '';
}
