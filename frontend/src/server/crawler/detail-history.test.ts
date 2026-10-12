import { afterEach, describe, expect, it, vi } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  DETAIL_BACKFILL_PAGE_SIZE, DETAIL_HISTORY_LIST_LIMIT, detailAttemptBudget, detailBackfillQuery, fenceDetailBackfillPayload,
  loadDetailBackfillCandidates, loadDetailHistory, sourceIdPredicate,
} from "./detail-history";
import type { CrawlableSource } from "./source-registry";

const NOW = "2026-10-08T00:00:00.000Z";
const source: CrawlableSource = { id: "city_portal", label: "City Agency", issuerType: "state", jurisdictionLevel: "city",
  stateCode: "CO", fipsCode: "0816000", baseUrl: "https://city.example.gov/open-bids", cadence: "daily", providerFamily: "fixture",
  jurisdictionName: "City", fetchConfig: {}, lastSuccessAt: null, consecutiveFailures: 0 };
const bid = (sourceBidId: string, overrides: Partial<typeof bids.$inferInsert> = {}) => ({
  id: `city_portal:${sourceBidId}`, sourceBidId, dedupeKey: `city_portal:${sourceBidId}`, source: "Old display label",
  title: "Road repairs", description: "Repair the public roads and drainage.", issuerName: "City Agency", issuerType: "city", stateCode: "CO",
  sourceUrl: `https://city.example.gov/bids/${sourceBidId}`, rawPayload: JSON.stringify({ enrichment: { outcome: { attempt_count: 2 } } }),
  qualityFlagsJson: "[]", firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW, ...overrides,
});
let database: TestDatabase | undefined;
afterEach(async () => { await database?.cleanup(); database = undefined; });

describe("detail history identity admission", () => {
  it.each(["sqlite", "mysql"])("keeps only exact canonical core-valid history with exact registered geography in %s", async (dialect) => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values([
      bid("optional"), bid("typed", { jurisdictionLevel: "city", fipsCode: "0816000" }),
      bid("case", { stateCode: "co" }), bid("wrong", { stateCode: "IL" }),
      bid("fips", { fipsCode: "0820000" }), bid("generic", { sourceUrl: source.baseUrl! }),
      bid("noncanonical", { sourceBidId: "different" }), bid("null", { sourceBidId: null }),
      bid("unknown"), bid("placeholder", { title: "Untitled opportunity" }),
      bid("outside", { id: "cityXportal:outside", dedupeKey: "cityXportal:outside" }),
    ]).run();
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const mysql = { query: async (sql: string, values: unknown[] = []): Promise<[unknown[], unknown?]> => {
      calls.push({ sql, values });
      return [database!.db.$client.prepare(sql).all(...values)];
    } };
    const rows = await loadDetailHistory(dialect === "sqlite" ? { database: database.db } : { mysql }, source.id, source);
    expect(rows.map((row) => row.id)).toEqual(["city_portal:optional", "city_portal:typed"]);
    expect(rows[0]).toMatchObject({ attachments: [], raw_payload: { enrichment: { outcome: { attempt_count: 2 } } }, quality_flags_json: [] });
    if (dialect === "mysql") expect(calls).toEqual([
      { sql: "SELECT MAX(last_seen_at) AS latest FROM bids WHERE id LIKE ? ESCAPE '!'", values: ["city!_portal:%"] },
      { sql: "SELECT * FROM bids WHERE id LIKE ? ESCAPE '!' AND last_seen_at >= ? ORDER BY last_seen_at DESC, id LIMIT ?",
        values: ["city!_portal:%", "2026-09-08T00:00:00.000Z", 5001] },
    ]);
  });

  it("falls back to the source issuer type for an unset jurisdiction and retains optional missing fields", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values(bid("optional")).run();
    expect(await loadDetailHistory({ database: database.db }, source.id, { ...source, issuerType: "city", jurisdictionLevel: null })).toHaveLength(1);
  });

  it("uses the SAM US/federal fallback without a registration", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values([
      bid("federal", { id: "sam_gov:federal", dedupeKey: "sam_gov:federal", issuerType: "federal", stateCode: "US" }),
      bid("city", { id: "sam_gov:city", dedupeKey: "sam_gov:city" }),
    ]).run();
    expect((await loadDetailHistory({ database: database.db }, "sam_gov")).map((row) => row.id)).toEqual(["sam_gov:federal"]);
  });

  it("fences a complete backfill document without mutating the child payload", () => {
    const payload = { source: source.id, runId: "history", status: "success" as const, startedAt: NOW,
      metadata: { pagination: { complete: true, list_kind: "open" }, sourceIdentity: { id: source.id } }, bids: [] };
    expect(fenceDetailBackfillPayload(payload)).toMatchObject({ metadata: { mode: "detail_backfill",
      pagination: { complete: false, list_kind: "open", stopped_reason: "detail_backfill" } } });
    expect(payload.metadata.pagination.complete).toBe(true);
  });
});

describe("bounded list history", () => {
  it("reads this source's rows seen within 30 days of its newest sighting, newest first", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values([
      bid("fresh"),
      bid("edge", { lastSeenAt: "2026-09-08T00:00:00.000Z" }),
      bid("stale", { lastSeenAt: "2026-09-07T23:59:59.000Z" }),
      bid("neighbour", { id: "city_portal_2:neighbour", dedupeKey: "city_portal_2:neighbour" }),
    ]).run();
    const rows = await loadDetailHistory({ database: database.db }, source.id, source);
    expect(rows.map((row) => row.id)).toEqual(["city_portal:fresh", "city_portal:edge"]);
  });

  it("scopes SQLite reads to a primary-key range", async () => {
    database = await createTestDatabase({ seed: false });
    const [scope, values] = sourceIdPredicate("sqlite", source.id);
    const plan = database.db.$client.prepare(`EXPLAIN QUERY PLAN SELECT * FROM bids WHERE ${scope}`).all(...values) as Array<{ detail: string }>;
    expect(plan.map((step) => step.detail).join("\n")).toMatch(/SEARCH bids USING .*\(id>\? AND id<\?\)/);
  });

  it.each(["sqlite", "mysql"])("caps one list run's history and reports a truncation only when a row is left out in %s", async (dialect) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      database = await createTestDatabase({ seed: false });
      const rows = Array.from({ length: DETAIL_HISTORY_LIST_LIMIT }, (_, index) => bid(`b${String(index).padStart(4, "0")}`));
      for (let start = 0; start < rows.length; start += 500) database.db.insert(bids).values(rows.slice(start, start + 500)).run();
      const mysql = { query: async (sql: string, values: unknown[] = []): Promise<[unknown[], unknown?]> => [database!.db.$client.prepare(sql).all(...values)] };
      const store = dialect === "sqlite" ? { database: database.db } : { mysql };

      expect(await loadDetailHistory(store, source.id, source)).toHaveLength(DETAIL_HISTORY_LIST_LIMIT);
      expect(warn).not.toHaveBeenCalled();

      database.db.insert(bids).values(bid("oldest", { lastSeenAt: "2026-10-01T00:00:00.000Z" })).run();
      const capped = await loadDetailHistory(store, source.id, source);
      expect(capped).toHaveLength(DETAIL_HISTORY_LIST_LIMIT);
      expect(capped.map((row) => row.id)).not.toContain("city_portal:oldest");
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "crawler_detail_history_truncated", source: "city_portal", limit: 5000 }));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("detail backfill candidates", () => {
  const outcome = (attemptedAt: string, nextRetryAt: string) =>
    JSON.stringify({ enrichment: { outcome: { attempted_at: attemptedAt, next_retry_at: nextRetryAt, attempt_count: 1 } } });
  const now = new Date(NOW);

  it("returns due rows without a usable body, oldest attempt first, up to the limit", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values([
      bid("never", { description: "", firstSeenAt: "2026-09-01T00:00:00.000Z" }),
      bid("retried", { description: "", firstSeenAt: "2026-08-01T00:00:00.000Z", rawPayload: outcome("2026-09-15T00:00:00+00:00", "2026-09-15T01:00:00+00:00") }),
      bid("echo", { description: "Road repairs", firstSeenAt: "2026-09-20T00:00:00.000Z" }),
      bid("cooling", { description: "", rawPayload: outcome("2026-10-07T23:00:00+00:00", "2026-10-08T23:00:00+00:00") }),
      // The crawler's backfill cooldown for a row it could not attempt: never attempted, not due.
      bid("unattempted", { description: "", firstSeenAt: "2026-07-01T00:00:00.000Z", rawPayload: JSON.stringify({ enrichment: { outcome: {
        status: "not_needed", reason: "missing_detail_url", attempted: false, attempted_at: null, next_retry_at: "2026-10-08T12:00:00+00:00" } } }) }),
      bid("complete"),
      bid("foreign", { description: "", stateCode: "IL", firstSeenAt: "2026-01-01T00:00:00.000Z" }),
    ]).run();
    const load = (limit: number) => loadDetailBackfillCandidates({ database: database!.db }, source.id, source, { limit, now });
    expect((await load(5)).map((row) => row.id)).toEqual(["city_portal:never", "city_portal:retried", "city_portal:echo"]);
    expect((await load(1)).map((row) => row.id)).toEqual(["city_portal:never"]);
  });

  it("pages past rows the registry no longer accepts", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values(Array.from({ length: DETAIL_BACKFILL_PAGE_SIZE + 1 }, (_, index) =>
      bid(`foreign${String(index).padStart(3, "0")}`, { description: "", stateCode: "IL", firstSeenAt: "2026-01-01T00:00:00.000Z" }))).run();
    database.db.insert(bids).values(bid("valid", { description: "" })).run();
    const rows = await loadDetailBackfillCandidates({ database: database.db }, source.id, source, { limit: 1, now });
    expect(rows.map((row) => row.id)).toEqual(["city_portal:valid"]);
  });

  it("never spends a slot on a row that points at the list page the crawler reads or the registry's portal page", async () => {
    database = await createTestDatabase({ seed: false });
    // BidNet-fallback shape: the crawler lists fetch_config.base_url and stamps it on URL-less rows; base_url is the portal.
    const listPage = "https://www.bidnetdirect.com/colorado/solicitations/open-bids";
    const older = { description: "", firstSeenAt: "2026-09-01T00:00:00.000Z" };
    database.db.insert(bids).values([
      bid("list", { ...older, sourceUrl: listPage }),
      bid("listslash", { ...older, sourceUrl: `${listPage}/` }),
      bid("portal", { ...older, sourceUrl: source.baseUrl! }),
      bid("portalslash", { ...older, sourceUrl: `${source.baseUrl}/` }),
      bid("detail", { description: "", firstSeenAt: "2026-09-20T00:00:00.000Z" }),
    ]).run();
    const bidnetFallback = { ...source, fetchConfig: { base_url: listPage } };
    const rows = await loadDetailBackfillCandidates({ database: database.db }, source.id, bidnetFallback, { limit: 1, now });
    expect(rows.map((row) => row.id)).toEqual(["city_portal:detail"]);
  });

  it("treats a bare SAM description link as a missing body", async () => {
    database = await createTestDatabase({ seed: false });
    const link = "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc";
    database.db.insert(bids).values([
      bid("abc", { id: "sam_gov:abc", dedupeKey: "sam_gov:abc", issuerType: "federal", stateCode: "US", description: link, fullDescription: link }),
      bid("done", { id: "sam_gov:done", dedupeKey: "sam_gov:done", issuerType: "federal", stateCode: "US" }),
    ]).run();
    const rows = await loadDetailBackfillCandidates({ database: database.db }, "sam_gov", undefined, { limit: 25, now });
    expect(rows.map((row) => row.id)).toEqual(["sam_gov:abc"]);
  });

  it("builds the MySQL query with an escaped prefix, guarded JSON reads and one binary collation", () => {
    const { sql, values } = detailBackfillQuery("mysql", "sam_gov", now, 1);
    expect(sql).toContain("id LIKE ? ESCAPE '!'");
    expect(sql).toContain("NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.enrichment.outcome.next_retry_at')), 'null')");
    expect(sql).toContain("COLLATE utf8mb4_bin");
    expect(sql).toMatch(/LIMIT \? OFFSET \?$/);
    expect(values).toEqual(["sam!_gov:%", NOW, DETAIL_BACKFILL_PAGE_SIZE, DETAIL_BACKFILL_PAGE_SIZE]);
  });

  it("reads the attempt budget the way the crawler does", () => {
    expect(detailAttemptBudget({ fetchConfig: {} })).toBe(25);
    expect(detailAttemptBudget({ fetchConfig: { enrichment: { max_details_per_run: 4 } } })).toBe(4);
    expect(detailAttemptBudget({ fetchConfig: { enrichment: { max_details_per_run: 999 } } })).toBe(200);
  });

  it("reports a scan that read its whole page budget without reaching the limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      let queries = 0;
      const mysql = {
        // Full pages of ids the registry rejects: nothing is ever a candidate, and every page looks like there is more.
        query: async (): Promise<[unknown[], unknown?]> => {
          queries += 1;
          return [Array.from({ length: DETAIL_BACKFILL_PAGE_SIZE }, () => ({ id: "other:1", source_bid_id: "1" }))];
        },
      };
      expect(await loadDetailBackfillCandidates({ mysql }, source.id, source, { limit: 1, now })).toEqual([]);
      expect(queries).toBe(10);
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "crawler_detail_backfill_scan_capped", source: "city_portal", pages: 10, found: 0, limit: 1 }));
    } finally {
      warn.mockRestore();
    }
  });

  it("stays silent when a short page ends the scan", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const mysql = { query: async (): Promise<[unknown[], unknown?]> => [[{ id: "other:1", source_bid_id: "1" }]] };
      expect(await loadDetailBackfillCandidates({ mysql }, source.id, source, { limit: 1, now })).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
