import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bidAttachments, bids, crawlerLogs, dataSources } from "@/server/db/schema";
import { createSourceDataQualityReport } from "@/server/source-validity/source-data-quality";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { importCrawlerJsonRunIntoSqlite, stampJurisdiction } from "./sqlite-json-importer";

const NOW = "2026-10-01T00:00:00.000Z";
const EARLIER = "2026-09-29T00:00:00.000Z";
const opportunity = (overrides: Record<string, unknown> = {}) => ({
  id: "city_portal:1", source: "City procurement", source_bid_id: "1", dedupe_key: "city_portal:1",
  title: "Repair public roads", description: "Replace the damaged road surface and drainage.",
  issuer_name: "City procurement", issuer_type: "city", jurisdiction_level: "city", state_code: "IL",
  source_url: "https://procurement.example.gov/bids/1", ...overrides,
});
let sequence = 0;
const payload = (rows: Record<string, unknown>[], metadata: Record<string, unknown> = {}): CrawlerJsonRunPayload => ({
  source: "city_portal", runId: `quality_${sequence++}`, status: "success", startedAt: NOW, finishedAt: NOW,
  bids: rows, metadata,
});

describe("crawler quality publication gate", () => {
  let testDb: TestDatabase;
  beforeEach(async () => { testDb = await createTestDatabase({ seed: false }); });
  afterEach(async () => { await testDb.cleanup(); });

  it.each([false, true])("rejects a foreign real SQLite dedupe target and preserves both sources' bodies and files (malformed=%s)", async (malformed) => {
    testDb.db.insert(dataSources).values([
      { id: "city_portal", label: "City procurement", issuerType: "city", stateCode: "IL", createdAt: EARLIER, updatedAt: EARLIER },
      { id: "other_portal", label: "Other City", issuerType: "city", stateCode: "IL", createdAt: EARLIER, updatedAt: EARLIER },
    ]).run();
    const files = (prefix: string) => [{ id: `${prefix}:file`, name: "Original.pdf", url: `https://${prefix}.example.gov/scope.pdf` }];
    const prior = opportunity({ id: "other_portal:one", source: "Other City", source_bid_id: "one", dedupe_key: "other_portal:one",
      description: "Preserve the other city's existing construction scope.", attachments: files("other_portal") });
    importCrawlerJsonRunIntoSqlite(testDb.db, { ...payload([prior]), source: "other_portal" });
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ id: "city_portal:old", source_bid_id: "old", dedupe_key: "city_portal:old", attachments: files("city_portal") })]));
    if (malformed) testDb.db.update(bids).set({ title: "Untitled opportunity" }).where(eq(bids.id, "other_portal:one")).run();
    const beforeBids = testDb.db.select().from(bids).all();
    const beforeFiles = testDb.db.select().from(bidAttachments).all();
    const incoming = opportunity({ source_bid_id: "one", dedupe_key: "other_portal:one", source: "New City",
      description: "Replace this new city's storm sewer and drainage systems.", attachments: [{ id: "incoming-file", name: "New.pdf", url: "https://city.example.gov/new.pdf" }] });
    const run = payload([incoming], { sourceIdentity: { id: "city_portal", stateCode: "IL", issuerType: "city", jurisdictionLevel: "city" },
      pagination: { complete: true, list_kind: "open" } });
    expect(importCrawlerJsonRunIntoSqlite(testDb.db, run)).toEqual({ fetchedCount: 1, insertedCount: 0, updatedCount: 0, logCount: 1 });
    expect(testDb.db.select().from(bids).all()).toEqual(beforeBids);
    expect(testDb.db.select().from(bidAttachments).all()).toEqual(beforeFiles);
    expect(run.metadata).toMatchObject({ pagination: { complete: false, quality_blocked: true }, dataQuality: {
      acceptedCount: 0, quarantinedCount: 1, acceptedIds: [], reconciliation: { balanced: true },
      quarantinedRecords: [{ id: incoming.id, issues: ["source_identity_mismatch:id"], row: incoming }],
    } });
    const report = await createSourceDataQualityReport(testDb.db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_portal")).toMatchObject({ contentStatus: "unusable", listCoverage: "partial",
      stored: { bidCount: 1, coreInvalidCount: 0 } });
    expect(report.rows.find((row) => row.sourceId === "other_portal")).toMatchObject({ stored: { bidCount: 1, coreInvalidCount: Number(malformed) } });
  });

  it("quarantines a foreign derived ID in the real SQLite importer without delisting the existing open bid", async () => {
    testDb.db.insert(dataSources).values({ id: "city_portal", label: "City procurement", issuerType: "city", jurisdictionLevel: "city",
      stateCode: "IL", createdAt: EARLIER, updatedAt: EARLIER }).run();
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ id: "city_portal:old", source_bid_id: "old", dedupe_key: "city_portal:old" })]));
    const incoming = opportunity({ id: "", source_bid_id: "one", dedupe_key: "other_portal:one" });
    const run = payload([incoming], { sourceIdentity: { id: "city_portal", stateCode: "IL", issuerType: "city", jurisdictionLevel: "city" },
      pagination: { list_kind: "open", complete: true } });
    expect(importCrawlerJsonRunIntoSqlite(testDb.db, run)).toMatchObject({ insertedCount: 0, updatedCount: 0 });
    expect(testDb.db.select().from(bids).all()).toEqual([expect.objectContaining({ id: "city_portal:old", lifecycleStatus: "open" })]);
    expect(run.metadata).toMatchObject({ pagination: { complete: false }, dataQuality: { acceptedCount: 0, quarantinedCount: 1,
      quarantinedRecords: [{ id: null, issues: ["source_identity_mismatch:id"], row: { id: "", dedupe_key: "other_portal:one" } }] } });
    const report = await createSourceDataQualityReport(testDb.db, new Date(NOW));
    expect(report.rows[0]).toMatchObject({ contentStatus: "unusable", listCoverage: "partial", run: { quarantinedCount: 1 },
      stored: { bidCount: 1, coreInvalidCount: 0 } });
    expect(report.unattributedBidCount).toBe(0);
    expect(incoming.id).toBe("");
  });

  it("quarantines placeholder titles while importing other valid records and retaining evidence", () => {
    const run = payload([opportunity(), opportunity({ id: "city_portal:2", source_bid_id: "2", dedupe_key: "city_portal:2", title: "Untitled City procurement opportunity" })]);
    const result = importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).all().map((row) => row.id)).toEqual(["city_portal:1"]);
    expect(result).toMatchObject({ fetchedCount: 2, insertedCount: 1, updatedCount: 0 });
    const log = testDb.db.select().from(crawlerLogs).where(eq(crawlerLogs.runId, run.runId)).get()!;
    expect(JSON.parse(log.metadata!)).toMatchObject({ dataQuality: {
      acceptedCount: 1, quarantinedCount: 1, contentStatus: "partial",
      quarantinedRecords: [{ id: "city_portal:2", issues: expect.arrayContaining(["invalid_title"]) }],
      reconciliation: { balanced: true },
    } });
  });

  it("keeps the prior good snapshot when an incoming core identity is invalid", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity()]));
    const run = payload([opportunity({ title: "Untitled opportunity", issuer_name: "Unknown issuer", source_url: "https://procurement.example.gov/" })]);
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    const saved = testDb.db.select().from(bids).get()!;
    expect(saved.title).toBe("Repair public roads");
    expect(saved.description).toBe("Replace the damaged road surface and drainage.");
    expect(run.metadata).toMatchObject({ dataQuality: { acceptedCount: 0, quarantinedCount: 1, contentStatus: "unusable" } });
  });

  it("does not delist other records when a complete list contains an unresolved quarantined candidate", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ id: "city_portal:old", dedupe_key: "city_portal:old", source_bid_id: "old" })]));
    const run = payload([opportunity({ id: "city_portal:1", title: "Untitled opportunity" })], { pagination: { list_kind: "open", complete: true } });
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).where(eq(bids.id, "city_portal:old")).get()?.lifecycleStatus).toBe("open");
    expect(run.metadata).toMatchObject({ dataQuality: { listCoverage: "partial" } });
  });

  it("deduplicates input IDs before accounting and keeps distinct same-count ID evidence", () => {
    const run = payload([opportunity(), opportunity(), opportunity({ id: "city_portal:2", source_bid_id: "2", dedupe_key: "city_portal:2" })]);
    expect(importCrawlerJsonRunIntoSqlite(testDb.db, run)).toMatchObject({ fetchedCount: 3, insertedCount: 2, updatedCount: 0 });
    expect(run.metadata).toMatchObject({ dataQuality: { receivedCount: 3, uniqueCount: 2, duplicateCount: 1, acceptedIds: ["city_portal:1", "city_portal:2"] } });
  });

  it("preserves the body's real validation time after a no-content detail refresh", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, { ...payload([opportunity({ detail_fetched_at: EARLIER, raw_payload: { enrichment: { applied_fields: ["description"] } } })]), startedAt: EARLIER, finishedAt: EARLIER });
    const run = payload([opportunity({ description: "Repair public roads", detail_fetched_at: NOW, raw_payload: { enrichment: { applied_fields: [], outcome: { status: "no_change" } } } })]);
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    const saved = testDb.db.select().from(bids).get()!;
    expect(JSON.parse(saved.rawPayload!)).toMatchObject({ data_quality: { body: { valid: true, reused: true, verifiedAt: EARLIER } } });
    expect(run.metadata).toMatchObject({ dataQuality: { validBodyCount: 1, retainedBodyCount: 1 } });
  });

  it("does not import bid rows from a failure document", () => {
    const run = { ...payload([opportunity()]), status: "failure" as const, errorCode: "ListPageReadError" };
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).all()).toHaveLength(0);
  });

  it("does not trust upstream quality metadata to publish an invalid record", () => {
    const run = payload([opportunity({ state_code: "ZZ", raw_payload: { data_quality: { core_valid: true, capabilities: { discovery: true, analysis: true } } } })], { dataQuality: { contentStatus: "usable", quarantinedCount: 0 } });
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).all()).toHaveLength(0);
    expect(run.metadata).toMatchObject({ dataQuality: { contentStatus: "unusable", quarantinedCount: 1 } });
  });

  it("reports rollback as unknown content with zero accepted bids even when incoming metadata has a valid usable manifest", async () => {
    testDb.db.insert(dataSources).values({ id: "city_portal", label: "City procurement", issuerType: "city", jurisdictionLevel: "city",
      stateCode: "IL", createdAt: EARLIER, updatedAt: EARLIER }).run();
    const prior = { ...payload([opportunity()], { pagination: { complete: true, list_kind: "open" } }), startedAt: EARLIER, finishedAt: EARLIER };
    importCrawlerJsonRunIntoSqlite(testDb.db, prior);
    const before = await createSourceDataQualityReport(testDb.db, new Date(NOW));
    expect(before.rows[0]).toMatchObject({ execution: "success", contentStatus: "usable", run: { acceptedCount: 1 } });
    testDb.db.$client.exec("CREATE TRIGGER reject_success_log BEFORE INSERT ON crawler_logs WHEN NEW.status = 'success' BEGIN SELECT RAISE(FAIL, 'log unavailable'); END");
    const failed = payload([opportunity({ description: "Changed scope that must roll back" })], structuredClone(prior.metadata!));
    const metadata = structuredClone(failed.metadata);
    expect(() => importCrawlerJsonRunIntoSqlite(testDb.db, failed)).toThrow("log unavailable");
    const after = await createSourceDataQualityReport(testDb.db, new Date(NOW));
    expect(after.rows[0]).toMatchObject({ execution: "failure", contentStatus: "unknown", runId: failed.runId,
      run: { acceptedCount: 0, validBodyCount: 0, analysisReadyCount: 0 }, stored: { bidCount: 1, validBodyCount: 1 } });
    expect(testDb.db.select().from(bids).get()?.description).toBe(opportunity().description);
    expect(failed.metadata).toEqual(metadata);
  });

  it("chooses the usable duplicate variant rather than dropping it after a placeholder row", () => {
    const run = payload([opportunity({ title: "Untitled opportunity" }), opportunity()]);
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).get()?.title).toBe("Repair public roads");
    expect(run.metadata).toMatchObject({ dataQuality: { uniqueCount: 1, acceptedCount: 1, duplicateCount: 1, duplicateRecords: [{ index: 0 }] } });
  });

  it("quarantines conflicting identity variants instead of silently selecting a duplicate", () => {
    const run = payload([opportunity(), opportunity({ source_bid_id: "wrong", dedupe_key: "city_portal:wrong" })]);
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).all()).toHaveLength(0);
    expect(run.metadata).toMatchObject({ dataQuality: { acceptedCount: 0, quarantinedCount: 1, duplicateCount: 1,
      quarantinedRecords: [{ issues: expect.arrayContaining(["conflicting_duplicate_identity"]) }] } });
  });
  it("keeps verified attachment capabilities after a body-only refresh", () => {
    const file = { name: "Scope.pdf", url: "https://procurement.example.gov/scope.pdf", storage_path: "/tmp/scope.pdf", byte_size: 42,
      checksum_sha256: "a".repeat(64), archive_status: "archived", content_type: "application/pdf" };
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ attachments: [file] })]));
    testDb.db.update(bidAttachments).set({ verifiedAt: EARLIER }).run();
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ attachments: [] })]));
    const stored = testDb.db.select().from(bids).get()!;
    expect(JSON.parse(stored.rawPayload!)).toMatchObject({ data_quality: {
      capabilities: { attachments: true }, attachments: { discovered: 1, archived: 1, verified: 1 },
    } });
  });

  it("uses the registered local jurisdiction for legacy broadly typed sources", () => {
    const run = stampJurisdiction(payload([opportunity()]), {
      id: "city_portal", issuerType: "state", stateCode: "IL", jurisdictionLevel: "city", jurisdictionName: "City", fipsCode: "1714000",
    });
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).get()?.issuerType).toBe("city");
    expect(run.metadata).toMatchObject({ dataQuality: { acceptedCount: 1, quarantinedCount: 0 } });
  });

  it("does not treat a failed parse with a retained valid body as a fresh body", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ detail_fetched_at: EARLIER })]));
    const run = payload([opportunity({ detail_fetched_at: NOW, raw_payload: { enrichment: { applied_fields: [], outcome: {
      status: "failure", reason: "body_not_obtained", attempted: true, valid_body: true, verified_at: null,
    } } } })]);
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(JSON.parse(testDb.db.select().from(bids).get()!.rawPayload!)).toMatchObject({ data_quality: { body: { reused: true, verifiedAt: EARLIER } } });
    expect(run.metadata).toMatchObject({ dataQuality: { retainedBodyCount: 1, fetchedBodyCount: 0 } });
  });

  it("does not accept verification asserted by a newly imported file", () => {
    const file = { name: "Scope.pdf", url: "https://procurement.example.gov/scope.pdf", storage_path: "/tmp/scope.pdf", byte_size: 42,
      checksum_sha256: "a".repeat(64), archive_status: "archived", content_type: "application/pdf", verified_at: NOW };
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ attachments: [file] })]));
    expect(JSON.parse(testDb.db.select().from(bids).get()!.rawPayload!)).toMatchObject({ data_quality: { attachments: { verified: 0 } } });
    expect(testDb.db.select().from(bidAttachments).get()?.verifiedAt).toBeNull();
  });

  it("requires verification again when an archived file's bytes change", () => {
    const file = { name: "Scope.pdf", url: "https://procurement.example.gov/scope.pdf", storage_path: "/tmp/scope.pdf", byte_size: 42,
      checksum_sha256: "a".repeat(64), archive_status: "archived", content_type: "application/pdf" };
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ attachments: [file] })]));
    testDb.db.update(bidAttachments).set({ verifiedAt: EARLIER }).run();
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ attachments: [{ ...file, checksum_sha256: "b".repeat(64) }] })]));
    expect(testDb.db.select().from(bidAttachments).get()?.verifiedAt).toBeNull();
    expect(JSON.parse(testDb.db.select().from(bids).get()!.rawPayload!)).toMatchObject({ data_quality: { attachments: { verified: 0 } } });
  });

  it.each([{ dateFilter: { from: "2026-09-01", kept: 1, dropped: 2 } }, { mode: "detail_backfill" }])("does not trust a complete flag from a scoped run (%j)", (scope) => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload([opportunity({ id: "city_portal:old", source_bid_id: "old", dedupe_key: "city_portal:old" })]));
    const run = payload([opportunity()], { ...scope, pagination: { complete: true, list_kind: "open" } });
    importCrawlerJsonRunIntoSqlite(testDb.db, run);
    expect(testDb.db.select().from(bids).where(eq(bids.id, "city_portal:old")).get()?.lifecycleStatus).toBe("open");
    expect(run.metadata).toMatchObject({ dataQuality: { listCoverage: "partial" }, pagination: { complete: false } });
  });

});
