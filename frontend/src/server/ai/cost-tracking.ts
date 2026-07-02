/**
 * LLM call cost metering.
 *
 * As of this writing there is no LLM SDK dependency in `frontend/package.json`
 * (no `openai`, `@anthropic-ai/sdk`, or Vercel `ai` package) and every "AI"
 * feature call site (`intents/brief-generator.ts`, `qualification/qa.ts`,
 * `match/service.ts`, etc.) is a deterministic/rule-based TS implementation
 * that never contacts a real model provider — see
 * `frontend/src/server/ai/providers.ts` (`createDeterministicProvider`,
 * `createMockProvider`) and `AiCostMetadata.total` being hardcoded to `0`
 * everywhere in `run-metadata.ts`.
 *
 * This module exists so that the moment a real LLM provider is wired into
 * `AiProviderRegistry`, every call automatically gets its token usage and
 * estimated USD cost recorded here, without having to design a metering layer
 * under time pressure at that point. Until then, deterministic call sites
 * call `recordAiCallCost` with `promptTokens: 0, completionTokens: 0` (helper:
 * `recordZeroCostAiCall`), so the ledger has a complete, honest history of
 * every AI run — including the ones that cost nothing because no LLM was
 * actually called.
 *
 * PRICING DISCLAIMER (see also docs/transferability/environment-variables.md
 * and the P1-4 human follow-up note): the rates in `MODEL_RATE_TABLE_USD`
 * below are illustrative placeholders for wiring the metering pipeline end to
 * end. They are NOT guaranteed to match any provider's actual current
 * published pricing and MUST be verified/updated against the real provider
 * rate card before being used for real billing, invoicing, or cost-alerting
 * decisions. Rates are overridable via `AI_COST_RATE_OVERRIDES_JSON` (see
 * `resolveModelRate`) specifically so this can be corrected without a code
 * change once real numbers are confirmed.
 */

import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { aiCallLogs } from "@/server/db/schema";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlExecute } from "@/server/db/mysql-runtime";
import type { AiConfidenceTier } from "./confidence";

/**
 * USD cost per 1,000 tokens, split prompt vs. completion, keyed by model
 * identifier. Includes the deterministic/mock "models" already used in this
 * codebase (always $0) plus a placeholder set of real provider model rates
 * for when a live provider is configured.
 *
 * UNVERIFIED — placeholder rates, see PRICING DISCLAIMER above. Update this
 * table (or set `AI_COST_RATE_OVERRIDES_JSON`) with confirmed provider
 * pricing before relying on totals here for real billing.
 */
export const MODEL_RATE_TABLE_USD: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  "rules://winbids/deterministic-ai-enterprise-depth-lite": { promptPer1k: 0, completionPer1k: 0 },
  "mock://local/deterministic": { promptPer1k: 0, completionPer1k: 0 },
  // Placeholder real-provider rows. Verify against the provider's current
  // published pricing page before using for billing decisions.
  "claude-sonnet-4-5": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "claude-haiku-4-5": { promptPer1k: 0.001, completionPer1k: 0.005 },
  "gpt-4o": { promptPer1k: 0.0025, completionPer1k: 0.01 },
  "gpt-4o-mini": { promptPer1k: 0.00015, completionPer1k: 0.0006 },
};

const DEFAULT_MODEL_RATE = { promptPer1k: 0, completionPer1k: 0 } as const;

let cachedRateOverrides: Record<string, { promptPer1k: number; completionPer1k: number }> | null | undefined;

function loadRateOverrides(env = process.env): Record<string, { promptPer1k: number; completionPer1k: number }> | null {
  if (cachedRateOverrides !== undefined) {
    return cachedRateOverrides;
  }

  const raw = env.AI_COST_RATE_OVERRIDES_JSON;

  if (!raw || raw.trim().length === 0) {
    cachedRateOverrides = null;
    return cachedRateOverrides;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (parsed && typeof parsed === "object") {
      cachedRateOverrides = parsed as Record<string, { promptPer1k: number; completionPer1k: number }>;
    } else {
      cachedRateOverrides = null;
    }
  } catch {
    cachedRateOverrides = null;
  }

  return cachedRateOverrides;
}

/** Test-only hook to bypass the module-level env cache. */
export function resetRateOverrideCacheForTests() {
  cachedRateOverrides = undefined;
}

export function resolveModelRate(model: string, env = process.env) {
  const overrides = loadRateOverrides(env);

  return overrides?.[model] ?? MODEL_RATE_TABLE_USD[model] ?? DEFAULT_MODEL_RATE;
}

export interface EstimateAiCallCostInput {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface AiCallCostEstimate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedUsd: number;
  currency: "USD";
}

function normalizeTokenCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Computes an estimated USD cost for a single call from its token counts and
 * model, using `resolveModelRate`. Pure function — does not touch the
 * database. See PRICING DISCLAIMER above regarding rate accuracy.
 */
export function estimateAiCallCost(input: EstimateAiCallCostInput): AiCallCostEstimate {
  const promptTokens = normalizeTokenCount(input.promptTokens);
  const completionTokens = normalizeTokenCount(input.completionTokens);
  const rate = resolveModelRate(input.model);

  const estimatedUsd =
    (promptTokens / 1000) * rate.promptPer1k + (completionTokens / 1000) * rate.completionPer1k;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedUsd: Math.round(estimatedUsd * 1_000_000) / 1_000_000,
    currency: "USD",
  };
}

export interface RecordAiCallCostInput {
  /** Correlates this cost record with the AiRunMetadata.id emitted alongside it, so a stored AI output can be joined back to its cost/usage row. */
  aiRunId: string;
  /** Feature/action identifier, e.g. "intent_brief", "qualification_qa". Free-form but should match the `action` passed to createAiRunMetadata for the same run. */
  action: string;
  provider: string;
  model: string;
  promptVersion: string;
  confidence: AiConfidenceTier;
  promptTokens: number;
  completionTokens: number;
  organizationId?: string | null;
  userId?: string | null;
  /** Arbitrary extra context (e.g. fallback reason, latency) stored as JSON. */
  metadata?: Record<string, unknown>;
  now?: () => Date;
}

export interface AiCallCostRecord extends AiCallCostEstimate {
  id: string;
  aiRunId: string;
  action: string;
  provider: string;
  model: string;
  promptVersion: string;
  confidence: AiConfidenceTier;
  organizationId: string | null;
  userId: string | null;
  createdAt: string;
}

type AiCallLogValues = typeof aiCallLogs.$inferInsert;

async function insertAiCallLog(database: AppDatabase, values: AiCallLogValues) {
  if (isMysqlDatabaseUrlConfigured()) {
    await mysqlExecute(resolveMysqlPool(), `
      INSERT INTO ai_call_logs (
        id,
        ai_run_id,
        organization_id,
        user_id,
        action,
        provider,
        model,
        prompt_version,
        confidence,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        estimated_cost_usd_micros,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      values.id,
      values.aiRunId,
      values.organizationId,
      values.userId,
      values.action,
      values.provider,
      values.model,
      values.promptVersion,
      values.confidence,
      values.promptTokens,
      values.completionTokens,
      values.totalTokens,
      values.estimatedCostUsdMicros,
      values.metadataJson,
      values.createdAt,
    ]);
    return;
  }

  database.insert(aiCallLogs).values(values).run();
}

/**
 * Records token usage and estimated USD cost for a single AI call, persisted
 * to the `ai_call_logs` table. Call this alongside `createAiRunMetadata` (or
 * `createDeterministicAiRunMetadata`) for every AI feature invocation so cost
 * data accumulates even while every provider is deterministic/free — see
 * module header. `aiRunId` should match the `id` on the `AiRunMetadata`
 * returned to the caller so a stored brief/answer/etc. can be joined back to
 * its cost record.
 */
export async function recordAiCallCost(
  database: AppDatabase,
  input: RecordAiCallCostInput,
): Promise<AiCallCostRecord> {
  const estimate = estimateAiCallCost({
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
  });

  const id = `ai_call_log_${crypto.randomUUID()}`;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();

  await insertAiCallLog(database, {
    id,
    aiRunId: input.aiRunId,
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    action: input.action,
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    confidence: input.confidence,
    promptTokens: estimate.promptTokens,
    completionTokens: estimate.completionTokens,
    totalTokens: estimate.totalTokens,
    estimatedCostUsdMicros: Math.round(estimate.estimatedUsd * 1_000_000),
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdAt,
  });

  return {
    id,
    aiRunId: input.aiRunId,
    action: input.action,
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion,
    confidence: input.confidence,
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    createdAt,
    ...estimate,
  };
}

/**
 * Convenience wrapper for the common case in this codebase today: a
 * deterministic/rule-based "AI" call site that made no real LLM request and
 * therefore has no tokens to bill. Keeps call sites in
 * brief-generator.ts/qa.ts terse while still producing a complete audit trail
 * (every AI run is logged, even the free ones).
 */
export async function recordZeroCostAiCall(
  database: AppDatabase,
  input: Omit<RecordAiCallCostInput, "promptTokens" | "completionTokens">,
): Promise<AiCallCostRecord> {
  return recordAiCallCost(database, { ...input, promptTokens: 0, completionTokens: 0 });
}

/**
 * Optional alert-threshold check: given a set of already-recorded cost
 * records (e.g. for one organization within a billing period), reports
 * whether their summed estimated USD cost has crossed
 * `AI_COST_ALERT_THRESHOLD_USD` (see environment-variables.md). This module
 * only computes the boolean signal — it deliberately does not send any
 * notification itself. Wiring this into an actual alert channel (Slack,
 * email, PagerDuty) is a human follow-up (see P1-4 task notes); this keeps
 * the threshold-crossing calculation available for whichever alert
 * transport gets chosen later.
 */
export function totalEstimatedCostUsd(records: readonly Pick<AiCallCostRecord, "estimatedUsd">[]): number {
  return Math.round(records.reduce((sum, record) => sum + record.estimatedUsd, 0) * 1_000_000) / 1_000_000;
}

export function isOverCostAlertThreshold(totalUsd: number, env = process.env): boolean {
  const raw = env.AI_COST_ALERT_THRESHOLD_USD;

  if (!raw) {
    return false;
  }

  const threshold = Number.parseFloat(raw);

  return Number.isFinite(threshold) && threshold >= 0 && totalUsd > threshold;
}
