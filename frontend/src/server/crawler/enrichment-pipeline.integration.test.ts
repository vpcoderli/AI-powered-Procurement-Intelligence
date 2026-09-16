import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { getBidByIdFromMysql, getBidByIdFromRepository } from "@/server/bids/repository";
import { queryBidsFromDatabase, queryBidsFromMysql } from "@/server/bids/service";
import { getBidDescription } from "@/lib/bid-description";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";

interface PipelineFixture {
  enriched: CrawlerJsonRunPayload;
  plain: CrawlerJsonRunPayload;
  scope: string;
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
