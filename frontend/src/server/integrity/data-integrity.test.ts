import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { queryBidsFromDatabase } from "@/server/bids/service";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import type { DemoPurgeMysql } from "./demo-purge";
import {
  INTEGRITY_LEVELS,
  IntegritySnapshotError,
  TRACKED_COLUMNS,
  buildIntegrityReport,
  buildIntegritySnapshot,
  canonicalRowJson,
  hashBidRow,
  levelOfIssuerType,
  parseIntegritySnapshot,
  serializeIntegritySnapshot,
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

/** The ids the seed lists as visible: open, shown, publishable, active. Written out so that a change to the gate shows up here. */
const VISIBLE_SEEDED_IDS = [
  "1",
  "al_state_procurement_demo_readiness",
  "bidnet_co_aurora:201",
  "bidnet_co_aurora:203",
  "bidnet_co_boulder:111",
  "bidnet_co_boulder:112",
  "bidnet_pa_lower_twp:301",
  "ca_caleprocure:RFQ-1",
  "ca_caleprocure:RFQ-2",
  "ca_caleprocure:legacy-7",
  "sam_gov:abc123",
];

describe("levelOfIssuerType", () => {
  it("is the issuer type when it is one of the six levels, otherwise other", () => {
    for (const type of REAL_ISSUER_TYPES) expect(levelOfIssuerType(type)).toBe(type);
    for (const type of ["agency", "", "County", "county ", null, undefined, 3]) expect(levelOfIssuerType(type)).toBe("other");
  });

  it("lists the levels in report order, other last", () => {
    expect([...INTEGRITY_LEVELS]).toEqual(["state", "county", "city", "township", "special_district", "federal", "other"]);
  });
});

describe("row hashing", () => {
  it("is the same whatever order the columns come in", () => {
    expect(canonicalRowJson({ b: 1, a: "x" })).toBe(canonicalRowJson({ a: "x", b: 1 }));
    expect(canonicalRowJson({ b: 1, a: "x" })).toBe('{"a":"x","b":1}');
  });

  it("keeps NULL apart from an empty string, and a number apart from its text", () => {
    expect(canonicalRowJson({ a: null })).not.toBe(canonicalRowJson({ a: "" }));
    expect(canonicalRowJson({ a: 1 })).not.toBe(canonicalRowJson({ a: "1" }));
    expect(canonicalRowJson({ a: "" })).toBe('{"a":""}');
    expect(canonicalRowJson({ a: null })).toBe('{"a":null}');
  });

  it("leaves out the columns the scan adds, and hashes only the columns it is asked to", () => {
    expect(canonicalRowJson({ a: 1, __integrity_shown: 1 })).toBe('{"a":1}');
    expect(canonicalRowJson({ a: 1, b: 2, c: 3 }, ["c", "a", "gone"])).toBe('{"a":1,"c":3}');
  });

  it("is a sha256 in hex that changes with any column", () => {
    const row = { id: "x", title: "T", description: "D" };
    expect(hashBidRow(row)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBidRow({ ...row })).toBe(hashBidRow(row));
    expect(hashBidRow({ ...row, description: "D2" })).not.toBe(hashBidRow(row));
    expect(hashBidRow({ ...row, description: "D2" }, ["id", "title"])).toBe(hashBidRow(row, ["id", "title"]));
  });
});

describe("data:integrity on SQLite", () => {
  let testDb: TestDatabase;
  const sqlite = () => testDb.db.$client;
  const target = () => ({ database: testDb.db });
  const report = () => buildIntegrityReport(target(), { now: INTEGRITY_NOW });
  const snapshot = (hashColumns?: readonly string[]) => buildIntegritySnapshot(target(), { now: INTEGRITY_NOW, hashColumns });
  const run = (sql: string, ...params: unknown[]) => sqlite().prepare(sql).run(...params);
  const totalChanges = () => (sqlite().prepare("SELECT total_changes() AS n").get() as { n: number }).n;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    for (const statement of buildIntegritySeed()) {
      const { sql, params } = insertSql(statement);
      run(sql, ...params);
    }
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  describe("the report", () => {
    it("reports every metric of every level for the seeded data", async () => {
      const result = await report();

      expect(result.levels).toEqual(EXPECTED_LEVELS);
      expect(result.totals).toEqual(EXPECTED_TOTALS);
      expect(result.malformedNyIds).toBe(EXPECTED_MALFORMED_NY_IDS);
      expect(result.malformedNyIdList).toEqual(["ny_contract_reporter:CR9 Company: Acme Inc"]);
      expect(result.dialect).toBe("sqlite");
      expect(result.generatedAt).toBe("2026-10-13T12:00:00.000Z");
    });

    it("lists the levels in report order and the hidden reasons most frequent first", async () => {
      const result = await report();

      expect(Object.keys(result.levels)).toEqual([...INTEGRITY_LEVELS]);
      expect(Object.keys(result.levels.state.hiddenReasons)).toEqual([
        "invalid_issuer", "inactive_flag", "registered_source_ambiguous", "registered_source_mismatch", "suppressed",
      ]);
      expect(Object.keys(result.totals.hiddenReasons)).toEqual([
        "registered_source_mismatch", "invalid_issuer", "inactive_flag", "invalid_issuer_type",
        "registered_source_ambiguous", "suppressed",
      ]);
    });

    it("explains every hidden open row, and the open rows add up", async () => {
      const result = await report();

      for (const level of INTEGRITY_LEVELS) {
        const entry = result.levels[level];
        expect(entry.hiddenReasons, level).not.toHaveProperty("unexplained");
        expect(Object.values(entry.hiddenReasons).reduce((sum, count) => sum + count, 0), level).toBeGreaterThanOrEqual(entry.openHidden);
        expect(entry.openVisible + entry.openHidden, level).toBe(entry.open);
        expect(entry.open + entry.closed + entry.awarded, level).toBe(entry.total);
        expect(entry.withBody + entry.bodyMissing, level).toBeLessThanOrEqual(entry.open);
      }
    });

    it("counts a FIPS-mismatched county row as an identity mismatch and hides it", async () => {
      const { county } = (await report()).levels;

      expect(county.identityMismatch).toBe(1);
      expect(county.hiddenReasons).toEqual({ registered_source_mismatch: 1 });
      expect(county.openHidden).toBe(1);
    });

    it("hides an open row whose issuer is a placeholder and keeps it out of withIssuer", async () => {
      const { state } = (await report()).levels;

      expect(state.hiddenReasons.invalid_issuer).toBe(2);
      expect(state.withIssuer).toBe(state.open - 2);
    });

    it("splits a missing body into locked at the source portal and genuinely missing", async () => {
      const { county, township, state } = (await report()).levels;

      expect(county.detailLockedAtSource).toBe(1);
      expect(county.withBody).toBe(2);
      expect(county.bodyMissing).toBe(0);
      expect(township.detailLockedAtSource).toBe(1);
      expect(township.withBody).toBe(0);
      expect(state.detailLockedAtSource).toBe(0);
      expect(state.bodyMissing).toBe(1);
    });

    it("counts an open row past its deadline, and a deadline it cannot read, but not a closed one", async () => {
      const { state, city, county } = (await report()).levels;

      expect(state.expiredOpen).toBe(1);
      expect(city.expiredOpen).toBe(1);
      expect(county.expiredOpen).toBe(0);
      expect(state.deadlineParseable).toBe(state.open - 1);
      expect(county.deadlineParseable).toBe(county.open - 1);
    });

    it("counts the unregistered and demo-like rows, and the ids that are not <source>:<source_bid_id>", async () => {
      const { state } = (await report()).levels;

      expect(state.unregistered).toBe(3);
      expect(state.demoLike).toBe(2);
      expect(state.nonCanonicalId).toBe(4);
    });

    it("reads the source health of enabled sources only, with a blank jurisdiction level as state and sam_gov as federal", async () => {
      const { levels } = await report();

      expect(levels.state.sourceHealth).toEqual({ sources: 3, neverSucceeded: 1, succeededWithin2d: 1, succeededWithin7d: 2, failing: 1 });
      expect(levels.federal.sourceHealth.sources).toBe(1);
      expect(levels.special_district.sourceHealth.sources).toBe(0);
      expect(levels.other.sourceHealth.sources).toBe(0);
    });

    it("reports every level as zero for an empty database", async () => {
      sqlite().exec("DELETE FROM bids; DELETE FROM data_sources;");

      const result = await report();

      expect(Object.keys(result.levels)).toEqual([...INTEGRITY_LEVELS]);
      for (const level of INTEGRITY_LEVELS) {
        expect(result.levels[level].total, level).toBe(0);
        expect(result.levels[level].newestLastSeenAt, level).toBeNull();
        expect(result.levels[level].hiddenReasons, level).toEqual({});
      }
      expect(result.totals.total).toBe(0);
      expect(result.malformedNyIds).toBe(0);
    });

    it("reads the rows in pages: more rows than one page change nothing", async () => {
      for (let n = 0; n < 700; n += 1) {
        run(
          "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, deadline_date, first_seen_at, last_seen_at, created_at, updated_at) " +
            "VALUES (?, 'California Cal eProcure', ?, ?, ?, 'Bulk body text for a page boundary check.', 'California Department of Bulk', 'state', 'CA', ?, '2026-12-01', 'a', '2026-10-01T00:00:00.000Z', 'a', 'a')",
          `ca_caleprocure:bulk-${n}`, `bulk-${n}`, `dedupe:bulk-${n}`, `Bulk bid ${n}`, `https://example.test/bulk/${n}`,
        );
      }

      const result = await report();

      expect(result.levels.state.total).toBe(EXPECTED_LEVELS.state.total + 700);
      expect(result.levels.state.openVisible).toBe(EXPECTED_LEVELS.state.openVisible + 700);
      expect(Object.keys((await snapshot()).rows)).toHaveLength(SEEDED_BID_IDS.length + 700);
    });

    it("reads a database whose row count is exactly a page, or exactly two", async () => {
      const insert = sqlite().prepare(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, deadline_date, first_seen_at, last_seen_at, created_at, updated_at) " +
          "VALUES (?, 'California Cal eProcure', ?, ?, ?, 'Bulk body text for a page boundary check.', 'California Department of Bulk', 'state', 'CA', ?, '2026-12-01', 'a', '2026-10-01T00:00:00.000Z', 'a', 'a')",
      );
      // The seed holds 23 bids and a page holds 250: 227 more make one full page, 477 more make two.
      for (let n = 0; n < 477; n += 1) {
        insert.run(`ca_caleprocure:page-${String(n).padStart(3, "0")}`, `page-${n}`, `dedupe:page-${n}`, `Page bid ${n}`, `https://example.test/page/${n}`);
        if (n === 226 || n === 476) {
          const result = await report();
          expect(result.totals.total, `after ${n + 1} more`).toBe(SEEDED_BID_IDS.length + n + 1);
          expect(Object.keys((await snapshot()).rows), `after ${n + 1} more`).toHaveLength(SEEDED_BID_IDS.length + n + 1);
        }
      }
    });

    it("takes the body from the full description when the short one is empty", async () => {
      run("UPDATE bids SET full_description = 'Full scope of work for laboratory supplies across state facilities.' WHERE id = 'ca_caleprocure:legacy-7'");

      const { state } = (await report()).levels;

      expect(state.withBody).toBe(EXPECTED_LEVELS.state.withBody + 1);
      expect(state.bodyMissing).toBe(0);
    });

    it("does not take a copy of the title for a body", async () => {
      run("UPDATE bids SET description = title WHERE id = 'ca_caleprocure:RFQ-1'");

      const { state } = (await report()).levels;

      expect(state.withBody).toBe(EXPECTED_LEVELS.state.withBody - 1);
      expect(state.bodyMissing).toBe(EXPECTED_LEVELS.state.bodyMissing + 1);
    });

    it("counts the malformed NY ids, and only those", async () => {
      run(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) " +
          "VALUES ('ny_contract_reporter:CR10 Company:Acme', 'NY Contract Reporter', 'CR10 Company:Acme', 'd10', 'T', 'D', 'Unknown state agency', 'state', 'NY', 'https://example.test/x', 'a', 'a', 'a', 'a')",
      );
      run(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) " +
          "VALUES ('ny_contract_reporter:CR11', 'NY Contract Reporter', 'CR11', 'd11', 'T', 'D', 'Acme Inc', 'state', 'NY', 'https://example.test/y', 'a', 'a', 'a', 'a')",
      );

      const result = await report();

      expect(result.malformedNyIds).toBe(EXPECTED_MALFORMED_NY_IDS + 1);
      // The ids behind the count, in code-unit order (not the database's collation), the clean CR11 not among them.
      expect(result.malformedNyIdList).toEqual(["ny_contract_reporter:CR10 Company:Acme", "ny_contract_reporter:CR9 Company: Acme Inc"]);
      expect(result.malformedNyIdList).toHaveLength(result.malformedNyIds);
    });

    it("counts a lower-case state code as a mismatch although the gate still shows the row", async () => {
      run("UPDATE bids SET state_code = 'co' WHERE id = 'bidnet_co_boulder:111'");

      const { county } = (await report()).levels;

      expect(county.identityMismatch).toBe(2);
      expect(county.openVisible).toBe(2);
    });

    it("counts a NULL source_bid_id as a non-canonical id", async () => {
      run("UPDATE bids SET source_bid_id = NULL WHERE id = 'tx_esbd:100'");

      expect((await report()).levels.state.nonCanonicalId).toBe(5);
    });

    it("explains a bid the stored data quality verdict hides", async () => {
      const verdict = (overrides: object) => JSON.stringify({
        data_quality: {
          schemaVersion: 1, checkedAt: "2026-10-01T00:00:00.000Z", coreValid: true,
          coreIssues: [], capabilities: { discovery: true, analysis: true, attachments: true },
          body: { valid: true, reason: "", verifiedAt: null, reused: false },
          attachments: { discovered: 0, archived: 0, verified: 0 },
          ...overrides,
        },
      });
      run("UPDATE bids SET raw_payload = ? WHERE id = 'ca_caleprocure:RFQ-1'", verdict({ coreValid: false }));
      run("UPDATE bids SET raw_payload = ? WHERE id = 'ca_caleprocure:RFQ-2'", verdict({ capabilities: { discovery: false, analysis: true, attachments: true } }));

      const { state } = (await report()).levels;

      expect(state.openVisible).toBe(EXPECTED_LEVELS.state.openVisible - 2);
      expect(state.hiddenReasons.data_quality_core_invalid).toBe(1);
      expect(state.hiddenReasons.data_quality_discovery_off).toBe(1);
      expect(state.hiddenReasons).not.toHaveProperty("unexplained");
    });
  });

  describe("visibility is what search shows", () => {
    it("openVisible of each level equals the rows queryBids returns for that issuer type", async () => {
      const result = await report();

      for (const issuerType of REAL_ISSUER_TYPES) {
        const searched = await queryBidsFromDatabase(testDb.db, { issuerType });
        expect(result.levels[issuerType].openVisible, issuerType).toBe(searched.total);
      }
      const all = await queryBidsFromDatabase(testDb.db, {});
      expect(result.totals.openVisible).toBe(all.total);
      expect(all.total - REAL_ISSUER_TYPES.reduce((sum, type) => sum + result.levels[type].openVisible, 0)).toBe(result.levels.other.openVisible);
    });

    it("marks exactly the rows search returns as visible, row by row", async () => {
      const { rows } = await snapshot();
      const searched = (await queryBidsFromDatabase(testDb.db, {})).bids.map((bid) => bid.id).sort();

      expect(Object.entries(rows).filter(([, row]) => row.visible).map(([id]) => id).sort()).toEqual(searched);
      expect(searched).toEqual([...VISIBLE_SEEDED_IDS].sort());
    });

    it("keeps agreeing with search after rows change", async () => {
      run("UPDATE bids SET issuer_name = 'Unknown x' WHERE id = 'ca_caleprocure:RFQ-1'");
      run("UPDATE bids SET display_status = 'suppressed' WHERE id = 'bidnet_co_aurora:201'");
      run("UPDATE bids SET issuer_type = 'city', jurisdiction_level = 'city', fips_code = '0804000' WHERE id = 'bidnet_co_aurora:202'");
      run("UPDATE bids SET fips_code = '08014' WHERE id = 'bidnet_co_boulder:111'");

      const result = await report();
      const { rows } = await snapshot();

      for (const issuerType of REAL_ISSUER_TYPES) {
        const searched = await queryBidsFromDatabase(testDb.db, { issuerType });
        expect(result.levels[issuerType].openVisible, issuerType).toBe(searched.total);
      }
      const searched = (await queryBidsFromDatabase(testDb.db, {})).bids.map((bid) => bid.id).sort();
      expect(Object.entries(rows).filter(([, row]) => row.visible).map(([id]) => id).sort()).toEqual(searched);
    });

    it("counts a closed row that still carries is_active = 1 as shown by search but not as open, and reports the disagreement", async () => {
      run("UPDATE bids SET is_active = 1 WHERE id = 'tx_esbd:101'");

      const result = await report();
      const { rows } = await snapshot();
      const searched = await queryBidsFromDatabase(testDb.db, { issuerType: "state" });

      expect(result.levels.state.activeFlagMismatch).toBe(EXPECTED_LEVELS.state.activeFlagMismatch + 1);
      expect(result.levels.state.openVisible).toBe(EXPECTED_LEVELS.state.openVisible);
      expect(searched.total).toBe(EXPECTED_LEVELS.state.openVisible + 1);
      expect(rows["tx_esbd:101"]).toMatchObject({ open: false, visible: true });
    });
  });

  describe("the snapshot", () => {
    it("has the documented shape: one entry per bid with a hash, level, visible, open and the tracked columns", async () => {
      const result = await snapshot();

      expect(result.version).toBe(1);
      expect(result.takenAt).toBe("2026-10-13T12:00:00.000Z");
      expect(result.dialect).toBe("sqlite");
      expect(Object.keys(result.rows).sort()).toEqual([...SEEDED_BID_IDS].sort());
      expect(result.report).toEqual(await report());
      expect(result.rows["bidnet_co_boulder:113"]).toMatchObject({
        level: "county", visible: false, open: true,
        t: {
          issuer_type: "county", jurisdiction_level: "county", fips_code: "08014", lifecycle_status: "open", is_active: 1,
          display_status: "published", issuer_name: "Boulder County", title: "Snow plow lease", deadline_date: "12/05/2026",
          source_bid_id: "113",
        },
      });
      for (const row of Object.values(result.rows)) {
        expect(row.h).toMatch(/^[0-9a-f]{64}$/);
        expect(Object.keys(row.t)).toEqual([...TRACKED_COLUMNS]);
        expect(INTEGRITY_LEVELS).toContain(row.level);
      }
    });

    it("lists the columns it hashed, the scan's own columns excluded", async () => {
      const { columns } = await snapshot();

      expect(columns).toEqual([...columns].sort());
      expect(columns).toEqual(expect.arrayContaining(["id", "raw_payload", "description", "full_description", "lifecycle_status", "updated_at"]));
      expect(columns.some((column) => column.startsWith("__integrity"))).toBe(false);
    });

    it("takes the column list from the schema: an empty bids table has the same columns as a full one", async () => {
      const full = await snapshot();
      sqlite().exec("DELETE FROM bids");

      const empty = await snapshot();

      expect(Object.keys(empty.rows)).toEqual([]);
      expect(empty.columns).toEqual(full.columns);
      expect(empty.columns).toEqual((sqlite().prepare("PRAGMA table_info(bids)").all() as Array<{ name: string }>).map((column) => column.name).sort());
    });

    it("records why a closed row was closed, and only then", async () => {
      const { rows } = await snapshot();

      expect(rows["tx_esbd:101"].c).toBe("deadline_passed");
      expect(rows["bidnet_co_boulder:114"].c).toBe("delisted");
      expect(rows["tx_esbd:102"]).not.toHaveProperty("c");
      expect(rows["ca_caleprocure:RFQ-1"]).not.toHaveProperty("c");
    });

    it("is not a copy of the rows: no payload, description or contact text, and a small row", async () => {
      const text = serializeIntegritySnapshot(await snapshot());

      expect(text).not.toContain("detail_access");
      expect(text).not.toContain("Culvert replacement on County Road 7.");
      expect(text).not.toContain("example.test");
      expect(text).not.toContain("\n");
    });

    it("is the same snapshot every time for the same data, hashes and file bytes included", async () => {
      const first = serializeIntegritySnapshot(await snapshot());
      const second = serializeIntegritySnapshot(await snapshot());

      expect(second).toBe(first);
    });

    it("hashes a column the tracked set does not hold", async () => {
      const before = await snapshot();
      run("UPDATE bids SET description = 'A different body text.' WHERE id = 'ca_caleprocure:RFQ-1'");
      const after = await snapshot();

      expect(after.rows["ca_caleprocure:RFQ-1"].h).not.toBe(before.rows["ca_caleprocure:RFQ-1"].h);
      expect(after.rows["ca_caleprocure:RFQ-1"].t).toEqual(before.rows["ca_caleprocure:RFQ-1"].t);
      expect(after.rows["ca_caleprocure:RFQ-2"].h).toBe(before.rows["ca_caleprocure:RFQ-2"].h);
    });

    it("keeps NULL apart from an empty string in the hash", async () => {
      const before = await snapshot();
      run("UPDATE bids SET contact_name = '' WHERE id = 'ca_caleprocure:RFQ-1'");
      const emptied = await snapshot();
      run("UPDATE bids SET contact_name = NULL WHERE id = 'ca_caleprocure:RFQ-1'");
      const nulled = await snapshot();

      expect(emptied.rows["ca_caleprocure:RFQ-1"].h).not.toBe(before.rows["ca_caleprocure:RFQ-1"].h);
      expect(nulled.rows["ca_caleprocure:RFQ-1"].h).toBe(before.rows["ca_caleprocure:RFQ-1"].h);
    });

    it("round-trips through the file format", async () => {
      const original = await snapshot();

      const parsed = parseIntegritySnapshot(serializeIntegritySnapshot(original));

      expect(parsed).toEqual(original);
      expect(serializeIntegritySnapshot(parsed)).toBe(serializeIntegritySnapshot(original));
    });

    it("refuses what is not a snapshot", async () => {
      const valid = JSON.parse(serializeIntegritySnapshot(await snapshot()));

      expect(() => parseIntegritySnapshot("not json")).toThrow(IntegritySnapshotError);
      expect(() => parseIntegritySnapshot("[]")).toThrow("not a data:integrity snapshot");
      expect(() => parseIntegritySnapshot(JSON.stringify({ ...valid, version: 2 }))).toThrow("version 2");
      expect(() => parseIntegritySnapshot(JSON.stringify({ ...valid, rows: [] }))).toThrow(IntegritySnapshotError);
      expect(() => parseIntegritySnapshot(JSON.stringify({ ...valid, report: null }))).toThrow(IntegritySnapshotError);
      expect(() => parseIntegritySnapshot(JSON.stringify({ ...valid, columns: "id" }))).toThrow(IntegritySnapshotError);
      expect(() => parseIntegritySnapshot(JSON.stringify({ ...valid, rows: { x: { h: 1 } } }))).toThrow(IntegritySnapshotError);
    });

    it("keeps ids with accents, dashes, CJK and astral characters whole through the report, the file and the compare", async () => {
      const ids = [...nonAsciiBidIds(8), "ca_caleprocure:𠜎-9", "ca_caleprocure:Ünïcödé – 10"];
      for (const id of ids) {
        const { sql, params } = insertSql(plainStateBid(id));
        run(sql, ...params);
      }

      const before = await snapshot();
      const viaFile = parseIntegritySnapshot(serializeIntegritySnapshot(before));

      expect(Object.keys(viaFile.rows).sort()).toEqual([...SEEDED_BID_IDS, ...ids].sort());
      for (const id of ids) expect(viaFile.rows[id], id).toEqual(before.rows[id]);
      expect(before.report.levels.state.total).toBe(EXPECTED_LEVELS.state.total + ids.length);
      expect(before.report.levels.state.openVisible).toBe(EXPECTED_LEVELS.state.openVisible + ids.length);

      run("DELETE FROM bids WHERE id IN (?, ?)", ids[1], ids[8]);
      const removed = (await compareWithSnapshot(target(), viaFile, { now: INTEGRITY_NOW, allowRemoved: [/café–A/] })).comparison;

      expect(removed.removed.ids).toEqual([ids[1], ids[8]].sort());
      expect(removed.removed.allowed).toEqual([ids[1]]);
      expect(removed.removed.unexpected).toEqual([ids[8]]);
      expect(removed.ok).toBe(false);
    });

    it("treats an id like a prototype property as an ordinary id", async () => {
      run(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) " +
          "VALUES ('__proto__', 'Odd', 'odd', 'dodd', 'T', 'D', 'Odd Agency', 'state', 'CA', 'https://example.test/odd', 'a', 'a', 'a', 'a')",
      );

      const parsed = parseIntegritySnapshot(serializeIntegritySnapshot(await snapshot()));

      expect(Object.keys(parsed.rows)).toContain("__proto__");
      expect(Object.hasOwn(parsed.rows, "__proto__")).toBe(true);
      expect(Object.hasOwn(parsed.rows, "constructor")).toBe(false);
    });
  });

  describe("the compare against a snapshot taken before", () => {
    const compare = async (before: Awaited<ReturnType<typeof snapshot>>, allowRemoved: RegExp[] = []) =>
      (await compareWithSnapshot(target(), before, { now: INTEGRITY_NOW, allowRemoved })).comparison;

    it("passes, and reports nothing, when nothing changed", async () => {
      const before = await snapshot();

      const comparison = await compare(before);

      expect(comparison.ok).toBe(true);
      expect(comparison.failures).toEqual([]);
      expect(comparison.warnings).toEqual([]);
      expect(comparison.added.count).toBe(0);
      expect(comparison.removed.count).toBe(0);
      expect(comparison.changed.count).toBe(0);
      expect(comparison.changed.onlyOutsideTracked.count).toBe(0);
      expect(comparison.metricDeltas).toEqual([]);
      expect(comparison.hashesComparable).toBe(true);
    });

    it("fails when a row was removed, naming it and its level", async () => {
      const before = await snapshot();
      run("DELETE FROM bids WHERE id = 'ca_caleprocure:RFQ-2'");

      const comparison = await compare(before);

      expect(comparison.ok).toBe(false);
      expect(comparison.removed).toMatchObject({ count: 1, unexpected: ["ca_caleprocure:RFQ-2"], allowed: [] });
      expect(comparison.removed.byLevel.state).toBe(1);
      expect(comparison.failures.map((failure) => failure.code)).toEqual(["removed_unexplained"]);
      expect(comparison.failures[0].ids).toEqual(["ca_caleprocure:RFQ-2"]);
    });

    it("lets --allow-removed explain the deletion", async () => {
      const before = await snapshot();
      run("DELETE FROM bids WHERE id = 'ca_caleprocure:RFQ-2'");

      const comparison = await compare(before, [/^ca_caleprocure:RFQ-2$/]);

      expect(comparison.ok).toBe(true);
      expect(comparison.failures).toEqual([]);
      expect(comparison.removed).toMatchObject({ count: 1, unexpected: [], allowed: ["ca_caleprocure:RFQ-2"] });
    });

    it("fails on a visible open row that went hidden, and says what changed on it", async () => {
      const before = await snapshot();
      run("UPDATE bids SET issuer_name = 'Unknown x' WHERE id = 'ca_caleprocure:RFQ-1'");

      const comparison = await compare(before);

      expect(comparison.ok).toBe(false);
      expect(comparison.visibility.regressions).toEqual(["ca_caleprocure:RFQ-1"]);
      expect(comparison.failures.map((failure) => failure.code)).toEqual(["visibility_regression"]);
      expect(comparison.changed.groups).toEqual([
        { label: "issuer_name changed", column: "issuer_name", count: 1, sampleIds: ["ca_caleprocure:RFQ-1"] },
      ]);
      expect(comparison.metricDeltas).toEqual(expect.arrayContaining([
        { level: "state", metric: "openVisible", before: 5, after: 4, delta: -1 },
        { level: "total", metric: "openHidden", before: 8, after: 9, delta: 1 },
      ]));
    });

    it("reports a retype by its transition and passes when the row now agrees with its source", async () => {
      const before = await snapshot();
      run("UPDATE bids SET issuer_type = 'city', jurisdiction_level = 'city', fips_code = '0804000' WHERE id = 'bidnet_co_aurora:202'");

      const comparison = await compare(before);

      expect(comparison.ok).toBe(true);
      expect(comparison.changed.count).toBe(1);
      expect(comparison.changed.groups).toEqual(expect.arrayContaining([
        { label: "issuer_type state→city", column: "issuer_type", from: "state", to: "city", count: 1, sampleIds: ["bidnet_co_aurora:202"] },
        { label: "jurisdiction_level NULL→city", column: "jurisdiction_level", from: "NULL", to: "city", count: 1, sampleIds: ["bidnet_co_aurora:202"] },
        { label: "fips_code changed", column: "fips_code", count: 1, sampleIds: ["bidnet_co_aurora:202"] },
      ]));
      expect(comparison.metricDeltas).toEqual(expect.arrayContaining([
        { level: "state", metric: "identityMismatch", before: 1, after: 0, delta: -1 },
        { level: "city", metric: "openVisible", before: 2, after: 3, delta: 1 },
      ]));
      expect(comparison.visibility.regressions).toEqual([]);
    });

    it("fails when a level's identity mismatches rise", async () => {
      const before = await snapshot();
      // A closed row: it can only add a mismatch, not take a visible bid away.
      run("UPDATE bids SET fips_code = '08099' WHERE id = 'bidnet_co_boulder:114'");

      const comparison = await compare(before);

      expect(comparison.ok).toBe(false);
      expect(comparison.failures).toEqual([
        expect.objectContaining({ code: "identity_mismatch_increased", level: "county", message: expect.stringContaining("1 -> 2") }),
      ]);
      expect(comparison.visibility.regressions).toEqual([]);
    });

    it("warns when a row went from open to closed with no recorded reason, and not for a recorded one", async () => {
      const before = await snapshot();
      run("UPDATE bids SET lifecycle_status = 'closed', is_active = 0 WHERE id = 'ca_caleprocure:RFQ-1'");
      run(
        "UPDATE bids SET lifecycle_status = 'closed', is_active = 0, raw_payload = ? WHERE id = 'ca_caleprocure:RFQ-2'",
        JSON.stringify({ lifecycle: { closed_reason: "deadline_passed", closed_observed_at: "2026-10-13T12:00:00.000Z" } }),
      );
      run(
        "UPDATE bids SET lifecycle_status = 'closed', is_active = 0, raw_payload = ? WHERE id = 'bidnet_co_aurora:201'",
        JSON.stringify({ lifecycle: { closed_reason: "delisted" } }),
      );
      run(
        "UPDATE bids SET lifecycle_status = 'closed', is_active = 0, raw_payload = ? WHERE id = 'bidnet_co_boulder:111'",
        JSON.stringify({ lifecycle: { closed_reason: "something_else" } }),
      );
      run("UPDATE bids SET lifecycle_status = 'awarded', is_active = 0 WHERE id = 'ca_caleprocure:legacy-7'");

      const comparison = await compare(before);

      expect(comparison.ok).toBe(true);
      expect(comparison.warnings).toEqual([
        expect.objectContaining({ code: "closed_without_reason", ids: ["bidnet_co_boulder:111", "ca_caleprocure:RFQ-1"] }),
      ]);
      expect(comparison.changed.groups).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: "lifecycle_status open→closed", count: 4 }),
        expect.objectContaining({ label: "lifecycle_status open→awarded", count: 1 }),
      ]));
    });

    it("counts a row whose only change is outside the tracked columns", async () => {
      const before = await snapshot();
      run("UPDATE bids SET description = 'Changed body text.' WHERE id = 'ca_caleprocure:RFQ-1'");

      const comparison = await compare(before);

      expect(comparison.ok).toBe(true);
      expect(comparison.changed.count).toBe(0);
      expect(comparison.changed.onlyOutsideTracked).toEqual({ count: 1, ids: ["ca_caleprocure:RFQ-1"] });
    });

    it("lists the rows that were added, by level", async () => {
      const before = await snapshot();
      run(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) " +
          "VALUES ('tx_esbd:200', 'Texas ESBD', '200', 'd200', 'New', 'A brand new bid.', 'Texas Facilities Commission', 'state', 'TX', 'https://example.test/200', 'a', '2026-10-13T09:00:00.000Z', 'a', 'a')",
      );

      const comparison = await compare(before);

      expect(comparison.ok).toBe(true);
      expect(comparison.added).toMatchObject({ count: 1, ids: ["tx_esbd:200"] });
      expect(comparison.added.byLevel.state).toBe(1);
    });

    it("does not read an empty table as every column added or removed", async () => {
      const full = await snapshot();
      sqlite().exec("DELETE FROM bids");
      const empty = await snapshot();
      // The data is empty now: the full snapshot is the earlier one.
      const toEmpty = await compare(full);
      for (const statement of buildIntegritySeed().filter((candidate) => candidate.table === "bids")) {
        const { sql, params } = insertSql(statement);
        run(sql, ...params);
      }
      // The data is full again: the empty snapshot is the earlier one.
      const fromEmpty = await compare(empty);

      for (const comparison of [fromEmpty, toEmpty]) {
        expect(comparison.columns).toEqual({ added: [], removed: [] });
        expect(comparison.hashesComparable).toBe(true);
        expect(comparison.warnings.map((warning) => warning.code)).not.toContain("columns_added");
        expect(comparison.warnings.map((warning) => warning.code)).not.toContain("columns_removed");
      }
      expect(fromEmpty.added.count).toBe(SEEDED_BID_IDS.length);
      expect(toEmpty.removed.count).toBe(SEEDED_BID_IDS.length);
    });

    it("keeps comparing row by row when a column was added since the snapshot, and ignores the new column", async () => {
      const before = await snapshot();
      sqlite().exec("ALTER TABLE bids ADD COLUMN integrity_note TEXT");
      run("UPDATE bids SET integrity_note = 'new data' WHERE id = 'ca_caleprocure:RFQ-1'");

      const comparison = await compare(before);

      expect(comparison.hashesComparable).toBe(true);
      expect(comparison.columns).toEqual({ added: ["integrity_note"], removed: [] });
      expect(comparison.changed.count).toBe(0);
      expect(comparison.changed.onlyOutsideTracked.count).toBe(0);
      expect(comparison.warnings.map((warning) => warning.code)).toEqual(["columns_added"]);
      expect(comparison.ok).toBe(true);
    });

    it("says it cannot compare hashes when a column was dropped, and still compares the tracked columns", async () => {
      const before = await snapshot();
      sqlite().exec("ALTER TABLE bids DROP COLUMN awarded_date");
      run("UPDATE bids SET issuer_name = 'Unknown x' WHERE id = 'ca_caleprocure:RFQ-1'");

      const comparison = await compare(before);

      expect(comparison.hashesComparable).toBe(false);
      expect(comparison.columns.removed).toEqual(["awarded_date"]);
      expect(comparison.changed.onlyOutsideTracked.count).toBeNull();
      expect(comparison.warnings.map((warning) => warning.code)).toContain("hashes_not_comparable");
      expect(comparison.visibility.regressions).toEqual(["ca_caleprocure:RFQ-1"]);
      expect(comparison.ok).toBe(false);
    });
  });

  describe("it only reads", () => {
    it("writes nothing: the report, the snapshot and the compare leave the connection's change count alone", async () => {
      const changesBefore = totalChanges();
      const rowsBefore = sqlite().prepare("SELECT * FROM bids ORDER BY id").all();
      const sourcesBefore = sqlite().prepare("SELECT * FROM data_sources ORDER BY id").all();

      await report();
      const taken = await snapshot();
      await compareWithSnapshot(target(), taken, { now: INTEGRITY_NOW, allowRemoved: [] });

      expect(totalChanges()).toBe(changesBefore);
      expect(sqlite().prepare("SELECT * FROM bids ORDER BY id").all()).toEqual(rowsBefore);
      expect(sqlite().prepare("SELECT * FROM data_sources ORDER BY id").all()).toEqual(sourcesBefore);
    });

    it("leaves no transaction open, and does not end one the caller opened", async () => {
      await report();
      expect(sqlite().inTransaction).toBe(false);

      sqlite().exec("BEGIN");
      await report();
      expect(sqlite().inTransaction).toBe(true);
      sqlite().exec("ROLLBACK");
    });

    it("leaves no transaction open after a failed read", async () => {
      sqlite().exec("ALTER TABLE bids RENAME TO bids_moved");

      await expect(report()).rejects.toThrow(/no such table/);

      expect(sqlite().inTransaction).toBe(false);
    });
  });
});

/**
 * The MySQL loader against a stand-in pool: the same SQL, run on the seeded SQLite database, so the dialect-independent
 * parts (paging, the read-only transaction, the shared report builder) are held to the SQLite answer without a server.
 * The real thing is data-integrity.mysql.integration.test.ts.
 */
describe("data:integrity through the MySQL loader (stand-in pool)", () => {
  let testDb: TestDatabase;
  let events: string[];
  let poolQueries: number;
  let failOnSelect: number | null;

  function standIn(): DemoPurgeMysql {
    let selects = 0;
    const run = async (sql: string, values: unknown[] = []) => {
      if (/^(START|SET) TRANSACTION/i.test(sql)) {
        events.push(sql);
        return [[]];
      }
      events.push(sql.replace(/\s+/g, " ").trim());
      selects += 1;
      if (failOnSelect !== null && selects === failOnSelect) throw new Error("connection lost");
      // MySQL's schema view, answered from SQLite's.
      if (/information_schema\.columns/i.test(sql)) {
        return [(testDb.db.$client.prepare("PRAGMA table_info(bids)").all() as Array<{ name: string }>).map((column) => ({ name: column.name }))];
      }
      return [testDb.db.$client.prepare(sql).all(...values)];
    };
    const connection = {
      query: run,
      execute: async () => { throw new Error("a read must not execute a prepared statement"); },
      beginTransaction: async () => { throw new Error("a read must not begin a read-write transaction"); },
      commit: async () => { events.push("COMMIT"); },
      rollback: async () => { events.push("ROLLBACK"); },
      release: () => { events.push("RELEASE"); },
    };
    return {
      query: async (...args: Parameters<typeof run>) => { poolQueries += 1; return run(...args); },
      getConnection: async () => connection,
    } as unknown as DemoPurgeMysql;
  }

  beforeEach(async () => {
    testDb = await createTestDatabase();
    for (const statement of buildIntegritySeed()) {
      const { sql, params } = insertSql(statement);
      testDb.db.$client.prepare(sql).run(...params);
    }
    events = [];
    poolQueries = 0;
    failOnSelect = null;
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("builds the same report as the SQLite loader", async () => {
    const viaSqlite = await buildIntegrityReport({ database: testDb.db }, { now: INTEGRITY_NOW });
    const viaMysql = await buildIntegrityReport({ mysql: standIn() }, { now: INTEGRITY_NOW });

    expect(viaMysql.dialect).toBe("mysql");
    expect(viaMysql.levels).toEqual(viaSqlite.levels);
    expect(viaMysql.totals).toEqual(viaSqlite.totals);
    expect(viaMysql.malformedNyIds).toBe(viaSqlite.malformedNyIds);
  });

  it("builds the same snapshot as the SQLite loader, the dialect aside", async () => {
    const viaSqlite = await buildIntegritySnapshot({ database: testDb.db }, { now: INTEGRITY_NOW });
    const viaMysql = await buildIntegritySnapshot({ mysql: standIn() }, { now: INTEGRITY_NOW });

    expect(viaMysql.dialect).toBe("mysql");
    expect(viaMysql.rows).toEqual(viaSqlite.rows);
    expect(viaMysql.columns).toEqual(viaSqlite.columns);
  });

  it("reads inside one read-only consistent-snapshot transaction on a single connection, and only reads", async () => {
    await buildIntegritySnapshot({ mysql: standIn() }, { now: INTEGRITY_NOW });

    // WITH CONSISTENT SNAPSHOT holds only under REPEATABLE READ, whatever the server or the connection defaults to.
    expect(events[0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(events[1]).toBe("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    expect(events.slice(-2)).toEqual(["COMMIT", "RELEASE"]);
    const statements = events.slice(2, -2);
    expect(statements.length).toBeGreaterThanOrEqual(3);
    for (const statement of statements) expect(statement, statement).toMatch(/^SELECT /);
    for (const statement of statements) expect(statement, statement).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
    expect(poolQueries).toBe(0);
    expect(events.filter((event) => event === "RELEASE")).toHaveLength(1);
  });

  it("reads the column list from the schema and not from the rows", async () => {
    testDb.db.$client.exec("DELETE FROM bids");

    const viaMysql = await buildIntegritySnapshot({ mysql: standIn() }, { now: INTEGRITY_NOW });

    expect(Object.keys(viaMysql.rows)).toEqual([]);
    expect(viaMysql.columns).toEqual((testDb.db.$client.prepare("PRAGMA table_info(bids)").all() as Array<{ name: string }>).map((column) => column.name).sort());
    expect(events.some((event) => /FROM information_schema\.columns WHERE table_schema = DATABASE\(\) AND table_name = 'bids'/.test(event))).toBe(true);
  });

  it("pages through the bids by id instead of reading them at once", async () => {
    for (let n = 0; n < 600; n += 1) {
      testDb.db.$client.prepare(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) " +
          "VALUES (?, 'Texas ESBD', ?, ?, 'Bulk', 'Bulk body text for a paging check.', 'Texas Bulk Agency', 'state', 'TX', 'https://example.test/b', 'a', 'a', 'a', 'a')",
      ).run(`tx_esbd:bulk-${n}`, `bulk-${n}`, `dedupe:bulk-${n}`);
    }

    await buildIntegrityReport({ mysql: standIn() }, { now: INTEGRITY_NOW });

    const pages = events.filter((event) => event.includes("FROM bids"));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).not.toContain("WHERE id >");
    for (const page of pages.slice(1)) expect(page).toContain("WHERE id > ?");
    for (const page of pages) expect(page).toContain("ORDER BY id");
  });

  it("rolls back and releases the connection when a read fails, and reports the failure", async () => {
    // The sources and the columns are read first; the first page of bids is the third read.
    failOnSelect = 3;

    await expect(buildIntegrityReport({ mysql: standIn() }, { now: INTEGRITY_NOW })).rejects.toThrow("connection lost");

    expect(events).not.toContain("COMMIT");
    expect(events.slice(-2)).toEqual(["ROLLBACK", "RELEASE"]);
  });
});
