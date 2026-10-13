/**
 * The before/after compare of data:integrity: a snapshot taken before a change against the data after it, row by row.
 *
 * It FAILS (the script exits 1) on:
 *   - a removed bid that no `--allow-removed` pattern covers (`removed_unexplained`);
 *   - a bid that was open and shown by search, is still open, and is no longer shown (`visibility_regression`);
 *   - a level whose `identityMismatch` count rose (`identity_mismatch_increased`).
 * It WARNS (never fails) on a bid that went from open to closed with no `deadline_passed` / `delisted` reason on record
 * (an award is a reason of its own), on a change of dialect, and on a schema change that limits what can be compared.
 * Everything else (rows added, rows retyped, rows changed, metric movements) is reported without judging it.
 *
 * ROW HASHES (`h`) cover every column of `bids`. A migration that ADDS a column changes every row's full hash, so the
 * snapshot to compare against is built over the columns the old snapshot had (`compareWithSnapshot` does that); a
 * migration that DROPS a column leaves no way to reproduce the old hashes, and the compare says so and judges the
 * tracked columns, the visibility and the metrics only.
 */
import {
  INTEGRITY_LEVELS,
  NUMERIC_LEVEL_METRICS,
  TRACKED_COLUMNS,
  buildIntegritySnapshot,
  type IntegrityDialect,
  type IntegrityLevel,
  type IntegritySnapshot,
  type IntegrityTarget,
  type LevelReport,
  type SnapshotRow,
  type SourceHealth,
  type TrackedColumn,
  type TrackedValue,
} from "./data-integrity";

/** Ids kept as examples of a group of changed rows. */
const SAMPLE_IDS = 10;
/** Columns with few distinct values: their changes are grouped by transition (`issuer_type state→city`). The rest by column. */
const TRANSITION_COLUMNS: ReadonlySet<TrackedColumn> = new Set(["issuer_type", "jurisdiction_level", "lifecycle_status", "is_active", "display_status"]);
/** The reasons the lifecycle records when it closes a bid on its own. */
const RECORDED_CLOSE_REASONS: ReadonlySet<string> = new Set(["deadline_passed", "delisted"]);
const SOURCE_HEALTH_KEYS: readonly (keyof SourceHealth)[] = ["sources", "neverSucceeded", "succeededWithin2d", "succeededWithin7d", "failing"];

export interface ChangeGroup {
  /** `issuer_type state→city`, or `title changed` for a column with many values. */
  label: string;
  column: TrackedColumn;
  /** Set for a column grouped by transition. NULL reads `NULL` and an empty string `''`. */
  from?: string;
  to?: string;
  count: number;
  /** The first few ids, in order. */
  sampleIds: string[];
}

export interface MetricDelta {
  level: IntegrityLevel | "total";
  metric: string;
  before: number;
  after: number;
  delta: number;
}

export interface ComparisonFinding {
  code: string;
  message: string;
  level?: IntegrityLevel;
  ids?: string[];
}

export interface SnapshotMeta {
  takenAt: string;
  dialect: IntegrityDialect;
  bids: number;
}

export interface IntegrityComparison {
  before: SnapshotMeta;
  after: SnapshotMeta;
  /** False when a column was dropped (or the later snapshot did not hash the old columns): `h` is then not judged. */
  hashesComparable: boolean;
  columns: { added: string[]; removed: string[] };
  added: { count: number; byLevel: Record<IntegrityLevel, number>; ids: string[] };
  removed: { count: number; byLevel: Record<IntegrityLevel, number>; ids: string[]; allowed: string[]; unexpected: string[] };
  changed: {
    /** Bids with a change in a tracked column. */
    count: number;
    groups: ChangeGroup[];
    /** Bids whose only change is outside the tracked columns; null count when the hashes cannot be compared. */
    onlyOutsideTracked: { count: number | null; ids: string[] };
  };
  visibility: { regressions: string[] };
  /** Numeric metrics that moved, per level and in total. */
  metricDeltas: MetricDelta[];
  failures: ComparisonFinding[];
  warnings: ComparisonFinding[];
  ok: boolean;
}

const byCodeUnit = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function zeroByLevel(): Record<IntegrityLevel, number> {
  return Object.fromEntries(INTEGRITY_LEVELS.map((level) => [level, 0])) as Record<IntegrityLevel, number>;
}

function showValue(value: TrackedValue): string {
  return value === null ? "NULL" : value === "" ? "''" : String(value);
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((name, index) => name === sortedRight[index]);
}

function levelMetrics(report: LevelReport | undefined): Array<[string, number]> {
  return [
    ...NUMERIC_LEVEL_METRICS.map((metric): [string, number] => [metric, Number(report?.[metric] ?? 0)]),
    ...SOURCE_HEALTH_KEYS.map((key): [string, number] => [`sourceHealth.${key}`, Number(report?.sourceHealth?.[key] ?? 0)]),
  ];
}

function metricDeltas(before: IntegritySnapshot["report"], after: IntegritySnapshot["report"]): MetricDelta[] {
  const deltas: MetricDelta[] = [];
  const compareLevel = (level: IntegrityLevel | "total", was: LevelReport | undefined, now: LevelReport | undefined) => {
    const nowByMetric = new Map(levelMetrics(now));
    for (const [metric, wasValue] of levelMetrics(was)) {
      const nowValue = nowByMetric.get(metric) ?? 0;
      if (nowValue !== wasValue) deltas.push({ level, metric, before: wasValue, after: nowValue, delta: nowValue - wasValue });
    }
  };
  for (const level of INTEGRITY_LEVELS) compareLevel(level, before.levels[level], after.levels[level]);
  compareLevel("total", before.totals, after.totals);
  const wasNy = Number(before.malformedNyIds ?? 0);
  const nowNy = Number(after.malformedNyIds ?? 0);
  if (wasNy !== nowNy) deltas.push({ level: "total", metric: "malformedNyIds", before: wasNy, after: nowNy, delta: nowNy - wasNy });
  return deltas;
}

/** `before` against `after`, both snapshots. Pure. */
export function compareIntegritySnapshots(
  before: IntegritySnapshot,
  after: IntegritySnapshot,
  options: { allowRemoved?: readonly RegExp[] } = {},
): IntegrityComparison {
  // A g or y flag would make `test` remember where it stopped.
  const patterns = (options.allowRemoved ?? []).map((pattern) => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, "")));
  const isAllowed = (id: string) => patterns.some((pattern) => pattern.test(id));

  const beforeColumns = new Set(before.columns);
  const afterColumns = new Set(after.columns);
  const addedColumns = after.columns.filter((column) => !beforeColumns.has(column));
  const removedColumns = before.columns.filter((column) => !afterColumns.has(column));
  // The hash of a row, as it would have been computed over the old snapshot's columns; null when that cannot be known.
  let hashOf: ((id: string, row: SnapshotRow) => string) | null = null;
  if (removedColumns.length === 0) {
    if (addedColumns.length === 0) hashOf = (_id, row) => row.h;
    else if (after.comparable && sameMembers(after.comparable.columns, before.columns)) {
      const hashes = after.comparable.byId;
      hashOf = (id, row) => hashes.get(id) ?? row.h;
    }
  }

  const removed: string[] = [];
  const added: string[] = [];
  const removedByLevel = zeroByLevel();
  const addedByLevel = zeroByLevel();
  const groups = new Map<string, ChangeGroup>();
  const changeOnly: string[] = [];
  const regressions: string[] = [];
  const closedWithoutReason: string[] = [];
  let changed = 0;

  const recordChange = (column: TrackedColumn, from: TrackedValue, to: TrackedValue, id: string) => {
    const transition = TRANSITION_COLUMNS.has(column);
    const label = transition ? `${column} ${showValue(from)}→${showValue(to)}` : `${column} changed`;
    let group = groups.get(label);
    if (!group) {
      group = { label, column, ...(transition ? { from: showValue(from), to: showValue(to) } : {}), count: 0, sampleIds: [] };
      groups.set(label, group);
    }
    group.count += 1;
    if (group.sampleIds.length < SAMPLE_IDS) group.sampleIds.push(id);
  };

  for (const id of Object.keys(before.rows).sort(byCodeUnit)) {
    const was = before.rows[id];
    if (!Object.hasOwn(after.rows, id)) {
      removed.push(id);
      removedByLevel[was.level] += 1;
      continue;
    }
    const now = after.rows[id];
    let touched = false;
    for (const column of TRACKED_COLUMNS) {
      const from = was.t[column] ?? null;
      const to = now.t[column] ?? null;
      if (from === to) continue;
      touched = true;
      recordChange(column, from, to, id);
    }
    if (touched) changed += 1;
    else if (hashOf !== null && was.h !== hashOf(id, now)) changeOnly.push(id);

    if (was.open && was.visible && now.open && !now.visible) regressions.push(id);
    if (was.open && !now.open && now.t.lifecycle_status !== "awarded" && !(now.c !== undefined && RECORDED_CLOSE_REASONS.has(now.c))) {
      closedWithoutReason.push(id);
    }
  }
  for (const id of Object.keys(after.rows).sort(byCodeUnit)) {
    if (Object.hasOwn(before.rows, id)) continue;
    added.push(id);
    addedByLevel[after.rows[id].level] += 1;
  }

  const unexpected = removed.filter((id) => !isAllowed(id));
  const allowed = removed.filter((id) => isAllowed(id));

  const failures: ComparisonFinding[] = [];
  if (unexpected.length > 0) {
    failures.push({
      code: "removed_unexplained",
      message: `${unexpected.length} bid(s) were removed and no --allow-removed pattern covers them`,
      ids: unexpected,
    });
  }
  if (regressions.length > 0) {
    failures.push({
      code: "visibility_regression",
      message: `${regressions.length} bid(s) that were open and shown by search are still open and are no longer shown`,
      ids: regressions,
    });
  }
  for (const level of INTEGRITY_LEVELS) {
    const was = Number(before.report.levels[level]?.identityMismatch ?? 0);
    const now = Number(after.report.levels[level]?.identityMismatch ?? 0);
    if (now > was) failures.push({ code: "identity_mismatch_increased", level, message: `${level}: identityMismatch rose ${was} -> ${now}` });
  }

  const warnings: ComparisonFinding[] = [];
  if (before.dialect !== after.dialect) {
    warnings.push({
      code: "dialect_changed",
      message: `The snapshot was taken on ${before.dialect} and this run reads ${after.dialect}; rows are compared as they are stored.`,
    });
  }
  if (addedColumns.length > 0) {
    warnings.push({
      code: "columns_added",
      message: `Columns added to bids since the snapshot: ${addedColumns.join(", ")}.`
        + (hashOf !== null ? " Row hashes compare the columns the snapshot had; the new ones are not compared." : ""),
    });
  }
  if (removedColumns.length > 0) {
    warnings.push({ code: "columns_removed", message: `Columns removed from bids since the snapshot: ${removedColumns.join(", ")}.` });
  }
  if (hashOf === null) {
    warnings.push({
      code: "hashes_not_comparable",
      message: "Row hashes cannot be compared across this schema change, so a change outside the tracked columns "
        + `(${TRACKED_COLUMNS.join(", ")}) goes unseen; those columns, the visibility and the metrics are still compared.`,
    });
  }
  if (closedWithoutReason.length > 0) {
    warnings.push({
      code: "closed_without_reason",
      message: `${closedWithoutReason.length} bid(s) went from open to closed with no closed_reason of deadline_passed or delisted on record`,
      ids: closedWithoutReason,
    });
  }

  return {
    before: { takenAt: before.takenAt, dialect: before.dialect, bids: Object.keys(before.rows).length },
    after: { takenAt: after.takenAt, dialect: after.dialect, bids: Object.keys(after.rows).length },
    hashesComparable: hashOf !== null,
    columns: { added: addedColumns, removed: removedColumns },
    added: { count: added.length, byLevel: addedByLevel, ids: added },
    removed: { count: removed.length, byLevel: removedByLevel, ids: removed, allowed, unexpected },
    changed: {
      count: changed,
      groups: [...groups.values()].sort((left, right) => right.count - left.count || byCodeUnit(left.label, right.label)),
      onlyOutsideTracked: { count: hashOf === null ? null : changeOnly.length, ids: hashOf === null ? [] : changeOnly },
    },
    visibility: { regressions },
    metricDeltas: metricDeltas(before.report, after.report),
    failures,
    warnings,
    ok: failures.length === 0,
  };
}

/**
 * Reads the data now, hashing the rows over the columns `before` had, and compares. Returns the snapshot it read too, so
 * that a caller that wants the new state as the next baseline does not read the database twice.
 */
export async function compareWithSnapshot(
  target: IntegrityTarget,
  before: IntegritySnapshot,
  options: { now: Date; allowRemoved?: readonly RegExp[] },
): Promise<{ comparison: IntegrityComparison; after: IntegritySnapshot }> {
  const after = await buildIntegritySnapshot(target, { now: options.now, hashColumns: before.columns });
  return { comparison: compareIntegritySnapshots(before, after, { allowRemoved: options.allowRemoved }), after };
}
