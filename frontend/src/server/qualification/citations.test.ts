import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bids, intentToBid } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  getOrCreateQualificationCitations,
} from "./citations";

describe("qualification evidence citations", () => {
  it("generates and persists evidence citations for an intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const response = await getOrCreateQualificationCitations(testDb.db, "anon_seed", intent.id);
      const row = testDb.db.select().from(intentToBid).where(eq(intentToBid.id, intent.id)).get();

      expect(response.intentId).toBe(intent.id);
      expect(response.bidId).toBe(intent.bid.id);
      expect(response.citations.length).toBeGreaterThanOrEqual(4);
      expect(response.citations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: "bid_field",
            section: "brief",
            sourceLabel: "Solicitation title",
            excerpt: intent.bid.title,
          }),
          expect.objectContaining({
            sourceType: "attachment",
            section: "compliance",
          }),
        ]),
      );
      expect(response.citations.every((citation) => !citation.url.includes("sam.gov/opp/12345"))).toBe(true);
      expect(response.citations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: "attachment",
            url: expect.stringMatching(/^\/api\/bids\/1\/attachments\//),
          }),
        ]),
      );
      expect(JSON.parse(row?.evidenceCitationsJson ?? "[]")).toHaveLength(response.citations.length);
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns persisted citations instead of regenerating when a snapshot exists", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const persisted = [{
        id: "citation_manual",
        section: "brief",
        sourceType: "bid_field",
        sourceLabel: "Manual source",
        excerpt: "Manual excerpt",
        url: "",
        confidence: "high",
        generatedAt: "2026-05-30T00:00:00.000Z",
      }];
      testDb.db.update(intentToBid)
        .set({ evidenceCitationsJson: JSON.stringify(persisted) })
        .where(eq(intentToBid.id, intent.id))
        .run();

      const response = await getOrCreateQualificationCitations(testDb.db, "anon_seed", intent.id);

      expect(response.citations).toEqual(persisted);
    } finally {
      await testDb.cleanup();
    }
  });

  it("routes unsafe bid source evidence to the local bid detail page", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db.update(bids)
        .set({ sourceUrl: "https://sam.gov/opp/12345" })
        .where(eq(bids.id, "1"))
        .run();
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      const response = await getOrCreateQualificationCitations(testDb.db, "anon_seed", intent.id);

      expect(response.citations.filter((citation) => citation.sourceType === "bid_field")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ url: "/bids/1" }),
        ]),
      );
      expect(response.citations.filter((citation) => citation.sourceType === "bid_field")).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ url: expect.stringContaining("sam.gov/opp/12345") }),
        ]),
      );
    } finally {
      await testDb.cleanup();
    }
  });

  it("does not return a persisted snapshot when the bid is suppressed", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      testDb.db.update(intentToBid)
        .set({
          evidenceCitationsJson: JSON.stringify([{
            id: "citation_old",
            section: "brief",
            sourceType: "bid_field",
            sourceLabel: "Old title",
            excerpt: "Suppressed title",
            url: "https://example.gov/old",
            confidence: "high",
            generatedAt: "2026-05-30T00:00:00.000Z",
          }]),
        })
        .where(eq(intentToBid.id, intent.id))
        .run();
      testDb.db.$client
        .prepare("UPDATE bids SET display_status = 'suppressed' WHERE id = ?")
        .run(intent.bid.id);

      await expect(getOrCreateQualificationCitations(testDb.db, "anon_seed", intent.id))
        .rejects.toThrow(IntentNotFoundError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("regenerates citations when a persisted snapshot has invalid enum fields", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      testDb.db.update(intentToBid)
        .set({
          evidenceCitationsJson: JSON.stringify([{
            id: "citation_bad",
            section: "unexpected",
            sourceType: "bid_field",
            sourceLabel: "Bad section",
            excerpt: "Bad section",
            url: "",
            confidence: "high",
            generatedAt: "2026-05-30T00:00:00.000Z",
          }]),
        })
        .where(eq(intentToBid.id, intent.id))
        .run();

      const response = await getOrCreateQualificationCitations(testDb.db, "anon_seed", intent.id);

      expect(response.citations).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ section: "unexpected" })]),
      );
      expect(response.citations).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "citation_bid_title" })]),
      );
    } finally {
      await testDb.cleanup();
    }
  });
});
