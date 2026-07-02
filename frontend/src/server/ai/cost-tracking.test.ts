import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { aiCallLogs, organizations } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  estimateAiCallCost,
  isOverCostAlertThreshold,
  recordAiCallCost,
  recordZeroCostAiCall,
  resetRateOverrideCacheForTests,
  resolveModelRate,
  totalEstimatedCostUsd,
} from "./cost-tracking";

function seedOrganization(testDb: TestDatabase) {
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
}

afterEach(() => {
  resetRateOverrideCacheForTests();
  delete process.env.AI_COST_RATE_OVERRIDES_JSON;
  delete process.env.AI_COST_ALERT_THRESHOLD_USD;
});

describe("estimateAiCallCost", () => {
  it("computes zero cost for deterministic/mock models not in the rate table", () => {
    const estimate = estimateAiCallCost({
      model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
      promptTokens: 500,
      completionTokens: 500,
    });

    expect(estimate).toEqual({
      promptTokens: 500,
      completionTokens: 500,
      totalTokens: 1000,
      estimatedUsd: 0,
      currency: "USD",
    });
  });

  it("computes a non-zero estimate for a known priced model", () => {
    const estimate = estimateAiCallCost({
      model: "gpt-4o-mini",
      promptTokens: 1000,
      completionTokens: 1000,
    });

    // 1000 prompt tokens * 0.00015/1k + 1000 completion tokens * 0.0006/1k
    expect(estimate.estimatedUsd).toBeCloseTo(0.00075, 8);
    expect(estimate.totalTokens).toBe(2000);
  });

  it("falls back to a zero-rate default for unknown models", () => {
    const estimate = estimateAiCallCost({
      model: "some-unlisted-model",
      promptTokens: 1000,
      completionTokens: 1000,
    });

    expect(estimate.estimatedUsd).toBe(0);
  });

  it("normalizes negative or non-finite token counts to zero", () => {
    const estimate = estimateAiCallCost({
      model: "gpt-4o-mini",
      promptTokens: -10,
      completionTokens: Number.NaN,
    });

    expect(estimate.promptTokens).toBe(0);
    expect(estimate.completionTokens).toBe(0);
    expect(estimate.estimatedUsd).toBe(0);
  });
});

describe("resolveModelRate", () => {
  it("prefers AI_COST_RATE_OVERRIDES_JSON over the built-in rate table", () => {
    const env = {
      AI_COST_RATE_OVERRIDES_JSON: JSON.stringify({
        "gpt-4o-mini": { promptPer1k: 1, completionPer1k: 2 },
      }),
    } as NodeJS.ProcessEnv;

    expect(resolveModelRate("gpt-4o-mini", env)).toEqual({ promptPer1k: 1, completionPer1k: 2 });
  });

  it("ignores malformed override JSON and falls back to the built-in table", () => {
    const env = { AI_COST_RATE_OVERRIDES_JSON: "{not-json" } as NodeJS.ProcessEnv;

    expect(resolveModelRate("gpt-4o-mini", env)).toEqual({ promptPer1k: 0.00015, completionPer1k: 0.0006 });
  });
});

describe("totalEstimatedCostUsd / isOverCostAlertThreshold", () => {
  it("sums estimated cost across records", () => {
    expect(totalEstimatedCostUsd([{ estimatedUsd: 0.01 }, { estimatedUsd: 0.02 }])).toBeCloseTo(0.03, 8);
    expect(totalEstimatedCostUsd([])).toBe(0);
  });

  it("returns false when no threshold is configured", () => {
    expect(isOverCostAlertThreshold(100, {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("reports over-threshold once the total exceeds AI_COST_ALERT_THRESHOLD_USD", () => {
    const env = { AI_COST_ALERT_THRESHOLD_USD: "10" } as NodeJS.ProcessEnv;

    expect(isOverCostAlertThreshold(9.99, env)).toBe(false);
    expect(isOverCostAlertThreshold(10, env)).toBe(false);
    expect(isOverCostAlertThreshold(10.01, env)).toBe(true);
  });

  it("ignores an invalid threshold value", () => {
    const env = { AI_COST_ALERT_THRESHOLD_USD: "not-a-number" } as NodeJS.ProcessEnv;

    expect(isOverCostAlertThreshold(999, env)).toBe(false);
  });
});

describe("recordAiCallCost", () => {
  it("persists token usage and estimated cost to ai_call_logs", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedOrganization(testDb);
      const record = await recordAiCallCost(testDb.db, {
        aiRunId: "ai_run_intent_brief_2026-06-10T00:00:00.000Z",
        action: "intent_brief",
        provider: "deterministic",
        model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
        promptVersion: "intent-brief-lite@2026-06-10",
        confidence: "high",
        promptTokens: 0,
        completionTokens: 0,
        organizationId: "org_seed",
        userId: "anon_seed",
        metadata: { bidId: "1" },
        now: () => new Date("2026-06-10T00:00:00.000Z"),
      });

      expect(record).toMatchObject({
        action: "intent_brief",
        provider: "deterministic",
        model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
        promptVersion: "intent-brief-lite@2026-06-10",
        confidence: "high",
        organizationId: "org_seed",
        userId: "anon_seed",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedUsd: 0,
        currency: "USD",
        createdAt: "2026-06-10T00:00:00.000Z",
      });

      const row = testDb.db
        .select()
        .from(aiCallLogs)
        .where(eq(aiCallLogs.id, record.id))
        .get();

      expect(row).toMatchObject({
        aiRunId: "ai_run_intent_brief_2026-06-10T00:00:00.000Z",
        organizationId: "org_seed",
        userId: "anon_seed",
        action: "intent_brief",
        provider: "deterministic",
        promptVersion: "intent-brief-lite@2026-06-10",
        confidence: "high",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsdMicros: 0,
      });
      expect(JSON.parse(row?.metadataJson ?? "{}")).toEqual({ bidId: "1" });
    } finally {
      await testDb.cleanup();
    }
  });

  it("stores a non-zero estimated cost for a priced model with real token counts", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const record = await recordAiCallCost(testDb.db, {
        aiRunId: "ai_run_enterprise_ai_1",
        action: "enterprise_ai",
        provider: "mock",
        model: "gpt-4o-mini",
        promptVersion: "enterprise-ai@unit",
        confidence: "medium",
        promptTokens: 2000,
        completionTokens: 1000,
      });

      // 2000 * 0.00015/1k + 1000 * 0.0006/1k = 0.0003 + 0.0006 = 0.0009
      expect(record.estimatedUsd).toBeCloseTo(0.0009, 8);

      const row = testDb.db
        .select()
        .from(aiCallLogs)
        .where(eq(aiCallLogs.id, record.id))
        .get();

      expect(row?.estimatedCostUsdMicros).toBe(900);
    } finally {
      await testDb.cleanup();
    }
  });

  it("defaults organizationId/userId to null when not provided", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const record = await recordZeroCostAiCall(testDb.db, {
        aiRunId: "ai_run_qualification_qa_1",
        action: "qualification_qa",
        provider: "deterministic",
        model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
        promptVersion: "qualification-qa-lite@2026-06-10",
        confidence: "medium",
      });

      expect(record.organizationId).toBeNull();
      expect(record.userId).toBeNull();
      expect(record.promptTokens).toBe(0);
      expect(record.completionTokens).toBe(0);
    } finally {
      await testDb.cleanup();
    }
  });
});
