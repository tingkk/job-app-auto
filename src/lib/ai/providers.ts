import type { FieldMapping, ProviderConfig } from '../types';
import type { AIProvider, AiMapFieldsInput, AiProfileExtraction } from './types';
import { AiProviderError } from './types';
import { sanitizeMapFieldsInput } from './sanitize';
import { fieldMappingsJsonSchema, fieldMappingsSchema, profileExtractionJsonSchema, profileExtractionSchema } from './schema';
import { providerBaseUrls } from './provider-metadata';

type JsonObject = Record<string, unknown>;
type ModelOption = { id: string; label?: string };

function ensureConfig(config: ProviderConfig) {
  if (!config.apiKey) throw new AiProviderError('Missing API key', 'missing-key');
  if (!config.model) throw new AiProviderError('Missing model ID', 'missing-model');
}

async function parseJsonResponse(response: Response): Promise<JsonObject> {
  const json = await readJsonResponse(response);
  if (!response.ok) {
    const detail = providerErrorMessage(json);
    throw new AiProviderError(`Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`, 'network');
  }
  return json;
}

async function readJsonResponse(response: Response): Promise<JsonObject> {
  try {
    return (await response.json()) as JsonObject;
  } catch {
    return {};
  }
}

function providerErrorMessage(json: JsonObject): string | undefined {
  const error = json.error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.status === 'string') return record.status;
  }
  if (typeof json.message === 'string') return json.message;
  return undefined;
}

async function getJson(
  config: ProviderConfig,
  path: string,
  headers: Record<string, string> = {},
  query = ''
): Promise<JsonObject> {
  ensureConfigForModels(config);
  const baseUrl = (config.baseUrl || providerBaseUrls[config.provider] || '').replace(/\/$/, '');
  if (!baseUrl) throw new AiProviderError('Missing base URL', 'missing-key');
  return parseJsonResponse(
    await fetch(`${baseUrl}${path}${query}`, {
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        ...headers
      }
    })
  );
}

function ensureConfigForModels(config: ProviderConfig) {
  if (!config.apiKey && !['openrouter'].includes(config.provider)) {
    throw new AiProviderError('Missing API key', 'missing-key');
  }
}

function parseOpenAiStyleModels(json: JsonObject): ModelOption[] {
  const data = json.data;
  if (!Array.isArray(data)) throw new AiProviderError('Model list response was not recognized', 'invalid-response');
  return data
    .map((model): ModelOption | undefined => {
      if (!model || typeof model !== 'object') return undefined;
      const record = model as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : undefined;
      if (!id) return undefined;
      const name = typeof record.name === 'string' ? record.name : undefined;
      const displayName = typeof record.display_name === 'string' ? record.display_name : undefined;
      return { id, label: displayName || name };
    })
    .filter((model): model is ModelOption => Boolean(model));
}

function parseGeminiModels(json: JsonObject): ModelOption[] {
  const models = json.models;
  if (!Array.isArray(models)) throw new AiProviderError('Gemini model list response was not recognized', 'invalid-response');
  return models
    .map((model): ModelOption | undefined => {
      if (!model || typeof model !== 'object') return undefined;
      const record = model as Record<string, unknown>;
      const rawName = typeof record.name === 'string' ? record.name : undefined;
      if (!rawName) return undefined;
      const methods = Array.isArray(record.supportedGenerationMethods) ? record.supportedGenerationMethods : [];
      if (methods.length && !methods.includes('generateContent')) return undefined;
      const id = rawName.replace(/^models\//, '');
      const label = typeof record.displayName === 'string' ? record.displayName : undefined;
      return { id, label };
    })
    .filter((model): model is ModelOption => Boolean(model));
}

function sortModels(models: ModelOption[]): ModelOption[] {
  const unique = new Map<string, ModelOption>();
  for (const model of models) unique.set(model.id, model);
  return Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function extractJsonText(json: JsonObject): string {
  const outputText = json.output_text;
  if (typeof outputText === 'string') return outputText;
  const directProfileExtraction = profileExtractionSchema.safeParse(json);
  if (directProfileExtraction.success) return JSON.stringify(directProfileExtraction.data);
  const directMappings = fieldMappingsSchema.safeParse(json);
  if (directMappings.success) return JSON.stringify(directMappings.data);
  const output = json.output;
  if (Array.isArray(output)) {
    const text = output
      .map((item) => (item && typeof item === 'object' ? textFromContentParts((item as Record<string, unknown>).content) : undefined))
      .filter(Boolean)
      .join('');
    if (text) return text;
  }
  const steps = json.steps;
  if (Array.isArray(steps)) {
    const text = steps
      .map((step) => textFromNestedProviderPart(step))
      .filter(Boolean)
      .join('');
    if (text) return text;
  }
  const choices = json.choices;
  if (Array.isArray(choices)) {
    const content = choices[0]?.message?.content;
    if (typeof content === 'string') return content;
    const text = textFromContentParts(content);
    if (text) return text;
  }
  const content = json.content;
  const text = textFromContentParts(content);
  if (text) return text;
  const candidates = json.candidates;
  if (Array.isArray(candidates)) {
    return candidates[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('') ?? '';
  }
  return JSON.stringify(json);
}

export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new AiProviderError('Provider returned invalid JSON', 'invalid-response');
    return JSON.parse(match[0]);
  }
}

function textFromContentParts(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.content === 'string') return record.content;
      return '';
    })
    .join('');
  return text || undefined;
}

function textFromNestedProviderPart(value: unknown, depth = 0): string {
  if (depth > 5 || value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => textFromNestedProviderPart(item, depth + 1)).join('');
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (typeof record.text === 'string') return record.text;
  for (const key of ['content', 'parts', 'output', 'result', 'message', 'response']) {
    const text = textFromNestedProviderPart(record[key], depth + 1);
    if (text) return text;
  }
  return '';
}

function buildMappingPrompt(input: AiMapFieldsInput): string {
  return [
    'Map job application form fields to explicit user profile values.',
    'Respond with only a JSON object of this shape: {"mappings": [{"fieldId": string, "value": string | boolean | string[], "source": "ai-live", "confidence": number, "profilePath": string | null, "explanation": string | null}]}. Confidence is between 0 and 1.',
    'Do not invent answers.',
    'Skip legal attestations, passwords, payments, signatures, CAPTCHA, and uncertain fields.',
    JSON.stringify(sanitizeMapFieldsInput(input))
  ].join('\n\n');
}

function buildProfileExtractionPrompt(cvText: string): string {
  return [
    'Extract a conservative profile patch from this CV text for a job-application autofill profile.',
    'Respond with only a JSON object of this shape: {"profilePatch": object, "confidence": number, "warnings": string[]}. Confidence is between 0 and 1.',
    'Use only facts explicitly present in the CV. Do not infer missing values.',
    'Prefer structured profile fields: identity, contact, address, links, education, employment, skills, languages, workAuthorization, preferences, demographics.',
    'For arrays, include stable generated ids when useful, such as link_1, education_1, employment_1, skill_1.',
    'If the CV text is empty, image-only, encrypted, or ambiguous, return an empty profilePatch with warnings.',
    cvText.slice(0, 50000)
  ].join('\n\n');
}

function parseProfileExtraction(json: JsonObject): AiProfileExtraction {
  const direct = profileExtractionSchema.safeParse(json);
  if (direct.success) return direct.data as AiProfileExtraction;
  const text = extractJsonText(json);
  const parsed = safeParseJson(text);
  const result = profileExtractionSchema.safeParse(parsed);
  if (result.success) return result.data as AiProfileExtraction;
  throw new AiProviderError(`Provider returned invalid CV extraction JSON: ${result.error.message}`, 'invalid-response');
}

function parseFieldMappings(json: JsonObject): FieldMapping[] {
  const direct = fieldMappingsSchema.safeParse(json);
  const parsed = direct.success ? direct.data : fieldMappingsSchema.parse(safeParseJson(extractJsonText(json)));
  return parsed.mappings.map((mapping) => ({ ...mapping, source: 'ai-live' }));
}

async function callOpenAiCompatible(
  config: ProviderConfig,
  path: string,
  body: JsonObject,
  headers: Record<string, string> = {}
) {
  ensureConfig(config);
  const baseUrl = (config.baseUrl || providerBaseUrls[config.provider] || '').replace(/\/$/, '');
  if (!baseUrl) throw new AiProviderError('Missing base URL', 'missing-key');
  return parseJsonResponse(
    await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body)
    })
  );
}

async function mapWithOpenAiCompatible(config: ProviderConfig, input: AiMapFieldsInput): Promise<FieldMapping[]> {
  const json = await callOpenAiCompatible(config, '/chat/completions', {
    model: config.model,
    messages: [{ role: 'user', content: buildMappingPrompt(input) }],
    response_format:
      config.provider === 'openrouter'
        ? { type: 'json_schema', json_schema: { name: 'field_mappings', strict: true, schema: fieldMappingsJsonSchema } }
        : { type: 'json_object' },
    temperature: 0
  });
  return parseFieldMappings(json);
}

export const openAiProvider: AIProvider = {
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: providerBaseUrls.openai,
  async validateConfiguration(config) {
    ensureConfig(config);
  },
  async listModels(config) {
    return sortModels(parseOpenAiStyleModels(await getJson(config, '/models')));
  },
  async extractProfile(config, cvText) {
    const json = await callOpenAiCompatible(config, '/responses', {
      model: config.model,
      input: [{ role: 'user', content: buildProfileExtractionPrompt(cvText) }],
      text: {
        format: {
          type: 'json_schema',
          name: 'profile_extraction',
          strict: false,
          schema: profileExtractionJsonSchema
        }
      }
    });
    return parseProfileExtraction(json);
  },
  async mapFields(config, input) {
    const json = await callOpenAiCompatible(config, '/responses', {
      model: config.model,
      input: [{ role: 'user', content: buildMappingPrompt(input) }],
      text: {
        format: { type: 'json_schema', name: 'field_mappings', strict: true, schema: fieldMappingsJsonSchema }
      }
    });
    return parseFieldMappings(json);
  }
};

export const anthropicProvider: AIProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  defaultBaseUrl: providerBaseUrls.anthropic,
  async validateConfiguration(config) {
    ensureConfig(config);
  },
  async listModels(config) {
    ensureConfigForModels(config);
    const baseUrl = (config.baseUrl || providerBaseUrls.anthropic).replace(/\/$/, '');
    const json = await parseJsonResponse(
      await fetch(`${baseUrl}/models`, {
        headers: {
          'x-api-key': config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      })
    );
    return sortModels(parseOpenAiStyleModels(json));
  },
  async extractProfile(config, cvText): Promise<AiProfileExtraction> {
    ensureConfig(config);
    const baseUrl = (config.baseUrl || providerBaseUrls.anthropic).replace(/\/$/, '');
    const json = await parseJsonResponse(
      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 4000,
          temperature: 0,
          messages: [{ role: 'user', content: buildProfileExtractionPrompt(cvText) }]
        })
      })
    );
    return parseProfileExtraction(json);
  },
  async mapFields(config, input) {
    ensureConfig(config);
    const baseUrl = (config.baseUrl || providerBaseUrls.anthropic).replace(/\/$/, '');
    const json = await parseJsonResponse(
      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 2000,
          temperature: 0,
          messages: [{ role: 'user', content: buildMappingPrompt(input) }]
        })
      })
    );
    return parseFieldMappings(json);
  }
};

export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultBaseUrl: providerBaseUrls.gemini,
  async validateConfiguration(config) {
    ensureConfig(config);
  },
  async listModels(config) {
    ensureConfigForModels(config);
    const baseUrl = (config.baseUrl || providerBaseUrls.gemini).replace(/\/$/, '');
    return sortModels(parseGeminiModels(await parseJsonResponse(await fetch(`${baseUrl}/models?key=${config.apiKey}`))));
  },
  async extractProfile(config, cvText): Promise<AiProfileExtraction> {
    const json = await callGeminiGenerateContent(config, buildProfileExtractionPrompt(cvText));
    return parseProfileExtraction(json);
  },
  async mapFields(config, input) {
    const json = await callGeminiGenerateContent(config, buildMappingPrompt(input));
    return parseFieldMappings(json);
  }
};

async function callGeminiGenerateContent(config: ProviderConfig, prompt: string): Promise<JsonObject> {
  ensureConfig(config);
  const baseUrl = (config.baseUrl || providerBaseUrls.gemini).replace(/\/$/, '');
  const model = (config.model ?? '').replace(/^models\//, '');
  return parseJsonResponse(
    await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.apiKey ?? ''
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json'
        }
      })
    })
  );
}

function compatibleProvider(id: ProviderConfig['provider'], label: string): AIProvider {
  return {
    id,
    label,
    defaultBaseUrl: providerBaseUrls[id],
    async validateConfiguration(config) {
      ensureConfig(config);
    },
    async listModels(config) {
      if (id === 'openrouter') {
        const baseUrl = (config.baseUrl || providerBaseUrls.openrouter).replace(/\/$/, '');
        return sortModels(parseOpenAiStyleModels(await parseJsonResponse(await fetch(`${baseUrl}/models`))));
      }
      return sortModels(parseOpenAiStyleModels(await getJson(config, '/models')));
    },
    async extractProfile(config, cvText): Promise<AiProfileExtraction> {
      const json = await callOpenAiCompatible(config, '/chat/completions', {
        model: config.model,
        messages: [{ role: 'user', content: buildProfileExtractionPrompt(cvText) }],
        response_format:
          id === 'openrouter'
            ? { type: 'json_schema', json_schema: { name: 'profile_extraction', strict: false, schema: profileExtractionJsonSchema } }
            : { type: 'json_object' },
        temperature: 0
      });
      return parseProfileExtraction(json);
    },
    mapFields: mapWithOpenAiCompatible
  };
}

export const aiProviders: Record<ProviderConfig['provider'], AIProvider> = {
  openai: openAiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  moonshot: compatibleProvider('moonshot', 'Moonshot Kimi'),
  zhipu: compatibleProvider('zhipu', 'Zhipu GLM'),
  deepseek: compatibleProvider('deepseek', 'DeepSeek'),
  openrouter: compatibleProvider('openrouter', 'OpenRouter'),
  'openai-compatible': compatibleProvider('openai-compatible', 'OpenAI-compatible')
};

export function getAiProvider(config: ProviderConfig): AIProvider | undefined {
  return aiProviders[config.provider];
}
