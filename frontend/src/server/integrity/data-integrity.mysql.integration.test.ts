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
  nonAsciiBidIds,
  plainStateBid,
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

  /** The pool, with every statement it is asked to run (and the values it is given) written down. */
  function recording(pool: Pool) {
    const statements: Array<{ sql: string; values: unknown[] | undefined }> = [];
    let poolQueries = 0;
    const wrapped = {
      query: (...args: Parameters<Pool["query"]>) => { poolQueries += 1; return pool.query(...args); },
      getConnection: async () => {
        const connection = await pool.getConnection();
        return new Proxy(connection, {
          get(inner, property) {
            if (property === "query") {
              return (sql: string, values?: unknown[]) => { statements.push({ sql: sql.replace(/\s+/g, " ").trim(), values }); return inner.query(sql, values); };
            }
            const value = Reflect.get(inner, property);
            return typeof value === "function" ? value.bind(inner) : value;
          },
        });
      },
    };
    return { pool: wrapped as unknown as DemoPurgeMysql, statements, poolQueries: () => poolQueries };
  }

  const nonAscii = /[^\u0000-\u007f]/;

  describe("ids that are not ASCII (the collation sorts é with e, and keys are not case-sensitive)", () => {
    it("pages through ids with accents, dashes and CJK, a page boundary on one of them, without losing or repeating a bid", async () => {
      // 620 ids, three of every four non-ASCII, interleaved with ASCII ones as the collation orders them.
      const ids = nonAsciiBidIds(620);
      for (const id of ids) {
        const { sql, params } = insertSql(plainStateBid(id));
        await mysql.query(sql, params);
      }
      const spy = recording(mysql);

      const result = await buildIntegritySnapshot({ mysql: spy.pool }, { now: INTEGRITY_NOW });

      // The pages after the first start where the page before ended: at least one of those ids is not ASCII, so the keyset
      // comparison `id > ?` really ran on one.
      const boundaries = spy.statements.filter((statement) => statement.sql.includes("WHERE id > ?")).map((statement) => String(statement.values?.[0]));
      expect(boundaries.length).toBeGreaterThanOrEqual(2);
      expect(boundaries.some((boundary) => nonAscii.test(boundary))).toBe(true);
      expect(Object.keys(result.rows)).toHaveLength(SEEDED_BID_IDS.length + 620);
      expect(Object.keys(result.rows).sort()).toEqual([...SEEDED_BID_IDS, ...ids].sort());
      expect(result.report.levels.state.total).toBe(EXPECTED_LEVELS.state.total + 620);
      expect(result.report.levels.state.openVisible).toBe(EXPECTED_LEVELS.state.openVisible + 620);
    }, 60_000);

    it("pages through ids that are all non-ASCII, so that every boundary is one", async () => {
      const ids = nonAsciiBidIds(620).filter((id) => nonAscii.test(id));
      expect(ids.length).toBeGreaterThan(400);
      for (const id of ids) {
        const { sql, params } = insertSql(plainStateBid(id));
        await mysql.query(sql, params);
      }
      // Only the non-ASCII ids are left, so that every page boundary falls on one.
      await mysql.query(`DELETE FROM bids WHERE id IN (${SEEDED_BID_IDS.map(() => "?").join(", ")})`, [...SEEDED_BID_IDS]);
      const spy = recording(mysql);

      const result = await buildIntegritySnapshot({ mysql: spy.pool }, { now: INTEGRITY_NOW });

      const boundaries = spy.statements.filter((statement) => statement.sql.includes("WHERE id > ?")).map((statement) => String(statement.values?.[0]));
      expect(boundaries.length).toBeGreaterThanOrEqual(1);
      for (const boundary of boundaries) expect(boundary, boundary).toMatch(nonAscii);
      expect(Object.keys(result.rows).sort()).toEqual([...ids].sort());
    }, 60_000);

    it("finds exactly the non-ASCII bid that was removed, and lets a pattern with a non-ASCII character explain it", async () => {
      const ids = nonAsciiBidIds(12);
      for (const id of ids) {
        const { sql, params } = insertSql(plainStateBid(id));
        await mysql.query(sql, params);
      }
      const before = await snapshot();
      await mysql.query("DELETE FROM bids WHERE id IN (?, ?)", [ids[1], ids[2]]);

      const comparison = (await compareWithSnapshot(target(), before, { now: INTEGRITY_NOW, allowRemoved: [/café–A/] })).comparison;

      expect(comparison.removed.ids).toEqual([ids[1], ids[2]].sort());
      expect(comparison.removed.allowed).toEqual([ids[1]]);
      expect(comparison.removed.unexpected).toEqual([ids[2]]);
      expect(comparison.removed.unexpectedByLevel.state).toEqual([ids[2]]);
      expect(comparison.ok).toBe(false);
    });

    it("takes the same snapshot as SQLite for the same non-ASCII ids, hashes included", async () => {
      const ids = nonAsciiBidIds(8);
      const testDb = await createTestDatabase();
      try {
        for (const statement of buildIntegritySeed()) {
          const { sql, params } = insertSql(statement);
          testDb.db.$client.prepare(sql).run(...params);
        }
        for (const id of ids) {
          const { sql, params } = insertSql(plainStateBid(id));
          testDb.db.$client.prepare(sql).run(...params);
          await mysql.query(sql, params);
        }

        const viaSqlite = await buildIntegritySnapshot({ database: testDb.db }, { now: INTEGRITY_NOW });
        const viaMysql = await snapshot();

        for (const id of ids) expect(viaMysql.rows[id], id).toEqual(viaSqlite.rows[id]);
      } finally {
        await testDb.cleanup();
      }
    });
  });

  describe("the column list", () => {
    it("comes from the schema: an empty bids table has the columns a full one has, and is not read as every column added or removed", async () => {
      const full = await snapshot();
      await mysql.query("DELETE FROM bids");
      const empty = await snapshot();
      const toEmpty = await compareWithSnapshot(target(), full, { now: INTEGRITY_NOW, allowRemoved: [] });
      for (const statement of buildIntegritySeed().filter((candidate) => candidate.table === "bids")) {
        const { sql, params } = insertSql(statement);
        await mysql.query(sql, params);
      }
      const fromEmpty = await compareWithSnapshot(target(), empty, { now: INTEGRITY_NOW, allowRemoved: [] });

      expect(Object.keys(empty.rows)).toEqual([]);
      expect(empty.columns).toEqual(full.columns);
      expect(empty.columns.length).toBeGreaterThan(30);
      for (const { comparison } of [toEmpty, fromEmpty]) {
        expect(comparison.columns).toEqual({ added: [], removed: [] });
        expect(comparison.hashesComparable).toBe(true);
        expect(comparison.warnings.map((warning) => warning.code)).toEqual([]);
      }
    });
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
    it("sends only reads, inside one REPEATABLE READ read-only consistent-snapshot transaction, and never uses the pool itself", async () => {
      const spy = recording(mysql);

      await buildIntegritySnapshot({ mysql: spy.pool }, { now: INTEGRITY_NOW });

      const sent = spy.statements.map((statement) => statement.sql);
      expect(sent[0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      expect(sent[1]).toBe("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      for (const statement of sent.slice(2)) expect(statement, statement).toMatch(/^SELECT /);
      expect(sent.length).toBeGreaterThanOrEqual(5);
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

    const insertBulk =
      "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, deadline_date, first_seen_at, last_seen_at, created_at, updated_at) " +
      "VALUES (?, 'California Cal eProcure', ?, ?, ?, 'Bulk body text for a consistency check.', 'California Department of Bulk', 'state', 'CA', ?, '2026-12-01', 'a', '2026-10-01T00:00:00.000Z', 'a', 'a')";

    /** 600 bulk bids, then a scan during which another session deletes 111 of them and adds one right after the first page. */
    async function scanWhileAnotherSessionWrites() {
      for (let n = 0; n < 600; n += 1) {
        await mysql.query(insertBulk, [`ca_caleprocure:bulk-${n}`, `bulk-${n}`, `dedupe:bulk-${n}`, `Bulk bid ${n}`, `https://example.test/bulk/${n}`]);
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
                    // After the first page, from another session: remove 111 bids the scan has not reached, and add one.
                    if (pages === 1) {
                      await writer.query("DELETE FROM bids WHERE id LIKE 'ca_caleprocure:bulk-5%'");
                      await writer.query(insertBulk, ["ca_caleprocure:zzz-late", "zzz-late", "dedupe:zzz-late", "Late bid", "https://example.test/late"]);
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
      return { result, pages };
    }

    async function expectTheMomentTheScanBegan({ result, pages }: Awaited<ReturnType<typeof scanWhileAnotherSessionWrites>>) {
      expect(pages).toBeGreaterThan(1);
      // What the scan saw is the data as it was when it began: the 600 bulk bids, none deleted, the late one absent.
      expect(Object.keys(result.rows)).toHaveLength(SEEDED_BID_IDS.length + 600);
      expect(Object.keys(result.rows)).not.toContain("ca_caleprocure:zzz-late");
      expect(result.report.levels.state.total).toBe(EXPECTED_LEVELS.state.total + 600);
      // A scan begun now sees the writes: bulk-5, bulk-50..59 and bulk-500..599 are gone (111 bids), the late one is there.
      const after = await snapshot();
      expect(Object.keys(after.rows)).toContain("ca_caleprocure:zzz-late");
      expect(Object.keys(after.rows)).toHaveLength(SEEDED_BID_IDS.length + 600 - 111 + 1);
    }

    it("describes one moment even while another connection deletes and inserts between its pages", async () => {
      await expectTheMomentTheScanBegan(await scanWhileAnotherSessionWrites());
    }, 60_000);

    it("describes one moment when the connection's own isolation level is READ COMMITTED, because the scan asks for REPEATABLE READ itself", async () => {
      // The pool has one connection, so this is the session every scan runs on. WITH CONSISTENT SNAPSHOT alone is not enough
      // here: under READ COMMITTED every statement would read the newest committed data.
      await mysql.query("SET SESSION transaction_isolation = 'READ-COMMITTED'");
      try {
        const [rows] = await mysql.query("SELECT @@transaction_isolation AS level");
        expect((rows as Array<{ level: string }>)[0].level).toBe("READ-COMMITTED");

        await expectTheMomentTheScanBegan(await scanWhileAnotherSessionWrites());

        // ...and the scan leaves the session as it found it: SET TRANSACTION covers its own transaction only.
        const [after] = await mysql.query("SELECT @@transaction_isolation AS level");
        expect((after as Array<{ level: string }>)[0].level).toBe("READ-COMMITTED");
      } finally {
        await mysql.query("SET SESSION transaction_isolation = 'REPEATABLE-READ'");
      }
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
