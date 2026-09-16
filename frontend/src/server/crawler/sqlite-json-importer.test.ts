import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bidAttachments, bids, crawlerLocks, crawlerLogs } from "@/server/db/schema";
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

  it("retains earlier attachments when a re-import discovers another URL", () => {
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
    expect(attachmentRows).toHaveLength(3);
    expect(attachmentRows).toContainEqual(expect.objectContaining({ name: "New.pdf", url: "https://example.com/new.pdf" }));
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
    expect(row?.fullDescription).toBeNull();
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
    expect(row?.fullDescription).toBeNull();
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
    expect(testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "il_bidbuy:1")).all().map((a) => a.name)).toEqual(["Spec.pdf", "A.pdf", "B.pdf"]);
  });

  it("protects detailed fields and diagnostics through repeated nonempty list-only imports", () => {
    const applied = ["description", "full_description", "original_category", "contact_name", "contact_email", "contact_phone"];
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({
      ...baseBid, description: "Detailed scope", full_description: "Complete detailed scope of the construction work",
      original_category: "Construction", contact_name: "Jane", contact_email: "jane@example.gov", contact_phone: "123",
      detail_fetched_at: NOW,
      raw_payload: { enrichment: { applied_fields: applied, fields: { description: "selector", contact: "heuristic" } } },
    }));
    for (let index = 0; index < 2; index += 1) {
      importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({
        ...baseBid, description: "Short list summary", full_description: "ROAD  REPAIR",
        original_category: "General", contact_name: "Help desk", contact_email: "help@example.gov", contact_phone: "999",
        raw_payload: { listRevision: index },
      }));
    }
    const row = testDb.db.select().from(bids).get()!;
    expect(row).toMatchObject({ description: "Detailed scope", fullDescription: "Complete detailed scope of the construction work", originalCategory: "Construction", contactName: "Jane", contactEmail: "jane@example.gov", contactPhone: "123" });
    expect(JSON.parse(row.rawPayload!)).toMatchObject({ listRevision: 1, enrichment: { fields: { description: "selector", contact: "heuristic" } } });
  });

  it("refreshes only fields that a new extraction actually wrote", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Old detailed scope", original_category: "Construction", contact_email: "jane@example.gov", detail_fetched_at: NOW }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({
      ...baseBid, description: "New detailed scope", original_category: "List category", contact_email: "help@example.gov", detail_fetched_at: NOW,
      raw_payload: { enrichment: { applied_fields: ["description"], fields: { description: "selector" } } },
    }));
    expect(testDb.db.select().from(bids).get()).toMatchObject({ description: "New detailed scope", originalCategory: "Construction", contactEmail: "jane@example.gov" });
  });

  it("preserves legacy detail values when parsing succeeded without applying any field", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Legacy scope", detail_fetched_at: NOW }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "List scope", detail_fetched_at: NOW, raw_payload: { enrichment: { applied_fields: [], fields: { description: "not_found" } } } }));
    expect(testDb.db.select().from(bids).get()?.description).toBe("Legacy scope");
  });

  it("merges attachment URLs across reordering and retains archived metadata", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [
      { id: "original-a", name: "A", url: "https://x/a", storage_path: "/archive/a", archive_status: "archived", checksum_sha256: "sha", byte_size: 10, fetched_at: NOW },
      { id: "original-b", name: "B", url: "https://x/b" },
    ] }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [
      { id: "changed-id", name: "Updated A", url: "https://x/a", archive_status: "not_archived", storage_path: null },
      { name: "C", url: "https://x/c" },
      { name: "Duplicate C", url: "https://x/c" },
    ] }));
    const attachments = testDb.db.select().from(bidAttachments).all();
    expect(attachments).toHaveLength(3);
    expect(attachments.find((row) => row.url === "https://x/a")).toMatchObject({ id: "original-a", name: "Updated A", archiveStatus: "archived", storagePath: "/archive/a", checksumSha256: "sha", byteSize: 10, fetchedAt: NOW });
    expect(attachments.some((row) => row.url === "https://x/b")).toBe(true);
  });

  it("rolls back bid and attachment updates when the success log cannot be written", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Original scope", attachments: [{ name: "A", url: "https://x/a" }] }));
    testDb.db.$client.exec("CREATE TRIGGER reject_success_log BEFORE INSERT ON crawler_logs WHEN NEW.status = 'success' BEGIN SELECT RAISE(FAIL, 'log unavailable'); END");
    const failed = payloadWith({ ...baseBid, description: "Changed scope", attachments: [{ name: "B", url: "https://x/b" }] });
    expect(() => importCrawlerJsonRunIntoSqlite(testDb.db, failed)).toThrow("log unavailable");
    expect(testDb.db.select().from(bids).get()?.description).toBe("Original scope");
    expect(testDb.db.select().from(bidAttachments).all().map((row) => row.url)).toEqual(["https://x/a"]);
    expect(testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, failed.runId)).get()).toMatchObject({ status: "failure", insertedCount: 0, updatedCount: 0, errorCode: "CrawlerPersistenceError" });
  });

  it("accepts an explained date-filtered zero-row success and rejects raw empty success", () => {
    const empty = { source: "il_bidbuy", runId: "filtered", status: "success" as const, startedAt: NOW, bids: [], metadata: { dateFilter: { from: "2026-09-01", to: null, kept: 0, dropped: 2, unparsed: 0 } } };
    expect(importCrawlerJsonRunIntoSqlite(testDb.db, empty)).toMatchObject({ fetchedCount: 0, logCount: 1 });
    expect(() => importCrawlerJsonRunIntoSqlite(testDb.db, { ...empty, runId: "raw-empty", metadata: {} })).toThrow(/no bid rows/);
  });

  it("accepts a verified empty-state zero-row success and rejects an unconfirmed tenant", () => {
    const emptyState = { verified: true, tenant_confirmed: true, marker: "There are no open bids at this time.", method: "adapter" };
    const empty = { source: "bidnet_ny_erie", runId: "empty-verified", status: "success" as const, startedAt: NOW, bids: [], metadata: { emptyState } };
    expect(importCrawlerJsonRunIntoSqlite(testDb.db, empty)).toMatchObject({ fetchedCount: 0, logCount: 1 });
    expect(testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, "empty-verified")).get()).toMatchObject({ status: "success", fetchedCount: 0 });
    expect(() =>
      importCrawlerJsonRunIntoSqlite(testDb.db, {
        ...empty,
        runId: "empty-unconfirmed",
        metadata: { emptyState: { ...emptyState, tenant_confirmed: false } },
      }),
    ).toThrow(/no bid rows/);
  });

  it("clears stale full detail when a fresh extraction explicitly replaces it with a short description", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "Old scope", full_description: "Old long detailed scope", detail_fetched_at: NOW }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, description: "New short detail", full_description: null, detail_fetched_at: NOW, raw_payload: { enrichment: { applied_fields: ["description", "full_description"] } } }));
    expect(testDb.db.select().from(bids).get()).toMatchObject({ description: "New short detail", fullDescription: null });
  });

  it("rolls back every bid if a new attachment ID belongs to a different bid", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, attachments: [{ id: "shared-id", url: "https://x/a" }] }));
    const conflicting = payloadWith({ ...baseBid, id: "other-bid", source_bid_id: "other-bid", dedupe_key: "other-bid", attachments: [{ id: "shared-id", url: "https://x/b" }] });
    expect(() => importCrawlerJsonRunIntoSqlite(testDb.db, conflicting)).toThrow();
    expect(testDb.db.select().from(bids).all()).toHaveLength(1);
    expect(testDb.db.select().from(bidAttachments).get()).toMatchObject({ bidId: baseBid.id, url: "https://x/a" });
  });

  it("records a queryable persistence failure even when the run's ordinary log ID already exists", () => {
    const initial = payloadWith({ ...baseBid, description: "Original" });
    importCrawlerJsonRunIntoSqlite(testDb.db, initial);
    expect(() => importCrawlerJsonRunIntoSqlite(testDb.db, { ...initial, bids: [{ ...baseBid, description: "Changed" }] })).toThrow();
    expect(testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, initial.runId)).all()).toContainEqual(expect.objectContaining({ status: "failure", errorCode: "CrawlerPersistenceError", updatedCount: 0 }));
  });

  it("retains a successful detail archive across list-only defaults and failed archival attempts", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, detail_archive_status: "archived", detail_archive_path: "/archive/detail.html", detail_checksum_sha256: "original-sha", detail_fetched_at: NOW, detail_archive_error: null }));
    for (const status of ["not_archived", "failed"]) {
      importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, detail_archive_status: status, detail_archive_path: null, detail_checksum_sha256: null, detail_fetched_at: null, detail_archive_error: status === "failed" ? "download failed" : null }));
      expect(testDb.db.select().from(bids).get()).toMatchObject({ detailArchiveStatus: "archived", detailArchivePath: "/archive/detail.html", detailChecksumSha256: "original-sha", detailFetchedAt: NOW, detailArchiveError: null });
    }
  });

  it("allows a newly archived detail file to refresh the previous archive", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, detail_archive_status: "archived", detail_archive_path: "/archive/old.html", detail_checksum_sha256: "old" }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith({ ...baseBid, detail_archive_status: "archived", detail_archive_path: "/archive/new.html", detail_checksum_sha256: "new" }));
    expect(testDb.db.select().from(bids).get()).toMatchObject({ detailArchiveStatus: "archived", detailArchivePath: "/archive/new.html", detailChecksumSha256: "new" });
  });

  it("rolls back the entire run when its lease expires before transaction completion", () => {
    testDb.db.insert(crawlerLocks).values({ source: "il_bidbuy", owner: "lease-owner", acquiredAt: NOW, expiresAt: "2026-07-31T00:00:01.000Z" }).run();
    let checks = 0;
    const lease = { source: "il_bidbuy", owner: "lease-owner", now: () => checks++ === 0 ? NOW : "2026-07-31T00:00:02.000Z" };
    const run = payloadWith({ ...baseBid, attachments: [{ url: "https://x/a" }] });
    expect(() => importCrawlerJsonRunIntoSqlite(testDb.db, run, lease)).toThrow(/lease was lost/);
    expect(testDb.db.select().from(bids).all()).toHaveLength(0);
    expect(testDb.db.select().from(bidAttachments).all()).toHaveLength(0);
    expect(testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, run.runId)).get()).toMatchObject({ status: "failure", errorCode: "CrawlerLeaseLostError" });
  });

  it("rejects an old lease owner before ingesting any bids", () => {
    testDb.db.insert(crawlerLocks).values({ source: "il_bidbuy", owner: "replacement", acquiredAt: NOW, expiresAt: "2026-07-31T00:10:00.000Z" }).run();
    expect(() => importCrawlerJsonRunIntoSqlite(testDb.db, payloadWith(baseBid), { source: "il_bidbuy", owner: "old-owner", now: () => NOW })).toThrow(/lease was lost/);
    expect(testDb.db.select().from(bids).all()).toHaveLength(0);
  });
});

describe("crawler JSON SQLite importer dedupe-key parity", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function run(runId: string, bid: Record<string, unknown>): CrawlerJsonRunPayload {
    return {
      source: "tx_esbd", runId, status: "success", startedAt: NOW, finishedAt: NOW, durationMs: 1, metadata: {},
      bids: [{ source: "tx_esbd", source_bid_id: "TX-9", dedupe_key: "tx_esbd:TX-9", title: "Parity", description: "Content",
        issuer_name: "Texas Agency", issuer_type: "state", state_code: "TX", source_url: "https://example.com/tx-9", ...bid }],
      errorCode: null, errorMessage: null, errorStack: null,
    };
  }

  it("updates the row matched by dedupe_key when the payload carries a different primary id (MySQL twin behaviour)", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, run("r1", { id: "legacy_id", attachments: [{ name: "A.pdf", url: "https://x/a.pdf" }] }));
    const result = importCrawlerJsonRunIntoSqlite(testDb.db, run("r2", { id: "new_id", description: "Refreshed content", attachments: [{ name: "B.pdf", url: "https://x/b.pdf" }] }));

    expect(result).toMatchObject({ insertedCount: 0, updatedCount: 1 });
    const rows = testDb.db.select().from(bids).all();
    expect(rows.map((row) => row.id)).toEqual(["legacy_id"]);
    expect(rows[0].description).toBe("Refreshed content");
    // Attachments follow the persisted row, and the earlier one is kept.
    expect(testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "legacy_id")).all().map((row) => row.url).sort())
      .toEqual(["https://x/a.pdf", "https://x/b.pdf"]);
    expect(testDb.db.select().from(crawlerLogs).all().map((row) => row.status)).toEqual(["success", "success"]);
  });

  it("normalizes a legacy title echo that differs only by trailing punctuation", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, run("r3", { id: "echo_id", title: "Road repair", description: "Road repair.", full_description: "ROAD REPAIR" }));
    const row = testDb.db.select().from(bids).where(eq(bids.id, "echo_id")).get();
    expect(row?.description).toBe("");
    expect(row?.fullDescription).toBeNull();
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
