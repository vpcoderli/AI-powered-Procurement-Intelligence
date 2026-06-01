import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generateWorkflowCoachCards } from "@/lib/knowledge/coach";
import { createTestDatabase } from "@/server/db/test-utils";
import type { AppDatabase } from "@/server/db/client";
import { knowledgeItems, organizationMemberships, organizations, users } from "@/server/db/schema";
import { createIntentForBid } from "@/server/intents/service";
import { createKnowledgeItem, KnowledgeValidationError, listKnowledgeItems } from "./service";
import { KNOWLEDGE_SOURCE_KINDS, SOURCE_KINDS } from "./types";

function createKnowledgeScope(db: AppDatabase, options: { membershipStatus?: string | null } = {}) {
  const membershipStatus = options.membershipStatus === undefined ? "active" : options.membershipStatus;

  db.insert(organizations)
    .values({
      id: "org_seed",
      name: "Seed Organization",
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();

  if (membershipStatus) {
    db.insert(organizationMemberships)
      .values({
        organizationId: "org_seed",
        userId: "anon_seed",
        role: "member",
        status: membershipStatus,
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .onConflictDoUpdate({
        target: [organizationMemberships.organizationId, organizationMemberships.userId],
        set: {
          status: membershipStatus,
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
      })
      .run();
  }
}

describe("knowledge service", () => {
  it("exposes source kinds under the public constant", () => {
    expect(SOURCE_KINDS).toBe(KNOWLEDGE_SOURCE_KINDS);
  });

  it("creates and lists organization-scoped knowledge items", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db);

      const item = await createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: " Past performance snippet ",
        body: " Reuse this wording for similar contracts. ",
        type: "template_snippet",
        tags: [" Past Performance ", "", "proposal"],
        sourceKind: "manual",
      });
      const result = await listKnowledgeItems(testDb.db, { organizationId: "org_seed", q: "performance" });

      expect(item.title).toBe("Past performance snippet");
      expect(item.body).toBe("Reuse this wording for similar contracts.");
      expect(item.tags).toEqual(["Past Performance", "proposal"]);
      expect(result.items.map((entry) => entry.id)).toContain(item.id);
    } finally {
      await testDb.cleanup();
    }
  });

  it("filters by source intent, bid, and type", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db);

      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      await createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Compliance lesson",
        body: "Check required forms before pricing.",
        type: "lesson",
        tags: ["compliance"],
        sourceKind: "intent",
        sourceIntentId: intent.id,
        sourceBidId: intent.bid.id,
      });
      const result = await listKnowledgeItems(testDb.db, {
        organizationId: "org_seed",
        intentId: intent.id,
        bidId: intent.bid.id,
        type: "lesson",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ sourceIntentId: intent.id, sourceBidId: intent.bid.id });
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects empty title/body and invalid item types", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db);

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: " ",
        body: "Body",
        type: "lesson",
        tags: [],
        sourceKind: "manual",
      })).rejects.toThrow("Knowledge title is required.");

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Title",
        body: "Body",
        type: "bad_type",
        tags: [],
        sourceKind: "manual",
      })).rejects.toThrow("Unsupported knowledge item type.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects malformed title, body, and source URL values", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db);

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: undefined as unknown as string,
        body: "Body",
        type: "lesson",
        tags: [],
        sourceKind: "manual",
      })).rejects.toBeInstanceOf(KnowledgeValidationError);

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Title",
        body: 42 as unknown as string,
        type: "lesson",
        tags: [],
        sourceKind: "manual",
      })).rejects.toBeInstanceOf(KnowledgeValidationError);

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Title",
        body: "Body",
        type: "lesson",
        tags: [],
        sourceKind: "manual",
        sourceUrl: 42 as unknown as string,
      })).rejects.toBeInstanceOf(KnowledgeValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects cross-user intent links", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db);

      const intent = await createIntentForBid(testDb.db, "other_seed", "1");

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Cross-user lesson",
        body: "Do not allow linking to another user's intent.",
        type: "lesson",
        tags: [],
        sourceKind: "intent",
        sourceIntentId: intent.id,
      })).rejects.toThrow("Linked intent is not available.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects intent and bid mismatches", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db);

      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Mismatch lesson",
        body: "The linked bid must match the linked intent.",
        type: "lesson",
        tags: [],
        sourceKind: "intent",
        sourceIntentId: intent.id,
        sourceBidId: "2",
      })).rejects.toThrow("Linked bid does not match intent.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects invalid bid links before sqlite foreign key errors", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db);

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Missing bid lesson",
        body: "The linked bid must exist before insert.",
        type: "lesson",
        tags: [],
        sourceKind: "bid",
        sourceBidId: "missing_bid",
      })).rejects.toThrow("Linked bid is not available.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("does not implicitly create missing users or organizations", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "missing_org",
        userId: "missing_user",
        title: "No stub",
        body: "Knowledge creation should not create principal records.",
        type: "lesson",
        tags: [],
        sourceKind: "manual",
      })).rejects.toBeInstanceOf(KnowledgeValidationError);

      expect(testDb.db.select().from(users).where(eq(users.id, "missing_user")).limit(1).get()).toBeUndefined();
      expect(testDb.db.select().from(organizations).where(eq(organizations.id, "missing_org")).limit(1).get()).toBeUndefined();
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects existing users and organizations without membership", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createKnowledgeScope(testDb.db, { membershipStatus: null });

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "No membership",
        body: "Existing users still need active organization membership.",
        type: "lesson",
        tags: [],
        sourceKind: "manual",
      })).rejects.toThrow("Knowledge organization membership is not available.");

      expect(
        testDb.db.select().from(knowledgeItems).where(eq(knowledgeItems.organizationId, "org_seed")).all(),
      ).toHaveLength(0);
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects disabled and invited memberships", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      for (const status of ["disabled", "invited"]) {
        createKnowledgeScope(testDb.db, { membershipStatus: status });

        await expect(createKnowledgeItem(testDb.db, {
          organizationId: "org_seed",
          userId: "anon_seed",
          title: `${status} membership`,
          body: "Only active organization membership can create knowledge.",
          type: "lesson",
          tags: [],
          sourceKind: "manual",
        })).rejects.toThrow("Knowledge organization membership is not available.");

        expect(
          testDb.db.select().from(knowledgeItems).where(eq(knowledgeItems.organizationId, "org_seed")).all(),
        ).toHaveLength(0);
      }
    } finally {
      await testDb.cleanup();
    }
  });

  it("generates deterministic workflow coach cards from an intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const cards = generateWorkflowCoachCards(intent);

      expect(cards.length).toBeGreaterThanOrEqual(3);
      expect(cards.map((card) => card.category)).toEqual(expect.arrayContaining(["deadline", "readiness", "decision"]));
      expect(cards.every((card) => card.title && card.guidance && card.suggestedAction)).toBe(true);
    } finally {
      await testDb.cleanup();
    }
  });
});
