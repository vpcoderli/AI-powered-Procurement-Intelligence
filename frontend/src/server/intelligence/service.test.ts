import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid, updateIntentStatus } from "@/server/intents/service";
import { createProcurementIntelligenceSummary } from "./service";

describe("Product 6 intelligence lite read model", () => {
  it("summarizes local pursuit intelligence without live AI infrastructure", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const cloudIntent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const broadbandIntent = await createIntentForBid(testDb.db, "anon_seed", "2");
      await updateIntentStatus(testDb.db, "anon_seed", cloudIntent.id, "questions_needed");
      await updateIntentStatus(testDb.db, "anon_seed", broadbandIntent.id, "pursuit_decision_needed");

      const summary = await createProcurementIntelligenceSummary(
        testDb.db,
        "anon_seed",
        new Date("2026-06-01T12:00:00.000Z"),
      );

      expect(summary).toMatchObject({
        generatedAt: "2026-06-01T12:00:00.000Z",
        mode: "deterministic_local",
        modelVersion: "product-6-intelligence-lite@2026-06-30",
        sourcePolicy: {
          llm: "not_used",
          embeddings: "not_used",
          vectorDb: "not_used",
          billing: "dry_run_only",
        },
        scope: {
          userId: "anon_seed",
          intentCount: 2,
        },
        cockpit: {
          activePursuits: 2,
          needsAction: 2,
          decisionQueue: 1,
          staleOrAtRisk: expect.any(Number),
          averageMatchScore: expect.any(Number),
        },
      });
      expect(summary.topSignals[0]).toMatchObject({
        intentId: cloudIntent.id,
        bidId: "1",
        title: "Enterprise Cloud Migration Services",
        signalType: "action_required",
        severity: "high",
        reason: expect.stringContaining("questions_needed"),
      });
      expect(summary.summaryBullets).toContain("2 active local pursuits reviewed.");
      expect(summary.limitations).toContain("Local deterministic read model only; no live LLM, embeddings, vector database, or external enrichment.");
    } finally {
      await testDb.cleanup();
    }
  });
});
