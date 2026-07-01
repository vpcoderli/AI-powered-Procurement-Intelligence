import { describe, expect, it } from "vitest";
import { organizationMemberships, organizations } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createKnowledgeItem } from "./service";
import { retrieveKnowledgeContext } from "./retrieval";

async function seedKnowledge(testDb: TestDatabase) {
  testDb.db.insert(organizations)
    .values({
      id: "org_seed",
      name: "Seed Organization",
      accountTier: "enterprise",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();

  testDb.db.insert(organizationMemberships)
    .values({
      organizationId: "org_seed",
      userId: "anon_seed",
      role: "owner",
      status: "active",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();

  await createKnowledgeItem(testDb.db, {
    organizationId: "org_seed",
    userId: "anon_seed",
    title: "Cloud security past performance",
    body: "Reusable response language for FedRAMP cloud migration work.",
    type: "template_snippet",
    tags: ["cloud", "security", "fedramp"],
    sourceKind: "manual",
    sourceUrl: "https://example.com/cloud",
    metadata: { owner: "proposal-team", sourceConfidence: "high" },
  });
}

describe("knowledge retrieval lite", () => {
  it("returns a deterministic RAG-ready lexical context with chunks and embedding status", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      await seedKnowledge(testDb);

      const result = await retrieveKnowledgeContext(testDb.db, {
        organizationId: "org_seed",
        query: "cloud security response proposal-team manual example",
        limit: 5,
      });

      const [item] = result.items;

      expect(result.items).toHaveLength(1);
      expect(result.trace.provider).toBe("lexical");
      expect(result.trace.retrievalMode).toBe("lexical_mock_rag");
      expect(result.trace.queryTokens).toEqual([
        "cloud",
        "security",
        "response",
        "proposal",
        "team",
        "manual",
        "example",
      ]);
      expect(result.trace.selectedItemIds).toEqual([result.items[0].id]);
      expect(result.trace.matchedFields).toEqual(expect.arrayContaining([
        expect.objectContaining({
          itemId: result.items[0].id,
          field: "title",
          tokenHits: ["cloud", "security"],
        }),
        expect.objectContaining({
          itemId: result.items[0].id,
          field: "body",
          tokenHits: ["cloud", "response"],
        }),
        expect.objectContaining({
          itemId: result.items[0].id,
          field: "tags",
          tokenHits: ["cloud", "security"],
        }),
        expect.objectContaining({
          itemId: result.items[0].id,
          field: "sourceKind",
          tokenHits: ["manual"],
        }),
        expect.objectContaining({
          itemId: result.items[0].id,
          field: "sourceUrl",
          tokenHits: ["cloud", "example"],
        }),
        expect.objectContaining({
          itemId: result.items[0].id,
          field: "metadata",
          tokenHits: ["proposal", "team"],
        }),
      ]));
      expect(result.trace.embeddingStatus).toEqual({
        status: "mock_unavailable",
        provider: null,
        vectorStore: "none",
        reason: "embedding_provider_out_of_scope_for_lite_phase",
      });
      expect(result.trace.chunks).toEqual([
        expect.objectContaining({
          itemId: item.id,
          title: "Cloud security past performance",
          sourceRefs: {
            sourceKind: "manual",
            sourceIntentId: null,
            sourceBidId: null,
            sourceUrl: "https://example.com/cloud",
          },
          score: expect.any(Number),
          matchedReason: expect.stringContaining("title matched cloud, security"),
          textExcerpt: expect.stringContaining("Reusable response language"),
        }),
      ]);
      expect(result.trace.chunks[0].score).toBeGreaterThan(0);
      expect(result.trace.chunks[0].textExcerpt.length).toBeLessThanOrEqual(240);
    } finally {
      await testDb.cleanup();
    }
  });
});
