import * as z from 'zod';
import { AppError } from '../../utils';
import { env } from '../env';
import { safeFetch } from '../net';
import type { ImageInput, StructuredRequest, StructuredResult } from './anthropic';

const API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Tried in order after the configured model when a model is missing or has no free quota on the
 * key. The aliases follow Google's newest Flash models; the pinned ones are a last resort.
 */
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

/** Paid list prices per million tokens; the free tier costs nothing, so these only ever overstate. */
const PRICES: { match: RegExp; inputPerM: number; outputPerM: number }[] = [
  { match: /flash-lite/, inputPerM: 0.25, outputPerM: 1.5 },
  { match: /flash/, inputPerM: 0.75, outputPerM: 3.75 },
  { match: /pro/, inputPerM: 2, outputPerM: 12 },
];

export function geminiCost(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const p = PRICES.find((x) => x.match.test(model)) ?? PRICES[1]!;
  return (usage.input_tokens * p.inputPerM + usage.output_tokens * p.outputPerM) / 1e6;
}

export function geminiModelForTier(tier: 'smart' | 'fast' = 'smart'): string {
  return tier === 'fast' ? env().GEMINI_FAST_MODEL : env().GEMINI_MODEL;
}

/**
 * The response schema as plain JSON Schema, without the `$schema` marker the API rejects.
 * Input mode, so a field with a default is optional for the model, as it is for the parser.
 */
export function geminiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  return rest;
}

async function imagePart(img: ImageInput): Promise<{ inline_data: { mime_type: string; data: string } }> {
  if ('base64' in img) return { inline_data: { mime_type: img.mediaType, data: img.base64 } };
  // Gemini reads images sent inline, so a linked one is fetched first (public addresses only, 8 MB at most).
  const res = await safeFetch(img.url, { timeoutMs: 20_000 });
  if (!res.ok) throw new AppError('ai_bad_input', `Could not read an image for the AI (${res.status}).`, 502);
  const type = (res.contentType || 'image/jpeg').split(';')[0]!.trim();
  return { inline_data: { mime_type: type, data: res.body.toString('base64') } };
}

/**
 * `format` is the current structured-output field (generationConfig.responseFormat); `legacy` is the
 * older responseMimeType + responseJsonSchema pair, sent if an API version rejects the new one.
 */
export type GeminiBodyStyle = 'format' | 'legacy';

/** The request body for one structured call; kept apart so it can be tested without the network. */
export async function geminiBody<T extends z.ZodType>(req: Omit<StructuredRequest<T>, 'apiKey'>, style: GeminiBodyStyle = 'format') {
  const parts: Record<string, unknown>[] = [];
  for (const img of req.images ?? []) {
    if (img.label) parts.push({ text: img.label });
    parts.push(await imagePart(img.image));
  }
  parts.push({ text: req.prompt });
  const schema = geminiSchema(req.schema);
  const maxOutputTokens = Math.min(req.maxTokens ?? 16_000, 65_536);
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig:
      style === 'format'
        ? { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } }, maxOutputTokens }
        : { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { message?: string; status?: string };
}

/** A 429 that no wait will fix: the key has no quota at all for this model (free tier excluded). */
export const noQuotaForModel = (message: string) => /limit:\s*0\b|free[_ ]tier.*(not|unavailable)|not available on the free tier/i.test(message);
/** A 400 saying this API version does not know the structured-output field we sent. */
export const unknownField = (message: string) => /unknown name|cannot find field|invalid json payload/i.test(message);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs Gemini with a structured output schema: the same contract as the Claude call it stands in for. */
export async function structuredGemini<T extends z.ZodType>(req: StructuredRequest<T>): Promise<StructuredResult<z.infer<T>>> {
  const first = req.model && req.model.startsWith('gemini') ? req.model : geminiModelForTier(req.tier);
  const models = [...new Set([first, ...FALLBACK_MODELS])];
  const bodies: Partial<Record<GeminiBodyStyle, string>> = {};
  const bodyFor = async (style: GeminiBodyStyle) => (bodies[style] ??= JSON.stringify(await geminiBody(req, style)));
  let style: GeminiBodyStyle = 'format';
  let status = 0;
  let json: GeminiResponse = {};
  let used = first;

  models: for (const model of models) {
    used = model;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
        body: await bodyFor(style),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      status = res.status;
      json = (await res.json().catch(() => ({}))) as GeminiResponse;
      const message = json.error?.message ?? '';
      if (res.ok) break models;
      if (status === 400 && style === 'format' && unknownField(message)) {
        style = 'legacy';
        continue;
      }
      if (status === 404 || (status === 429 && noQuotaForModel(message))) continue models;
      // the free tier rate-limits by the minute: wait and try again before giving up
      if ((status === 429 || status >= 500) && attempt < 3) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      break models;
    }
  }

  if (status < 200 || status >= 300) {
    const message = json.error?.message ?? '';
    if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) throw new AppError('provider_auth', 'The Gemini API key was rejected. Check Settings → Providers.', 401);
    if (status === 429) throw new AppError('provider_rate_limited', 'Gemini is rate limiting requests (the free tier allows a few a minute). Try again in a minute.', 429);
    if (status === 404) throw new AppError('provider_unavailable', `No Gemini model this key can use was found (last tried ${used}).`, 502);
    if (status >= 500 || status === 0) throw new AppError('provider_unavailable', 'Gemini is temporarily unavailable. Try again shortly.', 503);
    throw new AppError('ai_bad_request', `Gemini could not run this request: ${message || `status ${status}`}`, 502);
  }
  if (json.promptFeedback?.blockReason) throw new AppError('ai_refused', 'The AI declined this request. Try rephrasing it.', 422);
  const cand = json.candidates?.[0];
  if (cand?.finishReason === 'SAFETY' || cand?.finishReason === 'PROHIBITED_CONTENT') throw new AppError('ai_refused', 'The AI declined this request. Try rephrasing it.', 422);
  if (cand?.finishReason === 'MAX_TOKENS') throw new AppError('ai_truncated', 'The AI response was cut off. Try a shorter request.', 502);
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new AppError('ai_bad_output', 'The AI returned an unexpected format. Please try again.', 502);
  }
  const out = req.schema.safeParse(parsed);
  if (!out.success) throw new AppError('ai_bad_output', 'The AI returned an unexpected format. Please try again.', 502);
  const meta = json.usageMetadata ?? {};
  const usage = {
    input_tokens: meta.promptTokenCount ?? 0,
    // thinking tokens are billed as output
    output_tokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
    cache_read_input_tokens: 0,
  };
  const model = json.modelVersion || used;
  return { data: out.data as z.infer<T>, model, usage, costUsd: geminiCost(model, usage) };
}
