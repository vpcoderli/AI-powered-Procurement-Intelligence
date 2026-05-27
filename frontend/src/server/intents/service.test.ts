import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { intentToBid } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import {
  createIntentForBid,
  listUserIntents,
  updateIntentStatus,
} from "./service";

describe("intent service", () => {
  it("creates an intent and stores generated fields", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const row = testDb.db.select().from(intentToBid).where(eq(intentToBid.id, intent.id)).get();

      expect(intent.id).toMatch(/^intent_/);
      expect(intent.userId).toBe("anon_seed");
      expect(intent.bid.id).toBe("1");
      expect(intent.status).toBe("intent_added");
      expect(intent.generated.aiBidBrief).toContain("Department of Defense");
      expect(intent.generated.initialChecklist).toContain(
        "Read the full solicitation and all attachments.",
      );
      expect(intent.match.score).toBeGreaterThan(0);
      expect(row?.aiBidBrief).toBe(intent.generated.aiBidBrief);
      expect(JSON.parse(row?.initialChecklistJson ?? "[]")).toHaveLength(7);
      expect(JSON.parse(row?.matchScoreSnapshotJson ?? "{}").bidId).toBe("1");
    } finally {
      await testDb.cleanup();
    }
  });

  it("is idempotent for the same user and bid", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const first = await createIntentForBid(testDb.db, "anon_seed", "1");
      const second = await createIntentForBid(testDb.db, "anon_seed", "1");
      const rows = testDb.db
        .select()
        .from(intentToBid)
        .where(eq(intentToBid.bidId, "1"))
        .all();

      expect(second.id).toBe(first.id);
      expect(rows).toHaveLength(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("lists only the current user's intents", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      await createIntentForBid(testDb.db, "anon_seed", "1");
      await createIntentForBid(testDb.db, "user_other", "2");

      const intents = await listUserIntents(testDb.db, "anon_seed");

      expect(intents).toHaveLength(1);
      expect(intents[0].userId).toBe("anon_seed");
      expect(intents[0].bid.id).toBe("1");
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects unsupported status updates", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      await expect(
        updateIntentStatus(testDb.db, "anon_seed", intent.id, "not_supported"),
      ).rejects.toThrow("Unsupported intent status");
    } finally {
      await testDb.cleanup();
    }
  });
});
