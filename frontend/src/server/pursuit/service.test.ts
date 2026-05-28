import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pursuitDecisions } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  createPursuitDecision,
  getPursuitDecisionBoard,
} from "./service";

describe("pursuit decision service", () => {
  it("returns a recommendation and empty history before manual decisions", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const board = await getPursuitDecisionBoard(testDb.db, "anon_seed", intent.id);

      expect(board.intentId).toBe(intent.id);
      expect(board.recommendation.recommendation).toMatch(/pursue|no_bid|review/);
      expect(board.recommendation.reasons.length).toBeGreaterThan(0);
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
});
