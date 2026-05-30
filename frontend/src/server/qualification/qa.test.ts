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
