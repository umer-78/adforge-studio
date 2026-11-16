import type * as z from 'zod';
import { modelForTier, structured, type StructuredRequest, type StructuredResult } from './anthropic';
import { geminiModelForTier, structuredGemini } from './gemini';
import { providerKey, ProviderNotConfiguredError } from './keys';

export type LlmProvider = 'anthropic' | 'gemini';
export interface LlmAccess {
  provider: LlmProvider;
  apiKey: string;
}

/** Thrown when a text task has neither a Claude nor a Gemini key to run on. */
export class LlmNotConfiguredError extends ProviderNotConfiguredError {
  constructor() {
    super('anthropic');
    this.message = 'No AI text model is connected. Add a Claude key, or a free Gemini key, in Settings → Providers.';
  }
}

/** The text model a workspace can use: its Claude key first, else a Gemini key (the free fallback). */
export async function llmAccess(workspaceId: string | null | undefined): Promise<LlmAccess | null> {
  const claude = await providerKey(workspaceId, 'anthropic');
  if (claude) return { provider: 'anthropic', apiKey: claude };
  const gemini = await providerKey(workspaceId, 'gemini');
  return gemini ? { provider: 'gemini', apiKey: gemini } : null;
}

export async function requireLlm(workspaceId: string | null | undefined): Promise<LlmAccess> {
  const access = await llmAccess(workspaceId);
  if (!access) throw new LlmNotConfiguredError();
  return access;
}

export function llmModel(provider: LlmProvider, tier: 'smart' | 'fast' = 'smart'): string {
  return provider === 'gemini' ? geminiModelForTier(tier) : modelForTier(tier);
}

/** One structured text call on whichever model the workspace has. */
export function structuredVia<T extends z.ZodType>(access: LlmAccess, req: Omit<StructuredRequest<T>, 'apiKey'>): Promise<StructuredResult<z.infer<T>>> {
  if (access.provider === 'gemini') return structuredGemini({ ...req, apiKey: access.apiKey, model: req.model?.startsWith('gemini') ? req.model : undefined });
  return structured({ ...req, apiKey: access.apiKey });
}
