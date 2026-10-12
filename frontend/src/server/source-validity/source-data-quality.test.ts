import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bids, bidAttachments, crawlerLogs, dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { ISSUER_TYPES } from "@/lib/issuer-types";
import { createSourceDataQualityReport, createSourceDataQualityReportFromMysql } from "./source-data-quality";

const NOW = "2026-10-01T00:00:00.000Z";
let testDb: TestDatabase | undefined;
afterEach(async () => { await testDb?.cleanup(); testDb = undefined; });

async function seed() {
  testDb = await createTestDatabase({ seed: false });
  for (const level of ISSUER_TYPES) {
    testDb.db.insert(dataSources).values({ id: `${level}_source`, label: `${level} Agency`, issuerType: level, jurisdictionLevel: level, stateCode: level === "federal" ? "US" : "CO", providerFamily: "fixture", isEnabled: 1, lastSuccessAt: NOW, createdAt: NOW, updatedAt: NOW }).run();
  }
  return testDb.db;
}
function manifest(extra: Record<string, unknown> = {}) {
  return { schemaVersion: 1, execution: "success", listCoverage: "complete", contentStatus: "usable", receivedCount: 2, uniqueCount: 2, acceptedCount: 2, quarantinedCount: 0, duplicateCount: 0, validBodyCount: 2, retainedBodyCount: 1, fetchedBodyCount: 1, analysisReadyCount: 2, checkedAt: NOW, acceptedIds: ["one", "two"], reconciliation: { observed: 2, accepted: 2, quarantined: 0, balanced: true }, ...extra };
}

describe("all registered source data quality", () => {
  it("attributes list logs by exact registered IDs or unique labels and refuses ambiguous labels and bid-prefix metadata hints", async () => {
    const db = await seed();
    db.insert(dataSources).values({ id: "other_city", label: "city Agency", issuerType: "city", stateCode: "CO", createdAt: NOW, updatedAt: NOW }).run();
    db.insert(crawlerLogs).values([
      { id: "city_shared", source: "city Agency", runId: "ambiguous", status: "success", startedAt: NOW, metadata: JSON.stringify({ dataQuality: manifest(), sourceIdentity: { id: "city_source" } }) },
      { id: "state_label", source: "state Agency", runId: "unique", status: "success", startedAt: NOW, metadata: JSON.stringify({ dataQuality: manifest() }) },
      { id: "county_id", source: "county_source", runId: "exact", status: "failure", startedAt: NOW },
    ]).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_source")).toMatchObject({ execution: "unknown", runId: null });
    expect(report.rows.find((row) => row.sourceId === "other_city")).toMatchObject({ execution: "unknown", runId: null });
    expect(report.rows.find((row) => row.sourceId === "state_source")).toMatchObject({ execution: "success", runId: "unique" });
    expect(report.rows.find((row) => row.sourceId === "county_source")).toMatchObject({ execution: "failure", runId: "exact" });
    const mysql = { query: async (sql: string): Promise<[unknown[], unknown?]> => {
      if (sql.startsWith("SELECT id, label")) return [[{ id: "city_source", label: "city Agency", issuer_type: "city", state_code: "CO", is_enabled: 1 }]];
      if (sql.includes("FROM crawler_logs")) return [[{ id: "prefix", source: "city_source:one", status: "success", started_at: NOW,
        metadata: { sourceIdentity: { id: "city_source" }, dataQuality: manifest() } }]];
      return [[]];
    } };
    expect((await createSourceDataQualityReportFromMysql(mysql, new Date(NOW))).rows[0]).toMatchObject({ execution: "unknown", runId: null });
  });

  it("includes every jurisdiction and treats execution success without quality evidence as unknown", async () => {
    const db = await seed();
    db.insert(crawlerLogs).values({ id: "legacy", source: "city_source", runId: "legacy", status: "success", startedAt: NOW, fetchedCount: 2, metadata: JSON.stringify({ enrichment: { enriched: 2 } }) }).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows).toHaveLength(6);
    expect(report.segments.map((segment) => segment.jurisdictionLevel)).toEqual(ISSUER_TYPES);
    expect(report.rows.find((row) => row.sourceId === "city_source")).toMatchObject({ execution: "success", listCoverage: "unknown", contentStatus: "unknown", run: { validBodyCount: null, retainedBodyCount: null }, stored: { bidCount: 0 } });
    expect(report.rows.find((row) => row.sourceId === "county_source")).toMatchObject({ execution: "unknown", contentStatus: "unknown" });
    expect(report.summary.unknownSources).toBe(6);
  });

  it("keeps complete lists with missing bodies degraded while exposing body and reuse counts", async () => {
    const db = await seed();
    db.insert(crawlerLogs).values({ id: "degraded", source: "state_source", runId: "degraded", status: "success", startedAt: NOW, fetchedCount: 2, metadata: JSON.stringify({ dataQuality: manifest({ contentStatus: "partial", validBodyCount: 0, retainedBodyCount: 0, fetchedBodyCount: 0, analysisReadyCount: 0 }) }) }).run();
    db.insert(crawlerLogs).values({ id: "full", source: "city_source", runId: "full", status: "success", startedAt: NOW, fetchedCount: 2, metadata: JSON.stringify({ dataQuality: manifest() }) }).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "state_source")).toMatchObject({ execution: "success", listCoverage: "complete", contentStatus: "partial", run: { validBodyCount: 0, analysisReadyCount: 0 } });
    expect(report.rows.find((row) => row.sourceId === "city_source")).toMatchObject({ contentStatus: "usable", run: { validBodyCount: 2, retainedBodyCount: 1, fetchedBodyCount: 1 } });
    expect(report.summary).toMatchObject({ usableSources: 1, degradedSources: 1, unknownSources: 4 });
  });

  it("distinguishes verified empty from unknown and does not let deferred runs erase the last execution", async () => {
    const db = await seed();
    db.insert(crawlerLogs).values([
      { id: "empty", source: "township_source", runId: "empty", status: "success", startedAt: NOW, fetchedCount: 0, metadata: JSON.stringify({ emptyState: { verified: true, tenant_confirmed: true }, dataQuality: manifest({ receivedCount: 0, uniqueCount: 0, acceptedCount: 0, validBodyCount: 0, retainedBodyCount: 0, fetchedBodyCount: 0, analysisReadyCount: 0, acceptedIds: [], contentStatus: "empty_verified", reconciliation: { observed: 0, accepted: 0, quarantined: 0, balanced: true } }) }) },
      { id: "deferred", source: "township_source", runId: "deferred", status: "deferred", startedAt: "2026-10-01T01:00:00.000Z" },
      { id: "false_empty", source: "county_source", runId: "false_empty", status: "success", startedAt: NOW, metadata: JSON.stringify({ dataQuality: manifest({ contentStatus: "empty_verified" }) }) },
    ]).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "township_source")).toMatchObject({ execution: "success", contentStatus: "empty_verified", runId: "empty" });
    expect(report.rows.find((row) => row.sourceId === "county_source")?.contentStatus).toBe("unknown");
  });

  it("keeps a list failure visible after a newer successful detail backfill", async () => {
    const db = await seed();
    db.insert(crawlerLogs).values([
      { id: "list_failure", source: "city_source", runId: "list_failure", status: "failure", startedAt: NOW, metadata: null },
      { id: "body_success", source: "city_source", runId: "body_success", status: "success", startedAt: "2026-10-01T01:00:00.000Z", metadata: JSON.stringify({ mode: "detail_backfill", dataQuality: manifest() }) },
    ]).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_source")).toMatchObject({ execution: "failure", runId: "list_failure", contentStatus: "unknown" });
  });

  it("safely reads malformed SQLite log JSON while excluding valid backfill modes", async () => {
    const db = await seed();
    db.insert(crawlerLogs).values([
      { id: "list_malformed", source: "city_source", runId: "list_malformed", status: "success", startedAt: NOW, metadata: "{broken json" },
      { id: "backfill_newer", source: "city_source", runId: "backfill_newer", status: "success", startedAt: "2026-10-01T01:00:00.000Z", metadata: JSON.stringify({ mode: "detail_backfill" }) },
    ]).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_source")).toMatchObject({ execution: "success", runId: "list_malformed", contentStatus: "unknown" });
  });

  it("excludes newer MySQL backfill execution and guards malformed JSON in the latest-list query", async () => {
    let logSql = "";
    const mysql = { query: async (sql: string): Promise<[unknown[], unknown?]> => {
      if (sql.startsWith("SELECT id, label")) return [[{ id: "city_source", label: "City Agency", issuer_type: "city", state_code: "CO", is_enabled: 1 }]];
      if (sql.includes("FROM crawler_logs")) { logSql = sql; return [[
        { id: "body_success", source: "city_source", run_id: "body_success", status: "success", started_at: "2026-10-01T01:00:00.000Z", metadata: JSON.stringify({ mode: "detail_backfill", dataQuality: manifest() }) },
        { id: "list_failure", source: "city_source", run_id: "list_failure", status: "failure", started_at: NOW, metadata: "{broken json" },
      ]]; }
      return [[]];
    } };
    const report = await createSourceDataQualityReportFromMysql(mysql, new Date(NOW));
    expect(report.rows[0]).toMatchObject({ execution: "failure", runId: "list_failure", contentStatus: "unknown" });
    expect(logSql).toContain("CASE WHEN JSON_VALID(metadata)");
    expect(logSql).toContain("JSON_UNQUOTE(JSON_EXTRACT");
    expect(logSql).toContain("<> 'detail_backfill'");
  });

  it("attributes stored bodies by source identity, preserving unknown verification time", async () => {
    const db = await seed();
    db.insert(bids).values({ id: "city_source:one", source: "city Agency", sourceBidId: "one", dedupeKey: "one", title: "Road repairs", description: "Repair the damaged public roads using resurfacing materials and provide traffic management during construction.", issuerName: "city Agency", issuerType: "city", jurisdictionLevel: "city", jurisdictionName: "Example City", stateCode: "CO", sourceUrl: "https://example.gov/bids/one", firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW }).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_source")).toMatchObject({ stored: { bidCount: 1, validBodyCount: 1, bodyVerificationUnknownCount: 1, latestBodyVerifiedAt: null } });
    expect(report.rows.find((row) => row.sourceId === "state_source")?.stored.bidCount).toBe(0);
  });

  it("uses the registered jurisdiction level when a legacy source issuer type is broader", async () => {
    const db = await seed();
    db.update(dataSources).set({ issuerType: "state" }).where(eq(dataSources.id, "city_source")).run();
    db.insert(bids).values({ id: "city_source:local", source: "city Agency", sourceBidId: "local", dedupeKey: "local", title: "Road repairs", description: "Repair the public roads and provide traffic management throughout the construction work.", issuerName: "city Agency", issuerType: "city", jurisdictionLevel: "city", stateCode: "CO", sourceUrl: "https://example.gov/bids/local", firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW }).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_source")).toMatchObject({ jurisdictionLevel: "city", stored: { coreInvalidCount: 0, analysisReadyCount: 1 } });
  });

  it("honors persisted analysis restrictions while still rechecking actual stored fields", async () => {
    const db = await seed();
    db.insert(bids).values({ id: "city_source:restricted_analysis", source: "city Agency", sourceBidId: "restricted_analysis", dedupeKey: "restricted_analysis", title: "Road repairs", description: "Repair the public roads and provide traffic management throughout the construction work.", issuerName: "city Agency", issuerType: "city", stateCode: "CO", sourceUrl: "https://example.gov/bids/restricted_analysis", rawPayload: JSON.stringify({ data_quality: { coreValid: true, capabilities: { discovery: true, analysis: false }, body: { valid: true } } }), firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW }).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_source")?.stored).toMatchObject({ validBodyCount: 1, analysisReadyCount: 0 });
  });

  it("reports missing-body backlog reasons and original record age without confusing attempts with valid bodies", async () => {
    const db = await seed();
    for (const [id, outcome, firstSeenAt] of [
      ["city_source:budget", { status: "budget", reason: "budget_exhausted", attempted: false, attempt_count: 0 }, "2026-09-01T00:00:00.000Z"],
      ["city_source:failure", { status: "failure", reason: "http_429", attempted: true, attempted_at: "2026-09-30T00:00:00.000Z", attempt_count: 3, next_retry_at: "2026-10-02T00:00:00.000Z" }, NOW],
    ] as const) db.insert(bids).values({ id, source: "city Agency", sourceBidId: id, dedupeKey: id, title: "Road repairs", description: "", issuerName: "city Agency", issuerType: "city", stateCode: "CO", sourceUrl: `https://example.gov/bids/${id}`, rawPayload: JSON.stringify({ enrichment: { outcome } }), firstSeenAt, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW }).run();
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === "city_source")?.stored.bodyBacklog).toMatchObject({ pendingCount: 2, neverAttemptedCount: 1, statusCounts: { budget: 1, failure: 1 }, oldestPendingObservedAt: "2026-09-01T00:00:00.000Z", nextRetryAt: "2026-10-02T00:00:00.000Z" });
  });

  it("aggregates every active record across bounded SQLite pages and only reads attachments for those pages", async () => {
    const db = await seed();
    for (let index = 0; index < 260; index += 1) {
      const id = `city_source:${String(index).padStart(4, "0")}`;
      db.insert(bids).values({ id, source: "city Agency", sourceBidId: id, dedupeKey: id, title: "Road repairs", description: "Repair the public roads and provide traffic management throughout the construction work.", issuerName: "city Agency", issuerType: "city", stateCode: "CO", sourceUrl: `https://example.gov/bids/${index}`, firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW }).run();
    }
    db.insert(bidAttachments).values({ id: "last_page_attachment", bidId: "city_source:0259", name: "Procurement.pdf", url: "https://example.gov/a.pdf", storagePath: "a.pdf", byteSize: 100, contentType: "application/pdf", checksumSha256: "a".repeat(64), verifiedAt: NOW, archiveStatus: "archived", createdAt: NOW }).run();
    const statements: string[] = [];
    const prepare = db.$client.prepare.bind(db.$client);
    const spy = vi.spyOn(db.$client, "prepare").mockImplementation(((sql: string) => { statements.push(sql); return prepare(sql); }) as typeof db.$client.prepare);
    const report = await createSourceDataQualityReport(db, new Date(NOW));
    spy.mockRestore();
    expect(report.rows.find((row) => row.sourceId === "city_source")?.stored).toMatchObject({ bidCount: 260, validBodyCount: 260, attachmentsVerified: 1 });
    expect(statements.filter((sql) => sql.includes("FROM bids") && sql.includes("LIMIT"))).toHaveLength(1);
    expect(statements.some((sql) => sql.includes("FROM bid_attachments") && !sql.includes("bid_id IN"))).toBe(false);
  });

  it("uses MySQL keyset batches, incremental totals and latest registered-source execution only", async () => {
    const captured: Array<{ sql: string; values: unknown[] }> = [];
    const mysql = { query: async (sql: string, values: unknown[] = []): Promise<[unknown[], unknown?]> => {
      captured.push({ sql, values });
      if (sql.startsWith("SELECT id, label")) return [[{ id: "city_source", label: "City Agency", issuer_type: "city", state_code: "CO", is_enabled: 1 }]];
      if (sql.includes("FROM bids")) {
        const start = values[0] === "" ? 0 : 250;
        return [Array.from({ length: start === 0 ? 250 : 10 }, (_, offset) => { const id = `city_source:${String(start + offset).padStart(4, "0")}`; return { id, source: "City Agency", source_bid_id: id, dedupe_key: id, title: "Road repairs", description: "Repair the public roads and provide traffic management throughout construction.", issuer_name: "City Agency", issuer_type: "city", state_code: "CO", source_url: `https://example.gov/bids/${id}` }; })];
      }
      if (sql.includes("FROM bid_attachments")) return [[{ bid_id: "city_source:0259", id: "a", url: "https://example.gov/a.pdf", archive_status: "archived", storage_path: "a.pdf", checksum_sha256: "a".repeat(64), byte_size: 100, content_type: "application/pdf", verified_at: NOW }].filter((row) => values.includes(row.bid_id))];
      return [[]];
    } };
    const report = await createSourceDataQualityReportFromMysql(mysql, new Date(NOW));
    expect(report.rows[0].stored).toMatchObject({ bidCount: 260, validBodyCount: 260, attachmentsVerified: 1 });
    expect(captured.filter((call) => call.sql.includes("FROM bids"))).toHaveLength(2);
    expect(captured.find((call) => call.sql.includes("FROM crawler_logs"))?.sql).toContain("LIMIT 1");
    expect(captured.filter((call) => call.sql.includes("FROM bid_attachments")).every((call) => call.values.length <= 250)).toBe(true);
  });

  it("leases a read-only MySQL snapshot for the entire paged report and releases it", async () => {
    const events: string[] = [];
    const connection = {
      query: async (sql: string): Promise<[unknown[], unknown?]> => { events.push(sql); return [[]]; },
      beginTransaction: async () => { events.push("begin"); }, commit: async () => { events.push("commit"); }, rollback: async () => { events.push("rollback"); }, release: () => { events.push("release"); },
    };
    const mysql = { query: async (): Promise<[unknown[], unknown?]> => { throw new Error("Pool reads cannot share a snapshot"); }, getConnection: async () => connection };
    const report = await createSourceDataQualityReportFromMysql(mysql, new Date(NOW));
    expect(report.readConsistency).toBe("snapshot");
    expect(events[0]).toContain("READ ONLY");
    expect(events[1]).toBe("begin");
    expect(events.slice(-2)).toEqual(["commit", "release"]);
    expect(events).not.toContain("rollback");
  });

  it("rolls back and releases the read snapshot when scanning fails", async () => {
    const release = vi.fn(); const rollback = vi.fn(async () => undefined);
    const connection = { query: async (sql: string): Promise<[unknown[], unknown?]> => { if (sql.includes("FROM bids")) throw new Error("read failed"); return [[]]; }, beginTransaction: async () => undefined, commit: vi.fn(async () => undefined), rollback, release };
    const mysql = { query: async (): Promise<[unknown[], unknown?]> => [[]], getConnection: async () => connection };
    await expect(createSourceDataQualityReportFromMysql(mysql, new Date(NOW))).rejects.toThrow("read failed");
    expect(rollback).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce(); expect(connection.commit).not.toHaveBeenCalled();
  });

  it("normalizes MySQL JSON/numeric rows with the same evidence and includes all registered sources", async () => {
    const captured: string[] = [];
    const mysql = { query: async (sql: string): Promise<[unknown[], unknown?]> => {
      captured.push(sql);
      if (sql.startsWith("SELECT id, label")) return [[{ id: "district", label: "Water District", issuer_type: "special_district", jurisdiction_level: "special_district", state_code: "CO", is_enabled: "1", provider_family: "fixture" }]];
      if (sql.includes("FROM crawler_logs")) return [[{ id: "log", source: "district", run_id: "r", status: "success", started_at: NOW, fetched_count: "2", metadata: { dataQuality: manifest() } }]];
      return [[]];
    } };
    const report = await createSourceDataQualityReportFromMysql(mysql, new Date(NOW));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ sourceId: "district", jurisdictionLevel: "special_district", execution: "success", contentStatus: "usable", run: { acceptedCount: 2, validBodyCount: 2 } });
    expect(captured.find((sql) => sql.includes("FROM bids"))).not.toMatch(/issuer_type\s*=\s*'state'/);
  });
});
