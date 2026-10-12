import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bidAttachments, bids, crawlerLogs, dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { DEFAULT_ATTACHMENT_POLICY, serializeAttachmentPolicy, type AttachmentPolicy } from "./policy";
import {
  applyAttachmentRepairWrites,
  attachmentCandidateQuotas,
  listAttachmentRepairCandidates,
  listAttachmentsForVerification,
} from "./repository";
import { ATTACHMENT_REPAIR_LOG_SOURCE } from "./types";

const NOW = new Date("2026-09-16T00:00:00.000Z");

let testDb: TestDatabase;

function insertSource(id: string, label: string, fetchConfig: Record<string, unknown> | string | null) {
  testDb.db
    .insert(dataSources)
    .values({
      id,
      label,
      issuerType: "state",
      stateCode: "IL",
      fetchConfig: typeof fetchConfig === "string" || fetchConfig === null ? fetchConfig : JSON.stringify(fetchConfig),
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    })
    .run();
}

function policy(overrides: Partial<AttachmentPolicy>) {
  return serializeAttachmentPolicy({ ...DEFAULT_ATTACHMENT_POLICY, ...overrides });
}

function candidateIds(options: { limit?: number; maxPerSource?: number } = {}) {
  return listAttachmentRepairCandidates(testDb.db, { now: NOW, ...options }).map((row) => row.id);
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

describe("listAttachmentRepairCandidates — one window per source", () => {
  it("returns at most a source's max_per_run, highest repair priority first", () => {
    insertSource("il_bidbuy", "Illinois BidBuy", policy({ maxPerRun: 2 }));
    insertBid("bid-1", "Illinois BidBuy");
    insertAttachment({ id: "att-a-failed", bidId: "bid-1", archiveStatus: "failed", nextRepairAt: "2026-09-15T00:00:00.000Z" });
    insertAttachment({ id: "att-b-new", bidId: "bid-1" });
    insertAttachment({ id: "att-c-new", bidId: "bid-1" });
    insertAttachment({ id: "att-d-missing", bidId: "bid-1", archiveStatus: "failed", failureKind: "archive_missing", nextRepairAt: "2026-09-15T00:00:00.000Z" });

    expect(candidateIds()).toEqual(["att-d-missing", "att-b-new"]);
  });

  it("keeps one source's backlog from crowding out the sources that sort after it", () => {
    insertSource("sam_gov", "SAM.gov", null);
    insertSource("tx_esbd", "Texas ESBD", null);
    insertBid("bid-sam", "SAM.gov");
    insertBid("bid-tx", "Texas ESBD");
    for (const index of [1, 2, 3, 4]) insertAttachment({ id: `att-sam-${index}`, bidId: "bid-sam" });
    insertAttachment({ id: "att-tx", bidId: "bid-tx" });

    // The run-wide cap is smaller than SAM's backlog: every source gets its first candidate
    // before any source gets its second.
    expect(candidateIds({ limit: 3 })).toEqual(["att-sam-1", "att-tx", "att-sam-2"]);
  });

  it("leaves a source whose policy switches archiving off out of the selection", () => {
    insertSource("il_bidbuy", "Illinois BidBuy", policy({ archive: false }));
    insertSource("mo_missouri", "Missouri MissouriBUYS", null);
    insertBid("bid-il", "Illinois BidBuy");
    insertBid("bid-mo", "mo_missouri");
    insertAttachment({ id: "att-il", bidId: "bid-il" });
    insertAttachment({ id: "att-mo", bidId: "bid-mo" });

    expect(candidateIds()).toEqual(["att-mo"]);
  });

  it("lowers but never raises a source's max_per_run with the run's maxPerSource", () => {
    insertSource("il_bidbuy", "Illinois BidBuy", policy({ maxPerRun: 2 }));
    insertSource("mo_missouri", "Missouri MissouriBUYS", null);
    insertBid("bid-il", "Illinois BidBuy");
    insertBid("bid-mo", "mo_missouri");
    for (const id of ["att-il-1", "att-il-2", "att-il-3"]) insertAttachment({ id, bidId: "bid-il" });
    for (const id of ["att-mo-1", "att-mo-2", "att-mo-3", "att-mo-4"]) insertAttachment({ id, bidId: "bid-mo" });

    expect(candidateIds({ maxPerSource: 3 }).sort()).toEqual(["att-il-1", "att-il-2", "att-mo-1", "att-mo-2", "att-mo-3"]);
    expect(candidateIds({ maxPerSource: 1 }).sort()).toEqual(["att-il-1", "att-mo-1"]);
  });

  it("gives every bid source without a data_sources row its own default window", () => {
    insertBid("bid-a", "Legacy Portal A");
    insertBid("bid-b", "Legacy Portal B");
    insertAttachment({ id: "att-a-1", bidId: "bid-a" });
    insertAttachment({ id: "att-a-2", bidId: "bid-a" });
    insertAttachment({ id: "att-b-1", bidId: "bid-b" });

    expect(candidateIds({ maxPerSource: 1 })).toEqual(["att-a-1", "att-b-1"]);
  });

  it("reads an unreadable fetch_config as the default policy", () => {
    insertSource("broken", "Broken Portal", "{not json");
    insertBid("bid-1", "broken");
    insertAttachment({ id: "att-1", bidId: "bid-1" });

    const rows = listAttachmentRepairCandidates(testDb.db, { now: NOW });

    expect(rows.map((row) => row.id)).toEqual(["att-1"]);
    expect(rows[0]).toMatchObject({ sourceId: "broken", fetchConfig: "{not json" });
  });
});

describe("attachmentCandidateQuotas", () => {
  it("excludes archive-off sources and lists only the windows that differ from the default", () => {
    expect(
      attachmentCandidateQuotas([
        { id: "il_bidbuy", fetchConfig: JSON.stringify({ attachments: { archive: false } }) },
        { id: "sam_gov", fetchConfig: JSON.stringify({ attachments: { max_per_run: 7 } }) },
        { id: "tx_esbd", fetchConfig: JSON.stringify({ attachments: { max_per_run: 50 } }) },
        { id: "broken", fetchConfig: "{not json" },
        { id: "plain", fetchConfig: null },
      ]),
    ).toEqual({ defaultLimit: 50, excludedSourceIds: ["il_bidbuy"], sourceLimits: [{ sourceId: "sam_gov", limit: 7 }] });
  });

  it("applies the run's maxPerSource downward to the default and to every source", () => {
    expect(
      attachmentCandidateQuotas(
        [
          { id: "sam_gov", fetchConfig: JSON.stringify({ attachments: { max_per_run: 7 } }) },
          { id: "big", fetchConfig: JSON.stringify({ attachments: { max_per_run: 200 } }) },
        ],
        10,
      ),
    ).toEqual({ defaultLimit: 10, excludedSourceIds: [], sourceLimits: [{ sourceId: "sam_gov", limit: 7 }] });
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
