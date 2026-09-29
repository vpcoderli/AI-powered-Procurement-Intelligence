import { COVERAGE_LEVELS, type CoverageLevel } from "@/server/admin/data-source-list-contract";

export interface OverviewStateRow {
  stateCode: string;
  total: number;
  byLevel: Partial<Record<CoverageLevel, number>>;
}

export type StateSortKey = "stateCode" | "total" | CoverageLevel;

export interface StateSort {
  key: StateSortKey;
  descending: boolean;
}

export const TOP_STATES = 10;

/** Width of a CSS bar in percent (spec §4.3: no chart library). */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function sortStates(rows: readonly OverviewStateRow[], sort: StateSort): OverviewStateRow[] {
  const valueOf = (row: OverviewStateRow) =>
    sort.key === "stateCode" ? row.stateCode : sort.key === "total" ? row.total : (row.byLevel[sort.key] ?? 0);
  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    const compared = typeof left === "string" ? left.localeCompare(String(right)) : left - Number(right);
    return (sort.descending ? -compared : compared) || a.stateCode.localeCompare(b.stateCode);
  });
}

export function visibleStates(rows: readonly OverviewStateRow[], sort: StateSort, showAll: boolean): OverviewStateRow[] {
  const sorted = sortStates(rows, sort);
  return showAll ? sorted : sorted.slice(0, TOP_STATES);
}

/** Generic so object literals with extra fields (the rows in the test) type-check; only `level` and `total` are read. */
export function stateLevelColumns<T extends { level: CoverageLevel; total: number }>(byLevel: ReadonlyArray<T>): CoverageLevel[] {
  return COVERAGE_LEVELS.filter((level) => byLevel.some((entry) => entry.level === level && entry.total > 0));
}

export function toggleStateSort(current: StateSort, key: StateSortKey): StateSort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key !== "stateCode" };
}
