import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  bidAttachments,
  complianceManifestItems,
  intentToBid,
  pursuitDecisions,
  submissionPaths,
} from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid, getUserIntent } from "@/server/intents/service";
import { createSubmissionPathRow } from "@/server/submission/repository";
import {
  detectQualificationAmendmentSignals,
  getQualificationFreshness,
  refreshQualificationEvidence,
} from "./freshness";

describe("qualification freshness", () => {
  it("detects amendment and addenda signals in bid fields and attachments", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      testDb.db.$client
        .prepare("UPDATE bids SET title = ?, description = ?, full_description = ? WHERE id = ?")
        .run(
          "Cloud solicitation Amendment 2",
          "Addendum answers vendor questions.",
          "Revised scope and updated response deadline.",
          intent.bid.id,
        );
      testDb.db
        .insert(bidAttachments)
        .values({
          id: "attachment_addendum",
          bidId: intent.bid.id,
          name: "Addendum_02.pdf",
          url: "https://example.gov/addendum-02.pdf",
          fetchedAt: "2026-05-30T03:00:00.000Z",
          archiveStatus: "archived",
          createdAt: "2026-05-30T03:00:00.000Z",
        })
        .run();

      const updated = await getUserIntent(testDb.db, "anon_seed", intent.id);
      const signals = detectQualificationAmendmentSignals(updated!.bid);

      expect(signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceType: "title", label: "Solicitation title" }),
          expect.objectContaining({ sourceType: "description", label: "Description" }),
          expect.objectContaining({ sourceType: "detail_archive", label: "Full description" }),
          expect.objectContaining({
            sourceType: "attachment",
            label: "Addendum_02.pdf",
            detectedAt: "2026-05-30T03:00:00.000Z",
          }),
        ]),
      );
      expect(signals.every((signal) => signal.detectedAt)).toBe(true);
    } finally {
      await testDb.cleanup();
    }
  });

  it("reports not_refreshed when an intent has no citation snapshot", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      const response = await getQualificationFreshness(testDb.db, "anon_seed", intent.id);

      expect(response.status).toBe("not_refreshed");
      expect(response.lastRefreshedAt).toBeNull();
      expect(response.needsRefresh).toBe(true);
    } finally {
      await testDb.cleanup();
    }
  });

  it("reports stale when amendment evidence is newer than the citation snapshot", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      testDb.db
        .insert(bidAttachments)
        .values({
          id: "attachment_addendum",
          bidId: intent.bid.id,
          name: "Addendum_02.pdf",
          url: "https://example.gov/addendum-02.pdf",
          fetchedAt: "2026-05-30T03:00:00.000Z",
          archiveStatus: "archived",
          createdAt: "2026-05-30T03:00:00.000Z",
        })
        .run();
      testDb.db
        .update(intentToBid)
        .set({
          evidenceCitationsJson: JSON.stringify([
            {
              id: "citation_old",
              section: "brief",
              sourceType: "bid_field",
              sourceLabel: "Old brief",
              excerpt: "Old evidence",
              url: "",
              confidence: "medium",
              generatedAt: "2026-05-30T01:00:00.000Z",
            },
          ]),
        })
        .where(eq(intentToBid.id, intent.id))
        .run();

      const response = await getQualificationFreshness(testDb.db, "anon_seed", intent.id);

      expect(response.status).toBe("stale");
      expect(response.lastRefreshedAt).toBe("2026-05-30T01:00:00.000Z");
      expect(response.latestSignalAt).toBe("2026-05-30T03:00:00.000Z");
      expect(response.latestSignal?.label).toBe("Addendum_02.pdf");
      expect(response.signalCount).toBe(1);
      expect(response.needsRefresh).toBe(true);
    } finally {
      await testDb.cleanup();
    }
  });

  it("reports current when citations are newer than amendment signals", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      testDb.db
        .insert(bidAttachments)
        .values({
          id: "attachment_addendum",
          bidId: intent.bid.id,
          name: "Addendum_02.pdf",
          url: "https://example.gov/addendum-02.pdf",
          fetchedAt: "2026-05-30T03:00:00.000Z",
          archiveStatus: "archived",
          createdAt: "2026-05-30T03:00:00.000Z",
        })
        .run();
      testDb.db
        .update(intentToBid)
        .set({
          evidenceCitationsJson: JSON.stringify([
            {
              id: "citation_new",
              section: "brief",
              sourceType: "bid_field",
              sourceLabel: "New brief",
              excerpt: "New evidence",
              url: "",
              confidence: "high",
              generatedAt: "2026-05-30T04:00:00.000Z",
            },
          ]),
        })
        .where(eq(intentToBid.id, intent.id))
        .run();

      const response = await getQualificationFreshness(testDb.db, "anon_seed", intent.id);

      expect(response.status).toBe("current");
      expect(response.lastRefreshedAt).toBe("2026-05-30T04:00:00.000Z");
      expect(response.needsRefresh).toBe(false);
    } finally {
      await testDb.cleanup();
    }
  });

  it("reports stale when a bid field amendment signal is newer than citations", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      testDb.db.$client
        .prepare("UPDATE bids SET title = ?, updated_at = ? WHERE id = ?")
        .run("Cloud solicitation Amendment 4", "2026-05-30T05:00:00.000Z", intent.bid.id);
      testDb.db
        .update(intentToBid)
        .set({
          evidenceCitationsJson: JSON.stringify([
            {
              id: "citation_old",
              section: "brief",
              sourceType: "bid_field",
              sourceLabel: "Old brief",
              excerpt: "Old evidence",
              url: "",
              confidence: "medium",
              generatedAt: "2026-05-30T04:00:00.000Z",
            },
          ]),
        })
        .where(eq(intentToBid.id, intent.id))
        .run();

      const response = await getQualificationFreshness(testDb.db, "anon_seed", intent.id);

      expect(response.status).toBe("stale");
      expect(response.latestSignalAt).toBe("2026-05-30T05:00:00.000Z");
      expect(response.latestSignal).toEqual(expect.objectContaining({ sourceType: "title" }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("refreshes qualification evidence without overwriting submission guidance rows", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      createSubmissionPathRow(testDb.db, {
        id: "submission_path_1",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        guidance: {
          method: "email",
          portalUrl: "",
          contactEmail: "buyer@example.com",
          requiresRegistration: false,
          requiresPhysicalDelivery: false,
          requiresAddendaAcknowledgement: true,
          complexityScore: 35,
          guidanceText: "Manual route",
          readinessChecklist: ["Keep this manual note"],
          riskFlags: ["Manual risk"],
        },
        timestamp: "2026-05-30T00:00:00.000Z",
      });
      testDb.db
        .insert(bidAttachments)
        .values({
          id: "attachment_addendum",
          bidId: intent.bid.id,
          name: "Amendment_03.pdf",
          url: "https://example.gov/amendment-03.pdf",
          fetchedAt: "2026-05-30T05:00:00.000Z",
          archiveStatus: "archived",
          createdAt: "2026-05-30T05:00:00.000Z",
        })
        .run();
      testDb.db
        .insert(complianceManifestItems)
        .values({
          id: "compliance_item_1",
          intentId: intent.id,
          bidId: intent.bid.id,
          userId: "anon_seed",
          title: "Manual compliance note",
          category: "forms",
          status: "blocked",
          evidenceStatus: "attached",
          notes: "Keep compliance note",
          sortOrder: 1,
          createdAt: "2026-05-30T00:00:00.000Z",
          updatedAt: "2026-05-30T00:00:00.000Z",
        })
        .run();
      testDb.db
        .insert(pursuitDecisions)
        .values({
          id: "pursuit_decision_1",
          intentId: intent.id,
          bidId: intent.bid.id,
          userId: "anon_seed",
          decision: "no_bid",
          reasonsJson: JSON.stringify(["Manual decision reason"]),
          notes: "Keep decision note",
          createdAt: "2026-05-30T00:00:00.000Z",
          updatedAt: "2026-05-30T00:00:00.000Z",
        })
        .run();

      const response = await refreshQualificationEvidence(testDb.db, "anon_seed", intent.id, {
        now: "2026-05-30T06:00:00.000Z",
      });
      const submission = testDb.db.select().from(submissionPaths).where(eq(submissionPaths.intentId, intent.id)).get();
      const compliance = testDb.db
        .select()
        .from(complianceManifestItems)
        .where(eq(complianceManifestItems.intentId, intent.id))
        .get();
      const decision = testDb.db
        .select()
        .from(pursuitDecisions)
        .where(eq(pursuitDecisions.intentId, intent.id))
        .get();

      expect(response.freshness.status).toBe("current");
      expect(response.citations.citations.every((citation) => citation.generatedAt === "2026-05-30T06:00:00.000Z"))
        .toBe(true);
      expect(response.intent.generated.aiBidBrief).toContain(intent.bid.issuerName);
      expect(submission?.method).toBe("email");
      expect(JSON.parse(submission?.readinessChecklistJson ?? "[]")).toEqual(["Keep this manual note"]);
      expect(compliance?.status).toBe("blocked");
      expect(compliance?.notes).toBe("Keep compliance note");
      expect(decision?.decision).toBe("no_bid");
      expect(decision?.notes).toBe("Keep decision note");
    } finally {
      await testDb.cleanup();
    }
  });
});
