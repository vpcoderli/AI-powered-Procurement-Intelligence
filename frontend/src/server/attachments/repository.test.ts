import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bidAttachments, bids, crawlerLogs, dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { serializeAttachmentPolicy } from "./policy";
import {
  applyAttachmentRepairWrites,
  listAttachmentRepairCandidates,
  listAttachmentsForVerification,
} from "./repository";
import { ATTACHMENT_REPAIR_LOG_SOURCE } from "./types";

const NOW = new Date("2026-09-16T00:00:00.000Z");

let testDb: TestDatabase;

function insertSource(id: string, label: string, fetchConfig: Record<string, unknown> | null) {
  testDb.db
    .insert(dataSources)
    .values({
      id,
      label,
      issuerType: "state",
      stateCode: "IL",
      fetchConfig: fetchConfig ? JSON.stringify(fetchConfig) : null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    })
    .run();
}

function insertBid(id: string, source: string) {
  testDb.db
    .insert(bids)
    .values({
      id,
      source,
      sourceBidId: `${id}-ext`,
      dedupeKey: id,
      title: "Solicitation",
      description: "Description",
      issuerName: "Agency",
      issuerType: "state",
      stateCode: "IL",
      sourceUrl: `https://portal.example.gov/detail/${id}`,
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      lastSeenAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    })
    .run();
}

function insertAttachment(values: Partial<typeof bidAttachments.$inferInsert> & { id: string; bidId: string }) {
  testDb.db
    .insert(bidAttachments)
    .values({
      name: "Doc.pdf",
      url: "https://portal.example.gov/download/1",
      archiveStatus: "not_archived",
      createdAt: "2026-09-01T00:00:00.000Z",
      ...values,
    })
    .run();
}

beforeEach(async () => {
  testDb = await createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

describe("listAttachmentRepairCandidates", () => {
  it("joins the bid and the data source, and orders broken archives, then never-archived rows, first", () => {
    insertSource("il_bidbuy", "Illinois BidBuy", serializeAttachmentPolicy({
      archive: true,
      mode: "browser",
      maxPerRun: 7,
      minIntervalSeconds: 4,
      timeoutSeconds: 30,
      maxBytes: 52_428_800,
      browserLinkSelector: null,
    }));
    insertBid("bid-1", "Illinois BidBuy");
    insertAttachment({ id: "att-failed", bidId: "bid-1", archiveStatus: "failed", nextRepairAt: "2026-09-15T00:00:00.000Z" });
    insertAttachment({ id: "att-new", bidId: "bid-1" });
    // A previously archived file that went bad is user-visible breakage: it outranks new rows.
    insertAttachment({ id: "att-corrupt", bidId: "bid-1", archiveStatus: "failed", failureKind: "archive_corrupt", nextRepairAt: "2026-09-15T00:00:00.000Z" });

    const rows = listAttachmentRepairCandidates(testDb.db, { now: NOW });

    expect(rows.map((row) => row.id)).toEqual(["att-corrupt", "att-new", "att-failed"]);
    expect(rows[0]).toMatchObject({
      bidSource: "Illinois BidBuy",
      bidSourceUrl: "https://portal.example.gov/detail/bid-1",
      bidSourceBidId: "bid-1-ext",
      sourceId: "il_bidbuy",
      sourceLabel: "Illinois BidBuy",
    });
    expect(JSON.parse(rows[0].fetchConfig ?? "{}")).toMatchObject({ attachments: { mode: "browser", max_per_run: 7 } });
  });

  it("matches the data source by id as well as by label", () => {
    insertSource("mo_missouri", "Missouri MissouriBUYS", null);
    insertBid("bid-2", "mo_missouri");
    insertAttachment({ id: "att-2", bidId: "bid-2" });

    expect(listAttachmentRepairCandidates(testDb.db, { now: NOW })[0].sourceId).toBe("mo_missouri");
  });

  it("respects the backoff window and the 30-day parking window", () => {
    insertBid("bid-3", "Missouri");
    insertAttachment({ id: "att-backoff", bidId: "bid-3", archiveStatus: "failed", nextRepairAt: "2026-09-20T00:00:00.000Z" });
    insertAttachment({ id: "att-parked-recent", bidId: "bid-3", archiveStatus: "unavailable", nextRepairAt: "2026-09-01T00:00:00.000Z" });
    insertAttachment({ id: "att-parked-old", bidId: "bid-3", archiveStatus: "unavailable", nextRepairAt: "2026-07-01T00:00:00.000Z" });
    insertAttachment({ id: "att-archived", bidId: "bid-3", archiveStatus: "archived" });

    expect(listAttachmentRepairCandidates(testDb.db, { now: NOW }).map((row) => row.id)).toEqual(["att-parked-old"]);
  });

  it("filters by source id or label", () => {
    insertSource("il_bidbuy", "Illinois BidBuy", null);
    insertBid("bid-4", "Illinois BidBuy");
    insertBid("bid-5", "Missouri");
    insertAttachment({ id: "att-il", bidId: "bid-4" });
    insertAttachment({ id: "att-mo", bidId: "bid-5" });

    expect(listAttachmentRepairCandidates(testDb.db, { now: NOW, sourceIds: ["il_bidbuy"] }).map((r) => r.id)).toEqual([
      "att-il",
    ]);
    expect(listAttachmentRepairCandidates(testDb.db, { now: NOW, sourceIds: ["Missouri"] }).map((r) => r.id)).toEqual([
      "att-mo",
    ]);
  });

  it("returns seed/demo relative links so the service can park them without a fetch", () => {
    insertBid("bid-6", "Demo");
    insertAttachment({ id: "att-seed", bidId: "bid-6", url: "/api/bids/bid-6/attachments/att-seed" });

    expect(listAttachmentRepairCandidates(testDb.db, { now: NOW }).map((row) => row.id)).toEqual(["att-seed"]);
  });

  it("honours the row limit", () => {
    insertBid("bid-7", "Missouri");
    insertAttachment({ id: "att-a", bidId: "bid-7" });
    insertAttachment({ id: "att-b", bidId: "bid-7" });

    expect(listAttachmentRepairCandidates(testDb.db, { now: NOW, limit: 1 })).toHaveLength(1);
  });
});

describe("listAttachmentsForVerification", () => {
  it("returns archived rows never verified or verified before the cutoff", () => {
    insertBid("bid-8", "Missouri");
    insertAttachment({ id: "att-never", bidId: "bid-8", archiveStatus: "archived" });
    insertAttachment({ id: "att-stale", bidId: "bid-8", archiveStatus: "archived", verifiedAt: "2026-09-01T00:00:00.000Z" });
    insertAttachment({ id: "att-fresh", bidId: "bid-8", archiveStatus: "archived", verifiedAt: "2026-09-15T00:00:00.000Z" });
    insertAttachment({ id: "att-not-archived", bidId: "bid-8" });

    const rows = listAttachmentsForVerification(testDb.db, { verifyBefore: new Date("2026-09-09T00:00:00.000Z") });

    expect(rows.map((row) => row.id).sort()).toEqual(["att-never", "att-stale"]);
  });
});

describe("applyAttachmentRepairWrites", () => {
  it("writes only the provided columns", () => {
    insertBid("bid-9", "Missouri");
    insertAttachment({ id: "att-9", bidId: "bid-9", archiveStatus: "failed", repairAttempts: 2, contentType: "application/pdf" });

    applyAttachmentRepairWrites(testDb.db, {
      updates: [{ id: "att-9", archiveStatus: "archived", storagePath: "missouri/att-9.pdf", repairAttempts: 0 }],
    });

    const row = testDb.db.select().from(bidAttachments).where(eq(bidAttachments.id, "att-9")).get();
    expect(row).toMatchObject({
      archiveStatus: "archived",
      storagePath: "missouri/att-9.pdf",
      repairAttempts: 0,
      contentType: "application/pdf",
    });
  });

  it("rolls the whole batch back when one update fails", () => {
    insertBid("bid-10", "Missouri");
    insertAttachment({ id: "att-10", bidId: "bid-10" });

    expect(() =>
      applyAttachmentRepairWrites(testDb.db, {
        updates: [
          { id: "att-10", archiveStatus: "archived" },
          // archive_status is NOT NULL: this second statement aborts the transaction.
          { id: "att-10", archiveStatus: null as unknown as string },
        ],
      }),
    ).toThrow();

    expect(testDb.db.select().from(bidAttachments).where(eq(bidAttachments.id, "att-10")).get()?.archiveStatus).toBe(
      "not_archived",
    );
  });

  it("writes the run log under the attachment_repair source", () => {
    applyAttachmentRepairWrites(testDb.db, {
      log: {
        id: "log-1",
        runId: "run-1",
        status: "success",
        startedAt: "2026-09-16T00:00:00.000Z",
        finishedAt: "2026-09-16T00:00:05.000Z",
        durationMs: 5000,
        fetchedCount: 3,
        insertedCount: 2,
        updatedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        errorCode: null,
        errorMessage: null,
        metadata: JSON.stringify({ verified: 4 }),
      },
    });

    const log = testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, "run-1")).get();
    expect(log).toMatchObject({
      source: ATTACHMENT_REPAIR_LOG_SOURCE,
      status: "success",
      fetchedCount: 3,
      insertedCount: 2,
      updatedCount: 1,
    });
  });
});
