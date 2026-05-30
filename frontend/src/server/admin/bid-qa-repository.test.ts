import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bidAttachments, bidFieldCorrections, bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  batchUpdateAdminBidQaItems,
  listAdminBidQaCorrections,
  listAdminBidQaItems,
  updateAdminBidQaCorrection,
  updateAdminBidQaDisplayStatus,
  updateAdminBidQaReview,
} from "./bid-qa-repository";

const NOW = "2026-05-30T00:00:00.000Z";

describe("admin bid QA repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();

    testDb.db.insert(bids).values([
      {
        id: "ca_failed_archive",
        source: "California Cal eProcure",
        sourceBidId: "CA-1",
        dedupeKey: "CA-1",
        title: "California records system",
        description: "Records system procurement",
        issuerName: "California Agency",
        issuerType: "state",
        stateCode: "CA",
        sourceUrl: "https://caleprocure.ca.gov/event/CA-1",
        deadlineDate: "2026-06-30",
        sourceConfidence: "high",
        qualityFlagsJson: JSON.stringify(["attachment_archive_failed"]),
        adminReviewStatus: "needs_review",
        detailArchiveStatus: "failed",
        detailArchiveError: "HTTP 403",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "tx_low_quality",
        source: "Texas ESBD",
        sourceBidId: "TX-1",
        dedupeKey: "TX-1",
        title: "Texas security services",
        description: "Security services procurement",
        issuerName: "Texas Agency",
        issuerType: "state",
        stateCode: "TX",
        sourceUrl: "https://example.texas.gov/TX-1",
        sourceConfidence: "low",
        qualityFlagsJson: JSON.stringify(["missing_deadline", "missing_contact"]),
        adminReviewStatus: "unreviewed",
        detailArchiveStatus: "unavailable",
        detailArchiveError: "Browser access required",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "ny_clean",
        source: "New York Contract Reporter",
        sourceBidId: "NY-1",
        dedupeKey: "NY-1",
        title: "New York cloud modernization",
        description: "Cloud modernization procurement",
        issuerName: "New York Agency",
        issuerType: "state",
        stateCode: "NY",
        sourceUrl: "https://example.ny.gov/NY-1",
        deadlineDate: "2026-07-15",
        sourceConfidence: "high",
        qualityFlagsJson: JSON.stringify([]),
        adminReviewStatus: "reviewed",
        detailArchiveStatus: "archived",
        firstSeenAt: NOW,
        lastSeenAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]).run();

    testDb.db.insert(bidAttachments).values([
      {
        id: "ca_failed_attachment",
        bidId: "ca_failed_archive",
        name: "Scope.pdf",
        url: "https://caleprocure.ca.gov/scope.pdf",
        archiveStatus: "failed",
        archiveError: "HTTP 403",
        createdAt: NOW,
      },
      {
        id: "tx_unavailable_attachment",
        bidId: "tx_low_quality",
        name: "Portal link",
        url: "https://example.texas.gov/login",
        archiveStatus: "unavailable",
        archiveError: "Login required",
        createdAt: NOW,
      },
      {
        id: "ny_archived_attachment",
        bidId: "ny_clean",
        name: "Solicitation.pdf",
        url: "https://example.ny.gov/solicitation.pdf",
        archiveStatus: "archived",
        createdAt: NOW,
      },
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("lists QA items with summary, archive issue counts, and quality scores", async () => {
    const response = await listAdminBidQaItems(testDb.db);

    expect(response.summary).toEqual({
      total: 3,
      needsReview: 2,
      archiveIssues: 2,
      lowQuality: 2,
    });
    expect(response.items.map((item) => item.id)).toEqual([
      "tx_low_quality",
      "ca_failed_archive",
      "ny_clean",
    ]);
    expect(response.items.find((item) => item.id === "ca_failed_archive")).toMatchObject({
      displayStatus: "published",
      correctionCount: 0,
      qualityScore: 65,
      archiveIssueCount: 2,
      archiveFailedCount: 2,
      archiveUnavailableCount: 0,
    });
    expect(response.items.find((item) => item.id === "tx_low_quality")).toMatchObject({
      qualityScore: 34,
      archiveIssueCount: 2,
      archiveFailedCount: 0,
      archiveUnavailableCount: 2,
    });
  });

  it("filters by archive status, review status, state, and query", async () => {
    await expect(listAdminBidQaItems(testDb.db, { archiveStatus: "failed" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ca_failed_archive" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { reviewStatus: "needs_review" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ca_failed_archive" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { stateCode: "TX" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "tx_low_quality" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { q: "cloud" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ny_clean" })],
    });
  });

  it("filters by display status, source confidence, score range, reviewer, and reviewed date", async () => {
    await updateAdminBidQaDisplayStatus(testDb.db, "ca_failed_archive", {
      displayStatus: "suppressed",
      reviewerId: "operator-1",
      reviewedAt: "2026-05-30T02:00:00.000Z",
    });
    await updateAdminBidQaReview(testDb.db, "ny_clean", {
      reviewStatus: "reviewed",
      reviewerId: "admin-1",
      reviewedAt: "2026-05-30T04:00:00.000Z",
    });

    await expect(listAdminBidQaItems(testDb.db, { displayStatus: "suppressed" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ca_failed_archive" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { sourceConfidence: "low" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "tx_low_quality" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { minQualityScore: 60, maxQualityScore: 80 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ca_failed_archive" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { reviewerId: "admin-1" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ny_clean" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { reviewedFrom: "2026-05-30T03:00:00.000Z" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ny_clean" })],
    });
    await expect(listAdminBidQaItems(testDb.db, { reviewedTo: "2026-05-30T03:00:00.000Z" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "ca_failed_archive" })],
    });
  });

  it("updates review status with note, reviewer, and timestamp", async () => {
    const updated = await updateAdminBidQaReview(testDb.db, "tx_low_quality", {
      reviewStatus: "reviewed",
      note: "Verified manually against portal.",
      reviewerId: "admin-1",
      reviewedAt: "2026-05-30T01:00:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "tx_low_quality",
      adminReviewStatus: "reviewed",
      adminReviewNote: "Verified manually against portal.",
      adminReviewedBy: "admin-1",
      adminReviewedAt: "2026-05-30T01:00:00.000Z",
    });

    const row = testDb.db.select().from(bids).where(eq(bids.id, "tx_low_quality")).get();
    expect(row).toMatchObject({
      adminReviewStatus: "reviewed",
      adminReviewNote: "Verified manually against portal.",
      adminReviewedBy: "admin-1",
      adminReviewedAt: "2026-05-30T01:00:00.000Z",
    });
  });

  it("updates display status for publish controls", async () => {
    const updated = await updateAdminBidQaDisplayStatus(testDb.db, "ca_failed_archive", {
      displayStatus: "suppressed",
      reviewerId: "operator-1",
      reviewedAt: "2026-05-30T02:00:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "ca_failed_archive",
      displayStatus: "suppressed",
      adminReviewedBy: "operator-1",
      adminReviewedAt: "2026-05-30T02:00:00.000Z",
    });

    const row = testDb.db.select().from(bids).where(eq(bids.id, "ca_failed_archive")).get();
    expect(row?.displayStatus).toBe("suppressed");
  });

  it("updates allowed bid fields and records original/corrected values", async () => {
    const updated = await updateAdminBidQaCorrection(testDb.db, "tx_low_quality", {
      corrections: {
        title: "Texas security services corrected",
        deadlineDate: "2026-08-01",
      },
      note: "Corrected from portal QA.",
      reviewerId: "admin-1",
      correctedAt: "2026-05-30T03:00:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "tx_low_quality",
      title: "Texas security services corrected",
      deadlineDate: "2026-08-01",
      correctionCount: 2,
    });

    const row = testDb.db.select().from(bids).where(eq(bids.id, "tx_low_quality")).get();
    expect(row).toMatchObject({
      title: "Texas security services corrected",
      deadlineDate: "2026-08-01",
    });

    const corrections = testDb.db
      .select()
      .from(bidFieldCorrections)
      .where(eq(bidFieldCorrections.bidId, "tx_low_quality"))
      .all();

    expect(corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldName: "title",
          originalValue: "Texas security services",
          correctedValue: "Texas security services corrected",
          note: "Corrected from portal QA.",
          correctedBy: "admin-1",
          correctedAt: "2026-05-30T03:00:00.000Z",
        }),
        expect.objectContaining({
          fieldName: "deadlineDate",
          originalValue: null,
          correctedValue: "2026-08-01",
        }),
      ]),
    );
  });

  it("lists correction history in newest-first order", async () => {
    await updateAdminBidQaCorrection(testDb.db, "tx_low_quality", {
      corrections: { title: "Corrected once" },
      note: "First correction",
      reviewerId: "admin-1",
      correctedAt: "2026-05-30T03:00:00.000Z",
    });
    await updateAdminBidQaCorrection(testDb.db, "tx_low_quality", {
      corrections: { deadlineDate: "2026-08-01" },
      note: "Second correction",
      reviewerId: "operator-1",
      correctedAt: "2026-05-30T04:00:00.000Z",
    });

    await expect(listAdminBidQaCorrections(testDb.db, "tx_low_quality")).resolves.toEqual([
      expect.objectContaining({ fieldName: "deadlineDate", note: "Second correction", correctedBy: "operator-1" }),
      expect.objectContaining({ fieldName: "title", note: "First correction", correctedBy: "admin-1" }),
    ]);
  });

  it("batch updates review and display status for selected QA items", async () => {
    const reviewed = await batchUpdateAdminBidQaItems(testDb.db, {
      bidIds: ["ca_failed_archive", "tx_low_quality"],
      reviewStatus: "reviewed",
      note: "Batch reviewed",
      reviewerId: "operator-1",
      reviewedAt: "2026-05-30T05:00:00.000Z",
    });

    expect(reviewed.updatedCount).toBe(2);
    expect(reviewed.items).toEqual([
      expect.objectContaining({ id: "ca_failed_archive", adminReviewStatus: "reviewed" }),
      expect.objectContaining({ id: "tx_low_quality", adminReviewStatus: "reviewed" }),
    ]);

    const suppressed = await batchUpdateAdminBidQaItems(testDb.db, {
      bidIds: ["ca_failed_archive", "tx_low_quality"],
      displayStatus: "suppressed",
      reviewerId: "operator-1",
      reviewedAt: "2026-05-30T06:00:00.000Z",
    });

    expect(suppressed.updatedCount).toBe(2);
    expect(suppressed.items).toEqual([
      expect.objectContaining({ id: "ca_failed_archive", displayStatus: "suppressed" }),
      expect.objectContaining({ id: "tx_low_quality", displayStatus: "suppressed" }),
    ]);
  });
});
