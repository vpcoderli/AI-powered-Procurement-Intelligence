import crypto from "node:crypto";
import type { FeatureKey } from "@/server/auth/entitlements";
import type { AppDatabase } from "@/server/db/client";
import { creditUsageEvents } from "@/server/db/schema";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlExecute } from "@/server/db/mysql-runtime";
import { quoteAiCreditDryRun, type AiCreditDryRunQuote } from "./credits";

export { quoteAiCreditDryRun } from "./credits";

export interface CreditLedgerDryRunResult {
  mode: "dry_run";
  eventRecorded: boolean;
  eventId: string | null;
  featureKey: FeatureKey;
  creditCost: number;
  estimatedCredits: number;
  estimatedCost: AiCreditDryRunQuote["estimatedCost"];
  chargedAmount: 0;
  balanceAfter: null;
  fallbackReason: "billing_enforcement_disabled" | "workspace_not_available";
}

export interface RecordPremiumActionUsageDryRunInput {
  organizationId: string | null;
  userId: string;
  featureKey: FeatureKey;
  actionId: string;
  aiRunId?: string | null;
  quote?: AiCreditDryRunQuote;
  metadata?: Record<string, unknown>;
  now?: () => Date;
}

export class CreditLedgerEnforcementDisabledError extends Error {
  constructor() {
    super("Real credit debit, refund, and monthly grant enforcement are disabled for AI Enterprise Depth Lite.");
    this.name = "CreditLedgerEnforcementDisabledError";
  }
}

const RESERVED_INTERFACES = ["debitCredits", "refundCredits", "grantMonthlyCredits"] as const;

type CreditUsageEventValues = typeof creditUsageEvents.$inferInsert;

async function insertCreditUsageEvent(database: AppDatabase, values: CreditUsageEventValues) {
  if (isMysqlDatabaseUrlConfigured()) {
    await mysqlExecute(resolveMysqlPool(), `
      INSERT INTO credit_usage_events (
        id,
        organization_id,
        user_id,
        feature_key,
        event_type,
        amount,
        balance_after,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      values.id,
      values.organizationId,
      values.userId,
      values.featureKey,
      values.eventType,
      values.amount,
      values.balanceAfter,
      values.metadataJson,
      values.createdAt,
    ]);
    return;
  }

  database.insert(creditUsageEvents).values(values).run();
}

export async function recordPremiumActionUsageDryRun(
  database: AppDatabase,
  input: RecordPremiumActionUsageDryRunInput,
): Promise<CreditLedgerDryRunResult> {
  const quote = input.quote ?? quoteAiCreditDryRun({
    featureKey: input.featureKey,
    actionId: input.actionId,
    aiRun: {
      id: input.aiRunId ?? null,
      provider: typeof input.metadata?.provider === "string" ? input.metadata.provider : null,
      model: typeof input.metadata?.model === "string" ? input.metadata.model : null,
      estimatedCostUsd: typeof input.metadata?.estimatedCostUsd === "number" ? input.metadata.estimatedCostUsd : null,
      estimatedCredits: typeof input.metadata?.estimatedCredits === "number" ? input.metadata.estimatedCredits : null,
    },
  });

  if (!input.organizationId) {
    return {
      mode: "dry_run",
      eventRecorded: false,
      eventId: null,
      featureKey: input.featureKey,
      creditCost: quote.creditCost,
      estimatedCredits: quote.estimatedCredits,
      estimatedCost: quote.estimatedCost,
      chargedAmount: 0,
      balanceAfter: null,
      fallbackReason: "workspace_not_available",
    };
  }

  const eventId = `credit_usage_${crypto.randomUUID()}`;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();

  await insertCreditUsageEvent(database, {
    id: eventId,
    organizationId: input.organizationId,
    userId: input.userId,
    featureKey: input.featureKey,
    eventType: "premium_action",
    amount: 0,
    balanceAfter: null,
    metadataJson: JSON.stringify({
      ...(input.metadata ?? {}),
      dryRun: true,
      billingEnforcement: false,
      actionId: input.actionId,
      aiRunId: input.aiRunId ?? null,
      quote,
      estimatedCredits: quote.estimatedCredits,
      estimatedCostUsd: quote.estimatedCost.estimatedUsd,
      reservedInterfaces: [...RESERVED_INTERFACES],
    }),
    createdAt,
  });

  return {
    mode: "dry_run",
    eventRecorded: true,
    eventId,
    featureKey: input.featureKey,
    creditCost: quote.creditCost,
    estimatedCredits: quote.estimatedCredits,
    estimatedCost: quote.estimatedCost,
    chargedAmount: 0,
    balanceAfter: null,
    fallbackReason: "billing_enforcement_disabled",
  };
}

export async function debitCredits(): Promise<never> {
  throw new CreditLedgerEnforcementDisabledError();
}

export async function refundCredits(): Promise<never> {
  throw new CreditLedgerEnforcementDisabledError();
}

export async function grantMonthlyCredits(): Promise<never> {
  throw new CreditLedgerEnforcementDisabledError();
}
