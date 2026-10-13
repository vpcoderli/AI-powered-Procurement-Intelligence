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

/**
 * A snapshot row as this version writes it: with the hashes of the untracked columns (`u`) and of the payload (`p`). A
 * test that wants an older row passes `u: undefined, p: undefined`.
 */
function row(
  overrides: { h?: string; level?: IntegrityLevel; visible?: boolean; open?: boolean; c?: string; u?: string; p?: string; t?: Partial<SnapshotRow["t"]> } = {},
): SnapshotRow {
  const { t, c, ...rest } = overrides;
  const made: SnapshotRow = { h: "hash-0", level: "state", visible: true, open: true, u: "untracked-0", p: "payload-0", ...rest, t: tracked(t), ...(c ? { c } : {}) };
  // `u: undefined` must not leave a key behind: an older snapshot has no such property at all.
  if (made.u === undefined) delete made.u;
  if (made.p === undefined) delete made.p;
  return made;
}

/** The deadline of a bid that is long past at the default `takenAt`, 2026-10-13. */
const PAST = "2026-09-01";

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
      snapshotOf({ closes: row({ t: { deadline_date: PAST } }), hiddenBefore: row({ visible: false }), closedBefore: row({ open: false, visible: true }) }),
      snapshotOf({
        closes: row({ open: false, visible: false, c: "deadline_passed", t: { lifecycle_status: "closed", is_active: 0, deadline_date: PAST } }),
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
    row({ open: false, visible: false, ...(c ? { c } : {}), t: { lifecycle_status: lifecycle, is_active: 0, deadline_date: PAST } });

  it("warns on a row that went from open to closed with no recorded reason, or one that is neither deadline_passed nor delisted", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ none: row({ t: { deadline_date: PAST } }), other: row({ t: { deadline_date: PAST } }), expired: row({ t: { deadline_date: PAST } }), delisted: row({ t: { deadline_date: PAST } }) }),
      snapshotOf({ none: closing(), other: closing("something_else"), expired: closing("deadline_passed"), delisted: closing("delisted") }),
    );

    expect(comparison.ok).toBe(true);
    expect(comparison.warnings).toEqual([expect.objectContaining({ code: "closed_without_reason", ids: ["none", "other"] })]);
  });

  it("does not warn about an award, a row that stayed open, or one that was already closed", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ awarded: row({ t: { deadline_date: PAST } }), open: row(), already: row({ open: false, visible: false, t: { lifecycle_status: "closed", is_active: 0, deadline_date: PAST } }) }),
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
        // The group has 11 rows; the examples stop at ten, the ids do not.
        ids: ["bidnet:00", "bidnet:01", "bidnet:02", "bidnet:03", "bidnet:04", "bidnet:05", "bidnet:06", "bidnet:07", "bidnet:08", "bidnet:09", "bidnet:10"],
      },
    ]);
    expect(comparison.changed.onlyOutsideTracked.count).toBe(0);
  });

  it("counts a row in each group it belongs to, the biggest group first", () => {
    const before: Record<string, SnapshotRow> = {};
    const after: Record<string, SnapshotRow> = {};
    for (let n = 0; n < 340; n += 1) {
      const id = `ca:${n}`;
      before[id] = row({ h: "old", t: { deadline_date: PAST } });
      after[id] = row({ h: "new", open: false, visible: false, c: "deadline_passed", t: { lifecycle_status: "closed", is_active: 0, deadline_date: PAST } });
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
        comparable: { columns: COLUMNS, byId: new Map([["a", "old-a"], ["b", "changed-b"]]), untrackedById: new Map([["a", "untracked-0"], ["b", "untracked-0"]]) },
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

describe("compareIntegritySnapshots: ids by level", () => {
  /** Every level, in report order, empty unless listed. */
  const byLevel = (listed: Partial<Record<IntegrityLevel, string[]>>): Record<IntegrityLevel, string[]> =>
    Object.fromEntries(INTEGRITY_LEVELS.map((level) => [level, listed[level] ?? []])) as Record<IntegrityLevel, string[]>;
  const county = (overrides: Parameters<typeof row>[0] = {}) => row({ level: "county", ...overrides, t: { issuer_type: "county", ...overrides.t } });
  const city = (overrides: Parameters<typeof row>[0] = {}) => row({ level: "city", ...overrides, t: { issuer_type: "city", ...overrides.t } });

  it("groups every removed id by the level it had, and the allowed and the unexpected ones apart, so a pattern that is too broad shows", () => {
    const before = snapshotOf({ "ca:2": row(), "ca:1": row(), "co:1": county(), "ci:2": city(), "ci:1": city() });
    const after = snapshotOf({ "ca:2": row() });

    const { removed } = compareIntegritySnapshots(before, after, { allowRemoved: [/^co:/, /^ci:/] });

    expect(removed.idsByLevel).toEqual(byLevel({ state: ["ca:1"], county: ["co:1"], city: ["ci:1", "ci:2"] }));
    expect(removed.allowedByLevel).toEqual(byLevel({ county: ["co:1"], city: ["ci:1", "ci:2"] }));
    expect(removed.unexpectedByLevel).toEqual(byLevel({ state: ["ca:1"] }));
    expect(Object.keys(removed.idsByLevel)).toEqual([...INTEGRITY_LEVELS]);
    expect(removed.byLevel).toMatchObject({ state: 1, county: 1, city: 2 });
    // The flat lists are still there, in order.
    expect(removed.ids).toEqual(["ca:1", "ci:1", "ci:2", "co:1"]);
    expect(removed.allowed).toEqual(["ci:1", "ci:2", "co:1"]);
    expect(removed.unexpected).toEqual(["ca:1"]);
  });

  it("groups the added ids by the level they have now", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:1": row() }),
      snapshotOf({ "ca:1": row(), "ca:2": row(), "co:1": county(), "ci:1": city() }),
    );

    expect(comparison.added.idsByLevel).toEqual(byLevel({ state: ["ca:2"], county: ["co:1"], city: ["ci:1"] }));
    expect(comparison.added.ids).toEqual(["ci:1", "co:1", "ca:2"].sort());
  });

  it("groups the ids of a failure or a warning by level, too", () => {
    const closing = (level: "state" | "county") => (level === "state" ? row : county)({ open: false, visible: false, t: { lifecycle_status: "closed", is_active: 0 } });
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:gone": row(), "co:hidden": county(), "ca:hidden": row(), "ca:closed": row(), "co:closed": county() }),
      snapshotOf({ "co:hidden": county({ visible: false }), "ca:hidden": row({ visible: false }), "ca:closed": closing("state"), "co:closed": closing("county") }),
    );

    const finding = (code: string) => [...comparison.failures, ...comparison.warnings].find((candidate) => candidate.code === code);
    expect(finding("removed_unexplained")?.idsByLevel).toEqual(byLevel({ state: ["ca:gone"] }));
    expect(finding("visibility_regression")?.idsByLevel).toEqual(byLevel({ state: ["ca:hidden"], county: ["co:hidden"] }));
    expect(finding("closed_without_reason")?.idsByLevel).toEqual(byLevel({ state: ["ca:closed"], county: ["co:closed"] }));
  });

  it("keeps ids with accents, dashes and CJK whole, and orders them by code unit", () => {
    const ids = ["ca:é", "ca:e", "ca:Ünï–1", "ca:北京", "ca:Zürich"];
    const before = snapshotOf(Object.fromEntries(ids.map((id) => [id, row()])));

    const comparison = compareIntegritySnapshots(before, snapshotOf({}), { allowRemoved: [/北京/, /é$/] });

    expect(comparison.removed.ids).toEqual([...ids].sort());
    expect(comparison.removed.allowed).toEqual(["ca:北京", "ca:é"].sort());
    expect(comparison.removed.unexpected).toEqual(["ca:Ünï–1", "ca:Zürich", "ca:e"].sort());
    expect(comparison.removed.idsByLevel.state).toEqual([...ids].sort());
  });
});


describe("compareIntegritySnapshots: every change group carries all of its ids", () => {
  it("keeps the first few as examples and every id in `ids`, in order", () => {
    const before: Record<string, SnapshotRow> = {};
    const after: Record<string, SnapshotRow> = {};
    for (let n = 0; n < 45; n += 1) {
      const id = `ca:${String(n).padStart(2, "0")}`;
      before[id] = row({ h: "old" });
      after[id] = row({ h: "new", level: "city", t: { issuer_type: "city" } });
    }

    const comparison = compareIntegritySnapshots(snapshotOf(before), snapshotOf(after));

    const [group] = comparison.changed.groups;
    expect(group.label).toBe("issuer_type state→city");
    expect(group.count).toBe(45);
    expect(group.sampleIds).toHaveLength(10);
    expect(group.ids).toHaveLength(45);
    expect(group.ids).toEqual(Object.keys(before).sort());
    expect(group.sampleIds).toEqual(group.ids.slice(0, 10));
  });

  it("gives each group its own ids, a row that belongs to two groups appearing in both", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ a: row({ h: "1" }), b: row({ h: "2" }), c: row({ h: "3" }) }),
      snapshotOf({
        a: row({ h: "4", t: { title: "New A", issuer_name: "Other A" } }),
        b: row({ h: "5", t: { title: "New B" } }),
        c: row({ h: "6", t: { issuer_name: "Other C" } }),
      }),
    );

    const byLabel = Object.fromEntries(comparison.changed.groups.map((group) => [group.label, group.ids]));
    expect(byLabel).toEqual({ "title changed": ["a", "b"], "issuer_name changed": ["a", "c"] });
  });
});

describe("compareIntegritySnapshots: changes outside the tracked columns", () => {
  const byLevel = (listed: Partial<Record<IntegrityLevel, Array<{ id: string; changed: Array<"u" | "p"> }>>>) =>
    Object.fromEntries(INTEGRITY_LEVELS.map((level) => [level, listed[level] ?? []]));
  const closing = (overrides: Parameters<typeof row>[0] = {}) =>
    row({ open: false, visible: false, c: "deadline_passed", ...overrides, t: { lifecycle_status: "closed", is_active: 0, deadline_date: PAST, ...overrides.t } });

  it("names a row whose untracked columns changed although a tracked column changed as well", () => {
    // What a sweep that also wipes a description looks like: the lifecycle columns move, and so does something else.
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:wiped": row({ t: { deadline_date: PAST } }) }),
      snapshotOf({ "ca:wiped": closing({ h: "full-hash-1", u: "untracked-1" }) }),
    );

    expect(comparison.changed.count).toBe(1);
    expect(comparison.changedOutsideTracked.count).toBe(1);
    expect(comparison.changedOutsideTracked.ids).toEqual(["ca:wiped"]);
    expect(comparison.changedOutsideTracked.changesByLevel).toEqual(byLevel({ state: [{ id: "ca:wiped", changed: ["u"] }] }));
    expect(comparison.changedOutsideTracked.byLevel).toMatchObject({ state: 1, city: 0 });
  });

  it("names a row whose payload changed beyond its lifecycle key, with `p`", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:1": row() }),
      snapshotOf({ "ca:1": row({ h: "full-hash-1", p: "payload-1", t: { title: "New title" } }) }),
    );

    expect(comparison.changedOutsideTracked.changesByLevel.state).toEqual([{ id: "ca:1", changed: ["p"] }]);
  });

  it("says both when both changed, `u` before `p`", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:1": row() }),
      snapshotOf({ "ca:1": row({ u: "untracked-1", p: "payload-1" }) }),
    );

    expect(comparison.changedOutsideTracked.changesByLevel.state).toEqual([{ id: "ca:1", changed: ["u", "p"] }]);
  });

  it("names a row that changed nothing but outside the tracked columns, too", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:1": row() }),
      snapshotOf({ "ca:1": row({ h: "full-hash-1", u: "untracked-1" }) }),
    );

    expect(comparison.changed.count).toBe(0);
    expect(comparison.changed.onlyOutsideTracked).toEqual({ count: 1, ids: ["ca:1"] });
    expect(comparison.changedOutsideTracked.ids).toEqual(["ca:1"]);
  });

  it("does not name a row that moved only its clocks and its lifecycle (a plain sweep close)", () => {
    // `h` moves with updated_at and the lifecycle key, but `u` and `p` leave those out.
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:1": row({ t: { deadline_date: PAST } }), "ca:2": row() }),
      snapshotOf({ "ca:1": closing({ h: "full-hash-1" }), "ca:2": row({ h: "full-hash-2" }) }),
    );

    expect(comparison.changed.count).toBe(1);
    expect(comparison.changedOutsideTracked.count).toBe(0);
    expect(comparison.changedOutsideTracked.ids).toEqual([]);
    expect(comparison.changedOutsideTracked.changesByLevel).toEqual(byLevel({}));
    expect(comparison.changed.onlyOutsideTracked).toEqual({ count: 1, ids: ["ca:2"] });
  });

  it("groups the rows by the level they have now, every level present, and lists every one of them", () => {
    const before: Record<string, SnapshotRow> = {};
    const after: Record<string, SnapshotRow> = {};
    for (let n = 0; n < 30; n += 1) {
      const id = `bidnet_co_aurora:${String(n).padStart(2, "0")}`;
      before[id] = row({ t: { fips_code: "0803455" } });
      // The retype moves the row from state to city, and the payload gains a key.
      after[id] = row({ level: "city", h: "full-hash-1", p: "payload-1", t: { issuer_type: "city", fips_code: "0804000" } });
    }
    before["ca:untouched"] = row();
    after["ca:untouched"] = row();

    const { changedOutsideTracked } = compareIntegritySnapshots(snapshotOf(before), snapshotOf(after));

    expect(changedOutsideTracked.count).toBe(30);
    expect(changedOutsideTracked.byLevel).toMatchObject({ city: 30, state: 0 });
    expect(Object.keys(changedOutsideTracked.changesByLevel)).toEqual([...INTEGRITY_LEVELS]);
    expect(changedOutsideTracked.changesByLevel.state).toEqual([]);
    expect(changedOutsideTracked.changesByLevel.city).toHaveLength(30);
    expect(changedOutsideTracked.changesByLevel.city.every((change) => change.changed.join() === "p")).toBe(true);
    expect(changedOutsideTracked.ids).toEqual(Object.keys(before).filter((id) => id.startsWith("bidnet_")).sort());
  });

  it("only reports: it does not fail the compare, and adds no warning", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:1": row() }),
      snapshotOf({ "ca:1": row({ u: "untracked-1", p: "payload-1" }) }),
    );

    expect(comparison.changedOutsideTracked.count).toBe(1);
    expect(comparison.ok).toBe(true);
    expect(comparison.failures).toEqual([]);
    expect(comparison.warnings).toEqual([]);
  });

  it("does not look at rows that are only on one side", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ gone: row(), kept: row() }),
      snapshotOf({ kept: row(), fresh: row({ u: "untracked-9" }) }),
      { allowRemoved: [/./] },
    );

    expect(comparison.changedOutsideTracked.count).toBe(0);
  });

  describe("against a snapshot that has no such hashes (one written before they existed)", () => {
    const old = (overrides: Parameters<typeof row>[0] = {}) => row({ u: undefined, p: undefined, ...overrides });

    it("compares under today's rule and warns, explicitly, that a change outside the tracked columns on a touched row cannot be seen", () => {
      const comparison = compareIntegritySnapshots(
        snapshotOf({ touched: old(), untouched: old() }),
        snapshotOf({ touched: row({ h: "full-hash-1", u: "untracked-1", t: { title: "New" } }), untouched: row({ h: "full-hash-2" }) }),
      );

      expect(comparison.changedOutsideTracked).toMatchObject({ count: null, ids: [] });
      expect(comparison.changedOutsideTracked.changesByLevel).toEqual(byLevel({}));
      // Today's rule: the full hash on a row with no tracked change.
      expect(comparison.changed.onlyOutsideTracked).toEqual({ count: 1, ids: ["untouched"] });
      expect(comparison.changed.count).toBe(1);
      const warning = comparison.warnings.find((candidate) => candidate.code === "untracked_hashes_missing");
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("cannot be seen");
      expect(warning!.message).toContain("also changed a tracked column");
      expect(comparison.ok).toBe(true);
    });

    it("warns when only some rows lack the hashes, and when it is the later snapshot that lacks them", () => {
      const partial = compareIntegritySnapshots(snapshotOf({ a: old(), b: row() }), snapshotOf({ a: row(), b: row() }));
      const later = compareIntegritySnapshots(snapshotOf({ a: row() }), snapshotOf({ a: old() }));

      expect(partial.warnings.map((warning) => warning.code)).toEqual(["untracked_hashes_missing"]);
      expect(later.warnings.map((warning) => warning.code)).toEqual(["untracked_hashes_missing"]);
      expect(later.warnings[0].message).toContain("later snapshot");
      expect(partial.warnings[0].message).toContain("earlier snapshot");
    });

    it("does not warn about an empty snapshot, which has no rows to be blind on", () => {
      const comparison = compareIntegritySnapshots(snapshotOf({}), snapshotOf({ a: row() }));

      expect(comparison.warnings).toEqual([]);
      expect(comparison.changedOutsideTracked.count).toBe(0);
    });
  });

  describe("across a schema change", () => {
    const wider = { columns: [...COLUMNS, "note"] };

    it("compares the untracked columns the earlier snapshot had when columns were added, and ignores the new ones", () => {
      const comparison = compareIntegritySnapshots(
        snapshotOf({ a: row(), b: row(), c: row() }),
        snapshotOf({ a: row({ h: "f-a", u: "untracked-with-note-a" }), b: row({ h: "f-b", u: "untracked-with-note-b" }), c: row({ h: "f-c", u: "untracked-with-note-c" }) }, {
          ...wider,
          comparable: {
            columns: COLUMNS,
            byId: new Map([["a", "hash-0"], ["b", "hash-0"], ["c", "hash-0"]]),
            // Over the old columns only: a is as it was (only `note` is new), b really changed, c's payload changed.
            untrackedById: new Map([["a", "untracked-0"], ["b", "untracked-changed"], ["c", "untracked-0"]]),
          },
        }),
      );

      expect(comparison.hashesComparable).toBe(true);
      expect(comparison.changedOutsideTracked.ids).toEqual(["b"]);
      expect(comparison.changedOutsideTracked.changesByLevel.state).toEqual([{ id: "b", changed: ["u"] }]);
    });

    it("cannot judge the group when columns were added and the later snapshot did not hash the old ones", () => {
      const comparison = compareIntegritySnapshots(snapshotOf({ a: row() }), snapshotOf({ a: row({ u: "untracked-1" }) }, wider));

      expect(comparison.changedOutsideTracked.count).toBeNull();
      expect(comparison.warnings.map((warning) => warning.code)).toContain("hashes_not_comparable");
    });

    it("cannot judge the group when a column is gone", () => {
      const comparison = compareIntegritySnapshots(
        snapshotOf({ a: row() }),
        snapshotOf({ a: row({ u: "untracked-1" }) }, { columns: COLUMNS.filter((column) => column !== "description") }),
      );

      expect(comparison.changedOutsideTracked.count).toBeNull();
      expect(comparison.warnings.map((warning) => warning.code)).toContain("hashes_not_comparable");
    });
  });
});

describe("compareIntegritySnapshots: a close for the deadline that came early", () => {
  const TAKEN_AT = "2026-10-13T12:00:00.000Z";
  const closing = (deadline: string | null, overrides: Parameters<typeof row>[0] = {}) =>
    row({ open: false, visible: false, c: "deadline_passed", ...overrides, t: { lifecycle_status: "closed", is_active: 0, deadline_date: deadline, ...overrides.t } });
  const compareClose = (deadline: string | null, after: Parameters<typeof snapshotOf>[1] = {}) =>
    compareIntegritySnapshots(
      snapshotOf({ "ca:1": row({ t: { deadline_date: deadline } }) }),
      snapshotOf({ "ca:1": closing(deadline) }, { takenAt: TAKEN_AT, ...after }),
    );

  it("fails when the bid was closed for its deadline but the deadline had not passed when the data was read", () => {
    const comparison = compareClose("2026-12-01");

    expect(comparison.ok).toBe(false);
    expect(comparison.failures).toEqual([
      expect.objectContaining({ code: "early_close", ids: ["ca:1"], idsByLevel: expect.objectContaining({ state: ["ca:1"] }) }),
    ]);
    expect(comparison.failures[0].message).toContain("deadline_passed");
    expect(comparison.failures[0].message).toContain(TAKEN_AT);
  });

  it("passes when the deadline had passed when the data was read", () => {
    const comparison = compareClose(PAST);

    expect(comparison.ok).toBe(true);
    expect(comparison.failures).toEqual([]);
  });

  it("judges the deadline at the later snapshot's time, to the hour: a date-only deadline runs to the end of its day in the latest zone", () => {
    // 2026-10-13 expires at 2026-10-14 10:00 UTC (the end of the day in UTC-10).
    expect(compareClose("2026-10-13", { takenAt: "2026-10-14T09:59:59.999Z" }).failures.map((failure) => failure.code)).toEqual(["early_close"]);
    expect(compareClose("2026-10-13", { takenAt: "2026-10-14T10:00:00.000Z" }).failures).toEqual([]);
  });

  it("fails when the deadline cannot be read, because a deadline that cannot be read never closes a bid", () => {
    for (const deadline of ["Not Available", "", null, "0001-01-01"]) {
      const comparison = compareClose(deadline);
      expect(comparison.failures.map((failure) => failure.code), String(deadline)).toEqual(["early_close"]);
    }
  });

  it("lists every early close by the level the bid has now, and leaves the others out", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({
        "ca:late": row({ t: { deadline_date: "2026-12-01" } }),
        "ca:fine": row({ t: { deadline_date: PAST } }),
        "co:late": row({ level: "county", t: { issuer_type: "county", deadline_date: "2026-11-01" } }),
      }),
      snapshotOf({
        "ca:late": closing("2026-12-01"),
        "ca:fine": closing(PAST),
        "co:late": closing("2026-11-01", { level: "county", t: { issuer_type: "county" } }),
      }, { takenAt: TAKEN_AT }),
    );

    const failure = comparison.failures.find((candidate) => candidate.code === "early_close");
    expect(failure?.ids).toEqual(["ca:late", "co:late"]);
    expect(failure?.idsByLevel).toMatchObject({ state: ["ca:late"], county: ["co:late"], city: [] });
  });

  it("does not look at a close for another reason, an award, a bid that was already closed, or one that stayed open", () => {
    const future = "2026-12-01";
    const closed = (overrides: Parameters<typeof row>[0] = {}) => row({ open: false, visible: false, ...overrides, t: { lifecycle_status: "closed", is_active: 0, deadline_date: future, ...overrides.t } });
    const comparison = compareIntegritySnapshots(
      snapshotOf({
        delisted: row({ t: { deadline_date: future } }),
        unexplained: row({ t: { deadline_date: future } }),
        awarded: row({ t: { deadline_date: future } }),
        already: closed({ c: "deadline_passed" }),
        stillOpen: row({ t: { deadline_date: future } }),
      }),
      snapshotOf({
        delisted: closed({ c: "delisted" }),
        unexplained: closed(),
        awarded: closed({ c: "deadline_passed", t: { lifecycle_status: "awarded" } }),
        already: closed({ c: "deadline_passed" }),
        stillOpen: row({ t: { deadline_date: future } }),
      }, { takenAt: TAKEN_AT }),
    );

    expect(comparison.failures).toEqual([]);
    expect(comparison.ok).toBe(true);
  });

  it("warns, instead of staying silent, when the later snapshot's time cannot be read and so the check cannot run", () => {
    const comparison = compareClose("2026-12-01", { takenAt: "not a time" });

    expect(comparison.failures).toEqual([]);
    expect(comparison.warnings).toEqual([expect.objectContaining({ code: "early_close_not_checked", ids: ["ca:1"] })]);
  });

  it("is a failure of its own: the other failures are reported beside it", () => {
    const comparison = compareIntegritySnapshots(
      snapshotOf({ "ca:early": row({ t: { deadline_date: "2026-12-01" } }), "ca:gone": row() }),
      snapshotOf({ "ca:early": closing("2026-12-01") }, { takenAt: TAKEN_AT }),
    );

    expect(comparison.failures.map((failure) => failure.code)).toEqual(["removed_unexplained", "early_close"]);
  });
});
