import { describe, expect, it } from "vitest";
import { generateWorkflowCoachCards } from "@/lib/knowledge/coach";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import { createKnowledgeItem, listKnowledgeItems } from "./service";

describe("knowledge service", () => {
  it("creates and lists organization-scoped knowledge items", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
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
