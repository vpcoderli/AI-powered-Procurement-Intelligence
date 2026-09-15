import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bidAttachments, bids, crawlerLogs } from "@/server/db/schema";
import type { CrawlableSource } from "./source-registry";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { importCrawlerJsonRunIntoSqlite, stampJurisdiction } from "./sqlite-json-importer";

const NOW = "2026-07-31T00:00:00.000Z";

describe("crawler JSON SQLite importer", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("upserts bids by id and writes one crawler_logs row on a successful run", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "tx_esbd",
      runId: "sqlite_run_1",
      status: "success",
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 10,
      metadata: { mode: "json" },
      bids: [
        {
          id: "sqlite_bid_1",
          source: "tx_esbd",
          source_bid_id: "TX-1",
          dedupe_key: "tx_esbd:TX-1",
          title: "SQLite Imported Bid",
          description: "Direct JSON crawler content",
          issuer_name: "Texas Agency",
          issuer_type: "state",
          state_code: "TX",
          source_url: "https://example.com/tx-1",
          first_seen_at: NOW,
          last_seen_at: NOW,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      errorCode: null,
      errorMessage: null,
      errorStack: null,
    };

    const result = importCrawlerJsonRunIntoSqlite(testDb.db, payload);

    expect(result).toEqual({
      fetchedCount: 1,
      insertedCount: 1,
      updatedCount: 0,
      logCount: 1,
    });

    const bidRow = testDb.db.select().from(bids).where(eq(bids.id, "sqlite_bid_1")).get();
    expect(bidRow).toMatchObject({
      id: "sqlite_bid_1",
      dedupeKey: "tx_esbd:TX-1",
      title: "SQLite Imported Bid",
      stateCode: "TX",
    });

    const logRows = testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, "sqlite_run_1")).all();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      source: "tx_esbd",
      runId: "sqlite_run_1",
      status: "success",
      fetchedCount: 1,
      insertedCount: 1,
      updatedCount: 0,
      failedCount: 0,
    });
  });

  it("updates an existing bid (by id) on a second run instead of inserting a duplicate", () => {
    const baseBid: Record<string, unknown> = {
      id: "sqlite_bid_dup",
      source: "tx_esbd",
      dedupe_key: "tx_esbd:DUP",
      title: "Original title",
      description: "d",
      issuer_name: "Issuer",
      issuer_type: "state",
      state_code: "TX",
      source_url: "https://example.com/dup",
      first_seen_at: NOW,
      last_seen_at: NOW,
      created_at: NOW,
      updated_at: NOW,
    };

    const firstPayload: CrawlerJsonRunPayload = {
      source: "tx_esbd",
      runId: "sqlite_run_a",
      status: "success",
      startedAt: NOW,
      bids: [baseBid],
    };
    const firstResult = importCrawlerJsonRunIntoSqlite(testDb.db, firstPayload);
    expect(firstResult).toEqual({ fetchedCount: 1, insertedCount: 1, updatedCount: 0, logCount: 1 });

    const secondPayload: CrawlerJsonRunPayload = {
      source: "tx_esbd",
      runId: "sqlite_run_b",
      status: "success",
      startedAt: NOW,
      bids: [{ ...baseBid, title: "Updated title" }],
    };
    const secondResult = importCrawlerJsonRunIntoSqlite(testDb.db, secondPayload);

    expect(secondResult).toEqual({
      fetchedCount: 1,
      insertedCount: 0,
      updatedCount: 1,
      logCount: 1,
    });

    const allBids = testDb.db.select().from(bids).where(eq(bids.id, "sqlite_bid_dup")).all();
    expect(allBids).toHaveLength(1);
    expect(allBids[0].title).toBe("Updated title");

    // Two runs -> two distinct log rows (one per import call), not deduped.
    const logRows = testDb.db.select().from(crawlerLogs).all();
    expect(logRows).toHaveLength(2);
  });

  it("writes zero bids and one failure log row (with errorCode) for a failure payload", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "tx_esbd",
      runId: "sqlite_run_failure",
      status: "failure",
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 5,
      metadata: {},
      bids: [],
      errorCode: "EmptyCrawlerResultError",
      errorMessage: "No bids found",
      errorStack: "Traceback ...",
    };

    const result = importCrawlerJsonRunIntoSqlite(testDb.db, payload);

    expect(result).toEqual({
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      logCount: 1,
    });

    const allBids = testDb.db.select().from(bids).all();
    expect(allBids).toHaveLength(0);

    const logRows = testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, "sqlite_run_failure")).all();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      status: "failure",
      errorCode: "EmptyCrawlerResultError",
      errorMessage: "No bids found",
      fetchedCount: 0,
      failedCount: 1,
    });
  });

  // Task final-wave I2: the MySQL twin (mysql-json-importer.ts) has always persisted
  // bid_attachments via a delete-then-insert per bid; the SQLite importer silently dropped them
  // entirely. il_bidbuy (approved, attachments-capable) hits this path today under the default
  // SQLite deployment.
  it("persists bid attachments from the payload, preserving sort order", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "il_bidbuy",
      runId: "sqlite_run_attachments",
      status: "success",
      startedAt: NOW,
      bids: [
        {
          id: "sqlite_bid_attach",
          source: "il_bidbuy",
          dedupe_key: "il_bidbuy:1",
          title: "Bid with attachments",
          description: "d",
          issuer_name: "Issuer",
          issuer_type: "state",
          state_code: "IL",
          source_url: "https://example.com/attach",
          attachments: [
            {
              name: "Second.pdf",
              url: "https://example.com/second.pdf",
              original_url: "https://example.com/second.pdf",
              storage_path: "/tmp/second.pdf",
              byte_size: 99,
              content_type: "application/pdf",
              checksum_sha256: "second-checksum",
              fetched_at: NOW,
              archive_status: "archived",
              size_label: "99 B",
              mime_type: "application/pdf",
              sort_order: 1,
            },
            {
              id: "custom-attachment-id",
              name: "First.pdf",
              url: "https://example.com/first.pdf",
              sort_order: 0,
            },
          ],
        },
      ],
    };

    importCrawlerJsonRunIntoSqlite(testDb.db, payload);

    const attachmentRows = testDb.db
      .select()
      .from(bidAttachments)
      .where(eq(bidAttachments.bidId, "sqlite_bid_attach"))
      .all()
      .sort((a, b) => a.sortOrder - b.sortOrder);

    expect(attachmentRows).toHaveLength(2);
    expect(attachmentRows[0]).toMatchObject({
      id: "custom-attachment-id",
      bidId: "sqlite_bid_attach",
      name: "First.pdf",
      url: "https://example.com/first.pdf",
      sortOrder: 0,
      archiveStatus: "not_archived",
    });
    expect(attachmentRows[1]).toMatchObject({
      id: "sqlite_bid_attach:attachment:1",
      bidId: "sqlite_bid_attach",
      name: "Second.pdf",
      byteSize: 99,
      contentType: "application/pdf",
      archiveStatus: "archived",
      sortOrder: 1,
    });
  });

  it("replaces attachments on re-import rather than duplicating them", () => {
    const firstPayload: CrawlerJsonRunPayload = {
      source: "il_bidbuy",
      runId: "sqlite_run_attach_a",
      status: "success",
      startedAt: NOW,
      bids: [
        {
          id: "sqlite_bid_replace",
          source: "il_bidbuy",
          dedupe_key: "il_bidbuy:replace",
          title: "Bid",
          description: "d",
          issuer_name: "Issuer",
          issuer_type: "state",
          state_code: "IL",
          source_url: "https://example.com/replace",
          attachments: [
            { name: "Old1.pdf", url: "https://example.com/old1.pdf" },
            { name: "Old2.pdf", url: "https://example.com/old2.pdf" },
          ],
        },
      ],
    };
    importCrawlerJsonRunIntoSqlite(testDb.db, firstPayload);
    expect(
      testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "sqlite_bid_replace")).all(),
    ).toHaveLength(2);

    const secondPayload: CrawlerJsonRunPayload = {
      source: "il_bidbuy",
      runId: "sqlite_run_attach_b",
      status: "success",
      startedAt: NOW,
      bids: [
        {
          id: "sqlite_bid_replace",
          source: "il_bidbuy",
          dedupe_key: "il_bidbuy:replace",
          title: "Bid",
          description: "d",
          issuer_name: "Issuer",
          issuer_type: "state",
          state_code: "IL",
          source_url: "https://example.com/replace",
          attachments: [{ name: "New.pdf", url: "https://example.com/new.pdf" }],
        },
      ],
    };
    importCrawlerJsonRunIntoSqlite(testDb.db, secondPayload);

    const attachmentRows = testDb.db
      .select()
      .from(bidAttachments)
      .where(eq(bidAttachments.bidId, "sqlite_bid_replace"))
      .all();
    expect(attachmentRows).toHaveLength(1);
    expect(attachmentRows[0]).toMatchObject({ name: "New.pdf", url: "https://example.com/new.pdf" });
  });

  it("leaves no attachment rows for a bid with no attachments", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "il_bidbuy",
      runId: "sqlite_run_no_attach",
      status: "success",
      startedAt: NOW,
      bids: [
        {
          id: "sqlite_bid_no_attach",
          source: "il_bidbuy",
          dedupe_key: "il_bidbuy:no_attach",
          title: "Bid without attachments",
          description: "d",
          issuer_name: "Issuer",
          issuer_type: "state",
          state_code: "IL",
          source_url: "https://example.com/no-attach",
        },
      ],
    };

    importCrawlerJsonRunIntoSqlite(testDb.db, payload);

    expect(
      testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "sqlite_bid_no_attach")).all(),
    ).toHaveLength(0);
  });

  function payloadWith(bid: Record<string, unknown>) {
    return {
      source: "il_bidbuy", runId: `run_${Math.random().toString(16).slice(2)}`, status: "success" as const,
      startedAt: NOW, finishedAt: NOW, durationMs: 5, metadata: {}, bids: [bid], errorCode: null, errorMessage: null, errorStack: null,
    };
  }

  const baseBid = {
    id: "il_bidbuy:1", source: "Illinois BidBuy", source_bid_id: "1", dedupe_key: "il_bidbuy:1", title: "Road Repair",
    issuer_name: "IDOT", issuer_type: "state", state_code: "IL", source_url: "https://portal.example.gov/bid/1",
  };

  it("keeps an enriched description when a later run only carries the title again", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Full scope of work", full_description: "Full scope of work", original_category: "Construction", published_date: "08/14/2026", contact_email: "jane@example.gov", detail_fetched_at: NOW }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Road Repair", full_description: null, original_category: "", published_date: null, contact_email: null, detail_fetched_at: null }));

    const row = testDb.db.select().from(bids).where(eq(bids.id, "il_bidbuy:1")).get();
    expect(row?.description).toBe("Full scope of work");
    expect(row?.fullDescription).toBe("Full scope of work");
    expect(row?.originalCategory).toBe("Construction");
    expect(row?.publishedDate).toBe("08/14/2026");
    expect(row?.contactEmail).toBe("jane@example.gov");
    expect(row?.detailFetchedAt).toBe(NOW);
  });

  it("still overwrites enriched fields with newer non-empty values", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Old scope", original_category: "Old" }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "New scope", original_category: "New" }));

    const row = testDb.db.select().from(bids).where(eq(bids.id, "il_bidbuy:1")).get();
    expect(row?.description).toBe("New scope");
    expect(row?.originalCategory).toBe("New");
  });

  it("keeps enriched fields when a later run only carries whitespace-only values", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Full scope of work", full_description: "Full scope of work", contact_email: "jane@example.gov" }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "  ", full_description: "  ", contact_email: " " }));

    const row = testDb.db.select().from(bids).where(eq(bids.id, "il_bidbuy:1")).get();
    expect(row?.description).toBe("Full scope of work");
    expect(row?.fullDescription).toBe("Full scope of work");
    expect(row?.contactEmail).toBe("jane@example.gov");
  });

  it("keeps an enriched description when a later run echoes the title with different case and whitespace", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Full scope of work" }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "  ROAD REPAIR  " }));

    const row = testDb.db.select().from(bids).where(eq(bids.id, "il_bidbuy:1")).get();
    expect(row?.description).toBe("Full scope of work");
  });

  it("keeps existing attachments when a later run carries an empty attachment list", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [{ name: "Spec.pdf", url: "https://portal.example.gov/spec.pdf", sort_order: 0 }] }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [] }));
    expect(testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "il_bidbuy:1")).all()).toHaveLength(1);

    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [{ name: "A.pdf", url: "https://x/a.pdf", sort_order: 0 }, { name: "B.pdf", url: "https://x/b.pdf", sort_order: 1 }] }));
    expect(testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "il_bidbuy:1")).all().map((a) => a.name)).toEqual(["A.pdf", "B.pdf"]);
  });
});

describe("stampJurisdiction", () => {
  const source: Pick<CrawlableSource, "jurisdictionLevel" | "jurisdictionName" | "fipsCode"> = {
    jurisdictionLevel: "state",
    jurisdictionName: "California",
    fipsCode: "06",
  };

  it("stamps jurisdiction_level, jurisdiction_name, and fips_code onto every bid", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "ca_caleprocure",
      runId: "run_stamp",
      status: "success",
      startedAt: NOW,
      bids: [{ id: "b1" }, { id: "b2" }],
    };

    const stamped = stampJurisdiction(payload, source);

    expect(stamped.bids).toEqual([
      { id: "b1", jurisdiction_level: "state", jurisdiction_name: "California", fips_code: "06" },
      { id: "b2", jurisdiction_level: "state", jurisdiction_name: "California", fips_code: "06" },
    ]);
  });

  it("does not overwrite jurisdiction values the crawler already set", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "ca_caleprocure",
      runId: "run_stamp_existing",
      status: "success",
      startedAt: NOW,
      bids: [
        {
          id: "b1",
          jurisdiction_level: "county",
          jurisdiction_name: "Los Angeles County",
          fips_code: "037",
        },
      ],
    };

    const stamped = stampJurisdiction(payload, source);

    expect(stamped.bids).toEqual([
      {
        id: "b1",
        jurisdiction_level: "county",
        jurisdiction_name: "Los Angeles County",
        fips_code: "037",
      },
    ]);
  });

  it("stamps null when both the crawler and the source lack a value", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "unknown_source",
      runId: "run_stamp_null",
      status: "success",
      startedAt: NOW,
      bids: [{ id: "b1" }],
    };

    const stamped = stampJurisdiction(payload, {
      jurisdictionLevel: null,
      jurisdictionName: null,
      fipsCode: null,
    });

    expect(stamped.bids).toEqual([
      { id: "b1", jurisdiction_level: null, jurisdiction_name: null, fips_code: null },
    ]);
  });

  it("stamps only the fields the source has when the crawler and source partially overlap", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "ca_caleprocure",
      runId: "run_stamp_partial",
      status: "success",
      startedAt: NOW,
      bids: [{ id: "b1", jurisdiction_level: "county" }],
    };

    const stamped = stampJurisdiction(payload, source);

    expect(stamped.bids).toEqual([
      { id: "b1", jurisdiction_level: "county", jurisdiction_name: "California", fips_code: "06" },
    ]);
  });

  it("returns the payload unchanged when there are no bids", () => {
    const payload: CrawlerJsonRunPayload = {
      source: "ca_caleprocure",
      runId: "run_stamp_empty",
      status: "failure",
      startedAt: NOW,
      bids: [],
    };

    const stamped = stampJurisdiction(payload, source);

    expect(stamped).toEqual(payload);
  });
});
