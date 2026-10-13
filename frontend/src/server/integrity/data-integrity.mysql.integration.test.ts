import { randomUUID } from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { queryBidsFromMysql } from "@/server/bids/service";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { createTestDatabase } from "@/server/db/test-utils";
import type { DemoPurgeMysql } from "./demo-purge";
import {
  INTEGRITY_LEVELS,
  buildIntegrityReport,
  buildIntegritySnapshot,
  type IntegrityReport,
  type IntegritySnapshot,
} from "./data-integrity";
import { compareWithSnapshot } from "./data-integrity-compare";
import {
  EXPECTED_LEVELS,
  EXPECTED_MALFORMED_NY_IDS,
  EXPECTED_TOTALS,
  INTEGRITY_NOW,
  SEEDED_BID_IDS,
  buildIntegritySeed,
  insertSql,
} from "./data-integrity.fixtures";

const REAL_ISSUER_TYPES = ["state", "county", "city", "township", "special_district", "federal"] as const;

/**
 * The report, snapshot and compare on real MySQL, held to the answer SQLite gives for the same rows
 * (data-integrity.test.ts). Needs a MySQL 8 server: set CRAWLER_INTEGRATION_MYSQL_URL to a throwaway one (the test
 * creates and drops a database of its own and touches nothing else).
 */
describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("data:integrity on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  // One connection: a read that used the pool while it holds its read-only transaction on that connection would wait forever.
  let mysql: Pool;
  // A second pool, for the writes that happen while a scan is reading.
  let writer: Pool;
  const target = () => ({ mysql: mysql as unknown as DemoPurgeMysql });
  const report = () => buildIntegrityReport(target(), { now: INTEGRITY_NOW });
  const snapshot = () => buildIntegritySnapshot(target(), { now: INTEGRITY_NOW });

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
    writer = createPool({ uri: url.toString(), connectionLimit: 2 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (writer) await writer.end();
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await mysql.query("DELETE FROM bids");
    await mysql.query("DELETE FROM data_sources");
    for (const statement of buildIntegritySeed()) {
      const { sql, params } = insertSql(statement);
      await mysql.query(sql, params);
    }
  });

  async function sqliteReportAndSnapshot() {
    const testDb = await createTestDatabase();
    try {
      for (const statement of buildIntegritySeed()) {
        const { sql, params } = insertSql(statement);
        testDb.db.$client.prepare(sql).run(...params);
      }
      const database = { database: testDb.db };
      return {
        report: await buildIntegrityReport(database, { now: INTEGRITY_NOW }),
        snapshot: await buildIntegritySnapshot(database, { now: INTEGRITY_NOW }),
      };
    } finally {
      await testDb.cleanup();
    }
  }

  it("reports every metric of every level for the seeded data", async () => {
    const result = await report();

    expect(result.dialect).toBe("mysql");
    expect(result.levels).toEqual(EXPECTED_LEVELS);
    expect(result.totals).toEqual(EXPECTED_TOTALS);
    expect(result.malformedNyIds).toBe(EXPECTED_MALFORMED_NY_IDS);
  });

  it("counts exactly what the SQLite run counts on identical seed data", async () => {
    const viaSqlite = await sqliteReportAndSnapshot();

    const viaMysql = await report();

    for (const level of INTEGRITY_LEVELS) expect(viaMysql.levels[level], level).toEqual(viaSqlite.report.levels[level]);
    expect(viaMysql.totals).toEqual(viaSqlite.report.totals);
    expect(viaMysql.malformedNyIds).toBe(viaSqlite.report.malformedNyIds);
  });

  it("shows exactly the rows search shows: openVisible of each level equals queryBidsFromMysql", async () => {
    const result = await report();

    for (const issuerType of REAL_ISSUER_TYPES) {
      const searched = await queryBidsFromMysql(mysql as never, { issuerType });
      expect(result.levels[issuerType].openVisible, issuerType).toBe(searched.total);
    }
    const all = await queryBidsFromMysql(mysql as never, {});
    expect(result.totals.openVisible).toBe(all.total);
    const { rows } = await snapshot();
    expect(Object.entries(rows).filter(([, row]) => row.visible).map(([id]) => id).sort()).toEqual(all.bids.map((bid) => bid.id).sort());
  });

  it("takes the same snapshot as SQLite does: the same rows, flags, tracked columns and hashes", async () => {
    const viaSqlite = await sqliteReportAndSnapshot();

    const viaMysql = await snapshot();

    expect(viaMysql.dialect).toBe("mysql");
    expect(viaMysql.columns).toEqual(viaSqlite.snapshot.columns);
    expect(Object.keys(viaMysql.rows).sort()).toEqual([...SEEDED_BID_IDS].sort());
    for (const id of SEEDED_BID_IDS) {
      expect(viaMysql.rows[id], id).toEqual(viaSqlite.snapshot.rows[id]);
    }
  });

  it("reads more rows than a page holds, in id order, without losing or repeating one", async () => {
    const insert =
      "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, deadline_date, first_seen_at, last_seen_at, created_at, updated_at) " +
      "VALUES (?, 'California Cal eProcure', ?, ?, ?, 'Bulk body text for a page boundary check.', 'California Department of Bulk', 'state', 'CA', ?, '2026-12-01', 'a', '2026-10-01T00:00:00.000Z', 'a', 'a')";
    for (let n = 0; n < 620; n += 1) {
      await mysql.query(insert, [`ca_caleprocure:bulk-${n}`, `bulk-${n}`, `dedupe:bulk-${n}`, `Bulk bid ${n}`, `https://example.test/bulk/${n}`]);
    }

    const result = await snapshot();

    expect(Object.keys(result.rows)).toHaveLength(SEEDED_BID_IDS.length + 620);
    expect(result.report.levels.state.total).toBe(EXPECTED_LEVELS.state.total + 620);
    expect(result.report.levels.state.openVisible).toBe(EXPECTED_LEVELS.state.openVisible + 620);
  });

  describe("the compare", () => {
    const compare = async (before: IntegritySnapshot, allowRemoved: RegExp[] = []) =>
      (await compareWithSnapshot(target(), before, { now: INTEGRITY_NOW, allowRemoved })).comparison;

    it("passes when nothing changed", async () => {
      const before = await snapshot();

      const comparison = await compare(before);

      expect(comparison.ok).toBe(true);
      expect(comparison.failures).toEqual([]);
      expect(comparison.changed.count).toBe(0);
      expect(comparison.changed.onlyOutsideTracked.count).toBe(0);
    });

    it("fails on a removed bid, and passes when --allow-removed explains it", async () => {
      const before = await snapshot();
      await mysql.query("DELETE FROM bids WHERE id = 'ca_caleprocure:RFQ-2'");

      const removed = await compare(before);
      const allowed = await compare(before, [/^ca_caleprocure:RFQ-2$/]);

      expect(removed.ok).toBe(false);
      expect(removed.removed.unexpected).toEqual(["ca_caleprocure:RFQ-2"]);
      expect(removed.failures.map((failure) => failure.code)).toEqual(["removed_unexplained"]);
      expect(allowed.ok).toBe(true);
      expect(allowed.removed.allowed).toEqual(["ca_caleprocure:RFQ-2"]);
    });

    it("fails on a visible open bid that went hidden, and shows a retype by its transition", async () => {
      const before = await snapshot();
      await mysql.query("UPDATE bids SET issuer_name = 'Unknown x' WHERE id = 'ca_caleprocure:RFQ-1'");
      await mysql.query("UPDATE bids SET issuer_type = 'city', jurisdiction_level = 'city', fips_code = '0804000' WHERE id = 'bidnet_co_aurora:202'");

      const comparison = await compare(before);

      expect(comparison.ok).toBe(false);
      expect(comparison.visibility.regressions).toEqual(["ca_caleprocure:RFQ-1"]);
      expect(comparison.changed.groups.map((group) => group.label)).toEqual(expect.arrayContaining(["issuer_type state→city", "issuer_name changed"]));
      expect(comparison.metricDeltas).toEqual(expect.arrayContaining([
        { level: "state", metric: "identityMismatch", before: 1, after: 0, delta: -1 },
      ]));
    });

    it("keeps comparing row by row after a column is added, and says so", async () => {
      const before = await snapshot();
      await mysql.query("ALTER TABLE bids ADD COLUMN integrity_note TEXT");
      try {
        await mysql.query("UPDATE bids SET integrity_note = 'new data' WHERE id = 'ca_caleprocure:RFQ-1'");

        const comparison = await compare(before);

        expect(comparison.hashesComparable).toBe(true);
        expect(comparison.columns).toEqual({ added: ["integrity_note"], removed: [] });
        expect(comparison.changed.count).toBe(0);
        expect(comparison.changed.onlyOutsideTracked.count).toBe(0);
        expect(comparison.ok).toBe(true);
      } finally {
        await mysql.query("ALTER TABLE bids DROP COLUMN integrity_note");
      }
    });
  });

  describe("it only reads, and reads one moment", () => {
    /** The pool, with every statement it is asked to run written down. */
    function recording(pool: Pool) {
      const statements: string[] = [];
      let poolQueries = 0;
      const wrapped = {
        query: (...args: Parameters<Pool["query"]>) => { poolQueries += 1; return pool.query(...args); },
        getConnection: async () => {
          const connection = await pool.getConnection();
          return new Proxy(connection, {
            get(inner, property) {
              if (property === "query") {
                return (sql: string, values?: unknown[]) => { statements.push(sql.replace(/\s+/g, " ").trim()); return inner.query(sql, values); };
              }
              const value = Reflect.get(inner, property);
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        },
      };
      return { pool: wrapped as unknown as DemoPurgeMysql, statements, poolQueries: () => poolQueries };
    }

    it("sends only reads, inside one read-only consistent-snapshot transaction, and never uses the pool itself", async () => {
      const spy = recording(mysql);

      await buildIntegritySnapshot({ mysql: spy.pool }, { now: INTEGRITY_NOW });

      expect(spy.statements[0]).toBe("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      for (const statement of spy.statements.slice(1)) expect(statement, statement).toMatch(/^SELECT /);
      expect(spy.statements.length).toBeGreaterThanOrEqual(3);
      expect(spy.poolQueries()).toBe(0);
    });

    it("has the server refuse a write on the connection it reads on", async () => {
      // What the transaction the scan opens does to a write: not a claim about the scan's code but about the statement it sends.
      const connection = await mysql.getConnection();
      try {
        await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
        await expect(connection.query("DELETE FROM bids")).rejects.toMatchObject({ code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION" });
        await connection.rollback();
      } finally {
        connection.release();
      }
      const [rows] = await mysql.query("SELECT COUNT(*) AS n FROM bids");
      expect((rows as Array<{ n: number }>)[0].n).toBe(SEEDED_BID_IDS.length);
    });

    it("describes one moment even while another connection deletes and inserts between its pages", async () => {
      const insert =
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, deadline_date, first_seen_at, last_seen_at, created_at, updated_at) " +
        "VALUES (?, 'California Cal eProcure', ?, ?, ?, 'Bulk body text for a consistency check.', 'California Department of Bulk', 'state', 'CA', ?, '2026-12-01', 'a', '2026-10-01T00:00:00.000Z', 'a', 'a')";
      for (let n = 0; n < 600; n += 1) {
        await mysql.query(insert, [`ca_caleprocure:bulk-${n}`, `bulk-${n}`, `dedupe:bulk-${n}`, `Bulk bid ${n}`, `https://example.test/bulk/${n}`]);
      }
      let pages = 0;
      const interleaving = {
        query: mysql.query.bind(mysql),
        getConnection: async () => {
          const connection = await mysql.getConnection();
          return new Proxy(connection, {
            get(inner, property) {
              if (property === "query") {
                return async (sql: string, values?: unknown[]) => {
                  const result = await inner.query(sql, values);
                  if (/FROM bids/.test(sql)) {
                    pages += 1;
                    // After the first page, from another session: remove 100 bids the scan has not reached, and add one.
                    if (pages === 1) {
                      await writer.query("DELETE FROM bids WHERE id LIKE 'ca_caleprocure:bulk-5%'");
                      await writer.query(insert, ["ca_caleprocure:zzz-late", "zzz-late", "dedupe:zzz-late", "Late bid", "https://example.test/late"]);
                    }
                  }
                  return result;
                };
              }
              const value = Reflect.get(inner, property);
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        },
      } as unknown as DemoPurgeMysql;

      const result = await buildIntegritySnapshot({ mysql: interleaving }, { now: INTEGRITY_NOW });

      expect(pages).toBeGreaterThan(1);
      // What the scan saw is the data as it was when it began: the 600 bulk bids, none deleted, the late one absent.
      expect(Object.keys(result.rows)).toHaveLength(SEEDED_BID_IDS.length + 600);
      expect(Object.keys(result.rows)).not.toContain("ca_caleprocure:zzz-late");
      expect(result.report.levels.state.total).toBe(EXPECTED_LEVELS.state.total + 600);
      // A scan begun now sees the writes: bulk-5, bulk-50..59 and bulk-500..599 are gone (111 bids), the late one is there.
      const after = await snapshot();
      expect(Object.keys(after.rows)).toContain("ca_caleprocure:zzz-late");
      expect(Object.keys(after.rows)).toHaveLength(SEEDED_BID_IDS.length + 600 - 111 + 1);
    }, 60_000);

    it("leaves every row as it was", async () => {
      const [bidsBefore] = await mysql.query("SELECT * FROM bids ORDER BY id");
      const [sourcesBefore] = await mysql.query("SELECT * FROM data_sources ORDER BY id");

      const taken: IntegrityReport = (await snapshot()).report;
      await compareWithSnapshot(target(), await snapshot(), { now: INTEGRITY_NOW, allowRemoved: [] });

      expect(taken.totals.total).toBe(SEEDED_BID_IDS.length);
      expect((await mysql.query("SELECT * FROM bids ORDER BY id"))[0]).toEqual(bidsBefore);
      expect((await mysql.query("SELECT * FROM data_sources ORDER BY id"))[0]).toEqual(sourcesBefore);
    });
  });
});
