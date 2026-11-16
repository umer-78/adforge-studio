import * as z from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmCost } from '../../ai/llm';
import { geminiBody, geminiCost, geminiSchema, noQuotaForModel, structuredGemini } from './gemini';

const schema = z.object({ title: z.string(), shots: z.array(z.object({ seconds: z.number(), line: z.string() })), mood: z.enum(['calm', 'bold']).optional() });

describe('geminiSchema', () => {
  it('drops the $schema marker Gemini rejects and keeps the shape', () => {
    const s = geminiSchema(schema);
    expect(s.$schema).toBeUndefined();
    expect(s.type).toBe('object');
    expect(Object.keys(s.properties as object)).toEqual(['title', 'shots', 'mood']);
    expect(s.required).toEqual(['title', 'shots']);
  });
});

describe('geminiBody', () => {
  it('sends the system prompt, labelled inline images and a JSON response schema', async () => {
    const body = await geminiBody({
      schema,
      system: 'You write ads.',
      prompt: 'Idea: a lamp',
      images: [{ label: 'Product photo', image: { base64: 'AAAA', mediaType: 'image/png' } }],
      maxTokens: 999_999,
    });
    expect(body.systemInstruction.parts[0]!.text).toBe('You write ads.');
    expect(body.contents[0]!.parts).toEqual([{ text: 'Product photo' }, { inline_data: { mime_type: 'image/png', data: 'AAAA' } }, { text: 'Idea: a lamp' }]);
    expect(body.generationConfig).toMatchObject({ responseFormat: { text: { mimeType: 'APPLICATION_JSON' } }, maxOutputTokens: 65_536 });
  });

  it('has a legacy form for API versions without responseFormat', async () => {
    const body = await geminiBody({ schema, system: 's', prompt: 'p' }, 'legacy');
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 16_000 });
    expect((body.generationConfig as { responseJsonSchema: { type: string } }).responseJsonSchema.type).toBe('object');
  });
});

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) =>
  reply(200, {
    candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(data) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
    modelVersion: 'gemini-3.8-flash',
  });
const good = { title: 'Lamp', shots: [{ seconds: 3, line: 'Hook' }] };

describe('structuredGemini', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses the answer, skips thoughts and bills thinking as output', async () => {
    const fetch = vi.fn().mockResolvedValue(ok(good));
    vi.stubGlobal('fetch', fetch);
    const res = await structuredGemini({ apiKey: 'k', schema, system: 's', prompt: 'p', model: 'gemini-test' });
    expect(res.data).toEqual(good);
    expect(res.usage).toEqual({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 });
    expect(res.model).toBe('gemini-3.8-flash');
    expect(fetch.mock.calls[0]![0]).toContain('/models/gemini-test:generateContent');
    expect(fetch.mock.calls[0]![1].headers['x-goog-api-key']).toBe('k');
  });

  it('resends with the legacy schema field when the API does not know responseFormat', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(400, { error: { message: 'Invalid JSON payload received. Unknown name "responseFormat" at \'generation_config\'' } }))
      .mockResolvedValueOnce(ok(good));
    vi.stubGlobal('fetch', fetch);
    await structuredGemini({ apiKey: 'k', schema, system: 's', prompt: 'p', model: 'gemini-test' });
    expect(JSON.parse(fetch.mock.calls[1]![1].body).generationConfig.responseJsonSchema).toBeDefined();
  });

  it('moves to the next model when the key has no quota for one', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(429, { error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-test' } }))
      .mockResolvedValueOnce(ok(good));
    vi.stubGlobal('fetch', fetch);
    await structuredGemini({ apiKey: 'k', schema, system: 's', prompt: 'p', model: 'gemini-test' });
    expect(fetch.mock.calls[1]![0]).toContain('/models/gemini-flash-latest:generateContent');
  });

  it('reports a rejected key and output that does not fit the schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })));
    await expect(structuredGemini({ apiKey: 'bad', schema, system: 's', prompt: 'p', model: 'gemini-test' })).rejects.toMatchObject({ code: 'provider_auth' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ title: 7 })));
    await expect(structuredGemini({ apiKey: 'k', schema, system: 's', prompt: 'p', model: 'gemini-test' })).rejects.toMatchObject({ code: 'ai_bad_output' });
  });

  it('tells a no-quota 429 from an ordinary rate limit', () => {
    expect(noQuotaForModel('Quota exceeded ... limit: 0, model: x')).toBe(true);
    expect(noQuotaForModel('Resource has been exhausted (e.g. check quota).')).toBe(false);
  });
});

describe('Gemini pricing', () => {
  it('prices Flash-Lite below Flash and counts tokens per million', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
    expect(geminiCost('gemini-flash-lite-latest', usage)).toBeCloseTo(1.75);
    expect(geminiCost('gemini-3.8-flash', usage)).toBeCloseTo(4.5);
  });

  it('is used by the shared cost table instead of the Claude fallback', () => {
    expect(llmCost('gemini-3.8-flash', { input_tokens: 1_000_000 })).toBeCloseTo(0.75);
    expect(llmCost('gemini-3.1-flash-lite', { output_tokens: 1_000_000 })).toBeCloseTo(1.5);
  });
});
