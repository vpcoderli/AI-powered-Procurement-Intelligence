/**
 * MySQL parity for the data-integrity acceptance suite: the deadline sweep, both data migrations (through the
 * MySQL migration path), the demo purge and the integrity report. Every scenario is seeded identically on a
 * throwaway MySQL database and on a temporary SQLite database with the shared seed module, and the two results are
 * compared row by row, besides the requirement-level assertions.
 *
 * Guarded by CRAWLER_INTEGRATION_MYSQL_URL (a root-level URL, no schema). Creates and drops a random database.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createPool, type Pool } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sweepExpiredBids } from "@/server/bids/lifecycle-sweep";
import { queryBidsFromDatabase, queryBidsFromMysql } from "@/server/bids/service";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { findDemoBids, planDemoPurge, purgeDemoBids } from "@/server/integrity/demo-purge";
import {
  BID_GRAPH_RELATIONSHIPS,
  DIRECT_BID_CHILD_TABLES,
  INDIRECT_BID_CHILD_TABLES,
  INTEGRITY_LEVELS,
  NY_MARKER,
  OBSERVED_AT_MS,
  SWEEP_DATES_FOR_WALL_CLOCK,
  seedDemoPurgeScenario,
  seedIntegrityScenario,
  seedMigrationScenario,
  seedSweepScenario,
  type SqlRunner,
} from "./data-integrity.acceptance.seed";

const FRONTEND_DIR = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPTS = { purge: "scripts/purge-demo-bids.ts", integrity: "scripts/data-integrity.ts", sweep: "scripts/sweep-bid-lifecycle.ts" };

type Row = Record<string, unknown>;

const RESET_TABLES = [
  ...INDIRECT_BID_CHILD_TABLES,
  ...DIRECT_BID_CHILD_TABLES,
  "knowledge_items", "bids", "sourcing_partners", "data_sources", "organizations", "sessions", "users",
];

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function rawPayloadOf(row: Row | undefined): Row | null {
  if (!row || typeof row.raw_payload !== "string") return null;
  const parsed = parseJson(row.raw_payload);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Row) : null;
}

/** A bids row reduced to dialect-neutral values: numbers as numbers, raw_payload as parsed JSON when it is JSON. */
function comparable(row: Row | undefined): Row | undefined {
  if (!row) return undefined;
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "raw_payload") {
      const parsed = typeof value === "string" ? parseJson(value) : undefined;
      out[key] = parsed === undefined ? value : parsed;
    } else if (key === "is_active" || key === "amount_min" || key === "amount_max") {
      out[key] = value === null ? null : Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function findKey(node: unknown, key: string, depth = 0): unknown {
  if (!node || typeof node !== "object" || depth > 12) return undefined;
  if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, key)) return (node as Row)[key];
  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const found = findKey(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function levelRecord(report: unknown, level: string, depth = 0): Row | undefined {
  if (!report || typeof report !== "object" || depth > 8) return undefined;
  if (Array.isArray(report)) {
    const entry = report.find((item) => item && typeof item === "object" && (item as Row).level === level);
    if (entry) return entry as Row;
    for (const item of report) {
      const found = levelRecord(item, level, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const direct = (report as Row)[level];
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct as Row;
  for (const value of Object.values(report as Row)) {
    const found = levelRecord(value, level, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function runScript(script: string, args: string[], env: Record<string, string | undefined>) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.DATABASE_URL;
  delete childEnv.MYSQL_DATABASE_URL;
  delete childEnv.DATABASE_PATH;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], { cwd: FRONTEND_DIR, env: childEnv, encoding: "utf8", timeout: 180_000 });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("data-integrity acceptance: MySQL parity", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  let mysql: Pool;
  let databaseUrl: string;
  let password: string;
  let sqlite: TestDatabase;

  const mysqlRun: SqlRunner = async (sql, params = []) => {
    await mysql.query(sql, params);
  };
  const sqliteRun = (client: Database.Database): SqlRunner => (sql, params = []) => client.prepare(sql).run(...(params as never[]));

  async function mysqlRows(sql: string, params: unknown[] = []): Promise<Row[]> {
    const [rows] = await mysql.query(sql, params);
    return rows as Row[];
  }
  async function mysqlBid(id: string): Promise<Row | undefined> {
    return (await mysqlRows("SELECT * FROM bids WHERE id = ?", [id]))[0];
  }
  async function mysqlCount(sql: string, params: unknown[] = []): Promise<number> {
    return Number((await mysqlRows(sql, params))[0].n);
  }
  async function mysqlAllBids(): Promise<Map<string, Row>> {
    const rows = await mysqlRows("SELECT * FROM bids ORDER BY id");
    return new Map(rows.map((row) => [row.id as string, comparable(row)!]));
  }
  function sqliteAllBids(client: Database.Database): Map<string, Row> {
    const rows = client.prepare("SELECT * FROM bids ORDER BY id").all() as Row[];
    return new Map(rows.map((row) => [row.id as string, comparable(row)!]));
  }
  async function resetMysql() {
    for (const table of RESET_TABLES) await mysql.query(`DELETE FROM ${table}`);
  }
  async function orphanCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const rel of BID_GRAPH_RELATIONSHIPS) {
      out[`${rel.table}.${rel.column}`] = await mysqlCount(
        `SELECT count(*) AS n FROM ${rel.table} c LEFT JOIN ${rel.parent} p ON p.id = c.${rel.column} WHERE c.${rel.column} IS NOT NULL AND p.id IS NULL`,
      );
    }
    return out;
  }

  beforeAll(async () => {
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    password = url.password;
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    mysql = createPool({ uri: databaseUrl, connectionLimit: 4 });
    await runMysqlMigrations(mysql);
  }, 120_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await resetMysql();
    sqlite = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await sqlite.cleanup();
  });

  it("deadline sweep: closes the same rows with the same stamps on MySQL as on SQLite; dry run writes nothing; second run is a no-op", async () => {
    const expected = await seedSweepScenario(mysqlRun);
    await seedSweepScenario(sqliteRun(sqlite.db.$client));
    const before = await mysqlAllBids();

    const dry = await sweepExpiredBids({ mysql }, { now: new Date(OBSERVED_AT_MS), dryRun: true });
    expect(dry.closed).toBe(expected.closes.length);
    expect(await mysqlAllBids()).toEqual(before);

    const mysqlResult = await sweepExpiredBids({ mysql }, { now: new Date(OBSERVED_AT_MS), batchSize: 3 });
    const sqliteResult = await sweepExpiredBids({ database: sqlite.db }, { now: new Date(OBSERVED_AT_MS), batchSize: 3 });
    expect(mysqlResult).toEqual(sqliteResult);
    expect(mysqlResult.closed).toBe(expected.closes.length);
    expect(mysqlResult.unparseable).toBe(expected.unparseable);
    expect(mysqlResult.scanned).toBe(expected.scanned);
    expect(mysqlResult.closedByIssuerType).toEqual(expected.closedByIssuerType);

    const after = await mysqlAllBids();
    for (const close of expected.closes) {
      const row = after.get(close.id)!;
      expect(row.lifecycle_status, close.id).toBe("closed");
      expect(row.is_active, close.id).toBe(0);
      if (close.stampable) {
        expect((row.raw_payload as Row).lifecycle, close.id).toEqual({
          earlier: "note", closed_reason: "deadline_passed", closed_observed_at: new Date(OBSERVED_AT_MS).toISOString(), deadline: close.deadline,
        });
      } else {
        expect(row.raw_payload, close.id).toEqual(close.rawPayloadBefore === null ? null : (parseJson(close.rawPayloadBefore) ?? close.rawPayloadBefore));
      }
    }
    for (const id of expected.untouched) expect(after.get(id), id).toEqual(before.get(id));
    for (const row of after.values()) expect(row.is_active, row.id as string).toBe(row.lifecycle_status === "open" ? 1 : 0);

    // Row-level parity with SQLite on the columns the sweep touches.
    const sqliteAfter = sqliteAllBids(sqlite.db.$client);
    for (const [id, row] of after) {
      const twin = sqliteAfter.get(id)!;
      expect({ s: row.lifecycle_status, a: row.is_active, p: row.raw_payload }, id).toEqual({ s: twin.lifecycle_status, a: twin.is_active, p: twin.raw_payload });
    }

    const again = await sweepExpiredBids({ mysql }, { now: new Date(OBSERVED_AT_MS) });
    expect(again.closed).toBe(0);
    expect(await mysqlAllBids()).toEqual(after);
  }, 120_000);

  it("sweep CLI against MySQL: --dry-run --json reports without writing and names a redacted target", async () => {
    const expected = await seedSweepScenario(mysqlRun, SWEEP_DATES_FOR_WALL_CLOCK);
    const result = runScript(SCRIPTS.sweep, ["--dry-run", "--json"], { DATABASE_URL: databaseUrl });
    expect(result.code, result.stderr).toBe(0);
    const document = parseJson(result.stdout) as Row;
    expect(document.dryRun).toBe(true);
    expect(document.closed).toBe(expected.closes.length);
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(await mysqlCount("SELECT count(*) AS n FROM bids WHERE lifecycle_status = 'closed'")).toBe(4);
  }, 180_000);

  it("data migrations through runMysqlMigrations: FIPS drift corrected, NY rows re-keyed / deleted / skipped exactly as on SQLite, idempotent", async () => {
    const expected = await seedMigrationScenario(mysqlRun);
    await seedMigrationScenario(sqliteRun(sqlite.db.$client));
    const before = await mysqlAllBids();

    await runMysqlMigrations(mysql);
    runMigrations(sqlite.db);

    for (const drift of expected.driftCorrected) {
      const row = await mysqlBid(drift.id);
      expect(row?.issuer_type, drift.id).toBe(drift.level);
      expect(row?.fips_code, drift.id).toBe(drift.fips);
      const payloadBefore = drift.rawPayloadBefore === null ? null : parseJson(drift.rawPayloadBefore);
      if (payloadBefore && typeof payloadBefore === "object" && !Array.isArray(payloadBefore)) {
        expect(rawPayloadOf(row)?.legacy_fips_code, drift.id).toBe(drift.legacyFips);
        expect(rawPayloadOf(row)?.k, drift.id).toBe((payloadBefore as Row).k);
      } else {
        expect(row?.raw_payload, drift.id).toBe(drift.rawPayloadBefore);
      }
    }
    for (const rekey of expected.rekeyed) {
      expect(await mysqlBid(rekey.oldId), rekey.oldId).toBeUndefined();
      const row = (await mysqlBid(rekey.newId))!;
      expect(row, rekey.newId).toBeDefined();
      expect(row.dedupe_key).toBe(rekey.newId);
      expect(row.source_bid_id).toBe(rekey.sourceBidId);
      expect(row.issuer_name).toBe(rekey.issuerName);
      expect(row.title).toBe(rekey.title);
      expect(row.description).toBe(rekey.description);
      if (rekey.fullDescriptionBlank) expect(row.full_description == null || row.full_description === "", `${rekey.newId} blank`).toBe(true);
      else expect(row.full_description).toBe(rekey.fullDescription);
      const payload = rawPayloadOf(row)!;
      expect(payload.data_quality, rekey.newId).toBeUndefined();
      expect(payload.contractor_company, rekey.newId).toBe(rekey.company);
      // Soft, so the row-level parity checks below still report when the stamp is missing.
      expect.soft(payload.subcontracting, `${rekey.newId} subcontracting stamped`).toBeTypeOf("boolean");
      if (rekey.markerInOldTitle) expect(payload.subcontracting, rekey.newId).toBe(true);
      expect(payload).toMatchObject(rekey.rawKeep);
      expect(row.title).not.toContain(NY_MARKER);
    }
    for (const duplicate of expected.deletedDuplicates) {
      expect(await mysqlBid(duplicate.oldId), duplicate.oldId).toBeUndefined();
      expect(comparable(await mysqlBid(duplicate.twinId)), duplicate.twinId).toEqual(before.get(duplicate.twinId));
    }
    for (const id of [...expected.skippedMalformed, ...expected.untouched]) {
      expect(comparable(await mysqlBid(id)), id).toEqual(before.get(id));
    }

    // Row-level parity with the SQLite migration on every bids column.
    const mysqlAfter = await mysqlAllBids();
    const sqliteAfter = sqliteAllBids(sqlite.db.$client);
    expect([...mysqlAfter.keys()].sort()).toEqual([...sqliteAfter.keys()].sort());
    for (const [id, row] of mysqlAfter) {
      const twin = { ...sqliteAfter.get(id)! };
      const mine = { ...row };
      // "blank" may legitimately be NULL on one dialect and "" on the other; everything else must match exactly.
      if ((mine.full_description ?? "") === "" && (twin.full_description ?? "") === "") {
        delete mine.full_description;
        delete twin.full_description;
      }
      expect(mine, id).toEqual(twin);
    }

    await runMysqlMigrations(mysql);
    expect(await mysqlAllBids()).toEqual(mysqlAfter);
  }, 180_000);

  it("demo purge: plan and apply match SQLite exactly, dependents go, links detach, zero orphans on every relationship, second apply is a no-op", async () => {
    const expected = await seedDemoPurgeScenario(mysqlRun);
    await seedDemoPurgeScenario(sqliteRun(sqlite.db.$client));

    const mysqlFound = await findDemoBids({ mysql });
    expect(mysqlFound.map((bid) => bid.id).sort()).toEqual([...expected.demoBidIds].sort());

    const mysqlPlan = await planDemoPurge({ mysql });
    const sqlitePlan = await planDemoPurge({ database: sqlite.db });
    const sortBids = <T extends { bids: Array<{ id: string }> }>(plan: T) => ({ ...plan, bids: [...plan.bids].sort((a, b) => a.id.localeCompare(b.id)) });
    expect(sortBids(mysqlPlan)).toEqual(sortBids(sqlitePlan));
    for (const [table, n] of Object.entries(expected.dependentsPerTable)) expect(mysqlPlan.dependents[table], table).toBe(n);
    expect(mysqlPlan.knowledgeItemsToDetach).toBe(expected.knowledgeItemsDetached.length);
    expect(await mysqlCount("SELECT count(*) AS n FROM bids")).toBe(expected.demoBidIds.length + expected.keepBidIds.length);

    const allTables = [...DIRECT_BID_CHILD_TABLES, ...INDIRECT_BID_CHILD_TABLES, "knowledge_items"];
    const countsBefore: Record<string, number> = {};
    for (const table of allTables) countsBefore[table] = await mysqlCount(`SELECT count(*) AS n FROM ${table}`);

    const mysqlResult = await purgeDemoBids({ mysql }, { apply: true });
    const sqliteResult = await purgeDemoBids({ database: sqlite.db }, { apply: true });
    expect(mysqlResult.applied).toBe(true);
    expect(mysqlResult.deleted).toEqual(sqliteResult.deleted);
    expect(mysqlResult.detached).toEqual(sqliteResult.detached);
    expect(mysqlResult.deleted.bids).toBe(expected.demoBidIds.length);

    const placeholders = expected.demoBidIds.map(() => "?").join(", ");
    for (const id of expected.demoBidIds) expect(await mysqlBid(id), id).toBeUndefined();
    for (const table of DIRECT_BID_CHILD_TABLES) {
      expect(await mysqlCount(`SELECT count(*) AS n FROM ${table} WHERE bid_id IN (${placeholders})`, expected.demoBidIds), table).toBe(0);
    }
    for (const table of [...DIRECT_BID_CHILD_TABLES, ...INDIRECT_BID_CHILD_TABLES]) {
      expect(await mysqlCount(`SELECT count(*) AS n FROM ${table}`), table).toBe(countsBefore[table] - expected.demoBidIds.length);
    }
    expect(await mysqlCount("SELECT count(*) AS n FROM knowledge_items")).toBe(countsBefore.knowledge_items);
    for (const id of expected.knowledgeItemsDetached) {
      const [item] = await mysqlRows("SELECT source_bid_id, source_intent_id FROM knowledge_items WHERE id = ?", [id]);
      expect(item, id).toBeDefined();
      expect(item.source_bid_id, id).toBeNull();
      expect(item.source_intent_id, id).toBeNull();
    }
    for (const id of expected.awardOutcomesDetached) {
      const [outcome] = await mysqlRows("SELECT tabulation_artifact_id FROM award_outcomes WHERE id = ?", [id]);
      expect(outcome, id).toBeDefined();
      expect(outcome.tabulation_artifact_id, id).toBeNull();
    }
    for (const id of expected.keepBidIds) expect(await mysqlBid(id), id).toBeDefined();
    const orphans = await orphanCounts();
    expect(Object.values(orphans).every((n) => n === 0), JSON.stringify(orphans)).toBe(true);

    // The MySQL state equals the SQLite state row for row.
    expect(await mysqlAllBids()).toEqual(sqliteAllBids(sqlite.db.$client));

    const again = await purgeDemoBids({ mysql }, { apply: true });
    expect(again.applied).toBe(false);
    expect(Object.values(again.deleted).every((n) => n === 0)).toBe(true);
  }, 180_000);

  it("purge CLI against MySQL: dry run exits 0, prints the redacted target to stderr first, never the password", async () => {
    await seedDemoPurgeScenario(mysqlRun);
    const result = runScript(SCRIPTS.purge, ["--json"], { DATABASE_URL: databaseUrl });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr.trim().split("\n")[0]).toMatch(/mysql/i);
    expect(result.stderr + result.stdout).not.toContain(password);
    expect(parseJson(result.stdout)).toBeDefined();
    expect(await mysqlCount("SELECT count(*) AS n FROM bids")).toBe(13);
  }, 180_000);

  it("data:integrity report on MySQL equals the SQLite report on identical data, and openVisible equals the MySQL search count", async () => {
    const baseNow = Date.now();
    const expected = await seedIntegrityScenario(mysqlRun, baseNow);
    // The SQLite twin is a closed file so the CLI can open it alone.
    const dir = mkdtempSync(path.join(os.tmpdir(), "apsi-acc-mysql-"));
    const file = path.join(dir, "apsi.sqlite");
    try {
      const twin = createDatabase(file);
      runMigrations(twin);
      await seedIntegrityScenario(sqliteRun(twin.$client), baseNow);
      twin.$client.close();

      const searchVisible: Record<string, number> = {};
      for (const level of INTEGRITY_LEVELS) {
        if (level === "other") continue;
        searchVisible[level] = (await queryBidsFromMysql(mysql, { issuerType: level })).total;
      }
      const sqliteDb = createDatabase(file);
      for (const level of INTEGRITY_LEVELS) {
        if (level === "other") continue;
        expect((await queryBidsFromDatabase(sqliteDb, { issuerType: level })).total, `search parity ${level}`).toBe(searchVisible[level]);
      }
      sqliteDb.$client.close();

      const mysqlRun1 = runScript(SCRIPTS.integrity, ["--json"], { DATABASE_URL: databaseUrl });
      expect(mysqlRun1.code, mysqlRun1.stderr).toBe(0);
      expect(mysqlRun1.stderr + mysqlRun1.stdout).not.toContain(password);
      const mysqlReport = parseJson(mysqlRun1.stdout);
      expect(mysqlReport, "stdout must be exactly one JSON document").toBeDefined();

      const sqliteRun1 = runScript(SCRIPTS.integrity, ["--json"], { DATABASE_PATH: file });
      expect(sqliteRun1.code, sqliteRun1.stderr).toBe(0);
      const sqliteReport = parseJson(sqliteRun1.stdout);

      for (const level of INTEGRITY_LEVELS) {
        const mine = levelRecord(mysqlReport, level);
        const theirs = levelRecord(sqliteReport, level);
        expect(mine, `level ${level} on MySQL`).toBeDefined();
        expect(mine, `level ${level} parity`).toEqual(theirs);
        for (const [name, value] of Object.entries(expected.levels[level])) {
          const found = findKey(mine, name);
          expect(found, `${level}.${name}`).toBe(value);
        }
        if (level !== "other") expect(findKey(mine, "openVisible"), `${level}.openVisible == search`).toBe(searchVisible[level]);
      }
      expect(JSON.stringify(findKey(mysqlReport, "malformedNyIds") ?? null)).toContain("2138289");
      expect(findKey(mysqlReport, "malformedNyIds")).toEqual(findKey(sqliteReport, "malformedNyIds"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 240_000);
});
