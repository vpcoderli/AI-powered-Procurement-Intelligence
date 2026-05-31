import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { intentToBid, pursuitDecisions } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import type { BidMatchResult } from "@/server/match/types";
import {
  createPursuitDecision,
  getPursuitDecisionBoard,
} from "./service";

const weakMatch: BidMatchResult = {
  bidId: "1",
  score: 25,
  confidence: "low",
  components: {
    geography: 0,
    keywords: 5,
    category: 0,
    certifications: 0,
    contractValue: 5,
    deadline: 15,
  },
  explanation: "Weak fit.",
  riskNotes: [
    "Bid location is outside your listed service states.",
    "Estimated contract value is outside your preferred range.",
    "No attachments are listed for this bid.",
  ],
  missingProfileHints: [
    "Add service states to improve bid matching.",
    "Add certifications to improve bid matching.",
  ],
};

describe("pursuit decision service", () => {
  it("returns a recommendation and empty history before manual decisions", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const board = await getPursuitDecisionBoard(testDb.db, "anon_seed", intent.id);

      expect(board.intentId).toBe(intent.id);
      expect(board.recommendation.recommendation).toMatch(/pursue|no_bid|review/);
      expect(board.recommendation.reasons.length).toBeGreaterThan(0);
      expect(board.recommendation.reasonDetails.length).toBeGreaterThan(0);
      expect(board.recommendation.reasonDetails[0]).toEqual(expect.objectContaining({
        category: expect.any(String),
        severity: expect.stringMatching(/positive|watch|blocker/),
        summary: expect.any(String),
        explanation: expect.any(String),
        evidenceLabel: expect.any(String),
        suggestedAction: expect.any(String),
      }));
      expect(board.currentDecision).toBeNull();
      expect(board.history).toEqual([]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("stores decision history and returns the latest decision", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const first = await createPursuitDecision(testDb.db, "anon_seed", intent.id, {
        decision: "defer",
        reasons: ["Need pricing review"],
        notes: "Waiting for partner quote.",
      });
      const second = await createPursuitDecision(testDb.db, "anon_seed", intent.id, {
        decision: "pursue",
        reasons: ["Strong fit", "Quote received"],
        notes: "Proceed to proposal prep.",
      });
      const rows = testDb.db
        .select()
        .from(pursuitDecisions)
        .where(eq(pursuitDecisions.intentId, intent.id))
        .all();

      expect(first.currentDecision?.decision).toBe("defer");
      expect(second.currentDecision).toMatchObject({
        decision: "pursue",
        notes: "Proceed to proposal prep.",
      });
      expect(second.currentDecision?.reasons).toEqual(["Strong fit", "Quote received"]);
      expect(second.history).toHaveLength(2);
      expect(rows).toHaveLength(2);
    } finally {
      await testDb.cleanup();
    }
  });

  it("maps weak opportunities to no-bid taxonomy categories without changing stored decision reasons", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      testDb.db
        .update(intentToBid)
        .set({
          matchScoreSnapshotJson: JSON.stringify(weakMatch),
          riskFlagsJson: JSON.stringify([
            "Deadline is soon; confirm bid/no-bid quickly.",
            "Addenda acknowledgement may be required.",
          ]),
        })
        .where(eq(intentToBid.id, intent.id))
        .run();
      await createPursuitDecision(testDb.db, "anon_seed", intent.id, {
        decision: "defer",
        reasons: ["Manual user reason"],
        notes: "Keep user text.",
      });

      const board = await getPursuitDecisionBoard(testDb.db, "anon_seed", intent.id);

      expect(board.recommendation.recommendation).toBe("no_bid");
      expect(board.recommendation.reasonDetails.map((detail) => detail.category)).toEqual(
        expect.arrayContaining(["fit", "risk", "deadline", "profile"]),
      );
      expect(board.recommendation.reasonDetails.some((detail) => detail.severity === "blocker")).toBe(true);
      expect(board.currentDecision?.reasons).toEqual(["Manual user reason"]);
      expect(board.currentDecision?.notes).toBe("Keep user text.");
    } finally {
      await testDb.cleanup();
    }
  });
});
