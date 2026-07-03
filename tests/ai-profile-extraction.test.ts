import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiProviders, anthropicProvider, extractJsonText, geminiProvider, safeParseJson } from '../src/lib/ai/providers';
import { fieldMappingsSchema, profileExtractionSchema } from '../src/lib/ai/schema';
import type { ProviderConfig } from '../src/lib/types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI profile extraction response parsing', () => {
  it('extracts JSON text from OpenAI Responses API output content', () => {
    const text = extractJsonText({
      id: 'resp_123',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: '{"profilePatch":{"identity":{"fullName":"Ada Lovelace"}},"confidence":0.91,"warnings":[]}'
            }
          ]
        }
      ]
    });

    expect(profileExtractionSchema.parse(safeParseJson(text))).toEqual({
      profilePatch: { identity: { fullName: 'Ada Lovelace' } },
      confidence: 0.91,
      warnings: []
    });
  });

  it('accepts null profilePath and explanation from strict-schema providers', () => {
    const parsed = fieldMappingsSchema.parse({
      mappings: [{ fieldId: 'first', value: 'Ada', source: 'ai-live', confidence: 0.9, profilePath: null, explanation: null }]
    });
    expect(parsed.mappings[0]).toMatchObject({ fieldId: 'first', value: 'Ada' });
    expect(parsed.mappings[0]?.profilePath).toBeUndefined();
    expect(parsed.mappings[0]?.explanation).toBeUndefined();
  });

  it('rejects provider envelopes instead of defaulting to zero confidence', () => {
    expect(() =>
      profileExtractionSchema.parse({
        id: 'resp_123',
        output: []
      })
    ).toThrow();
  });

  it('uses the Gemini generateContent API for CV profile extraction', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: '{"profilePatch":{"identity":{"fullName":"Ada Lovelace"}},"confidence":0.91,"warnings":[]}' }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const config: ProviderConfig = {
      provider: 'gemini',
      enabled: true,
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
    };
    const extraction = await geminiProvider.extractProfile(config, 'Ada Lovelace');
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect((init as RequestInit).headers).toMatchObject({
      'content-type': 'application/json',
      'x-goog-api-key': 'test-key'
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.contents[0].parts[0].text).toContain('Ada Lovelace');
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json' });
    expect(extraction.profilePatch.identity?.fullName).toBe('Ada Lovelace');
  });

  it('parses Gemini step envelopes for CV profile extraction', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'interaction_123',
          status: 'completed',
          model: 'gemini-2.5-flash',
          steps: [
            {
              type: 'model_output',
              content: [
                {
                  type: 'text',
                  text: '{"profilePatch":{"identity":{"fullName":"Grace Hopper"}},"confidence":0.88,"warnings":[]}'
                }
              ]
            }
          ],
          usage: {}
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const extraction = await geminiProvider.extractProfile(
      {
        provider: 'gemini',
        enabled: true,
        apiKey: 'test-key',
        model: 'gemini-2.5-flash'
      },
      'Grace Hopper'
    );

    expect(extraction).toEqual({
      profilePatch: { identity: { fullName: 'Grace Hopper' } },
      confidence: 0.88,
      warnings: []
    });
  });

  it('parses Anthropic content envelopes for CV profile extraction', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: '{"profilePatch":{"identity":{"fullName":"Katherine Johnson"}},"confidence":0.9,"warnings":[]}'
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const extraction = await anthropicProvider.extractProfile(
      {
        provider: 'anthropic',
        enabled: true,
        apiKey: 'test-key',
        model: 'claude-sonnet-4-6'
      },
      'Katherine Johnson'
    );

    expect(extraction.profilePatch.identity?.fullName).toBe('Katherine Johnson');
  });

  it('parses OpenAI-compatible chat completion envelopes for CV profile extraction', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"profilePatch":{"identity":{"fullName":"Margaret Hamilton"}},"confidence":0.86,"warnings":[]}'
              }
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const extraction = await aiProviders.deepseek.extractProfile(
      {
        provider: 'deepseek',
        enabled: true,
        apiKey: 'test-key',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1'
      },
      'Margaret Hamilton'
    );

    expect(extraction.profilePatch.identity?.fullName).toBe('Margaret Hamilton');
  });

  it('includes provider error detail for Gemini HTTP failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Model does not support requested output schema' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    );

    await expect(
      geminiProvider.extractProfile(
        {
          provider: 'gemini',
          enabled: true,
          apiKey: 'test-key',
          model: 'gemini-2.5-flash'
        },
        'Ada Lovelace'
      )
    ).rejects.toThrow('Provider returned HTTP 400: Model does not support requested output schema');
  });
});
