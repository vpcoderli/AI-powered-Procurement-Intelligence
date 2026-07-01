import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { intentToBid } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { answerQualificationQuestion } from "./qa";

describe("qualification grounded Q&A", () => {
  it("answers a question using only ranked evidence citations", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const response = await answerQualificationQuestion(testDb.db, "anon_seed", intent.id, {
        question: "What is the submission deadline?",
      });

      expect(response.intentId).toBe(intent.id);
      expect(response.bidId).toBe(intent.bid.id);
      expect(response.question).toBe("What is the submission deadline?");
      expect(response.answer).toContain("Deadline");
      expect(response.answer).toContain(intent.bid.deadlineDate);
      expect(response.citations[0]).toEqual(expect.objectContaining({
        id: "citation_deadline",
        section: "key_dates",
      }));
      expect(response.grounded).toBe(true);
      expect(response.groundingStatus).toBe("grounded");
      expect(response.evidenceCoverage).toEqual({
        status: "direct",
        matchedCitationCount: 2,
        selectedCitationCount: 3,
        totalCitationCount: expect.any(Number),
        coveredSections: ["key_dates", "submission", "brief"],
      });
      expect(response.limitations).toContain("Deterministic local answer generated from stored bid fields, archives, attachments, and generated brief citations only.");
      expect(response.aiRun).toMatchObject({
        provider: "deterministic",
        model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
        rulesVersion: "ai-enterprise-depth-lite-rules@2026-06-10",
        promptVersion: "qualification-qa-lite@2026-06-10",
        confidence: "medium",
        cost: { currency: "USD", total: 0, estimatedUsd: 0 },
        credits: { estimated: 1, charged: 0, mode: "dry_run" },
        fallback: { used: false, reason: "no_llm_provider_configured" },
        fallbackReason: "no_llm_provider_configured",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("falls back to available evidence instead of inventing an answer", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const response = await answerQualificationQuestion(testDb.db, "anon_seed", intent.id, {
        question: "Does the buyer mention specialized certification?",
      });

      expect(response.answer).toContain("available evidence");
      expect(response.citations.length).toBeGreaterThan(0);
      expect(response.grounded).toBe(true);
      expect(response.groundingStatus).toBe("partially_grounded");
      expect(response.evidenceCoverage.status).toBe("partial");
      expect(response.evidenceCoverage.matchedCitationCount).toBe(0);
      expect(response.limitations).toContain("No live LLM, embeddings, vector database, or external retrieval were used.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("does not answer from persisted citations when the bid is suppressed", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      await answerQualificationQuestion(testDb.db, "anon_seed", intent.id, {
        question: "What is the deadline?",
      });
      testDb.db.update(intentToBid)
        .set({ evidenceCitationsJson: JSON.stringify([{
          id: "citation_deadline",
          section: "key_dates",
          sourceType: "bid_field",
          sourceLabel: "Deadline",
          excerpt: "Suppressed deadline",
          url: "",
          confidence: "high",
          generatedAt: "2026-05-30T00:00:00.000Z",
        }]) })
        .where(eq(intentToBid.id, intent.id))
        .run();
      testDb.db.$client
        .prepare("UPDATE bids SET display_status = 'suppressed' WHERE id = ?")
        .run(intent.bid.id);

      await expect(answerQualificationQuestion(testDb.db, "anon_seed", intent.id, {
        question: "What is the deadline?",
      })).rejects.toThrow(IntentNotFoundError);
    } finally {
      await testDb.cleanup();
    }
  });
});
