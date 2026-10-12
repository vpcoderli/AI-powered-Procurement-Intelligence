import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MysqlCrawlerLockStore } from "@/server/crawler/lock-repository";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "@/server/crawler/mysql-json-importer";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { listAttachmentRepairCandidatesFromMysql } from "./mysql-repository";
import { DEFAULT_ATTACHMENT_POLICY, serializeAttachmentPolicy, type AttachmentPolicy } from "./policy";
import type { ArchiveAttachmentsResponse } from "./python-runner";
import { runAttachmentRepairOnce } from "./repair-service";

const NOW = new Date("2026-10-12T00:00:00.000Z");
const STAMP = "2026-10-01T00:00:00.000Z";

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("attachment repair selection on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  let mysql: ReturnType<typeof createMysqlPool>;

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    mysql = createPool({ uri: url.toString(), connectionLimit: 4 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  beforeEach(async () => {
    for (const table of ["bid_attachments", "bids", "data_sources", "crawler_locks", "crawler_logs"]) {
      await mysql.query(`DELETE FROM ${table}`);
    }
  });

  const source = (id: string, label: string, policy?: Partial<AttachmentPolicy> | string) =>
    mysql.query(
      "INSERT INTO data_sources (id, label, issuer_type, state_code, fetch_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, label, "state", "TX", policy === undefined ? null : typeof policy === "string" ? policy
        : JSON.stringify(serializeAttachmentPolicy({ ...DEFAULT_ATTACHMENT_POLICY, ...policy })), STAMP, STAMP],
    );

  const bid = (id: string, bidSource: string) =>
    mysql.query(
      "INSERT INTO bids (id, source, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, bidSource, id, "Solicitation", "Scope", "Agency", "state", "TX", `https://portal.example.gov/${id}`, STAMP, STAMP, STAMP, STAMP],
    );

  async function attachments(bidId: string, ids: string[], state: { status?: string; kind?: string; next?: string } = {}) {
    for (let start = 0; start < ids.length; start += 1000) {
      const batch = ids.slice(start, start + 1000);
      await mysql.query(
        `INSERT INTO bid_attachments (id, bid_id, name, url, archive_status, failure_kind, next_repair_at, created_at) VALUES ${batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
        batch.flatMap((id) => [id, bidId, "Doc.pdf", `https://portal.example.gov/files/${id}`, state.status ?? "not_archived",
          state.kind ?? null, state.next ?? null, STAMP]),
      );
    }
  }

  const candidateIds = async (options: { limit?: number; maxPerSource?: number } = {}) =>
    (await listAttachmentRepairCandidatesFromMysql(mysql, { now: NOW, ...options })).map((row) => row.id);

  it("gives every source its own window, cuts the run-wide cap evenly and leaves archive-off sources out", async () => {
    await source("sam_gov", "SAM.gov", { maxPerRun: 2 });
    await source("tx_esbd", "Texas ESBD");
    await source("il_bidbuy", "Illinois BidBuy", { archive: false });
    await source("broken", "Broken Portal", "{not json");
    await bid("bid-sam", "SAM.gov");
    await bid("bid-tx", "tx_esbd");
    await bid("bid-il", "Illinois BidBuy");
    await bid("bid-legacy", "legacy portal");
    await bid("bid-broken", "broken");
    await attachments("bid-sam", ["att-sam-1", "att-sam-2", "att-sam-3"]);
    await attachments("bid-sam", ["att-sam-0-missing"], { status: "failed", kind: "archive_missing", next: "2026-10-11T00:00:00.000Z" });
    await attachments("bid-tx", ["att-tx-1", "att-tx-2"]);
    await attachments("bid-il", ["att-il-1"]);
    await attachments("bid-legacy", ["att-legacy-1"]);
    await attachments("bid-broken", ["att-broken-1"]);

    expect((await candidateIds()).sort()).toEqual([
      "att-broken-1", "att-legacy-1", "att-sam-0-missing", "att-sam-1", "att-tx-1", "att-tx-2",
    ]);
    // Every source's first candidate (by source key) before any source's second.
    expect(await candidateIds({ limit: 5 })).toEqual(["att-broken-1", "att-legacy-1", "att-sam-0-missing", "att-tx-1", "att-sam-1"]);
    expect((await candidateIds({ maxPerSource: 1 })).sort()).toEqual(["att-broken-1", "att-legacy-1", "att-sam-0-missing", "att-tx-1"]);

    const rows = await listAttachmentRepairCandidatesFromMysql(mysql, { now: NOW });
    expect(rows.find((row) => row.id === "att-sam-1")).toMatchObject({ bidSource: "SAM.gov", sourceId: "sam_gov", sourceLabel: "SAM.gov" });
    expect(JSON.parse(rows.find((row) => row.id === "att-sam-1")?.fetchConfig ?? "{}")).toMatchObject({ attachments: { max_per_run: 2 } });
    expect(rows.find((row) => row.id === "att-legacy-1")).toMatchObject({ bidSource: "legacy portal", sourceId: null, fetchConfig: null });
  });

  it("keeps a parked or failed link's repair state when a SAM.gov run sends the link again", async () => {
    await source("sam_gov", "SAM.gov");
    const link = (file: string) => `https://sam.gov/api/prod/opps/v3/opportunities/resources/files/${file}/download?api_key=null&token=`;
    const payload = (runId: string): CrawlerJsonRunPayload => ({
      source: "sam_gov", runId, status: "success", startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 5,
      metadata: {}, errorCode: null, errorMessage: null, errorStack: null,
      bids: [{
        id: "sam_gov:abc123", source: "SAM.gov", source_bid_id: "abc123", dedupe_key: "sam_gov:abc123",
        title: "Trail maintenance services", issuer_name: "Department of the Interior", issuer_type: "federal",
        state_code: "US", source_url: "https://sam.gov/opp/abc123/view",
        attachments: ["parked", "failed"].map((file) => ({ name: `${file}.pdf`, url: link(file), original_url: link(file), archive_status: "not_archived" })),
      }],
    });

    expect((await importCrawlerJsonRunIntoMysql(mysql, payload("run-1"))).insertedCount).toBe(1);
    await mysql.query(
      "UPDATE bid_attachments SET archive_status = 'unavailable', archive_error = ?, failure_kind = 'html_response', repair_attempts = 2, next_repair_at = ? WHERE url = ?",
      ["Portal returned an HTML page", "2026-10-11T00:00:00.000Z", link("parked")],
    );
    await mysql.query(
      "UPDATE bid_attachments SET archive_status = 'failed', archive_error = ?, failure_kind = 'http_5xx', repair_attempts = 1, next_repair_at = ? WHERE url = ?",
      ["HTTP 503", "2026-10-12T02:00:00.000Z", link("failed")],
    );

    await importCrawlerJsonRunIntoMysql(mysql, payload("run-2"));

    const [rows] = await mysql.query(
      "SELECT name, archive_status AS archiveStatus, archive_error AS archiveError, failure_kind AS failureKind, repair_attempts AS repairAttempts, next_repair_at AS nextRepairAt FROM bid_attachments ORDER BY name",
    );
    expect(rows).toEqual([
      { name: "failed.pdf", archiveStatus: "failed", archiveError: "HTTP 503", failureKind: "http_5xx", repairAttempts: 1, nextRepairAt: "2026-10-12T02:00:00.000Z" },
      { name: "parked.pdf", archiveStatus: "unavailable", archiveError: "Portal returned an HTML page", failureKind: "html_response", repairAttempts: 2, nextRepairAt: "2026-10-11T00:00:00.000Z" },
    ]);
    // Neither is due: the failed one is still backing off and the parked one waits 30 days.
    expect(await listAttachmentRepairCandidatesFromMysql(mysql, { now: new Date("2026-10-12T01:00:00.000Z") })).toEqual([]);
  });

  it("runs a source that sorts after a 5,001-link SAM.gov backlog in the same worker run", async () => {
    await source("sam_gov", "SAM.gov", { maxPerRun: 3 });
    await source("tx_esbd", "Texas ESBD");
    await bid("bid-sam", "SAM.gov");
    await bid("bid-tx", "Texas ESBD");
    await attachments("bid-sam", Array.from({ length: 5_001 }, (_, index) => `att-sam-${String(index + 1).padStart(5, "0")}`));
    await attachments("bid-tx", ["att-tx"]);

    const archiveRoot = await mkdtemp(path.join(os.tmpdir(), "apsi-repair-mysql-"));
    const drizzleGuard = new Proxy({}, {
      get(_target, property) {
        throw new Error(`MySQL is configured; db.${String(property)} must not be used.`);
      },
    });
    const batches: Array<[string, number]> = [];
    try {
      const result = await runAttachmentRepairOnce({
        database: drizzleGuard as never,
        mysql: mysql as unknown as MysqlCrawlerLockStore,
        owner: "integration-worker",
        now: () => NOW,
        archiveRoot,
        runner: async (request): Promise<ArchiveAttachmentsResponse> => {
          batches.push([request.source.id, request.items.length]);
          return {
            results: request.items.map((item) => ({
              id: item.id, archive_status: "archived" as const, storage_path: `${request.source.id}/${item.id}.pdf`, byte_size: 1024,
              content_type: "application/pdf", checksum_sha256: "a".repeat(64), archive_error: null, failure_kind: null,
              final_url: item.url, fetched_at: NOW.toISOString(), method: "direct",
            })),
            stats: { archived: request.items.length, failed: 0, unavailable: 0, duration_ms: 1 },
          };
        },
      });

      expect(batches).toEqual([["sam_gov", 3], ["tx_esbd", 1]]);
      expect(result).toMatchObject({ status: "success", candidates: 4, repaired: 4, skipped: 0 });
      const [archived] = await mysql.query("SELECT id FROM bid_attachments WHERE archive_status = 'archived' ORDER BY id");
      expect((archived as Array<{ id: string }>).map((row) => row.id)).toEqual(["att-sam-00001", "att-sam-00002", "att-sam-00003", "att-tx"]);
      const [logs] = await mysql.query("SELECT source, status, fetched_count AS fetchedCount FROM crawler_logs");
      expect(logs).toEqual([{ source: "attachment_repair", status: "success", fetchedCount: 4 }]);
      const [locks] = await mysql.query("SELECT source FROM crawler_locks");
      expect(locks).toEqual([]);
    } finally {
      await rm(archiveRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
