import { afterEach, describe, expect, it } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { fenceDetailBackfillPayload, loadDetailHistory } from "./detail-history";
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
    if (dialect === "mysql") expect(calls).toEqual([{ sql: "SELECT * FROM bids WHERE id LIKE ? ESCAPE '!' ORDER BY first_seen_at, id", values: ["city!_portal:%"] }]);
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
