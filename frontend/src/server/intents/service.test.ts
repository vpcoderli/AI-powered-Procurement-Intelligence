import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { intentToBid } from "@/server/db/schema";
import { inviteWorkspaceMember, listWorkspaceMemberUserIds } from "@/server/account/workspace";
import { registerUser } from "@/server/auth/service";
import { createTestDatabase } from "@/server/db/test-utils";
import type { BidMatchResult } from "@/server/match/types";
import { createIntentRow } from "./repository";
import {
  createIntentForBid,
  listUserIntents,
  updateIntentStatus,
} from "./service";
import type { GeneratedIntentContent } from "./types";

const generated: GeneratedIntentContent = {
  aiBidBrief: "Brief",
  keyDates: { publishedDate: "2026-05-01", deadlineDate: "2026-06-01" },
  initialChecklist: ["Read the full solicitation and all attachments."],
  riskFlags: [],
};

const match: BidMatchResult = {
  bidId: "1",
  score: 70,
  confidence: "medium",
  components: {
    geography: 20,
    keywords: 20,
    category: 10,
    certifications: 0,
    contractValue: 5,
    deadline: 15,
  },
  explanation: "Good fit.",
  riskNotes: [],
  missingProfileHints: [],
};

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

  it("returns the existing intent row when a duplicate user and bid insert races", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const first = createIntentRow(testDb.db, {
        id: "intent_first",
        userId: "anon_seed",
        bidId: "1",
        status: "intent_added",
        generated,
        match,
        timestamp: "2026-05-27T00:00:00.000Z",
      });
      const second = createIntentRow(testDb.db, {
        id: "intent_second",
        userId: "anon_seed",
        bidId: "1",
        status: "intent_added",
        generated,
        match,
        timestamp: "2026-05-27T00:00:01.000Z",
      });
      const rows = testDb.db
        .select()
        .from(intentToBid)
        .where(eq(intentToBid.bidId, "1"))
        .all();

      expect(first?.id).toBe("intent_first");
      expect(second?.id).toBe("intent_first");
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

  it("shares intent workspaces across workspace members when a workspace scope is provided", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const owner = await registerUser(testDb.db, {
        email: "owner@example.com",
        password: "strong-password",
      });
      const member = await inviteWorkspaceMember(testDb.db, owner.user.id, {
        email: "member@example.com",
        role: "member",
      });
      const memberUserId = member.member.userId;
      const scopeUserIds = listWorkspaceMemberUserIds(testDb.db, owner.user.id);
      const first = await createIntentForBid(testDb.db, owner.user.id, "1", { scopeUserIds });
      const second = await createIntentForBid(testDb.db, memberUserId, "1", { scopeUserIds });

      expect(second.id).toBe(first.id);
      expect(await listUserIntents(testDb.db, memberUserId, { scopeUserIds })).toHaveLength(1);
      await expect(updateIntentStatus(testDb.db, memberUserId, first.id, "needs_review", { scopeUserIds }))
        .resolves.toMatchObject({
          id: first.id,
          status: "needs_review",
        });
    } finally {
      await testDb.cleanup();
    }
  });

  it("does not expose another workspace's intents", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const owner = await registerUser(testDb.db, {
        email: "owner@example.com",
        password: "strong-password",
      });
      const outsider = await registerUser(testDb.db, {
        email: "outsider@example.com",
        password: "strong-password",
      });
      const ownerScope = listWorkspaceMemberUserIds(testDb.db, owner.user.id);
      const outsiderScope = listWorkspaceMemberUserIds(testDb.db, outsider.user.id);
      const intent = await createIntentForBid(testDb.db, owner.user.id, "1", {
        scopeUserIds: ownerScope,
      });

      await expect(
        updateIntentStatus(testDb.db, outsider.user.id, intent.id, "needs_review", {
          scopeUserIds: outsiderScope,
        }),
      ).rejects.toThrow("Intent not found");
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
