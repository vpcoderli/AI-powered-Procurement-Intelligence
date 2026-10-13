import { describe, expect, it } from "vitest";
import {
  INTEGRITY_LEVELS,
  TRACKED_COLUMNS,
  type ComparableHashes,
  type IntegrityLevel,
  type IntegrityReport,
  type IntegritySnapshot,
  type LevelReport,
  type SnapshotRow,
} from "./data-integrity";
import { compareIntegritySnapshots } from "./data-integrity-compare";
import { EXPECTED_LEVELS, EXPECTED_TOTALS } from "./data-integrity.fixtures";

/* The decisions of the compare, on snapshots written by hand: no database, so each rule is read off one case. */

const COLUMNS = ["id", "title", "description", "raw_payload", "issuer_type", "updated_at"];

function tracked(overrides: Partial<SnapshotRow["t"]> = {}): SnapshotRow["t"] {
  return {
    issuer_type: "state", jurisdiction_level: null, fips_code: null, lifecycle_status: "open", is_active: 1,
    display_status: "published", issuer_name: "Agency", title: "Title", deadline_date: "2026-12-01", source_bid_id: "1",
    ...overrides,
  };
}

function row(overrides: { h?: string; level?: IntegrityLevel; visible?: boolean; open?: boolean; c?: string; t?: Partial<SnapshotRow["t"]> } = {}): SnapshotRow {
  const { t, c, ...rest } = overrides;
  return { h: "hash-0", level: "state", visible: true, open: true, ...rest, t: tracked(t), ...(c ? { c } : {}) };
}

function reportWith(overrides: Partial<Record<IntegrityLevel, Partial<LevelReport>>> = {}, dialect: "sqlite" | "mysql" = "sqlite"): IntegrityReport {
  const levels = Object.fromEntries(INTEGRITY_LEVELS.map((level) => [level, { ...structuredClone(EXPECTED_LEVELS[level]), ...overrides[level] }])) as Record<IntegrityLevel, LevelReport>;
  return { generatedAt: "2026-10-13T12:00:00.000Z", dialect, levels, totals: structuredClone(EXPECTED_TOTALS), malformedNyIds: 1 };
}

function snapshotOf(
  rows: Record<string, SnapshotRow>,
  options: { report?: IntegrityReport; dialect?: "sqlite" | "mysql"; columns?: string[]; takenAt?: string; comparable?: ComparableHashes } = {},
): IntegritySnapshot {
  const dictionary = Object.assign(Object.create(null), rows) as Record<string, SnapshotRow>;
  return {
    version: 1,
    takenAt: options.takenAt ?? "2026-10-13T12:00:00.000Z",
    dialect: options.dialect ?? "sqlite",
    columns: options.columns ?? COLUMNS,
    report: options.report ?? reportWith({}, options.dialect),
    rows: dictionary,
    ...(options.comparable ? { comparable: options.comparable } : {}),
  };
}

const codes = (findings: Array<{ code: string }>) => findings.map((finding) => finding.code);

describe("compareIntegritySnapshots: nothing changed", () => {
  it("passes with nothing to report", () => {
    const rows = { a: row(), b: row({ level: "county", t: { issuer_type: "county" } }) };

    const comparison = compareIntegritySnapshots(snapshotOf(rows), snapshotOf(rows));

    expect(comparison.ok).toBe(true);
    expect(comparison.failures).toEqual([]);
    expect(comparison.warnings).toEqual([]);
    expect(comparison.added).toMatchObject({ count: 0, ids: [] });
    expect(comparison.removed).toMatchObject({ count: 0, ids: [], allowed: [], unexpected: [] });
    expect(comparison.changed).toEqual({ count: 0, groups: [], onlyOutsideTracked: { count: 0, ids: [] } });
    expect(comparison.metricDeltas).toEqual([]);
    expect(comparison.visibility.regressions).toEqual([]);
    expect(comparison.before).toEqual({ takenAt: "2026-10-13T12:00:00.000Z", dialect: "sqlite", bids: 2 });
  });
});

describe("compareIntegritySnapshots: removed rows", () => {
  const before = snapshotOf({ "ca:1": row(), "ca:2": row(), "tx:1": row({ level: "county", t: { issuer_type: "county" } }) });
  const after = snapshotOf({ "ca:2": row() });

  it("fails on every removed id that no allow pattern covers, and lists them with their level", () => {
    const comparison = compareIntegritySnapshots(before, after);

    expect(comparison.ok).toBe(false);
    expect(comparison.removed.count).toBe(2);
    expect(comparison.removed.ids).toEqual(["ca:1", "tx:1"]);
    expect(comparison.removed.unexpected).toEqual(["ca:1", "tx:1"]);
    expect(comparison.removed.byLevel).toMatchObject({ state: 1, county: 1, city: 0 });
    expect(comparison.failures).toEqual([
      expect.objectContaining({ code: "removed_unexplained", ids: ["ca:1", "tx:1"] }),
    ]);
  });

  it("passes when the patterns cover them all, however many patterns there are", () => {
    const comparison = compareIntegritySnapshots(before, after, { allowRemoved: [/^ca:/, /^tx:1$/] });

    expect(comparison.ok).toBe(true);
    expect(comparison.removed).toMatchObject({ count: 2, allowed: ["ca:1", "tx:1"], unexpected: [] });
  });

  it("still fails for the ids the patterns leave out", () => {
    const comparison = compareIntegritySnapshots(before, after, { allowRemoved: [/^ca:/] });

    expect(comparison.ok).toBe(false);
    expect(comparison.removed).toMatchObject({ allowed: ["ca:1"], unexpected: ["tx:1"] });
    expect(comparison.failures[0].ids).toEqual(["tx:1"]);
  });

  it("matches a pattern anywhere in the id unless the pattern is anchored", () => {
    expect(compareIntegritySnapshots(before, after, { allowRemoved: [/a:1/, /x:1/] }).ok).toBe(true);
    expect(compareIntegritySnapshots(before, after, { allowRemoved: [/^a:1/, /^x:1/] }).ok).toBe(false);
  });

  it("allows nothing by default", () => {
    expect(compareIntegritySnapshots(before, after, { allowRemoved: [] }).ok).toBe(false);
  });

  it("is not tripped by an id that only exists after", () => {
    const comparison = compareIntegritySnapshots(snapshotOf({ a: row() }), snapshotOf({ a: row(), b: row({ level: "city", t: { issuer_type: "city" } }) }));

    expect(comparison.ok).toBe(true);
    expect(comparison.added).toMatchObject({ count: 1, ids: ["b"] });
    expect(comparison.added.byLevel).toMatchObject({ city: 1, state: 0 });
  });
});

describe("compareIntegritySnapshots: visibility regressions", () => {
  it("fails on a row that was open and visible, is still open, and is no longer visible", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:1": row(), "ca:2": row() }),
      snapshotOf({ "ca:1": row({ visible: false, h: "hash-1" }), "ca:2": row() }),
    );

    expect(comparison.ok).toBe(false);
    expect(comparison.visibility.regressions).toEqual(["ca:1"]);
    expect(comparison.failures).toEqual([expect.objectContaining({ code: "visibility_regression", ids: ["ca:1"] })]);
  });

  it("does not fail on a row that closed (that is a lifecycle change), nor on one that was hidden before", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ closes: row(), hiddenBefore: row({ visible: false }), closedBefore: row({ open: false, visible: true }) }),
      snapshotOf({
        closes: row({ open: false, visible: false, c: "deadline_passed", t: { lifecycle_status: "closed", is_active: 0 } }),
        hiddenBefore: row({ visible: false }),
        closedBefore: row({ open: false, visible: false }),
      }),
    );

    expect(comparison.visibility.regressions).toEqual([]);
    expect(comparison.ok).toBe(true);
  });

  it("does not count a removed row twice: it is a removal, not also a regression", () => {
    const comparison = compareIntegritySnapshots(snapshotOf({ a: row() }), snapshotOf({}), { allowRemoved: [/./] });

    expect(comparison.visibility.regressions).toEqual([]);
    expect(comparison.ok).toBe(true);
  });

  it("lists the ids in order", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ b: row(), a: row(), c: row() }),
      snapshotOf({ b: row({ visible: false }), a: row({ visible: false }), c: row() }),
    );

    expect(comparison.visibility.regressions).toEqual(["a", "b"]);
  });
});

describe("compareIntegritySnapshots: identity mismatches", () => {
  const before = (overrides: Partial<Record<IntegrityLevel, Partial<LevelReport>>>) => snapshotOf({}, { report: reportWith(overrides) });

  it("fails for every level whose count rose, naming the level and both numbers", () => {
    const comparison = compareIntegritySnapshots(
      before({ city: { identityMismatch: 0 }, county: { identityMismatch: 1 } }),
      before({ city: { identityMismatch: 3 }, county: { identityMismatch: 2 } }),
    );

    expect(comparison.ok).toBe(false);
    expect(comparison.failures).toEqual([
      expect.objectContaining({ code: "identity_mismatch_increased", level: "county", message: expect.stringContaining("1 -> 2") }),
      expect.objectContaining({ code: "identity_mismatch_increased", level: "city", message: expect.stringContaining("0 -> 3") }),
    ]);
  });

  it("passes when a count fell or stayed", () => {
    const comparison = compareIntegritySnapshots(
      before({ state: { identityMismatch: 4 }, county: { identityMismatch: 1 } }),
      before({ state: { identityMismatch: 0 }, county: { identityMismatch: 1 } }),
    );

    expect(comparison.ok).toBe(true);
    expect(comparison.failures).toEqual([]);
  });

  it("fails for the level that rose even when another level fell by as much", () => {
    const comparison = compareIntegritySnapshots(
      before({ state: { identityMismatch: 5 }, city: { identityMismatch: 0 } }),
      before({ state: { identityMismatch: 0 }, city: { identityMismatch: 5 } }),
    );

    expect(comparison.ok).toBe(false);
    expect(comparison.failures.map((failure) => failure.level)).toEqual(["city"]);
  });
});

describe("compareIntegritySnapshots: warnings", () => {
  const closing = (c?: string, lifecycle = "closed") =>
    row({ open: false, visible: false, ...(c ? { c } : {}), t: { lifecycle_status: lifecycle, is_active: 0 } });

  it("warns on a row that went from open to closed with no recorded reason, or one that is neither deadline_passed nor delisted", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ none: row(), other: row(), expired: row(), delisted: row() }),
      snapshotOf({ none: closing(), other: closing("something_else"), expired: closing("deadline_passed"), delisted: closing("delisted") }),
    );

    expect(comparison.ok).toBe(true);
    expect(comparison.warnings).toEqual([expect.objectContaining({ code: "closed_without_reason", ids: ["none", "other"] })]);
  });

  it("does not warn about an award, a row that stayed open, or one that was already closed", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ awarded: row(), open: row(), already: row({ open: false, visible: false, t: { lifecycle_status: "closed", is_active: 0 } }) }),
      snapshotOf({ awarded: closing(undefined, "awarded"), open: row(), already: closing() }),
    );

    expect(comparison.warnings).toEqual([]);
  });

  it("warns when the dialect differs between the two snapshots, and still compares", () => {
    const rows = { a: row() };

    const comparison = compareIntegritySnapshots(snapshotOf(rows, { dialect: "sqlite" }), snapshotOf(rows, { dialect: "mysql" }));

    expect(codes(comparison.warnings)).toEqual(["dialect_changed"]);
    expect(comparison.ok).toBe(true);
    expect(comparison.before.dialect).toBe("sqlite");
    expect(comparison.after.dialect).toBe("mysql");
  });
});

describe("compareIntegritySnapshots: changed rows", () => {
  it("groups a retype by its transition, with the rows it touched", () => {
    const before: Record<string, SnapshotRow> = {};
    const after: Record<string, SnapshotRow> = {};
    for (let n = 0; n < 11; n += 1) {
      const id = `bidnet:${String(n).padStart(2, "0")}`;
      before[id] = row({ h: "old" });
      after[id] = row({ h: "new", level: "city", t: { issuer_type: "city" } });
    }

    const comparison = compareIntegritySnapshots(snapshotOf(before), snapshotOf(after));

    expect(comparison.changed.count).toBe(11);
    expect(comparison.changed.groups).toEqual([
      {
        label: "issuer_type state→city", column: "issuer_type", from: "state", to: "city", count: 11,
        sampleIds: ["bidnet:00", "bidnet:01", "bidnet:02", "bidnet:03", "bidnet:04", "bidnet:05", "bidnet:06", "bidnet:07", "bidnet:08", "bidnet:09"],
      },
    ]);
    expect(comparison.changed.onlyOutsideTracked.count).toBe(0);
  });

  it("counts a row in each group it belongs to, the biggest group first", () => {
    const before: Record<string, SnapshotRow> = {};
    const after: Record<string, SnapshotRow> = {};
    for (let n = 0; n < 340; n += 1) {
      const id = `ca:${n}`;
      before[id] = row({ h: "old" });
      after[id] = row({ h: "new", open: false, visible: false, c: "deadline_passed", t: { lifecycle_status: "closed", is_active: 0 } });
    }

    const comparison = compareIntegritySnapshots(snapshotOf(before), snapshotOf(after));

    expect(comparison.changed.count).toBe(340);
    expect(comparison.changed.groups.map((group) => [group.label, group.count])).toEqual([
      ["is_active 1→0", 340],
      ["lifecycle_status open→closed", 340],
    ]);
    expect(comparison.changed.groups[0].sampleIds).toHaveLength(10);
  });

  it("does not list every value of a free-text column as its own group", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "1" }), b: row({ h: "2" }), c: row({ h: "3" }) }),
      snapshotOf({
        a: row({ h: "4", t: { title: "New A" } }),
        b: row({ h: "5", t: { title: "New B", issuer_name: "Other" } }),
        c: row({ h: "6", t: { deadline_date: "2027-01-01", fips_code: "08013", source_bid_id: "9" } }),
      }),
    );

    expect(comparison.changed.groups.map((group) => [group.label, group.count])).toEqual([
      ["title changed", 2],
      ["deadline_date changed", 1],
      ["fips_code changed", 1],
      ["issuer_name changed", 1],
      ["source_bid_id changed", 1],
    ]);
    expect(comparison.changed.count).toBe(3);
  });

  it("tells NULL from an empty string and shows both", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "1" }) }),
      snapshotOf({ a: row({ h: "2", t: { jurisdiction_level: "" } }) }),
    );

    expect(comparison.changed.groups).toEqual([
      expect.objectContaining({ label: "jurisdiction_level NULL→''", from: "NULL", to: "''", count: 1 }),
    ]);
  });

  it("counts a row whose hash changed while its tracked columns did not as changed outside them", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "1" }), b: row({ h: "2" }) }),
      snapshotOf({ a: row({ h: "9" }), b: row({ h: "2" }) }),
    );

    expect(comparison.changed.count).toBe(0);
    expect(comparison.changed.onlyOutsideTracked).toEqual({ count: 1, ids: ["a"] });
    expect(comparison.ok).toBe(true);
  });

  it("does not count a row that changed in a tracked column as also changed outside them", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "1" }) }),
      snapshotOf({ a: row({ h: "2", t: { title: "New" } }) }),
    );

    expect(comparison.changed.count).toBe(1);
    expect(comparison.changed.onlyOutsideTracked.count).toBe(0);
  });

  it("compares every tracked column", () => {
    for (const column of TRACKED_COLUMNS) {
      const changedValue = column === "is_active" ? 0 : "changed";
      const comparison = compareIntegritySnapshots(
        snapshotOf({ a: row({ h: "1" }) }),
        snapshotOf({ a: row({ h: "2", t: { [column]: changedValue } }) }),
      );
      expect(comparison.changed.groups.map((group) => group.column), column).toEqual([column]);
    }
  });
});

describe("compareIntegritySnapshots: hashes across a schema change", () => {
  it("compares hashes of the columns both snapshots have when columns were only added", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "old-a" }), b: row({ h: "old-b" }) }),
      snapshotOf({ a: row({ h: "full-a" }), b: row({ h: "full-b" }) }, {
        columns: [...COLUMNS, "note"],
        comparable: { columns: COLUMNS, byId: new Map([["a", "old-a"], ["b", "changed-b"]]) },
      }),
    );

    expect(comparison.hashesComparable).toBe(true);
    expect(comparison.columns).toEqual({ added: ["note"], removed: [] });
    expect(comparison.changed.onlyOutsideTracked).toEqual({ count: 1, ids: ["b"] });
    expect(codes(comparison.warnings)).toEqual(["columns_added"]);
    expect(comparison.ok).toBe(true);
  });

  it("cannot compare hashes when columns were added and the later snapshot did not hash the old ones", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "old-a" }) }),
      snapshotOf({ a: row({ h: "full-a" }) }, { columns: [...COLUMNS, "note"] }),
    );

    expect(comparison.hashesComparable).toBe(false);
    expect(comparison.changed.onlyOutsideTracked).toEqual({ count: null, ids: [] });
    expect(codes(comparison.warnings)).toEqual(["columns_added", "hashes_not_comparable"]);
  });

  it("cannot compare hashes when a column is gone, but still compares the tracked columns and the metrics", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "old-a" }), b: row({ h: "old-b" }) }),
      snapshotOf({ a: row({ h: "new-a", visible: false }), b: row({ h: "new-b", t: { title: "New" } }) }, {
        columns: COLUMNS.filter((column) => column !== "description"),
      }),
    );

    expect(comparison.hashesComparable).toBe(false);
    expect(comparison.columns.removed).toEqual(["description"]);
    expect(comparison.changed.onlyOutsideTracked).toEqual({ count: null, ids: [] });
    expect(comparison.changed.count).toBe(1);
    expect(comparison.visibility.regressions).toEqual(["a"]);
    expect(codes(comparison.warnings)).toEqual(["columns_removed", "hashes_not_comparable"]);
    expect(comparison.ok).toBe(false);
  });
});

describe("compareIntegritySnapshots: metric deltas", () => {
  it("lists the numeric metrics that moved, per level and in total", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({}, { report: reportWith({ city: { total: 3, open: 2, openVisible: 2 } }) }),
      snapshotOf({}, {
        report: {
          ...reportWith({ city: { total: 4, open: 3, openVisible: 2, openHidden: 1 } }),
          totals: { ...structuredClone(EXPECTED_TOTALS), total: 24 },
        },
      }),
    );

    expect(comparison.metricDeltas).toEqual([
      { level: "city", metric: "total", before: 3, after: 4, delta: 1 },
      { level: "city", metric: "open", before: 2, after: 3, delta: 1 },
      { level: "city", metric: "openHidden", before: 0, after: 1, delta: 1 },
      { level: "total", metric: "total", before: 23, after: 24, delta: 1 },
    ]);
  });

  it("includes the source health numbers, named after the level's health block", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({}, { report: reportWith({ state: { sourceHealth: { ...EXPECTED_LEVELS.state.sourceHealth, failing: 1 } } }) }),
      snapshotOf({}, { report: reportWith({ state: { sourceHealth: { ...EXPECTED_LEVELS.state.sourceHealth, failing: 3 } } }) }),
    );

    expect(comparison.metricDeltas).toEqual([{ level: "state", metric: "sourceHealth.failing", before: 1, after: 3, delta: 2 }]);
  });

  it("reports the legacy NY ids when their number changed", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({}),
      snapshotOf({}, { report: { ...reportWith(), malformedNyIds: 0 } }),
    );

    expect(comparison.metricDeltas).toEqual([{ level: "total", metric: "malformedNyIds", before: 1, after: 0, delta: -1 }]);
  });
});
