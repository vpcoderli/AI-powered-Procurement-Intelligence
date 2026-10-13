/**
 * Independent acceptance tests for the state / county / city data-integrity branch (plan
 * `docs/superpowers/plans/2026-10-13-data-integrity.md`, digest `test-phase-requirements.md`).
 *
 * Black-box: every expected value here is derived from the requirement text, never from the implementation or
 * from the implementers' co-located tests. Where the CLI contract is the requirement, the scripts are spawned
 * through `node --import tsx`. Offline only: SQLite and pure functions.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEADLINE_ZONE_OFFSET_MINUTES, bidDeadlineExpiresAtMs, bidDeadlinePassed, parseBidDeadline } from "@/lib/bid-deadline";
import { sweepExpiredBids } from "@/server/bids/lifecycle-sweep";
import { queryBidsFromDatabase } from "@/server/bids/service";
import type { CrawlerJsonRunPayload } from "@/server/crawler/bid-intake";
import { importCrawlerJsonRunIntoSqlite } from "@/server/crawler/sqlite-json-importer";
import { createCrawlerWorkerTick } from "@/server/crawler/worker-tick";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { buildIntegrityReport } from "@/server/integrity/data-integrity";
import { findDemoBids, planDemoPurge, purgeDemoBids } from "@/server/integrity/demo-purge";
import {
  BID_GRAPH_RELATIONSHIPS,
  DIRECT_BID_CHILD_TABLES,
  INDIRECT_BID_CHILD_TABLES,
  INTEGRITY_LEVELS,
  NY_MARKER,
  OBSERVED_AT,
  OBSERVED_AT_MS,
  SWEEP_DATES_FOR_WALL_CLOCK,
  SWEEP_LEVELS,
  attachDependents,
  seedBids,
  seedDemoPurgeScenario,
  seedIntegrityScenario,
  seedMigrationScenario,
  seedSources,
  seedSweepScenario,
  type SqlRunner,
} from "./data-integrity.acceptance.seed";

const FRONTEND_DIR = fileURLToPath(new URL("../../", import.meta.url));
const REPO_ROOT = path.resolve(FRONTEND_DIR, "..");
const SCRIPTS = {
  purge: "scripts/purge-demo-bids.ts",
  sweep: "scripts/sweep-bid-lifecycle.ts",
  integrity: "scripts/data-integrity.ts",
};

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

function runScript(script: string, args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  // Offline SQLite runs: a stray MySQL URL in the parent environment must never redirect the child.
  delete childEnv.DATABASE_URL;
  delete childEnv.MYSQL_DATABASE_URL;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: FRONTEND_DIR,
    env: childEnv,
    encoding: "utf8",
    timeout: 180_000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", signal: result.signal };
}

const sqliteRunner = (client: Database.Database): SqlRunner => (sql, params = []) => client.prepare(sql).run(...(params as never[]));

interface ClosedSqlite<T> {
  dir: string;
  file: string;
  seeded: T;
  open: () => Database.Database;
  cleanup: () => void;
}

/** A migrated SQLite file, seeded and then closed, so a spawned script can open it alone. */
async function createClosedSqlite<T>(seed: (run: SqlRunner) => Promise<T>): Promise<ClosedSqlite<T>> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "apsi-acc-"));
  const file = path.join(dir, "apsi.sqlite");
  const db = createDatabase(file);
  runMigrations(db);
  const seeded = await seed(sqliteRunner(db.$client));
  db.$client.close();
  return {
    dir,
    file,
    seeded,
    open: () => new Database(file),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function fileSha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

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

function allBidRows(client: Database.Database): Map<string, Row> {
  const rows = client.prepare("SELECT * FROM bids ORDER BY id").all() as Row[];
  return new Map(rows.map((row) => [row.id as string, row]));
}

function bidRow(client: Database.Database, id: string): Row | undefined {
  return client.prepare("SELECT * FROM bids WHERE id = ?").get(id) as Row | undefined;
}

function count(client: Database.Database, sql: string, params: unknown[] = []): number {
  return Number((client.prepare(sql).get(...(params as never[])) as { n: number }).n);
}

/** Depth-first search for the first value stored under `key` anywhere in a JSON document. */
function findKey(node: unknown, key: string, depth = 0): unknown {
  if (!node || typeof node !== "object" || depth > 12) return undefined;
  if (!Array.isArray(node) && Object.prototype.hasOwnProperty.call(node, key)) return (node as Row)[key];
  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const found = findKey(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The digest fixes the per-level metric names but not where the per-level record sits in the document, so the
 * record is located by its level name: an object stored under the level key, or an array entry whose `level`
 * field names it.
 */
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

function metric(record: Row | undefined, name: string): number | undefined {
  const value = findKey(record, name);
  return typeof value === "number" ? value : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Task 1a — deadline parser (pure)
// ---------------------------------------------------------------------------------------------------------------

/** A UTC-10 wall-clock instant. */
const wall = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, m - 1, d, h, mi, s, ms) + 10 * 3_600_000;
/** The end of the stated day D: D+1 00:00 in UTC-10. */
const eod = (y: number, m: number, d: number) => wall(y, m, d + 1);
const MINUTE = 60_000;
const FAR_FUTURE = Date.UTC(2200, 0, 1);

describe("Task 1 — deadline parser: every rule at both edges of expiry", () => {
  it("fixes the deadline zone at UTC-10", () => {
    expect(DEADLINE_ZONE_OFFSET_MINUTES).toBe(-600);
  });

  const exactMidnightEpoch = String(Date.UTC(2026, 9, 14, 4)); // 00:00:00 at UTC-4 on 2026-10-14
  const exactEndOfDayEpoch = String(Date.UTC(2026, 9, 14, 6, 59, 59)); // 23:59:59 at UTC-7 on 2026-10-13
  const plainEpochMs = Date.UTC(2026, 9, 14, 13, 30); // no US offset reads midnight or 23:59:59 here

  const expiring: Array<[rule: string, text: string, expiresAt: number]> = [
    // Date-only forms: the whole stated day.
    ["date-only ISO", "2026-10-12", eod(2026, 10, 12)],
    ["date-only US", "10/12/2026", eod(2026, 10, 12)],
    ["date-only US, single digits", "4/16/2026", eod(2026, 4, 16)],
    ["date-only US, two-digit year", "05/31/26", eod(2026, 5, 31)],
    ["date-only month name", "Oct 12, 2026", eod(2026, 10, 12)],
    ["date-only month name, no comma", "October 12 2026", eod(2026, 10, 12)],
    ["date-only abbreviated month with period", "Sept. 3, 2026", eod(2026, 9, 3)],
    ["date-only leap day", "2028-02-29", eod(2028, 2, 29)],
    ["date-only at the start of the window", "2000-01-01", eod(2000, 1, 1)],
    ["date-only at the end of the window", "2100-12-31", eod(2100, 12, 31)],
    // Offsetless times are UTC-10 wall clocks.
    ["US time with meridiem and ignored zone word", "10/13/2026 2:00 PM CST", wall(2026, 10, 13, 14)],
    ["US time with meridiem, AM", "10/13/2026 2:00 AM", wall(2026, 10, 13, 2)],
    ["US time with meridiem and zone word ET", "10/13/2026 4:30 PM ET", wall(2026, 10, 13, 16, 30)],
    ["ISO time without zone", "2026-10-13T14:00", wall(2026, 10, 13, 14)],
    ["ISO time with space and seconds, no zone", "2026-10-13 14:00:30", wall(2026, 10, 13, 14, 0, 30)],
    ["ISO fraction without zone is honoured", "2026-10-13T14:00:00.250", wall(2026, 10, 13, 14, 0, 0, 250)],
    ["month-name time with @", "Aug 21, 2026 @ 02:00 PM", wall(2026, 8, 21, 14)],
    ["month-name time with AM", "Dec 1, 2026 @ 10:00 AM", wall(2026, 12, 1, 10)],
    ["24-hour US time past noon is literal", "10/12/2026 13:00", wall(2026, 10, 12, 13)],
    ["explicit noon PM", "10/13/2026 12:00 PM", wall(2026, 10, 13, 12)],
    ["12:30 without meridiem stays 12:30", "10/13/2026 12:30", wall(2026, 10, 13, 12, 30)],
    ["hour 0 is literal", "10/13/2026 0:30", wall(2026, 10, 13, 0, 30)],
    // Separators between date and time.
    ["'at' separator", "6/3/2026 at 2:00PM", wall(2026, 6, 3, 14)],
    ["'@' separator, US form", "6/3/2026 @ 2:00 PM", wall(2026, 6, 3, 14)],
    ["'at' separator, month name", "Aug 21, 2026 at 02:00 PM", wall(2026, 8, 21, 14)],
    // 1-11 o'clock without AM/PM reads as PM.
    ["AM/PM-less 2:00 reads as 14:00", "10/13/2026 2:00", wall(2026, 10, 13, 14)],
    ["AM/PM-less 11:59 reads as 23:59", "10/13/2026 11:59", wall(2026, 10, 13, 23, 59)],
    ["AM/PM-less 1:00:30 reads as 13:00:30", "10/13/2026 1:00:30", wall(2026, 10, 13, 13, 0, 30)],
    ["AM/PM-less two-digit 09:00 reads as 21:00", "10/13/2026 09:00", wall(2026, 10, 13, 21)],
    ["AM/PM-less month-name 9:30 reads as 21:30", "Oct 13, 2026 9:30", wall(2026, 10, 13, 21, 30)],
    ["AM/PM-less month-name with @", "Oct 13, 2026 @ 3:00", wall(2026, 10, 13, 15)],
    ["AM/PM-less with 'at'", "6/3/2026 at 2:00", wall(2026, 6, 3, 14)],
    ["ISO one-digit hour 9 reads as 21:00", "2026-10-13T9:00", wall(2026, 10, 13, 21)],
    ["ISO one-digit hour 1 with space reads as 13:15", "2026-10-13 1:15", wall(2026, 10, 13, 13, 15)],
    ["ISO two-digit 09:00 is literal", "2026-10-13T09:00", wall(2026, 10, 13, 9)],
    // Whole stated day: exact midnights and bare 12:00.
    ["12:00 AM is the whole day", "10/13/2026 12:00 AM", eod(2026, 10, 13)],
    ["month-name 12:00 AM is the whole day", "Oct 13, 2026 12:00 AM", eod(2026, 10, 13)],
    ["US 00:00 is the whole day", "10/13/2026 00:00", eod(2026, 10, 13)],
    ["ISO T00:00:00 is the whole day", "2026-10-13T00:00:00", eod(2026, 10, 13)],
    ["ISO ' 00:00' is the whole day", "2026-10-13 00:00", eod(2026, 10, 13)],
    ["ISO T00:00:00Z is the whole day as written", "2026-10-13T00:00:00Z", eod(2026, 10, 13)],
    ["bare 12:00 is the whole day", "10/13/2026 12:00", eod(2026, 10, 13)],
    ["bare 12:00:00 is the whole day", "10/13/2026 12:00:00", eod(2026, 10, 13)],
    ["bare month-name 12:00 is the whole day", "Oct 13, 2026 12:00", eod(2026, 10, 13)],
    // Digest C-2: the bare-12:00 whole-day rule covers the 12-hour US and month-name forms only; an ISO two-digit
    // T12:00 is 24-hour noon, an offsetless UTC-10 wall clock.
    ["ISO two-digit 12:00 is noon (C-2)", "2026-10-13T12:00", wall(2026, 10, 13, 12)],
    ["ISO two-digit 12:00:00 is noon (C-2)", "2026-10-13 12:00:00", wall(2026, 10, 13, 12)],
    // 24:00 is D+1 00:00, the end of D.
    ["ISO 24:00", "2026-10-13T24:00", eod(2026, 10, 13)],
    ["ISO 24:00:00 with space", "2026-10-13 24:00:00", eod(2026, 10, 13)],
    ["US 24:00", "10/13/2026 24:00", eod(2026, 10, 13)],
    // Explicit zones are exact.
    ["ISO Z exact", "2026-10-13T11:59:59Z", Date.UTC(2026, 9, 13, 11, 59, 59)],
    ["ISO Z exact, one second past", "2026-10-13T12:00:01Z", Date.UTC(2026, 9, 13, 12, 0, 1)],
    ["ISO negative offset exact", "2026-10-13T08:00:00-05:00", Date.UTC(2026, 9, 13, 13)],
    ["ISO positive offset without colon exact", "2026-10-13T08:30:00+0200", Date.UTC(2026, 9, 13, 6, 30)],
    // 06:00Z is 00:00:00 at UTC-6, so the round-5 exact-instant rule makes it the whole day of 2026-10-13.
    ["ISO positive offset without colon at a US local midnight is that whole day", "2026-10-13T08:00:00+0200", eod(2026, 10, 13)],
    ["ISO Z fraction honoured", "2026-10-13T11:59:59.500Z", Date.UTC(2026, 9, 13, 11, 59, 59, 500)],
    // Round-5 exact-instant rulings.
    ["ISO Z that is 00:00:00 at UTC-4 is that whole day", "2026-10-14T04:00:00Z", eod(2026, 10, 14)],
    ["ISO offset 00:00:00 is that whole day", "2026-10-14T00:00:00-04:00", eod(2026, 10, 14)],
    ["ISO Z that is 23:59:59 at UTC-4 is that whole day", "2026-10-14T03:59:59Z", eod(2026, 10, 13)],
    ["zoned ISO 23:59:59 expires at the end of its stated date", "2026-10-13T23:59:59-07:00", eod(2026, 10, 13)],
    ["zoned ISO 23:59:59Z expires at the end of its stated date", "2026-10-13T23:59:59Z", eod(2026, 10, 13)],
    ["epoch ms exact", String(plainEpochMs), plainEpochMs],
    ["epoch seconds exact", String(plainEpochMs / 1000), plainEpochMs],
    ["epoch ms at a US local midnight is that whole day", exactMidnightEpoch, eod(2026, 10, 14)],
    ["epoch ms at a US local 23:59:59 is that whole day", exactEndOfDayEpoch, eod(2026, 10, 13)],
    // .NET
    [".NET bare", "/Date(1893456000000)/", Date.UTC(2030, 0, 1)],
    [".NET with negative offset is the stated ms", `/Date(${plainEpochMs}-0500)/`, plainEpochMs],
    [".NET with positive offset is the stated ms", `/Date(${plainEpochMs}+0000)/`, plainEpochMs],
    [".NET at a US local midnight is that whole day", `/Date(${Date.UTC(2026, 9, 14, 5)}-0500)/`, eod(2026, 10, 14)],
  ];

  it.each(expiring)("%s: %s expires at the ruled instant, not a minute earlier", (_rule, text, expiresAt) => {
    expect(parseBidDeadline(text)).not.toBeNull();
    expect(bidDeadlineExpiresAtMs(text)).toBe(expiresAt);
    expect(bidDeadlinePassed(text, expiresAt - MINUTE)).toBe(false);
    expect(bidDeadlinePassed(text, expiresAt)).toBe(true);
    expect(bidDeadlinePassed(text, expiresAt + MINUTE)).toBe(true);
  });

  const neverExpires: Array<[rule: string, text: string | null | undefined]> = [
    ["empty", ""],
    ["whitespace", "   "],
    ["null", null],
    ["undefined", undefined],
    ["words", "Not Available"],
    ["TBD", "TBD"],
    ["impossible day", "02/30/2026"],
    ["impossible month", "13/01/2026"],
    ["non-leap February 29", "2026-02-29"],
    ["hour 25", "10/12/2026 25:00"],
    ["13:00 PM", "10/12/2026 13:00 PM"],
    ["minute 60", "10/12/2026 12:60"],
    ["ISO month 13", "2026-13-01"],
    ["unknown month word", "Foo 1, 2026"],
    ["US year before 2000", "12/31/1999"],
    ["ISO year before 2000", "1999-12-31"],
    ["ISO year after 2100", "2101-01-01"],
    ["US year after 2100", "01/01/2101"],
    ["month-name year after 2100", "Jan 1, 2101"],
    ["month-name year before 2000", "Dec 31, 1999"],
    ["zoned ISO year before 2000", "1999-12-31T23:59:59Z"],
    ["zoned ISO year after 2100", "2101-01-01T00:00:00Z"],
    ["epoch seconds in 1999", "0946684799"],
    ["epoch ms in 1999", "0946684799000"],
    ["epoch ms in 2101", "4133980800000"],
    [".NET in 1999", "/Date(946684799000)/"],
    [".NET in 2101", "/Date(4133980800000)/"],
    [".NET with offset in 1999", "/Date(946684799000-0500)/"],
  ];

  it.each(neverExpires)("never expires: %s (%s)", (_rule, text) => {
    expect(parseBidDeadline(text)).toBeNull();
    expect(bidDeadlineExpiresAtMs(text)).toBeNull();
    expect(bidDeadlinePassed(text, FAR_FUTURE)).toBe(false);
  });

  it("reports date-only parses as dateOnly with the start of day D in UTC-10", () => {
    expect(parseBidDeadline("10/12/2026")).toEqual({ instantMs: wall(2026, 10, 12), dateOnly: true });
    expect(parseBidDeadline("2026-10-13T14:00")?.dateOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 1b — lifecycle rule at import time (SQLite importer)
// ---------------------------------------------------------------------------------------------------------------

describe("Task 1 — deadline-passed lifecycle at import time", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    await seedSources(sqliteRunner(testDb.db.$client), SWEEP_LEVELS.map((entry) => ({
      id: entry.prefix, issuerType: entry.level, stateCode: entry.stateCode, jurisdictionLevel: entry.jurisdictionLevel, fipsCode: entry.fips,
    })));
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function payload(source: string, runId: string, bids: Row[], extra: Partial<CrawlerJsonRunPayload> = {}): CrawlerJsonRunPayload {
    return {
      source,
      runId,
      status: "success",
      startedAt: "2026-10-13T11:55:00.000Z",
      finishedAt: OBSERVED_AT,
      durationMs: 1000,
      metadata: { mode: "json" },
      bids,
      errorCode: null,
      errorMessage: null,
      errorStack: null,
      ...extra,
    };
  }

  function bid(entry: (typeof SWEEP_LEVELS)[number], suffix: string, extra: Row = {}): Row {
    return {
      id: `${entry.prefix}:${suffix}`,
      source: entry.prefix,
      source_bid_id: suffix,
      dedupe_key: `${entry.prefix}:${suffix}`,
      title: `Imported ${suffix}`,
      description: "A real procurement description for the acceptance run.",
      issuer_name: `${entry.level} issuer`,
      issuer_type: entry.level,
      state_code: entry.stateCode,
      jurisdiction_level: entry.jurisdictionLevel,
      fips_code: entry.fips,
      source_url: `https://example.gov/${entry.prefix}/${suffix}`,
      raw_payload: { portal: "acceptance" },
      first_seen_at: OBSERVED_AT,
      last_seen_at: OBSERVED_AT,
      created_at: OBSERVED_AT,
      updated_at: OBSERVED_AT,
      ...extra,
    };
  }

  it("closes an open row whose deadline has passed, identically for state, county, city and township", () => {
    for (const entry of SWEEP_LEVELS) {
      const result = importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, `run-${entry.level}`, [
        bid(entry, "past", { deadline_date: "10/12/2026" }),
        bid(entry, "future", { deadline_date: "10/13/2026" }),
        bid(entry, "tbd", { deadline_date: "TBD" }),
        bid(entry, "none", { deadline_date: null }),
      ]));
      expect(result.insertedCount).toBe(4);
    }

    for (const entry of SWEEP_LEVELS) {
      const client = testDb.db.$client;
      const past = bidRow(client, `${entry.prefix}:past`)!;
      expect(past.lifecycle_status, entry.level).toBe("closed");
      expect(past.is_active, entry.level).toBe(0);
      expect(rawPayloadOf(past)?.lifecycle, entry.level).toEqual({
        closed_reason: "deadline_passed",
        closed_observed_at: OBSERVED_AT,
        deadline: "10/12/2026",
      });
      expect(rawPayloadOf(past)?.portal).toBe("acceptance");

      for (const suffix of ["future", "tbd", "none"]) {
        const row = bidRow(client, `${entry.prefix}:${suffix}`)!;
        expect(row.lifecycle_status, `${entry.level} ${suffix}`).toBe("open");
        expect(row.is_active, `${entry.level} ${suffix}`).toBe(1);
        expect(rawPayloadOf(row)?.lifecycle, `${entry.level} ${suffix}`).toBeUndefined();
      }
    }

    // is_active always equals lifecycle_status === 'open'.
    const rows = [...allBidRows(testDb.db.$client).values()];
    expect(rows.length).toBe(16);
    for (const row of rows) expect(row.is_active).toBe(row.lifecycle_status === "open" ? 1 : 0);
  });

  it("uses the observation instant exactly: a deadline that expires one second later stays open", () => {
    const entry = SWEEP_LEVELS[1];
    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "edge", [
      bid(entry, "exact", { deadline_date: "2026-10-13T12:00:00Z" }),
      bid(entry, "later", { deadline_date: "2026-10-13T12:00:01Z" }),
    ]));
    expect(bidRow(testDb.db.$client, `${entry.prefix}:exact`)?.lifecycle_status).toBe("closed");
    expect(bidRow(testDb.db.$client, `${entry.prefix}:later`)?.lifecycle_status).toBe("open");
  });

  it("reopens a closed bid when a later import observes a future deadline, with no stale closed_reason", () => {
    const entry = SWEEP_LEVELS[2];
    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "first", [bid(entry, "flip", { deadline_date: "10/12/2026" })]));
    expect(bidRow(testDb.db.$client, `${entry.prefix}:flip`)?.lifecycle_status).toBe("closed");

    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "second", [bid(entry, "flip", { deadline_date: "10/20/2026" })]));
    const row = bidRow(testDb.db.$client, `${entry.prefix}:flip`)!;
    expect(row.lifecycle_status).toBe("open");
    expect(row.is_active).toBe(1);
    expect(row.deadline_date).toBe("10/20/2026");
    expect(rawPayloadOf(row)?.lifecycle).toBeUndefined();
  });

  it("falls back to the stored deadline when the incoming row has none", () => {
    const entry = SWEEP_LEVELS[0];
    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "first", [bid(entry, "fb", { deadline_date: "10/12/2026" })], { finishedAt: "2026-10-01T00:00:00.000Z" }));
    expect(bidRow(testDb.db.$client, `${entry.prefix}:fb`)?.lifecycle_status).toBe("open");

    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "second", [bid(entry, "fb", { deadline_date: null })]));
    const row = bidRow(testDb.db.$client, `${entry.prefix}:fb`)!;
    expect(row.lifecycle_status).toBe("closed");
    expect(rawPayloadOf(row)?.lifecycle).toMatchObject({ closed_reason: "deadline_passed", deadline: "10/12/2026" });
  });

  it("never downgrades an awarded bid, even with a passed deadline", () => {
    const entry = SWEEP_LEVELS[3];
    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "awarded", [
      bid(entry, "won", { deadline_date: "10/12/2026", lifecycle_status: "awarded", awarded_date: "2026-10-05" }),
    ]));
    const row = bidRow(testDb.db.$client, `${entry.prefix}:won`)!;
    expect(row.lifecycle_status).toBe("awarded");
    expect(row.is_active).toBe(0);

    // A later plain re-import of the same bid with a passed deadline must not turn it into 'closed'.
    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "again", [bid(entry, "won", { deadline_date: "10/12/2026" })]));
    expect(bidRow(testDb.db.$client, `${entry.prefix}:won`)?.lifecycle_status).toBe("awarded");
  });

  it("keeps the existing delisted reason for a complete open-list run that no longer returns a bid", () => {
    const entry = SWEEP_LEVELS[1];
    const pagination = { list_kind: "open", start_page: 1, pages_fetched: 1, next_page: null, stopped_reason: "exhausted", requests_made: 1, complete: true };
    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "list-1", [
      bid(entry, "stays", { deadline_date: "12/31/2099" }),
      bid(entry, "goes", { deadline_date: "12/31/2099" }),
    ], { metadata: { mode: "json", pagination } }));
    importCrawlerJsonRunIntoSqlite(testDb.db, payload(entry.prefix, "list-2", [
      bid(entry, "stays", { deadline_date: "12/31/2099" }),
    ], { metadata: { mode: "json", pagination } }));

    const gone = bidRow(testDb.db.$client, `${entry.prefix}:goes`)!;
    expect(gone.lifecycle_status).toBe("closed");
    expect(gone.is_active).toBe(0);
    expect(rawPayloadOf(gone)?.lifecycle).toMatchObject({ closed_reason: "delisted" });
    expect(bidRow(testDb.db.$client, `${entry.prefix}:stays`)?.lifecycle_status).toBe("open");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 1c — the periodic sweep (module, CLI and worker tick)
// ---------------------------------------------------------------------------------------------------------------

describe("Task 1 — deadline sweep over stored bids (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("closes exactly the expired open rows at every level, stamps object payloads only, and leaves the rest byte-identical", async () => {
    const expected = await seedSweepScenario(sqliteRunner(testDb.db.$client));
    const before = allBidRows(testDb.db.$client);

    const result = await sweepExpiredBids({ database: testDb.db }, { now: new Date(OBSERVED_AT_MS) });

    expect(result.dryRun).toBe(false);
    expect(result.scanned).toBe(expected.scanned);
    expect(result.closed).toBe(expected.closes.length);
    expect(result.unparseable).toBe(expected.unparseable);
    expect(result.closedByIssuerType).toEqual(expected.closedByIssuerType);

    const after = allBidRows(testDb.db.$client);
    for (const close of expected.closes) {
      const row = after.get(close.id)!;
      expect(row.lifecycle_status, close.id).toBe("closed");
      expect(row.is_active, close.id).toBe(0);
      if (close.stampable) {
        expect(rawPayloadOf(row)?.lifecycle, close.id).toEqual({
          earlier: "note",
          closed_reason: "deadline_passed",
          closed_observed_at: new Date(OBSERVED_AT_MS).toISOString(),
          deadline: close.deadline,
        });
        expect(rawPayloadOf(row)?.kept, close.id).toBe(true);
      } else {
        // A non-object raw_payload is never stamped.
        expect(row.raw_payload, close.id).toBe(close.rawPayloadBefore);
      }
    }
    for (const id of expected.untouched) {
      expect(after.get(id), id).toEqual(before.get(id));
    }
    for (const row of after.values()) expect(row.is_active, row.id as string).toBe(row.lifecycle_status === "open" ? 1 : 0);
  });

  it("dry run counts the same and writes nothing; a second real run closes nothing more", async () => {
    const expected = await seedSweepScenario(sqliteRunner(testDb.db.$client));
    const before = allBidRows(testDb.db.$client);
    const changesBefore = count(testDb.db.$client, "SELECT total_changes() AS n");

    const dry = await sweepExpiredBids({ database: testDb.db }, { now: new Date(OBSERVED_AT_MS), dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.closed).toBe(expected.closes.length);
    expect(dry.closedByIssuerType).toEqual(expected.closedByIssuerType);
    expect(count(testDb.db.$client, "SELECT total_changes() AS n")).toBe(changesBefore);
    expect(allBidRows(testDb.db.$client)).toEqual(before);

    const first = await sweepExpiredBids({ database: testDb.db }, { now: new Date(OBSERVED_AT_MS), batchSize: 2 });
    expect(first.closed).toBe(expected.closes.length);
    const afterFirst = allBidRows(testDb.db.$client);

    const second = await sweepExpiredBids({ database: testDb.db }, { now: new Date(OBSERVED_AT_MS), batchSize: 2 });
    expect(second.closed).toBe(0);
    expect(second.closedByIssuerType).toEqual({});
    expect(second.scanned).toBe(expected.scanned - expected.closes.length);
    expect(allBidRows(testDb.db.$client)).toEqual(afterFirst);
  });

  it("sweep CLI: --dry-run --json writes nothing and reports; the real run closes and exits 0; a bad flag exits 1", async () => {
    // The CLI has no --now: it sweeps against the wall clock, so the seed uses deadlines decades away on either side.
    const fixture = await createClosedSqlite((run) => seedSweepScenario(run, SWEEP_DATES_FOR_WALL_CLOCK));
    try {
      const dry = runScript(SCRIPTS.sweep, ["--dry-run", "--json"], { DATABASE_PATH: fixture.file });
      expect(dry.code, dry.stderr).toBe(0);
      const dryJson = parseJson(dry.stdout) as Row;
      expect(dryJson).toBeDefined();
      expect(dryJson.dryRun).toBe(true);
      expect(dryJson.closed).toBe(fixture.seeded.closes.length);
      expect(dryJson.unparseable).toBe(fixture.seeded.unparseable);
      let client = fixture.open();
      expect(count(client, "SELECT count(*) AS n FROM bids WHERE lifecycle_status = 'closed'")).toBe(SWEEP_LEVELS.length);
      client.close();

      const real = runScript(SCRIPTS.sweep, ["--json"], { DATABASE_PATH: fixture.file });
      expect(real.code, real.stderr).toBe(0);
      const realJson = parseJson(real.stdout) as Row;
      expect(realJson.dryRun).toBe(false);
      expect(realJson.closed).toBe(fixture.seeded.closes.length);
      client = fixture.open();
      for (const close of fixture.seeded.closes) expect(bidRow(client, close.id)?.lifecycle_status, close.id).toBe("closed");
      client.close();

      const bad = runScript(SCRIPTS.sweep, ["--bogus"], { DATABASE_PATH: fixture.file });
      expect(bad.code).toBe(1);
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("worker tick runs the sweep and reports it; a sweep failure is isolated as lifecycleSweepError", async () => {
    const expected = await seedSweepScenario(sqliteRunner(testDb.db.$client));
    const tick = createCrawlerWorkerTick(
      { database: testDb.db, owner: "acceptance-worker" },
      { runCrawlerSourceOnce: async () => { throw new Error("no crawl expected"); }, clock: () => OBSERVED_AT_MS, sleep: async () => undefined },
    );
    const result = await tick();
    expect(result.lifecycleSweepError).toBeUndefined();
    expect(result.lifecycleSweep?.closed).toBe(expected.closes.length);
    expect(result.lifecycleSweep?.closedByIssuerType).toEqual(expected.closedByIssuerType);

    const failing = createCrawlerWorkerTick(
      { database: testDb.db, owner: "acceptance-worker-2" },
      { runCrawlerSourceOnce: async () => { throw new Error("no crawl expected"); }, sweepExpiredBids: async () => { throw new Error("sweep exploded"); } },
    );
    const failed = await failing();
    expect(failed.lifecycleSweep).toBeUndefined();
    expect(failed.lifecycleSweepError).toContain("sweep exploded");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 3 — data migrations on a legacy-shaped SQLite
// ---------------------------------------------------------------------------------------------------------------

describe("Task 3 — data migrations on a legacy-shaped SQLite", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("corrects Aurora-style FIPS drift to the source level and FIPS, keeping the stale value as legacy_fips_code", async () => {
    const expected = await seedMigrationScenario(sqliteRunner(testDb.db.$client));
    runMigrations(testDb.db);
    const client = testDb.db.$client;

    for (const drift of expected.driftCorrected) {
      const row = bidRow(client, drift.id)!;
      expect(row.issuer_type, drift.id).toBe(drift.level);
      expect(row.fips_code, drift.id).toBe(drift.fips);
      const payload = rawPayloadOf(row);
      if (drift.rawPayloadBefore !== null && rawPayloadOf({ raw_payload: drift.rawPayloadBefore })) {
        expect(payload?.legacy_fips_code, drift.id).toBe(drift.legacyFips);
        expect(payload?.k, drift.id).toBe((rawPayloadOf({ raw_payload: drift.rawPayloadBefore }) as Row).k);
      } else {
        // A non-JSON (or NULL) payload is corrected with the payload left as it was.
        expect(row.raw_payload, drift.id).toBe(drift.rawPayloadBefore);
      }
    }
  });

  it("re-keys NY subcontract rows: clean id, CR# source_bid_id, contractor as issuer, marker stripped, echo bodies blanked, data_quality removed, stamps added", async () => {
    const expected = await seedMigrationScenario(sqliteRunner(testDb.db.$client));
    runMigrations(testDb.db);
    const client = testDb.db.$client;

    for (const rekey of expected.rekeyed) {
      expect(bidRow(client, rekey.oldId), rekey.oldId).toBeUndefined();
      const row = bidRow(client, rekey.newId)!;
      expect(row, rekey.newId).toBeDefined();
      expect(row.dedupe_key).toBe(rekey.newId);
      expect(row.source_bid_id).toBe(rekey.sourceBidId);
      expect(row.issuer_name).toBe(rekey.issuerName);
      expect(row.title).toBe(rekey.title);
      expect(row.description).toBe(rekey.description);
      if (rekey.fullDescriptionBlank) expect(row.full_description == null || row.full_description === "", `${rekey.newId} full_description blank`).toBe(true);
      else expect(row.full_description).toBe(rekey.fullDescription);
      const payload = rawPayloadOf(row)!;
      expect(payload.data_quality, rekey.newId).toBeUndefined();
      expect(payload.contractor_company, rekey.newId).toBe(rekey.company);
      // Digest C-1: contractor_company is stamped on every re-keyed row; subcontracting: true only when the old
      // title carried the marker sentence, and with no marker there is no subcontracting key (unknown, not false).
      if (rekey.markerInOldTitle) expect(payload.subcontracting, rekey.newId).toBe(true);
      else expect(payload.subcontracting, `${rekey.newId}: no marker, so no subcontracting key (C-1)`).toBeUndefined();
      expect(payload).toMatchObject(rekey.rawKeep);
      expect(row.title).not.toContain(NY_MARKER);
    }
  });

  it("deletes a malformed duplicate whose clean twin exists, and skips rows held by a child reference or a key clash", async () => {
    const expected = await seedMigrationScenario(sqliteRunner(testDb.db.$client));
    const before = allBidRows(testDb.db.$client);
    runMigrations(testDb.db);
    const client = testDb.db.$client;

    for (const duplicate of expected.deletedDuplicates) {
      expect(bidRow(client, duplicate.oldId), duplicate.oldId).toBeUndefined();
      expect(bidRow(client, duplicate.twinId), duplicate.twinId).toEqual(before.get(duplicate.twinId));
    }
    for (const id of expected.skippedMalformed) {
      expect(bidRow(client, id), id).toEqual(before.get(id));
    }
    for (const id of expected.untouched) {
      expect(bidRow(client, id), id).toEqual(before.get(id));
    }
    // The children that held rows back are still attached.
    expect(count(client, "SELECT count(*) AS n FROM saved_bids WHERE bid_id = ?", [expected.skippedMalformed[0]])).toBe(1);
    expect(count(client, "SELECT count(*) AS n FROM bid_attachments WHERE bid_id = ?", [expected.skippedMalformed[1]])).toBe(1);
  });

  it("is idempotent: running the migrations again changes no row and makes no write", async () => {
    await seedMigrationScenario(sqliteRunner(testDb.db.$client));
    runMigrations(testDb.db);
    const afterFirst = allBidRows(testDb.db.$client);
    const changes = count(testDb.db.$client, "SELECT total_changes() AS n");

    runMigrations(testDb.db);
    expect(allBidRows(testDb.db.$client)).toEqual(afterFirst);
    expect(count(testDb.db.$client, "SELECT total_changes() AS n")).toBe(changes);

    runMigrations(testDb.db);
    expect(allBidRows(testDb.db.$client)).toEqual(afterFirst);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 4 — demo purge
// ---------------------------------------------------------------------------------------------------------------

describe("Task 4 — demo purge (module)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("matches the demo rule exactly: both demo kinds, and none of the near misses", async () => {
    const expected = await seedDemoPurgeScenario(sqliteRunner(testDb.db.$client));
    const found = await findDemoBids({ database: testDb.db });
    expect(found.map((bid) => bid.id).sort()).toEqual([...expected.demoBidIds].sort());
    for (const bid of found) {
      expect(bid.kind).toBe(bid.id.endsWith("_demo_readiness") ? "demo_readiness" : "mock_seed");
    }
    for (const keep of expected.keepBidIds) expect(found.some((bid) => bid.id === keep), keep).toBe(false);
  });

  it("plans exact dependent counts and detachments without writing anything", async () => {
    const expected = await seedDemoPurgeScenario(sqliteRunner(testDb.db.$client));
    const client = testDb.db.$client;
    const changesBefore = count(client, "SELECT total_changes() AS n");
    const bidsBefore = count(client, "SELECT count(*) AS n FROM bids");

    const plan = await planDemoPurge({ database: testDb.db });
    expect(plan.bids.map((bid) => bid.id).sort()).toEqual([...expected.demoBidIds].sort());
    for (const [table, n] of Object.entries(expected.dependentsPerTable)) {
      expect(plan.dependents[table], table).toBe(n);
    }
    expect(plan.knowledgeItemsToDetach).toBe(expected.knowledgeItemsDetached.length);
    expect(count(client, "SELECT total_changes() AS n")).toBe(changesBefore);
    expect(count(client, "SELECT count(*) AS n FROM bids")).toBe(bidsBefore);

    const dry = await purgeDemoBids({ database: testDb.db }, { apply: false });
    expect(dry.applied).toBe(false);
    expect(Object.values(dry.deleted).every((n) => n === 0)).toBe(true);
    expect(count(client, "SELECT total_changes() AS n")).toBe(changesBefore);
  });

  it("apply removes the demo bids with every dependent, detaches surviving links, keeps everything else, and is a no-op the second time", async () => {
    const expected = await seedDemoPurgeScenario(sqliteRunner(testDb.db.$client));
    const client = testDb.db.$client;
    const allTables = [...DIRECT_BID_CHILD_TABLES, ...INDIRECT_BID_CHILD_TABLES, "knowledge_items", "bids"];
    const countsBefore = Object.fromEntries(allTables.map((table) => [table, count(client, `SELECT count(*) AS n FROM ${table}`)]));
    const keepRowsBefore = new Map(expected.keepBidIds.map((id) => [id, bidRow(client, id)]));

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });
    expect(result.applied).toBe(true);
    expect(result.deleted.bids).toBe(expected.demoBidIds.length);
    for (const [table, n] of Object.entries(expected.dependentsPerTable)) expect(result.deleted[table], table).toBe(n);

    const placeholders = expected.demoBidIds.map(() => "?").join(", ");
    for (const id of expected.demoBidIds) expect(bidRow(client, id), id).toBeUndefined();
    for (const table of DIRECT_BID_CHILD_TABLES) {
      expect(count(client, `SELECT count(*) AS n FROM ${table} WHERE bid_id IN (${placeholders})`, expected.demoBidIds), table).toBe(0);
    }
    const demoIntents = expected.demoBidIds.map((id) => `int-${expected.tags[id]}`);
    const intentPlaceholders = demoIntents.map(() => "?").join(", ");
    expect(count(client, `SELECT count(*) AS n FROM submission_confirmations WHERE intent_id IN (${intentPlaceholders})`, demoIntents)).toBe(0);
    expect(count(client, `SELECT count(*) AS n FROM response_workspace_comments WHERE intent_id IN (${intentPlaceholders})`, demoIntents)).toBe(0);
    expect(count(client, `SELECT count(*) AS n FROM response_workspace_activity WHERE intent_id IN (${intentPlaceholders})`, demoIntents)).toBe(0);
    const demoItems = expected.demoBidIds.map((id) => `rwi-${expected.tags[id]}`);
    expect(count(client, `SELECT count(*) AS n FROM response_workspace_item_artifacts WHERE item_id IN (${demoItems.map(() => "?").join(", ")})`, demoItems)).toBe(0);
    const demoQuotes = expected.demoBidIds.map((id) => `qr-${expected.tags[id]}`);
    expect(count(client, `SELECT count(*) AS n FROM quote_request_artifacts WHERE quote_request_id IN (${demoQuotes.map(() => "?").join(", ")})`, demoQuotes)).toBe(0);

    // Detachments: knowledge items stay, with their links to purged rows set to NULL.
    for (const id of expected.knowledgeItemsDetached) {
      const item = client.prepare("SELECT source_bid_id, source_intent_id FROM knowledge_items WHERE id = ?").get(id) as Row | undefined;
      expect(item, id).toBeDefined();
      expect(item?.source_bid_id, id).toBeNull();
      expect(item?.source_intent_id, id).toBeNull();
    }
    for (const id of expected.awardOutcomesDetached) {
      const outcome = client.prepare("SELECT tabulation_artifact_id, bid_id FROM award_outcomes WHERE id = ?").get(id) as Row | undefined;
      expect(outcome, id).toBeDefined();
      expect(outcome?.tabulation_artifact_id, id).toBeNull();
    }
    expect(count(client, "SELECT count(*) AS n FROM knowledge_items")).toBe(countsBefore.knowledge_items);

    // Everything that was not demo data is intact.
    for (const [id, row] of keepRowsBefore) expect(bidRow(client, id), id).toEqual(row);
    for (const table of [...DIRECT_BID_CHILD_TABLES, ...INDIRECT_BID_CHILD_TABLES]) {
      expect(count(client, `SELECT count(*) AS n FROM ${table}`), table).toBe(countsBefore[table] - expected.demoBidIds.length);
    }
    const keepKnowledge = client.prepare("SELECT source_bid_id, source_intent_id FROM knowledge_items WHERE id = ?").get("ki-N7") as Row;
    expect(keepKnowledge).toEqual({ source_bid_id: "tx_esbd:TX-1", source_intent_id: "int-N7" });
    expect(client.pragma("foreign_key_check")).toEqual([]);

    const again = await purgeDemoBids({ database: testDb.db }, { apply: true });
    expect(again.applied).toBe(false);
    expect(again.bids).toEqual([]);
    expect(Object.values(again.deleted).every((n) => n === 0)).toBe(true);
    expect(await findDemoBids({ database: testDb.db })).toEqual([]);
  });

  it("a pre-existing, unrelated referential violation does not block the purge", async () => {
    const expected = await seedDemoPurgeScenario(sqliteRunner(testDb.db.$client));
    const client = testDb.db.$client;
    client.pragma("foreign_keys = OFF");
    client.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("ghost-session", "ghost-user", "hash-ghost", "2099-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    client.pragma("foreign_keys = ON");
    expect((client.pragma("foreign_key_check") as unknown[]).length).toBeGreaterThan(0);

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });
    expect(result.applied).toBe(true);
    expect(result.deleted.bids).toBe(expected.demoBidIds.length);
    expect(count(client, "SELECT count(*) AS n FROM sessions WHERE id = 'ghost-session'")).toBe(1);
  });

  it("never deletes more than 500 bids in one run", async () => {
    const run = sqliteRunner(testDb.db.$client);
    await seedBids(run, Array.from({ length: 501 }, (_, index) => ({
      id: String(1000 + index), source: "mock-source", sourceBidId: `mock:${1000 + index}`, issuerType: "state", stateCode: "TX",
    })));
    let error: unknown;
    let result: Awaited<ReturnType<typeof purgeDemoBids>> | undefined;
    try {
      result = await purgeDemoBids({ database: testDb.db }, { apply: true });
    } catch (caught) {
      error = caught;
    }
    const remaining = count(testDb.db.$client, "SELECT count(*) AS n FROM bids");
    expect(501 - remaining).toBeLessThanOrEqual(500);
    if (result) expect(result.deleted.bids ?? 0).toBeLessThanOrEqual(500);
    else expect(error).toBeInstanceOf(Error);
    expect(testDb.db.$client.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("Task 4 — demo purge CLI (bids:purge-demo)", () => {
  it("defaults to a dry run that prints the plan, names the target on stderr first and writes nothing", async () => {
    const fixture = await createClosedSqlite(seedDemoPurgeScenario);
    try {
      const before = fileSha256(fixture.file);
      const dry = runScript(SCRIPTS.purge, [], { DATABASE_PATH: fixture.file });
      expect(dry.code, dry.stderr).toBe(0);
      expect(dry.stderr.trim().split("\n")[0]).toContain(fixture.file);
      expect(dry.stdout).toMatch(/demo_readiness/);
      expect(dry.stdout).toMatch(/mock/);
      expect(fileSha256(fixture.file)).toBe(before);

      const json = runScript(SCRIPTS.purge, ["--json"], { DATABASE_PATH: fixture.file });
      expect(json.code, json.stderr).toBe(0);
      const document = parseJson(json.stdout) as Row;
      expect(document, "stdout must be exactly one JSON document").toBeDefined();
      expect(JSON.stringify(document)).toContain("al_state_procurement_demo_readiness");
      expect(fileSha256(fixture.file)).toBe(before);

      const client = fixture.open();
      expect(count(client, "SELECT count(*) AS n FROM bids")).toBe(fixture.seeded.demoBidIds.length + fixture.seeded.keepBidIds.length);
      client.close();
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("--apply refuses without a valid --backup-file (missing flag, missing file, empty file, the database itself) and exits 2 writing nothing", async () => {
    const fixture = await createClosedSqlite(seedDemoPurgeScenario);
    try {
      const before = fileSha256(fixture.file);
      const emptyBackup = path.join(fixture.dir, "empty.bak");
      writeFileSync(emptyBackup, "");
      const attempts: Array<[label: string, args: string[]]> = [
        ["no --backup-file", ["--apply"]],
        ["missing backup", ["--apply", "--backup-file", path.join(fixture.dir, "nope.bak")]],
        ["empty backup", ["--apply", "--backup-file", emptyBackup]],
        ["the database itself", ["--apply", "--backup-file", fixture.file]],
      ];
      for (const [label, args] of attempts) {
        const result = runScript(SCRIPTS.purge, args, { DATABASE_PATH: fixture.file });
        expect(result.code, `${label}: ${result.stderr}`).toBe(2);
        expect(fileSha256(fixture.file), label).toBe(before);
      }
      const client = fixture.open();
      expect(count(client, "SELECT count(*) AS n FROM bids")).toBe(fixture.seeded.demoBidIds.length + fixture.seeded.keepBidIds.length);
      client.close();
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("--apply with a real backup removes the demo bids and dependents and exits 0", async () => {
    const fixture = await createClosedSqlite(seedDemoPurgeScenario);
    try {
      const backup = path.join(fixture.dir, "backup.sqlite");
      writeFileSync(backup, readFileSync(fixture.file));
      const result = runScript(SCRIPTS.purge, ["--apply", "--backup-file", backup, "--json"], { DATABASE_PATH: fixture.file });
      expect(result.code, result.stderr).toBe(0);
      expect(parseJson(result.stdout)).toBeDefined();
      const client = fixture.open();
      for (const id of fixture.seeded.demoBidIds) expect(bidRow(client, id), id).toBeUndefined();
      for (const id of fixture.seeded.keepBidIds) expect(bidRow(client, id), id).toBeDefined();
      expect(client.pragma("foreign_key_check")).toEqual([]);
      client.close();
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("a missing SQLite file exits 2 and creates nothing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "apsi-acc-missing-"));
    try {
      const missing = path.join(dir, "not-there.sqlite");
      const result = runScript(SCRIPTS.purge, [], { DATABASE_PATH: missing });
      expect(result.code, result.stderr).toBe(2);
      expect(existsSync(missing)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------
// Task 5 — data:integrity
// ---------------------------------------------------------------------------------------------------------------

describe("Task 5 — data:integrity report, snapshot and compare (CLI)", () => {
  function runIntegrity(args: string[], file: string) {
    return runScript(SCRIPTS.integrity, args, { DATABASE_PATH: file });
  }

  it("reports every per-level metric on a seeded database, with openVisible equal to the search count", async () => {
    const fixture = await createClosedSqlite((run) => seedIntegrityScenario(run, Date.now()));
    try {
      // The search path's own answer, per level, is the oracle for openVisible.
      const db = createDatabase(fixture.file);
      const searchVisible: Record<string, number> = {};
      for (const level of INTEGRITY_LEVELS) {
        if (level === "other") continue;
        searchVisible[level] = (await queryBidsFromDatabase(db, { issuerType: level })).total;
      }
      db.$client.close();
      expect(searchVisible.state).toBeGreaterThan(0);
      expect(searchVisible.county).toBeGreaterThan(0);
      expect(searchVisible.city).toBeGreaterThan(0);

      const result = runIntegrity(["--json"], fixture.file);
      expect(result.code, result.stderr).toBe(0);
      const report = parseJson(result.stdout);
      expect(report, "stdout must be exactly one JSON document").toBeDefined();
      expect(result.stderr).toContain(fixture.file);

      for (const level of INTEGRITY_LEVELS) {
        const record = levelRecord(report, level);
        expect(record, `level ${level} present in the report`).toBeDefined();
        const expected = fixture.seeded.levels[level];
        for (const [name, value] of Object.entries(expected)) {
          expect(metric(record, name), `${level}.${name}`).toBe(value);
        }
        if (level !== "other") expect(metric(record, "openVisible"), `${level}.openVisible == search`).toBe(searchVisible[level]);
      }
      const malformed = findKey(report, "malformedNyIds");
      if (Array.isArray(malformed)) {
        expect(malformed).toEqual(expect.arrayContaining(fixture.seeded.malformedNyIds));
      } else if (typeof malformed === "number") {
        expect(malformed).toBe(fixture.seeded.malformedNyIds.length);
      } else {
        expect(JSON.stringify(malformed ?? null), "malformedNyIds must name or count the malformed rows").toContain("2138289");
      }
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("is read-only: the database file and the legacy rows it reports on are unchanged", async () => {
    const fixture = await createClosedSqlite((run) => seedIntegrityScenario(run, Date.now()));
    try {
      const before = fileSha256(fixture.file);
      const client0 = fixture.open();
      const driftBefore = bidRow(client0, fixture.seeded.driftId);
      const malformedBefore = bidRow(client0, fixture.seeded.malformedNyIds[0]);
      client0.close();

      const result = runIntegrity(["--json"], fixture.file);
      expect(result.code, result.stderr).toBe(0);
      expect(fileSha256(fixture.file)).toBe(before);
      expect(existsSync(`${fixture.file}-wal`) ? statSync(`${fixture.file}-wal`).size : 0).toBe(0);

      const client = fixture.open();
      expect(bidRow(client, fixture.seeded.driftId)).toEqual(driftBefore);
      expect(bidRow(client, fixture.seeded.malformedNyIds[0])).toEqual(malformedBefore);
      client.close();
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("--snapshot writes per-row { h, level, visible, open, t } deterministically", async () => {
    const fixture = await createClosedSqlite((run) => seedIntegrityScenario(run, Date.now()));
    try {
      const first = path.join(fixture.dir, "first.json");
      const second = path.join(fixture.dir, "second.json");
      expect(runIntegrity(["--snapshot", first], fixture.file).code).toBe(0);
      expect(runIntegrity(["--snapshot", second, "--json"], fixture.file).code).toBe(0);
      const snapshot = JSON.parse(readFileSync(first, "utf8")) as Row;
      const again = JSON.parse(readFileSync(second, "utf8")) as Row;
      const rows = snapshot.rows as Record<string, Row>;
      expect(rows).toBeDefined();

      const client = fixture.open();
      const ids = (client.prepare("SELECT id FROM bids").all() as Row[]).map((row) => row.id as string);
      client.close();
      expect(Object.keys(rows).sort()).toEqual(ids.sort());
      for (const [id, row] of Object.entries(rows)) {
        expect(row.h, `${id}.h`).toMatch(/^[0-9a-f]{64}$/);
        expect(INTEGRITY_LEVELS, `${id}.level`).toContain(row.level);
        expect(typeof row.visible, `${id}.visible`).toBe("boolean");
        expect(typeof row.open, `${id}.open`).toBe("boolean");
        expect(row.t && typeof row.t === "object", `${id}.t`).toBe(true);
        expect((again.rows as Record<string, Row>)[id].h, `${id}.h stable`).toBe(row.h);
      }
      expect(rows["tx_esbd:1"].open).toBe(true);
      expect(rows["tx_esbd:1"].visible).toBe(true);
      expect(rows["tx_esbd:3"].open).toBe(false);
      expect(rows["tx_esbd:2"].visible).toBe(false);
      expect(rows["bidnet_co_aurora:drift"].level).toBe("state");
      expect(rows["weird:1"].level).toBe("other");
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("--compare fails on an unexplained removal and on a visibility regression, and --allow-removed explains a removal", async () => {
    const fixture = await createClosedSqlite((run) => seedIntegrityScenario(run, Date.now()));
    try {
      const before = path.join(fixture.dir, "before.json");
      expect(runIntegrity(["--snapshot", before], fixture.file).code).toBe(0);

      // Ground the regression in the search path: the row is visible now and hidden after the mutation.
      let db = createDatabase(fixture.file);
      const wasVisible = (await queryBidsFromDatabase(db, { issuerType: "city" })).bids.some((bid) => bid.id === fixture.seeded.regressionId);
      db.$client.close();
      expect(wasVisible).toBe(true);

      let client = fixture.open();
      client.prepare("DELETE FROM bids WHERE id = ?").run(fixture.seeded.removedId);
      client.prepare("UPDATE bids SET issuer_name = 'Unknown x' WHERE id = ?").run(fixture.seeded.regressionId);
      // The retyped row is unregistered, so the retype moves a level's counts without raising any identityMismatch
      // (which the plan makes a failure of its own, tested separately below).
      client.prepare("UPDATE bids SET issuer_type = 'county', jurisdiction_level = 'county' WHERE id = ?").run(fixture.seeded.retypedId);
      client.prepare("UPDATE bids SET description = 'A changed body outside the t columns' WHERE id = ?").run("sam_gov:F1");
      client.close();

      db = createDatabase(fixture.file);
      const stillVisible = (await queryBidsFromDatabase(db, { issuerType: "city" })).bids.some((bid) => bid.id === fixture.seeded.regressionId);
      db.$client.close();
      expect(stillVisible).toBe(false);

      const both = runIntegrity(["--compare", before, "--json"], fixture.file);
      expect(both.code, both.stderr).toBe(1);
      const bothDoc = parseJson(both.stdout);
      expect(bothDoc, "stdout must be exactly one JSON document").toBeDefined();
      const bothText = JSON.stringify(bothDoc);
      expect(bothText).toContain(fixture.seeded.removedId);
      expect(bothText).toContain(fixture.seeded.regressionId);
      expect(bothText).toContain("sam_gov:F1");

      const allowed = runIntegrity(["--compare", before, "--allow-removed", "^tx_esbd:1$", "--json"], fixture.file);
      expect(allowed.code, "the visibility regression alone still fails").toBe(1);

      // Undo the regression: the explained removal alone passes; unexplained it still fails.
      client = fixture.open();
      client.prepare("UPDATE bids SET issuer_name = ? WHERE id = ?").run(`Issuer ${fixture.seeded.regressionId}`, fixture.seeded.regressionId);
      client.close();
      const unexplained = runIntegrity(["--compare", before, "--json"], fixture.file);
      expect(unexplained.code, unexplained.stderr).toBe(1);
      const explained = runIntegrity(["--compare", before, "--allow-removed", "^tx_esbd:1$", "--json"], fixture.file);
      expect(explained.code, explained.stderr).toBe(0);
      const explainedText = JSON.stringify(parseJson(explained.stdout));
      // Per-level deltas and the retype are reported.
      expect(explainedText).toContain(fixture.seeded.retypedId);
      expect(explainedText).toMatch(/delta/i);
    } finally {
      fixture.cleanup();
    }
  }, 240_000);

  it("--allow-removed explains a demo-rule removal", async () => {
    const fixture = await createClosedSqlite((run) => seedIntegrityScenario(run, Date.now()));
    try {
      const before = path.join(fixture.dir, "before.json");
      expect(runIntegrity(["--snapshot", before], fixture.file).code).toBe(0);
      const client = fixture.open();
      client.prepare("DELETE FROM bids WHERE id = ?").run(fixture.seeded.demoId);
      client.close();
      expect(runIntegrity(["--compare", before, "--json"], fixture.file).code).toBe(1);
      const explained = runIntegrity(["--compare", before, "--allow-removed", "_demo_readiness$", "--json"], fixture.file);
      expect(explained.code, explained.stderr).toBe(0);
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("fails when a level's identityMismatch increases, and warns (exit 0) on an unexplained open→closed transition", async () => {
    const fixture = await createClosedSqlite((run) => seedIntegrityScenario(run, Date.now()));
    try {
      const before = path.join(fixture.dir, "before.json");
      expect(runIntegrity(["--snapshot", before], fixture.file).code).toBe(0);
      let client = fixture.open();
      client.prepare("UPDATE bids SET fips_code = '08999' WHERE id = ?").run("bidnet_co_larimer:1");
      client.close();
      expect(runIntegrity(["--compare", before, "--json"], fixture.file).code).toBe(1);

      client = fixture.open();
      client.prepare("UPDATE bids SET fips_code = '08069' WHERE id = ?").run("bidnet_co_larimer:1");
      client.prepare("UPDATE bids SET lifecycle_status = 'closed', is_active = 0 WHERE id = ?").run("bidnet_co_aurora:1");
      client.close();
      const warned = runIntegrity(["--compare", before, "--json"], fixture.file);
      expect(warned.code, warned.stderr).toBe(0);
      expect(JSON.stringify(parseJson(warned.stdout))).toContain("bidnet_co_aurora:1");
    } finally {
      fixture.cleanup();
    }
  }, 180_000);

  it("usage errors exit 2", async () => {
    const fixture = await createClosedSqlite((run) => seedIntegrityScenario(run, Date.now()));
    try {
      expect(runIntegrity(["--compare", path.join(fixture.dir, "missing.json")], fixture.file).code).toBe(2);
      expect(runIntegrity(["--no-such-flag"], fixture.file).code).toBe(2);
    } finally {
      fixture.cleanup();
    }
  }, 120_000);
});

describe("Task 5 — data:integrity report (module, in process)", () => {
  it("builds the report without writing: total_changes() is unchanged", async () => {
    const testDb = await createTestDatabase({ seed: false });
    try {
      const expected = await seedIntegrityScenario(sqliteRunner(testDb.db.$client), Date.now());
      const changes = count(testDb.db.$client, "SELECT total_changes() AS n");
      const build = buildIntegrityReport as (target: unknown, options: { now: Date }) => Promise<unknown>;
      expect(typeof build).toBe("function");
      const report = await build({ database: testDb.db }, { now: new Date() });
      expect(count(testDb.db.$client, "SELECT total_changes() AS n")).toBe(changes);
      const state = levelRecord(report, "state");
      expect(metric(state, "total")).toBe(expected.levels.state.total);
      expect(metric(state, "identityMismatch")).toBe(expected.levels.state.identityMismatch);
      expect(metric(levelRecord(report, "county"), "detailLockedAtSource")).toBe(expected.levels.county.detailLockedAtSource);
    } finally {
      await testDb.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Task 6 — wiring
// ---------------------------------------------------------------------------------------------------------------

describe("Task 6 — wiring", () => {
  const packageJson = JSON.parse(readFileSync(path.join(FRONTEND_DIR, "package.json"), "utf8")) as { scripts: Record<string, string> };

  it("exposes the three npm scripts", () => {
    expect(packageJson.scripts["data:integrity"]).toContain("scripts/data-integrity.ts");
    expect(packageJson.scripts["bids:lifecycle:sweep"]).toContain("scripts/sweep-bid-lifecycle.ts");
    expect(packageJson.scripts["bids:purge-demo"]).toContain("scripts/purge-demo-bids.ts");
  });

  it("test:crawler-integration lists every *.integration.test.ts", () => {
    const script = packageJson.scripts["test:crawler-integration"] ?? "";
    const listed = new Set(script.split(/\s+/).filter((token) => token.endsWith(".integration.test.ts")));
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== ".next") walk(full);
        } else if (entry.name.endsWith(".integration.test.ts")) {
          found.push(path.relative(FRONTEND_DIR, full));
        }
      }
    };
    walk(path.join(FRONTEND_DIR, "src"));
    walk(path.join(FRONTEND_DIR, "scripts"));
    const missing = found.filter((file) => !listed.has(file)).sort();
    expect(missing, "integration tests not listed in test:crawler-integration").toEqual([]);
  });

  it("frontend/Dockerfile ships the jurisdiction table at /crawler/data/ in the crawler runtime (worker and runner)", () => {
    const dockerfile = readFileSync(path.join(FRONTEND_DIR, "Dockerfile"), "utf8");
    const stages = dockerfile.split(/^FROM\s+/m).slice(1).map((chunk) => {
      const [header, ...rest] = chunk.split("\n");
      const name = /\bAS\s+(\S+)/i.exec(header)?.[1] ?? header.trim();
      const body = rest.join("\n");
      // The destination may be spelled as the directory or as the file itself; both place the table at /crawler/data/us_jurisdictions.tsv.
      const copiesTable = /^COPY\b[^\n]*crawler\/data(?:\/us_jurisdictions\.tsv|\/?)\s+[^\n]*\/crawler\/data(?:\/|\/us_jurisdictions\.tsv)?\s*$/m.test(body);
      return { name, copiesTable };
    });
    const byName = new Map(stages.map((stage) => [stage.name, stage.copiesTable]));
    const inRuntime = byName.get("crawler-runtime") === true;
    const inBoth = byName.get("worker") === true && byName.get("runner") === true;
    expect(inRuntime || inBoth, "a COPY of crawler/data/us_jurisdictions.tsv into /crawler/data/ reaching both images").toBe(true);
    expect(existsSync(path.join(REPO_ROOT, "crawler/data/us_jurisdictions.tsv"))).toBe(true);
  });

  it("ships the runbook docs/operations/data-integrity.md", () => {
    expect(existsSync(path.join(REPO_ROOT, "docs/operations/data-integrity.md"))).toBe(true);
  });
});

// Keep the helper exports referenced so the seed module's wider surface is type-checked with this file.
void attachDependents;
void BID_GRAPH_RELATIONSHIPS;
