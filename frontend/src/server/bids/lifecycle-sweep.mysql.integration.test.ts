import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { sweepExpiredBids, type LifecycleSweepResult } from "./lifecycle-sweep";

/** 02:00 on 13 October in the deadline zone (UTC-10). */
const NOW = new Date("2026-10-13T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const SEEDED_AT = "2026-10-01T00:00:00.000Z";

interface Seed {
  id: string;
  deadline: string | null;
  issuerType?: string;
  lifecycleStatus?: string;
  rawPayload?: string | null;
  expired?: boolean;
}

// The same scenario the SQLite suite runs (lifecycle-sweep.test.ts): one open row in every shape the sweep reads.
const SEEDS: Seed[] = [
  { id: "ex:us-date", deadline: "10/12/2026", issuerType: "state", expired: true },
  { id: "ex:iso-date", deadline: "2026-10-12", issuerType: "state", expired: true },
  { id: "ex:us-time-at-now", deadline: "10/13/2026 2:00 AM", issuerType: "county", expired: true },
  { id: "ex:two-digit-year", deadline: "05/31/26", issuerType: "county", expired: true },
  { id: "ex:month-name", deadline: "Aug 21, 2026 @ 02:00 PM", issuerType: "city", expired: true },
  { id: "ex:epoch-ms", deadline: "1761757200000", issuerType: "state", expired: true },
  { id: "ex:iso-instant", deadline: "2026-10-13T11:59:59Z", issuerType: "state", expired: true },
  { id: "open:today", deadline: "10/13/2026" },
  { id: "open:iso-today", deadline: "2026-10-13" },
  { id: "open:cst", deadline: "10/13/2026 2:00 PM CST" },
  { id: "open:month-ahead", deadline: "Dec 1, 2026 @ 10:00 AM" },
  { id: "open:dotnet", deadline: "/Date(1893456000000)/" },
  { id: "open:instant-ahead", deadline: "2026-10-13T12:00:01Z" },
  { id: "open:offset-ahead", deadline: "2026-10-13T08:00:00-05:00" },
  { id: "open:2028", deadline: "01/01/2028" },
  { id: "odd:not-available", deadline: "Not Available" },
  { id: "odd:tbd", deadline: "TBD" },
  { id: "odd:impossible-date", deadline: "02/30/2026" },
  { id: "odd:min-date", deadline: "0001-01-01" },
  { id: "odd:epoch-zero", deadline: "01/01/1970" },
  { id: "odd:dotnet-min", deadline: "/Date(-62135596800000)/" },
  { id: "none:null", deadline: null },
  { id: "none:blank", deadline: "  " },
  { id: "done:awarded", deadline: "10/01/2026", lifecycleStatus: "awarded" },
  { id: "done:closed", deadline: "10/01/2026", lifecycleStatus: "closed" },
];
const OPEN_ROWS = SEEDS.filter((seed) => !seed.lifecycleStatus).length;
const EXPIRED = SEEDS.filter((seed) => seed.expired).map((seed) => seed.id).sort();
const UNREADABLE = SEEDS.filter((seed) => seed.id.startsWith("odd:")).map((seed) => seed.id);
const EXPECTED = { scanned: OPEN_ROWS, closed: EXPIRED.length, unparseable: UNREADABLE.length, closedByIssuerType: { state: 4, county: 2, city: 1 } };

const COLUMNS = ["id", "source", "source_bid_id", "dedupe_key", "title", "description", "deadline_date", "issuer_name", "issuer_type", "state_code",
  "source_url", "is_active", "lifecycle_status", "raw_payload", "first_seen_at", "last_seen_at", "created_at", "updated_at"];

interface StoredBid {
  id: string;
  lifecycle_status: string;
  is_active: number;
  deadline_date: string | null;
  raw_payload: string | null;
  updated_at: string;
  first_seen_at: string;
  last_seen_at: string;
}

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("deadline sweep on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  let mysql: ReturnType<typeof createMysqlPool>;
  let importer: ReturnType<typeof createMysqlPool>;
  let url: URL;

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    // One connection: the sweep must never ask the pool for a second one while its transaction holds the first.
    mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
    // What an import does to the same rows meanwhile.
    importer = createPool({ uri: url.toString(), connectionLimit: 1 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (importer) await importer.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  beforeEach(async () => { await mysql.query("DELETE FROM bids"); });
  afterEach(() => { vi.restoreAllMocks(); });

  const payloadOf = (seed: Seed) => seed.rawPayload !== undefined ? seed.rawPayload : JSON.stringify({ portal_id: seed.id, lifecycle: { note: "kept" } });

  async function seed(rows: Seed[] = SEEDS) {
    for (let start = 0; start < rows.length; start += 250) {
      const chunk = rows.slice(start, start + 250);
      await mysql.query(
        `INSERT INTO bids (${COLUMNS.join(", ")}) VALUES ${chunk.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ")}`,
        chunk.flatMap((row, index) => [
          row.id, row.id.split(":")[0], row.id, row.id, `Bid ${start + index}`, "Repair the road.", row.deadline, "Agency", row.issuerType ?? "state", "CO",
          `https://portal.example.gov/${start + index}`, row.lifecycleStatus ? 0 : 1, row.lifecycleStatus ?? "open", payloadOf(row), SEEDED_AT, SEEDED_AT, SEEDED_AT, SEEDED_AT,
        ]),
      );
    }
  }
  async function all(): Promise<StoredBid[]> {
    const [rows] = await mysql.query("SELECT id, lifecycle_status, is_active, deadline_date, raw_payload, updated_at, first_seen_at, last_seen_at FROM bids ORDER BY id");
    return rows as StoredBid[];
  }
  const read = async (id: string) => (await all()).find((row) => row.id === id)!;
  const sweep = (options: { dryRun?: boolean; batchSize?: number } = {}) => sweepExpiredBids({ mysql }, { now: NOW, ...options });

  it("closes exactly the bids whose deadline has passed and reports what it saw", async () => {
    await seed();
    const result = await sweep();

    expect(result).toEqual({ ...EXPECTED, dryRun: false });
    const rows = await all();
    expect(rows.filter((row) => row.lifecycle_status === "closed" && row.updated_at === NOW_ISO).map((row) => row.id).sort()).toEqual(EXPIRED);
    for (const row of rows.filter((candidate) => EXPIRED.includes(candidate.id))) {
      expect(row).toMatchObject({ lifecycle_status: "closed", is_active: 0, updated_at: NOW_ISO, first_seen_at: SEEDED_AT, last_seen_at: SEEDED_AT });
    }
    for (const row of SEEDS.filter((candidate) => !candidate.expired && !candidate.lifecycleStatus)) {
      expect(await read(row.id)).toMatchObject({ lifecycle_status: "open", is_active: 1, updated_at: SEEDED_AT });
    }
  });

  it("records why and when under raw_payload.lifecycle without losing the payload", async () => {
    await seed();
    await sweep();

    expect(JSON.parse((await read("ex:us-date")).raw_payload!)).toEqual({
      portal_id: "ex:us-date",
      lifecycle: { note: "kept", closed_reason: "deadline_passed", closed_observed_at: NOW_ISO, deadline: "10/12/2026" },
    });
    expect(JSON.parse((await read("ex:month-name")).raw_payload!).lifecycle.deadline).toBe("Aug 21, 2026 @ 02:00 PM");
    expect((await read("open:today")).raw_payload).toBe(payloadOf({ id: "open:today", deadline: "10/13/2026" }));
  });

  it("leaves awarded and closed bids alone, and never closes an unreadable or missing deadline", async () => {
    await seed();
    const before = await all();
    await sweep();
    const after = await all();

    for (const id of ["done:awarded", "done:closed", ...UNREADABLE, "none:null", "none:blank"]) {
      expect(after.find((row) => row.id === id)).toEqual(before.find((row) => row.id === id));
    }
  });

  it("writes nothing on a dry run", async () => {
    await seed();
    const before = await all();
    const result = await sweep({ dryRun: true });

    expect(result).toEqual({ ...EXPECTED, dryRun: true });
    expect(await all()).toEqual(before);
  });

  it("is idempotent: a second run finds nothing left to close", async () => {
    await seed();
    await sweep();
    const afterFirst = await all();
    const second = await sweep();

    expect(second).toEqual({ scanned: OPEN_ROWS - EXPIRED.length, closed: 0, unparseable: UNREADABLE.length, closedByIssuerType: {}, dryRun: false });
    expect(await all()).toEqual(afterFirst);
  });

  it("closes a bid whose payload is not JSON without touching the payload", async () => {
    await seed([
      { id: "ex:text", deadline: "10/12/2026", rawPayload: "not json" },
      { id: "ex:null", deadline: "10/12/2026", rawPayload: null },
      { id: "ex:array", deadline: "10/12/2026", rawPayload: "[1,2]" },
    ]);
    const result = await sweep();

    expect(result.closed).toBe(3);
    expect(await read("ex:text")).toMatchObject({ lifecycle_status: "closed", is_active: 0, raw_payload: "not json", updated_at: NOW_ISO });
    expect(await read("ex:null")).toMatchObject({ lifecycle_status: "closed", is_active: 0, raw_payload: null });
    expect(await read("ex:array")).toMatchObject({ lifecycle_status: "closed", raw_payload: "[1,2]" });
  });

  it("gives the same answer when it pages two rows at a time, and at every other page size", async () => {
    await seed();
    const results: LifecycleSweepResult[] = [];
    for (const batchSize of [1, 2, 3, OPEN_ROWS - 1, OPEN_ROWS, OPEN_ROWS + 1]) results.push(await sweep({ batchSize, dryRun: true }));
    for (const result of results) expect(result).toEqual({ ...EXPECTED, dryRun: true });

    expect(await sweep({ batchSize: 2 })).toEqual({ ...EXPECTED, dryRun: false });
    expect((await all()).filter((row) => row.lifecycle_status === "closed" && row.updated_at === NOW_ISO).map((row) => row.id).sort()).toEqual(EXPIRED);
  });

  it("pages through more bids than one default page holds", async () => {
    await seed(Array.from({ length: 1_250 }, (_, index) => ({
      id: `bulk:${String(index).padStart(5, "0")}`, deadline: index % 2 === 0 ? "10/12/2026" : "10/20/2026", issuerType: index % 5 === 0 ? "county" : "state",
    })));
    const result = await sweep();

    expect(result).toMatchObject({ scanned: 1_250, closed: 625, unparseable: 0 });
    expect(result.closedByIssuerType.county + result.closedByIssuerType.state).toBe(625);
    const [[open]] = (await mysql.query("SELECT COUNT(*) AS open_count FROM bids WHERE lifecycle_status = 'open'")) as unknown as [[{ open_count: number }]];
    expect(Number(open.open_count)).toBe(625);
  }, 60_000);

  it("pages by the column's own collation: ids that differ only in case or accents sort and page the way MySQL orders them", async () => {
    const ids = ["Zeta:1", "alpha:2", "Alpha:3", "alpha:10", "beta:1", "Beta:2", "émile:1", "emile:2", "a%b:1", "a_b:2", "a'b:3", "a;b:4", "a:b:5"];
    await seed(ids.map((id) => ({ id, deadline: "10/12/2026" })));

    for (const batchSize of [1, 2, 5]) {
      expect(await sweep({ batchSize, dryRun: true })).toMatchObject({ scanned: ids.length, closed: ids.length });
    }
    expect(await sweep({ batchSize: 2 })).toMatchObject({ scanned: ids.length, closed: ids.length });
  });

  it("does not close a bid an import moved ahead after the page was read, and leaves its payload alone", async () => {
    await seed([{ id: "race:moved", deadline: "10/12/2026" }, { id: "race:expired", deadline: "10/12/2026" }]);
    // The page has been read; an import (another connection, autocommit) refreshes one bid just before the sweep locks it.
    const store = {
      query: mysql.query.bind(mysql),
      getConnection: async () => {
        await importer.query("UPDATE bids SET deadline_date = ?, raw_payload = ? WHERE id = ?", ["12/31/2026", '{"imported":"later"}', "race:moved"]);
        return mysql.getConnection();
      },
    };

    const result = await sweepExpiredBids({ mysql: store }, { now: NOW });

    expect(result).toMatchObject({ scanned: 2, closed: 1, closedByIssuerType: { state: 1 } });
    expect(await read("race:moved")).toMatchObject({ lifecycle_status: "open", is_active: 1, deadline_date: "12/31/2026", raw_payload: '{"imported":"later"}' });
    expect(await read("race:expired")).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
  });

  /** Rejects when `promise` has not settled within `ms`; the sweep must not wait on a row another connection holds. */
  async function settlesWithin<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`the sweep was still waiting after ${ms} ms`)), ms); });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
  }

  it("skips a bid another connection has locked, without waiting, and closes it on a later pass once the lock is released", async () => {
    await seed([{ id: "lock:held", deadline: "10/12/2026" }, { id: "lock:free", deadline: "10/12/2026" }]);
    const holder = await importer.getConnection();
    await holder.beginTransaction();
    await holder.query("SELECT id FROM bids WHERE id = ? FOR UPDATE", ["lock:held"]);
    try {
      const during = await settlesWithin(sweep(), 5_000);

      expect(during).toMatchObject({ scanned: 2, closed: 1, closedByIssuerType: { state: 1 } });
      expect(await read("lock:held")).toMatchObject({ lifecycle_status: "open", is_active: 1, updated_at: SEEDED_AT });
      expect(await read("lock:held")).toEqual(expect.objectContaining({ raw_payload: payloadOf({ id: "lock:held", deadline: "10/12/2026" }) }));
      expect(await read("lock:free")).toMatchObject({ lifecycle_status: "closed", is_active: 0, updated_at: NOW_ISO });
    } finally {
      await holder.rollback();
      holder.release();
    }

    const later = await sweep();

    expect(later).toMatchObject({ scanned: 1, closed: 1, closedByIssuerType: { state: 1 } });
    expect(await read("lock:held")).toMatchObject({ lifecycle_status: "closed", is_active: 0, updated_at: NOW_ISO });
    expect(JSON.parse((await read("lock:held")).raw_payload!).lifecycle).toMatchObject({ closed_reason: "deadline_passed", deadline: "10/12/2026" });
  }, 30_000);

  it("leaves a locked bid open on the later pass too when the import that held the lock moved its deadline ahead", async () => {
    await seed([{ id: "lock:held", deadline: "10/12/2026" }, { id: "lock:free", deadline: "10/12/2026" }]);
    const holder = await importer.getConnection();
    await holder.beginTransaction();
    await holder.query("SELECT id FROM bids WHERE id = ? FOR UPDATE", ["lock:held"]);
    try {
      expect(await settlesWithin(sweep(), 5_000)).toMatchObject({ scanned: 2, closed: 1 });
      await holder.query("UPDATE bids SET deadline_date = ?, raw_payload = ? WHERE id = ?", ["12/31/2026", '{"imported":"later"}', "lock:held"]);
      await holder.commit();
    } finally {
      await holder.rollback(); // no-op after the commit; releases the lock if an assertion above failed first
      holder.release();
    }

    const later = await sweep();

    expect(later).toMatchObject({ scanned: 1, closed: 0, unparseable: 0 });
    expect(await read("lock:held")).toMatchObject({ lifecycle_status: "open", is_active: 1, deadline_date: "12/31/2026", raw_payload: '{"imported":"later"}' });
  }, 30_000);

  it("rolls the whole page back when one of its writes fails, and surfaces the error", async () => {
    await seed([{ id: "page:1", deadline: "10/12/2026" }, { id: "page:2", deadline: "10/12/2026" }, { id: "page:3", deadline: "10/12/2026" }]);
    const store = {
      query: mysql.query.bind(mysql),
      getConnection: async () => {
        const connection = await mysql.getConnection();
        const execute = connection.execute.bind(connection) as (sql: string, values?: unknown[]) => Promise<unknown>;
        let writes = 0;
        vi.spyOn(connection, "execute").mockImplementation((async (sql: string, values?: unknown[]) => {
          writes += 1;
          if (writes === 2) throw new Error("connection lost mid-page");
          return execute(sql, values);
        }) as never);
        return connection;
      },
    };

    await expect(sweepExpiredBids({ mysql: store }, { now: NOW })).rejects.toThrow("connection lost mid-page");

    expect((await all()).map((row) => row.lifecycle_status)).toEqual(["open", "open", "open"]);
    // The single pooled connection was handed back: the pool still answers.
    expect(await sweep({ dryRun: true })).toMatchObject({ scanned: 3, closed: 3 });
  });

  it("returns an empty result when there is nothing open", async () => {
    expect(await sweep()).toEqual({ scanned: 0, closed: 0, unparseable: 0, closedByIssuerType: {}, dryRun: false });
  });
});
