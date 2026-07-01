import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { creditUsageEvents, organizationMemberships, organizations } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  CreditLedgerEnforcementDisabledError,
  debitCredits,
  grantMonthlyCredits,
  quoteAiCreditDryRun,
  recordPremiumActionUsageDryRun,
  refundCredits,
} from "./credit-ledger";

function createLedgerScope(testDb: TestDatabase) {
  testDb.db.insert(organizations)
    .values({
      id: "org_seed",
      name: "Seed Organization",
      accountTier: "pro",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();

  testDb.db.insert(organizationMemberships)
    .values({
      organizationId: "org_seed",
      userId: "anon_seed",
      role: "owner",
      status: "active",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();
}

describe("credit ledger dry-run", () => {
  it("records premium action usage without debiting credits", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createLedgerScope(testDb);
      const quote = quoteAiCreditDryRun({
        featureKey: "bid.brief.full.generate",
        actionId: "qa:intent_1",
        aiRun: {
          id: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
          provider: "deterministic",
          model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
          estimatedCostUsd: 0,
        },
      });

      const result = await recordPremiumActionUsageDryRun(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        featureKey: "bid.brief.full.generate",
        actionId: "qa:intent_1",
        aiRunId: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
        quote,
        metadata: { provider: "deterministic" },
        now: () => new Date("2026-06-10T00:00:00.000Z"),
      });

      expect(result).toMatchObject({
        mode: "dry_run",
        eventRecorded: true,
        featureKey: "bid.brief.full.generate",
        creditCost: 1,
        estimatedCredits: 1,
        estimatedCost: { currency: "USD", total: 0, estimatedUsd: 0 },
        chargedAmount: 0,
        balanceAfter: null,
        fallbackReason: "billing_enforcement_disabled",
      });

      const row = testDb.db
        .select()
        .from(creditUsageEvents)
        .where(eq(creditUsageEvents.id, result.eventId ?? ""))
        .limit(1)
        .get();

      expect(row).toMatchObject({
        organizationId: "org_seed",
        userId: "anon_seed",
        featureKey: "bid.brief.full.generate",
        eventType: "premium_action",
        amount: 0,
        balanceAfter: null,
      });
      expect(JSON.parse(row?.metadataJson ?? "{}")).toMatchObject({
        dryRun: true,
        billingEnforcement: false,
        actionId: "qa:intent_1",
        aiRunId: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
        quote,
        estimatedCredits: 1,
        estimatedCostUsd: 0,
        reservedInterfaces: ["debitCredits", "refundCredits", "grantMonthlyCredits"],
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns unavailable dry-run status when workspace is unavailable", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const result = await recordPremiumActionUsageDryRun(testDb.db, {
        organizationId: null,
        userId: "anon_seed",
        featureKey: "bid.brief.full.generate",
        actionId: "qa:intent_1",
      });

      expect(result).toEqual({
        mode: "dry_run",
        eventRecorded: false,
        eventId: null,
        featureKey: "bid.brief.full.generate",
        creditCost: 1,
        estimatedCredits: 1,
        estimatedCost: { currency: "USD", total: 0, estimatedUsd: 0 },
        chargedAmount: 0,
        balanceAfter: null,
        fallbackReason: "workspace_not_available",
      });
      expect(testDb.db.select().from(creditUsageEvents).all()).toHaveLength(0);
    } finally {
      await testDb.cleanup();
    }
  });

  it("keeps debit, refund, and monthly grant interfaces disabled", async () => {
    await expect(debitCredits()).rejects.toBeInstanceOf(CreditLedgerEnforcementDisabledError);
    await expect(refundCredits()).rejects.toBeInstanceOf(CreditLedgerEnforcementDisabledError);
    await expect(grantMonthlyCredits()).rejects.toBeInstanceOf(CreditLedgerEnforcementDisabledError);
  });
});
