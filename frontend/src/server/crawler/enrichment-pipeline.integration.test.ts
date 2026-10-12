import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { getBidByIdFromMysql, getBidByIdFromRepository } from "@/server/bids/repository";
import { queryBidsFromDatabase, queryBidsFromMysql } from "@/server/bids/service";
import { createSourceDataQualityReportFromMysql } from "@/server/source-validity/source-data-quality";
import { getBidDescription } from "@/lib/bid-description";
import { registerSourcesInMysql, type SourceCandidate } from "../../../scripts/register-sources";
import { listCrawlableSourcesFromMysql } from "./source-registry";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";

interface PipelineFixture {
  enriched: CrawlerJsonRunPayload;
  plain: CrawlerJsonRunPayload;
  scope: string;
  local: Record<string, CrawlerJsonRunPayload>;
  sam_enriched: CrawlerJsonRunPayload;
  sam_failed: CrawlerJsonRunPayload;
  sam_body: string;
}

describe.runIf(process.env.RUN_CRAWLER_INTEGRATION === "1")("offline crawler / HTTP extractor / database pipeline", () => {
  let fixture: PipelineFixture;

  beforeAll(() => {
    fixture = JSON.parse(execFileSync(
      process.env.CRAWLER_INTEGRATION_PYTHON || "python3",
      [path.resolve("scripts/fixtures/enrichment-pipeline.py")],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  }, 35_000);

  it("carries actual detail content through the real adapter and fetch-task contract", () => {
    const bid = fixture.enriched.bids![0];
    expect(fixture.enriched.metadata?.enrichment).toMatchObject({ attempted: 1, enriched: 1, failed: 0 });
    expect(bid.full_description).toBe(fixture.scope);
    expect(bid.description).not.toBe(bid.title);
    expect(bid.attachments).not.toHaveLength(0);
    expect(bid.raw_payload).toMatchObject({ enrichment: { applied_fields: expect.arrayContaining(["description", "full_description", "attachments"]) } });
  });

  it("preserves displayable content, attachments and search results after SQLite list-only reimport", async () => {
    const database = await createTestDatabase({ seed: false });
    try {
      importCrawlerJsonRunIntoSqlite(database.db, fixture.enriched);
      const id = String(fixture.enriched.bids![0].id);
      const before = await getBidByIdFromRepository(database.db, id);
      importCrawlerJsonRunIntoSqlite(database.db, fixture.plain);
      const after = await getBidByIdFromRepository(database.db, id);
      expect(after?.fullDescription).toBe(fixture.scope);
      expect(after?.description).toBe(before?.description);
      expect(after?.attachments).toEqual(before?.attachments);
      expect(getBidDescription(after!)).toBe(fixture.scope);
      const matches = await queryBidsFromDatabase(database.db, { q: "BoundaryOnlyKeyword" });
      expect(matches.bids.map((bid) => bid.id)).toContain(id);
    } finally {
      await database.cleanup();
    }
  });

  it("clears a historical portal-label contact in SQLite while preserving its other contact fields", async () => {
    const database = await createTestDatabase({ seed: false });
    try {
      importCrawlerJsonRunIntoSqlite(database.db, fixture.enriched);
      const id = String(fixture.enriched.bids![0].id);
      database.db.$client.prepare("UPDATE bids SET contact_name = ?, contact_email = ?, contact_phone = ? WHERE id = ?")
        .run("Purchase Method: Open Market", "buyer@example.gov", "555-0100", id);
      importCrawlerJsonRunIntoSqlite(database.db, fixture.plain);
      expect(await getBidByIdFromRepository(database.db, id)).toMatchObject({
        contactName: "", contactEmail: "buyer@example.gov", contactPhone: "555-0100",
      });
    } finally {
      await database.cleanup();
    }
  });

  it.each(["county", "city", "township", "special_district"] as const)("preserves %s identity through Python, SQLite and search", async (level) => {
    const database = await createTestDatabase({ seed: false });
    try {
      const payload = fixture.local[level];
      const id = String(payload.bids![0].id);
      expect(payload.bids![0].issuer_type).toBe(level);
      importCrawlerJsonRunIntoSqlite(database.db, payload);
      expect(await getBidByIdFromRepository(database.db, id)).toMatchObject({ issuerType: level, stateCode: "IL" });
      const matches = await queryBidsFromDatabase(database.db, { states: ["IL"], issuerType: level });
      expect(matches.bids.map((bid) => bid.id)).toContain(id);
      expect((await queryBidsFromDatabase(database.db, { issuerType: "state" })).bids).toHaveLength(0);
    } finally {
      await database.cleanup();
    }
  });

  it("retains SAM API body and full-body search after a detail failure in SQLite", async () => {
    const database = await createTestDatabase({ seed: false });
    try {
      const id = String(fixture.sam_enriched.bids![0].id);
      importCrawlerJsonRunIntoSqlite(database.db, fixture.sam_enriched);
      importCrawlerJsonRunIntoSqlite(database.db, fixture.sam_failed);
      const bid = await getBidByIdFromRepository(database.db, id);
      expect(getBidDescription(bid!)).toBe(fixture.sam_body);
      expect(bid?.description).not.toContain("noticedesc");
      expect((await queryBidsFromDatabase(database.db, { q: "SamBoundaryOnlyKeyword" })).bids.map((match) => match.id)).toContain(id);
    } finally {
      await database.cleanup();
    }
  });

  describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("real MySQL transaction integration", () => {
    const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
    let admin: ReturnType<typeof createMysqlPool>;
    let mysql: ReturnType<typeof createMysqlPool>;

    beforeAll(async () => {
      // Always create a new isolated schema. Never migrate or clear the supplied database.
      const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
      url.pathname = "/";
      admin = createMysqlPool(url.toString());
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      url.pathname = `/${databaseName}`;
      // A single connection also verifies failure logging releases its transaction lease.
      mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
      await runMysqlMigrations(mysql);
    }, 60_000);

    afterAll(async () => {
      if (mysql) await mysql.end();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await admin.end();
      }
    });

    it("keeps discovered city sources gated until approval and preserves governance on re-registration", async () => {
      const candidate: SourceCandidate = {
        id: "bidnet_co_boulder_city_mysql_test",
        label: "City of Boulder (BidNet)",
        issuerType: "city",
        stateCode: "CO",
        baseUrl: "https://www.bidnetdirect.com/colorado/city-of-boulder/solicitations/open-bids",
        jurisdictionLevel: "city",
        jurisdictionName: "Boulder city",
        fipsCode: "0807850",
        providerFamily: "bidnet",
        cadence: "daily",
        fetchConfig: { base_url: "https://www.bidnetdirect.com/colorado/city-of-boulder/solicitations/open-bids" },
      };
      const now = "2026-09-23T00:00:00.000Z";

      expect(await registerSourcesInMysql(mysql, [candidate], now)).toEqual({ inserted: 1, errors: [] });
      const [pending] = await mysql.query(
        "SELECT approval_status, approved_for_ingestion FROM data_sources WHERE id = ?",
        [candidate.id],
      );
      expect(pending).toEqual([expect.objectContaining({ approval_status: null, approved_for_ingestion: null })]);
      expect((await listCrawlableSourcesFromMysql(mysql)).map((source) => source.id)).not.toContain(candidate.id);

      await mysql.query(
        "UPDATE data_sources SET approval_status = 'approved', approved_for_ingestion = 1, legal_review_status = 'approved_public' WHERE id = ?",
        [candidate.id],
      );
      expect(await registerSourcesInMysql(mysql, [{ ...candidate, label: "City of Boulder Updated (BidNet)" }], now))
        .toEqual({ inserted: 1, errors: [] });
      const [approved] = await mysql.query(
        "SELECT label, approval_status, approved_for_ingestion, legal_review_status FROM data_sources WHERE id = ?",
        [candidate.id],
      );
      expect(approved).toEqual([expect.objectContaining({
        label: "City of Boulder Updated (BidNet)",
        approval_status: "approved",
        approved_for_ingestion: 1,
        legal_review_status: "approved_public",
      })]);
      expect((await listCrawlableSourcesFromMysql(mysql)).map((source) => source.id)).toContain(candidate.id);

      const aliasUrl = "https://www.bidnetdirect.com/city-of-boulder/solicitations/open-bids";
      expect(await registerSourcesInMysql(mysql, [{
        ...candidate, id: "boulder_alias_mysql_test", baseUrl: aliasUrl, fetchConfig: { base_url: aliasUrl },
      }], now)).toMatchObject({ inserted: 0, errors: [{ errors: [expect.stringContaining("already registered")] }] });
      expect(await registerSourcesInMysql(mysql, [{ ...candidate, fipsCode: "0801111", jurisdictionName: "Different city" }], now))
        .toMatchObject({ inserted: 0, errors: [{ errors: [expect.stringContaining("identity change")] }] });
      const [unchanged] = await mysql.query("SELECT fips_code, approval_status FROM data_sources WHERE id = ?", [candidate.id]);
      expect(unchanged).toEqual([expect.objectContaining({ fips_code: candidate.fipsCode, approval_status: "approved" })]);
    });

    it("retains detail content and attachments after repeated real MySQL imports", async () => {
      await importCrawlerJsonRunIntoMysql(mysql, fixture.enriched);
      const id = String(fixture.enriched.bids![0].id);
      const before = await getBidByIdFromMysql(mysql, id);
      await importCrawlerJsonRunIntoMysql(mysql, fixture.plain);
      const after = await getBidByIdFromMysql(mysql, id);
      expect(after?.fullDescription).toBe(fixture.scope);
      expect(after?.description).toBe(before?.description);
      expect(after?.attachments).toEqual(before?.attachments);
      expect(getBidDescription(after!)).toBe(fixture.scope);
      const matches = await queryBidsFromMysql(mysql, { q: "BoundaryOnlyKeyword" });
      expect(matches.bids.map((bid) => bid.id)).toContain(id);
    });

    it("clears a historical portal-label contact in MySQL while preserving its other contact fields", async () => {
      const bid = { ...fixture.enriched.bids![0], id: "contact:legacy", dedupe_key: "contact:legacy", source_bid_id: "contact-legacy" };
      await importCrawlerJsonRunIntoMysql(mysql, { ...fixture.enriched, runId: randomUUID(), bids: [bid] });
      await mysql.query("UPDATE bids SET contact_name = ?, contact_email = ?, contact_phone = ? WHERE id = ?",
        ["Purchase Method: Contract", "buyer@example.gov", "555-0100", bid.id]);
      await importCrawlerJsonRunIntoMysql(mysql, {
        ...fixture.plain, runId: randomUUID(), bids: [{ ...fixture.plain.bids![0], id: bid.id, dedupe_key: bid.dedupe_key, source_bid_id: bid.source_bid_id }],
      });
      expect(await getBidByIdFromMysql(mysql, bid.id)).toMatchObject({
        contactName: "", contactEmail: "buyer@example.gov", contactPhone: "555-0100",
      });
    });

    it.each(["county", "city", "township", "special_district"] as const)("preserves %s identity through Python, real MySQL and search", async (level) => {
      const payload = fixture.local[level];
      const id = String(payload.bids![0].id);
      await importCrawlerJsonRunIntoMysql(mysql, payload);
      expect(await getBidByIdFromMysql(mysql, id)).toMatchObject({ issuerType: level, stateCode: "IL" });
      const matches = await queryBidsFromMysql(mysql, { states: ["IL"], issuerType: level });
      expect(matches.bids.map((bid) => bid.id)).toContain(id);
      expect((await queryBidsFromMysql(mysql, { issuerType: "state" })).bids.map((bid) => bid.id)).not.toContain(id);
    });

    it("retains SAM API body and full-body search after a detail failure in real MySQL", async () => {
      const id = String(fixture.sam_enriched.bids![0].id);
      await importCrawlerJsonRunIntoMysql(mysql, fixture.sam_enriched);
      await importCrawlerJsonRunIntoMysql(mysql, fixture.sam_failed);
      const bid = await getBidByIdFromMysql(mysql, id);
      expect(getBidDescription(bid!)).toBe(fixture.sam_body);
      expect(bid?.description).not.toContain("noticedesc");
      expect((await queryBidsFromMysql(mysql, { q: "SamBoundaryOnlyKeyword" })).bids.map((match) => match.id)).toContain(id);
    });

    it("quarantines a foreign derived namespace in real MySQL without delisting and reports original evidence", async () => {
      const sourceId = "derived_identity_city_mysql";
      const foreignId = "other_identity_city_mysql:one";
      const at = "2026-10-08T00:00:00.000Z";
      expect(await registerSourcesInMysql(mysql, [{ id: sourceId, label: "Derived identity city", issuerType: "city", stateCode: "IL",
        jurisdictionLevel: "city", jurisdictionName: "City", fipsCode: "1714000", baseUrl: "https://city.example.gov/open-bids",
        providerFamily: null, cadence: "daily", fetchConfig: {} }], at)).toEqual({ inserted: 1, errors: [] });
      // Older registrations can retain the broad issuer type while declaring the local level.
      await mysql.query("UPDATE data_sources SET issuer_type = 'state' WHERE id = ?", [sourceId]);
      const old = { id: `${sourceId}:old`, source: "Derived identity city", source_bid_id: "old", dedupe_key: `${sourceId}:old`,
        title: "Road repairs", description: "Resurface public roads and improve drainage.", issuer_name: "City Agency", issuer_type: "city",
        jurisdiction_level: "city", state_code: "IL", source_url: "https://city.example.gov/bids/old" };
      const initial: CrawlerJsonRunPayload = { source: sourceId, runId: randomUUID(), status: "success", startedAt: "2026-10-07T00:00:00.000Z", bids: [old] };
      await importCrawlerJsonRunIntoMysql(mysql, initial);
      const incoming = { ...old, id: "", source_bid_id: "one", dedupe_key: foreignId, source_url: "https://city.example.gov/bids/one" };
      const run: CrawlerJsonRunPayload = { ...initial, runId: randomUUID(), startedAt: at, finishedAt: at, bids: [incoming],
        metadata: { sourceIdentity: { id: sourceId, stateCode: "IL", issuerType: "city", jurisdictionLevel: "city" },
          pagination: { complete: true, list_kind: "open" } } };
      const result = await importCrawlerJsonRunIntoMysql(mysql, run);
      expect(result).toMatchObject({ insertedCount: 0, updatedCount: 0 });
      expect(result).not.toHaveProperty("delistedCount");
      const [saved] = await mysql.query("SELECT id, lifecycle_status FROM bids WHERE id = ? OR id = ?", [old.id, foreignId]);
      expect(saved).toEqual([expect.objectContaining({ id: old.id, lifecycle_status: "open" })]);
      expect(run.metadata).toMatchObject({ pagination: { complete: false, quality_blocked: true }, dataQuality: {
        acceptedCount: 0, quarantinedCount: 1, acceptedIds: [], contentStatus: "unusable", quarantinedRecords: [
          { id: null, issues: ["source_identity_mismatch:id"], row: { id: "", dedupe_key: foreignId } },
        ],
      } });
      const report = await createSourceDataQualityReportFromMysql(mysql, new Date(at));
      expect(report.readConsistency).toBe("snapshot");
      expect(report.rows.find((row) => row.sourceId === sourceId)).toMatchObject({ listCoverage: "partial", contentStatus: "unusable",
        run: { acceptedCount: 0, quarantinedCount: 1 }, stored: { bidCount: 1, coreInvalidCount: 0, analysisReadyCount: 1 } });
      expect(incoming.id).toBe("");
    });

    it("rejects a foreign actual MySQL dedupe target before writes even when its prior core is malformed", async () => {
      const sourceId = "dedupe_identity_city_mysql";
      const otherSourceId = "dedupe_identity_other_mysql";
      const at = "2026-10-08T00:00:00.000Z";
      expect(await registerSourcesInMysql(mysql, [sourceId, otherSourceId].map((id) => ({ id, label: id, issuerType: "city", stateCode: "IL",
        jurisdictionLevel: "city", jurisdictionName: "City", fipsCode: "1714000", baseUrl: `https://${id}.example.gov/open-bids`,
        providerFamily: null, cadence: "daily", fetchConfig: {} })), at)).toEqual({ inserted: 2, errors: [] });
      const old = { id: `${sourceId}:old`, source: sourceId, source_bid_id: "old", dedupe_key: `${sourceId}:old`,
        title: "Road repairs", description: "Preserve this city's road reconstruction scope.", issuer_name: "City Agency", issuer_type: "city",
        jurisdiction_level: "city", state_code: "IL", source_url: "https://city.example.gov/bids/old",
        attachments: [{ id: `${sourceId}:file`, name: "Original.pdf", url: "https://city.example.gov/original.pdf" }] };
      const other = { ...old, id: `${otherSourceId}:one`, source: otherSourceId, source_bid_id: "one", dedupe_key: `${otherSourceId}:one`,
        description: "Preserve the other city's road construction scope.", source_url: "https://other.example.gov/bids/one",
        attachments: [{ id: `${otherSourceId}:file`, name: "Original.pdf", url: "https://other.example.gov/original.pdf" }] };
      await importCrawlerJsonRunIntoMysql(mysql, { source: sourceId, runId: randomUUID(), status: "success", startedAt: "2026-10-07T00:00:00.000Z", bids: [old] });
      await importCrawlerJsonRunIntoMysql(mysql, { source: otherSourceId, runId: randomUUID(), status: "success", startedAt: "2026-10-07T00:00:00.000Z", bids: [other] });
      for (const malformed of [false, true]) {
        if (malformed) await mysql.query("UPDATE bids SET title = 'Untitled opportunity' WHERE id = ?", [other.id]);
        const [beforeBids] = await mysql.query("SELECT * FROM bids WHERE id IN (?, ?) ORDER BY id", [old.id, other.id]);
        const [beforeFiles] = await mysql.query("SELECT * FROM bid_attachments WHERE bid_id IN (?, ?) ORDER BY id", [old.id, other.id]);
        const incoming = { ...other, id: `${sourceId}:one`, source: sourceId, description: "Replace this new city's storm sewer and drainage systems.",
          source_url: "https://city.example.gov/bids/one", attachments: [{ id: `${sourceId}:incoming`, name: "New.pdf", url: "https://city.example.gov/new.pdf" }] };
        const run: CrawlerJsonRunPayload = { source: sourceId, runId: randomUUID(), status: "success", startedAt: at, finishedAt: at, bids: [incoming],
          metadata: { sourceIdentity: { id: sourceId, stateCode: "IL", issuerType: "city", jurisdictionLevel: "city" },
            pagination: { complete: true, list_kind: "open" } } };
        expect(await importCrawlerJsonRunIntoMysql(mysql, run)).toEqual({ fetchedCount: 1, insertedCount: 0, updatedCount: 0, logCount: 1 });
        const [afterBids] = await mysql.query("SELECT * FROM bids WHERE id IN (?, ?) ORDER BY id", [old.id, other.id]);
        const [afterFiles] = await mysql.query("SELECT * FROM bid_attachments WHERE bid_id IN (?, ?) ORDER BY id", [old.id, other.id]);
        expect(afterBids).toEqual(beforeBids);
        expect(afterFiles).toEqual(beforeFiles);
        expect(run.metadata).toMatchObject({ pagination: { complete: false, quality_blocked: true }, dataQuality: {
          acceptedCount: 0, quarantinedCount: 1, acceptedIds: [], reconciliation: { observed: 1, accepted: 0, quarantined: 1, balanced: true },
          quarantinedRecords: [{ id: incoming.id, issues: ["source_identity_mismatch:id"], row: incoming }],
        } });
        const report = await createSourceDataQualityReportFromMysql(mysql, new Date(at));
        expect(report.rows.find((row) => row.sourceId === sourceId)).toMatchObject({ contentStatus: "unusable", listCoverage: "partial",
          stored: { bidCount: 1, coreInvalidCount: 0 } });
        expect(report.rows.find((row) => row.sourceId === otherSourceId)).toMatchObject({ stored: { bidCount: 1, coreInvalidCount: Number(malformed) } });
      }
    });

    it("quarantines bad complete-list candidates and reports effective attachments in a real MySQL snapshot", async () => {
      const sourceId = "quality_city_mysql";
      await registerSourcesInMysql(mysql, [{
        id: sourceId, label: "Quality city", issuerType: "city", stateCode: "IL",
        baseUrl: "https://procurement.example.gov/bids", jurisdictionLevel: "city", jurisdictionName: "Quality city", fipsCode: "1714000",
        providerFamily: null, cadence: "daily", fetchConfig: {},
      }], "2026-10-01T00:00:00Z");
      const bid = { ...fixture.local.city.bids![0], source: "Quality city", id: `${sourceId}:1`, source_bid_id: "quality-1", dedupe_key: `${sourceId}:1`,
        title: "Repair QA city bridges", jurisdiction_level: "city", fips_code: "1714000", description: "Repair bridges.", full_description: null,
        attachments: [{ name: "Scope.pdf", url: "https://procurement.example.gov/scope.pdf", archive_status: "archived", storage_path: "/tmp/scope.pdf",
          byte_size: 42, checksum_sha256: "a".repeat(64), content_type: "application/pdf" }],
      };
      const run = { ...fixture.local.city, source: sourceId, runId: randomUUID(), startedAt: "2026-09-29T00:00:00Z", finishedAt: "2026-09-29T00:00:01Z", bids: [bid] };
      await importCrawlerJsonRunIntoMysql(mysql, run);
      await mysql.query("UPDATE bid_attachments SET verified_at = ? WHERE bid_id = ?", ["2026-09-29T00:00:00Z", bid.id]);
      await importCrawlerJsonRunIntoMysql(mysql, { ...run, runId: randomUUID(), bids: [{ ...bid, id: `${sourceId}:2`, source_bid_id: "quality-2", dedupe_key: `${sourceId}:2`, attachments: [] }] });
      await importCrawlerJsonRunIntoMysql(mysql, { ...run, runId: randomUUID(), bids: [{ ...bid, attachments: [] }] });
      const badRun = { ...run, runId: randomUUID(), startedAt: "2026-10-01T00:00:00Z", finishedAt: "2026-10-01T00:00:01Z", bids: [{ ...bid, title: "Untitled opportunity" }], metadata: { pagination: { complete: true, list_kind: "open" } } };
      await importCrawlerJsonRunIntoMysql(mysql, badRun);
      const [saved] = await mysql.query("SELECT title, lifecycle_status, raw_payload FROM bids WHERE id = ?", [bid.id]);
      expect(saved).toEqual([expect.objectContaining({ title: bid.title, lifecycle_status: "open" })]);
      const raw = (saved as Array<{raw_payload: string | Record<string, unknown>}>)[0].raw_payload;
      expect(typeof raw === "string" ? JSON.parse(raw) : raw).toMatchObject({ data_quality: { attachments: { discovered: 1, verified: 1 } } });
      const [other] = await mysql.query("SELECT lifecycle_status FROM bids WHERE id = ?", [`${sourceId}:2`]);
      expect(other).toEqual([expect.objectContaining({ lifecycle_status: "open" })]);
      const report = await createSourceDataQualityReportFromMysql(mysql, new Date("2026-10-01T00:00:00Z"));
      expect(report.readConsistency).toBe("snapshot");
      expect(report.rows.find((row) => row.sourceId === sourceId)).toMatchObject({
        jurisdictionLevel: "city", listCoverage: "partial", contentStatus: "unusable",
        run: { quarantinedCount: 1 }, stored: { bidCount: 2, validBodyCount: 2, attachmentsVerified: 1 },
      });
    });

    it("logs a legitimate date-filtered empty result in real MySQL", async () => {
      const runId = randomUUID();
      await importCrawlerJsonRunIntoMysql(mysql, {
        ...fixture.enriched, runId, bids: [],
        metadata: { dateFilter: { from: "2099-01-01", to: null, kept: 0, dropped: 1, unparsed: 0 } },
      });
      const [rows] = await mysql.query("SELECT status, fetched_count FROM crawler_logs WHERE run_id = ?", [runId]);
      expect(rows).toEqual([expect.objectContaining({ status: "success", fetched_count: 0 })]);
    });

    it("rolls back bid and attachment updates when the final log cannot be inserted", async () => {
      const runId = randomUUID();
      const bid: Record<string, unknown> = { ...fixture.enriched.bids![0], id: "rollback:one", dedupe_key: "rollback:one", source_bid_id: "rollback-one" };
      const initial = { ...fixture.enriched, runId, bids: [bid] };
      await importCrawlerJsonRunIntoMysql(mysql, initial);
      const [before] = await mysql.query("SELECT title FROM bids WHERE id = ?", [bid.id]);
      expect(before).toEqual([expect.objectContaining({ title: bid.title })]);
      const [attachmentsBefore] = await mysql.query("SELECT * FROM bid_attachments WHERE bid_id = ? ORDER BY id", [bid.id]);
      expect(attachmentsBefore).not.toHaveLength(0);
      await expect(importCrawlerJsonRunIntoMysql(mysql, {
        ...initial, bids: [{ ...bid, title: "Must roll back", attachments: [
          ...(bid.attachments as Record<string, unknown>[]).map((attachment) => ({ ...attachment, name: "Changed within failed transaction" })),
          { id: "rollback:extra", name: "Must disappear", url: "https://example.invalid/rollback-only.pdf" },
        ] }],
      })).rejects.toThrow();
      const [after] = await mysql.query("SELECT title FROM bids WHERE id = ?", [bid.id]);
      expect(after).toEqual(before);
      const [attachmentsAfter] = await mysql.query("SELECT * FROM bid_attachments WHERE bid_id = ? ORDER BY id", [bid.id]);
      expect(attachmentsAfter).toEqual(attachmentsBefore);
      const [failures] = await mysql.query("SELECT error_code FROM crawler_logs WHERE run_id = ? AND status = 'failure'", [runId]);
      expect(failures).toEqual([expect.objectContaining({ error_code: "CrawlerPersistenceError" })]);
    });

    it("uses the stored dedupe-match id for attachment ownership, accepted evidence and delisting", async () => {
      const source = "intake_dedupe";
      const bid = { ...fixture.enriched.bids![0], id: `${source}:stored`, source_bid_id: "dedupe-one", dedupe_key: `${source}:key`, attachments: [] };
      const initial = { ...fixture.enriched, source, runId: randomUUID(), metadata: {}, bids: [bid] };
      await importCrawlerJsonRunIntoMysql(mysql, initial);
      const incoming = { ...initial, runId: randomUUID(), metadata: { pagination: { complete: true, list_kind: "open" } },
        bids: [{ ...bid, id: `${source}:alternate`, title: "Refreshed bridge scope", attachments: [
          { id: `${source}:file`, name: "Scope.pdf", url: "https://example.invalid/intake-dedupe.pdf" },
        ] }] };
      const result = await importCrawlerJsonRunIntoMysql(mysql, incoming);
      expect(result).toMatchObject({ insertedCount: 0, updatedCount: 1, delistedCount: 0 });
      expect(incoming.metadata).toMatchObject({ dataQuality: { acceptedIds: [bid.id] } });
      const [saved] = await mysql.query("SELECT id, title, lifecycle_status FROM bids WHERE dedupe_key = ?", [bid.dedupe_key]);
      expect(saved).toEqual([expect.objectContaining({ id: bid.id, title: "Refreshed bridge scope", lifecycle_status: "open" })]);
      const [files] = await mysql.query("SELECT bid_id FROM bid_attachments WHERE id = ?", [`${source}:file`]);
      expect(files).toEqual([expect.objectContaining({ bid_id: bid.id })]);
    });

    it("rolls back the whole batch on an attachment owned by another bid and logs zero accepted quality in a single-connection pool", async () => {
      const source = "intake_collision";
      const owner = { ...fixture.enriched.bids![0], id: `${source}:owner`, source_bid_id: "collision-owner", dedupe_key: `${source}:owner`,
        attachments: [{ id: `${source}:shared`, name: "Original.pdf", url: "https://example.invalid/intake-owner.pdf" }] };
      const initial = { ...fixture.enriched, source, runId: randomUUID(), metadata: {}, bids: [owner] };
      await importCrawlerJsonRunIntoMysql(mysql, initial);
      const failed = { ...initial, runId: randomUUID(), metadata: structuredClone(initial.metadata), bids: [
        { ...owner, id: `${source}:collateral`, source_bid_id: "collision-collateral", dedupe_key: `${source}:collateral`, attachments: [] },
        { ...owner, id: `${source}:offender`, source_bid_id: "collision-offender", dedupe_key: `${source}:offender`,
          attachments: [{ id: `${source}:shared`, name: "Must never move.pdf", url: "https://example.invalid/intake-offender.pdf" }] },
      ] };
      const metadata = structuredClone(failed.metadata);
      await expect(importCrawlerJsonRunIntoMysql(mysql, failed)).rejects.toMatchObject({ name: "CrawlerPersistenceError", failureLogged: true });
      const [saved] = await mysql.query("SELECT id FROM bids WHERE id LIKE ?", [`${source}:%`]);
      expect(saved).toEqual([expect.objectContaining({ id: owner.id })]);
      const [files] = await mysql.query("SELECT bid_id, name, url FROM bid_attachments WHERE id = ?", [`${source}:shared`]);
      expect(files).toEqual([expect.objectContaining({ bid_id: owner.id, name: "Original.pdf", url: "https://example.invalid/intake-owner.pdf" })]);
      const [logs] = await mysql.query("SELECT status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs WHERE run_id = ?", [failed.runId]);
      expect(logs).toEqual([expect.objectContaining({ status: "failure", fetched_count: 0, inserted_count: 0, updated_count: 0 })]);
      const raw = (logs as Array<{ metadata: string | Record<string, unknown> }>)[0].metadata;
      expect(typeof raw === "string" ? JSON.parse(raw) : raw).toMatchObject({ persistence: { fetchedBeforePersistence: 2 },
        dataQuality: { execution: "failure", acceptedCount: 0, acceptedIds: [], contentStatus: "unknown" } });
      expect(failed.metadata).toEqual(metadata);
    });

    it("requires real MySQL attachments to be reverified after changed bytes and rejects incoming verification for new files", async () => {
      const source = "intake_verified";
      const attachment = { id: `${source}:file`, name: "Scope.pdf", url: "https://example.invalid/intake-verified.pdf", archive_status: "archived",
        storage_path: "scope.pdf", byte_size: 42, checksum_sha256: "a".repeat(64), content_type: "application/pdf", verified_at: "2026-09-29T00:00:00Z" };
      const bid = { ...fixture.enriched.bids![0], id: `${source}:one`, source_bid_id: "verified-one", dedupe_key: `${source}:one`, attachments: [attachment] };
      const initial = { ...fixture.enriched, source, runId: randomUUID(), metadata: {}, bids: [bid] };
      await importCrawlerJsonRunIntoMysql(mysql, initial);
      const [newFiles] = await mysql.query("SELECT verified_at FROM bid_attachments WHERE id = ?", [attachment.id]);
      expect(newFiles).toEqual([expect.objectContaining({ verified_at: null })]);
      await mysql.query("UPDATE bid_attachments SET verified_at = ? WHERE id = ?", [attachment.verified_at, attachment.id]);
      await importCrawlerJsonRunIntoMysql(mysql, { ...initial, runId: randomUUID(), bids: [{ ...bid, attachments: [] }] });
      const [retained] = await mysql.query("SELECT raw_payload FROM bids WHERE id = ?", [bid.id]);
      const retainedRaw = (retained as Array<{ raw_payload: string | Record<string, unknown> }>)[0].raw_payload;
      expect(typeof retainedRaw === "string" ? JSON.parse(retainedRaw) : retainedRaw).toMatchObject({ data_quality: { capabilities: { attachments: true } } });
      await importCrawlerJsonRunIntoMysql(mysql, { ...initial, runId: randomUUID(), bids: [{ ...bid,
        attachments: [{ ...attachment, checksum_sha256: "b".repeat(64) }] }] });
      const [changedFiles] = await mysql.query("SELECT verified_at FROM bid_attachments WHERE id = ?", [attachment.id]);
      expect(changedFiles).toEqual([expect.objectContaining({ verified_at: null })]);
      const [changed] = await mysql.query("SELECT raw_payload FROM bids WHERE id = ?", [bid.id]);
      const raw = (changed as Array<{ raw_payload: string | Record<string, unknown> }>)[0].raw_payload;
      expect(typeof raw === "string" ? JSON.parse(raw) : raw).toMatchObject({ data_quality: { capabilities: { attachments: false }, attachments: { verified: 0 } } });
    });

    it("rolls back a real single-connection MySQL transaction if its lease expires before commit", async () => {
      const runId = randomUUID();
      const source = `lease-${randomUUID()}`;
      await mysql.query("INSERT INTO crawler_locks (source, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)",
        [source, "current-worker", "2026-09-15T10:00:00.000Z", "2026-09-15T10:10:00.000Z"]);
      let checks = 0;
      await expect(importCrawlerJsonRunIntoMysql(mysql, {
        ...fixture.enriched, runId,
        bids: [{ ...fixture.enriched.bids![0], id: "lease:one", dedupe_key: "lease:one", source_bid_id: "lease-one" }],
      }, {
        source, owner: "current-worker",
        now: () => ++checks === 1 ? "2026-09-15T10:00:00.000Z" : "2026-09-15T10:11:00.000Z",
      })).rejects.toMatchObject({ name: "CrawlerLeaseLostError" });
      expect(checks).toBe(2);
      const [bids] = await mysql.query("SELECT id FROM bids WHERE id = 'lease:one'");
      const [attachments] = await mysql.query("SELECT id FROM bid_attachments WHERE bid_id = 'lease:one'");
      expect(bids).toEqual([]);
      expect(attachments).toEqual([]);
      const [logs] = await mysql.query("SELECT status, error_code FROM crawler_logs WHERE run_id = ?", [runId]);
      expect(logs).toEqual([expect.objectContaining({ status: "failure", error_code: "CrawlerLeaseLostError" })]);
    });
  });
});
