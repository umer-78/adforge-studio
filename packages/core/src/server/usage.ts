import type { Database } from '../db/database.types';
import { AppError, formatUsd } from '../utils';
import { dailyAiCapUsd } from './env';
import type { AnyClient } from './supabase';

type UsageKind = Database['public']['Tables']['usage_ledger']['Insert']['kind'];

export interface UsageEntry {
  workspaceId: string;
  userId?: string | null;
  kind: UsageKind;
  provider: string;
  model?: string | null;
  units: number;
  unit: string;
  costUsd: number;
  isEstimate?: boolean;
  generationId?: string | null;
  jobId?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordUsage(sb: AnyClient, entry: UsageEntry) {
  const { error } = await sb.from('usage_ledger').insert({
    workspace_id: entry.workspaceId,
    user_id: entry.userId ?? null,
    kind: entry.kind,
    provider: entry.provider,
    model: entry.model ?? null,
    units: entry.units,
    unit: entry.unit,
    cost_usd: Math.max(0, Number(entry.costUsd.toFixed(6))),
    is_estimate: entry.isEstimate ?? false,
    generation_id: entry.generationId ?? null,
    job_id: entry.jobId ?? null,
    meta: (entry.meta ?? {}) as never,
  });
  if (error) throw new Error(`Could not record usage: ${error.message}`);
}

export async function monthSpend(sb: AnyClient, workspaceId: string): Promise<number> {
  const { data, error } = await sb.rpc('workspace_month_spend', { ws: workspaceId });
  if (error) throw new Error(`Could not read spend: ${error.message}`);
  return Number(data ?? 0);
}

export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  hardStop: boolean;
}

export async function budgetStatus(sb: AnyClient, workspaceId: string): Promise<BudgetStatus> {
  const [{ data: ws, error }, spent] = await Promise.all([
    sb.from('workspaces').select('monthly_budget_usd, budget_hard_stop').eq('id', workspaceId).single(),
    monthSpend(sb, workspaceId),
  ]);
  if (error || !ws) throw new Error(`Workspace not found: ${error?.message}`);
  const budget = Number(ws.monthly_budget_usd);
  return { spentUsd: spent, budgetUsd: budget, remainingUsd: Math.max(0, budget - spent), hardStop: ws.budget_hard_stop };
}

/** What a workspace has spent since midnight UTC. */
export async function daySpend(sb: AnyClient, workspaceId: string, now = new Date()): Promise<number> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { data, error } = await sb.from('usage_ledger').select('cost_usd').eq('workspace_id', workspaceId).gte('created_at', since.toISOString()).limit(20_000);
  if (error) throw new Error(`Could not read spend: ${error.message}`);
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

/** The daily cap check on its own: throws once today's spend plus this action would pass the cap. */
export function checkDailyCap(spentTodayUsd: number, additionalUsd: number, capUsd: number | null) {
  if (capUsd == null || additionalUsd <= 0) return;
  if (spentTodayUsd + additionalUsd > capUsd + 1e-9) {
    throw new AppError(
      'daily_cap_reached',
      `This would cost about ${formatUsd(additionalUsd)} and pass today's AI spending cap (${formatUsd(spentTodayUsd)} of ${formatUsd(capUsd)} used). The cap resets at midnight UTC; the owner can change AI_DAILY_CAP_USD.`,
      402,
      { spentTodayUsd, capUsd },
    );
  }
}

/** Throws when a paid action would pass the daily AI cap, or exceed the monthly cap when the workspace uses a hard stop. */
export async function assertBudget(sb: AnyClient, workspaceId: string, additionalUsd: number): Promise<BudgetStatus> {
  const cap = dailyAiCapUsd();
  if (cap != null && additionalUsd > 0) checkDailyCap(await daySpend(sb, workspaceId), additionalUsd, cap);
  const status = await budgetStatus(sb, workspaceId);
  if (status.hardStop && status.spentUsd + additionalUsd > status.budgetUsd + 1e-9) {
    throw new AppError(
      'budget_exceeded',
      `This would cost about ${formatUsd(additionalUsd)} and exceed your monthly budget (${formatUsd(status.spentUsd)} of ${formatUsd(status.budgetUsd)} used). Raise the budget in Settings to continue.`,
      402,
      status,
    );
  }
  return status;
}
