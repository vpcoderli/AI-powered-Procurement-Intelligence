/**
 * Vocabulary of the admin source list, index and overview (spec 2026-09-29 §4.2, §5.1).
 * No imports on purpose: client components import these values.
 */
export const COVERAGE_LEVELS = ["federal", "state", "county", "city", "township", "special_district", "unknown"] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export const SOURCE_APPROVAL_STATES = ["approved", "awaiting", "blocked"] as const;
export type SourceApprovalState = (typeof SOURCE_APPROVAL_STATES)[number];

export const SOURCE_HEALTH_STATES = ["never_run", "healthy", "failing", "disabled"] as const;
export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];

export type SourceFacetKey = "level" | "state" | "platform" | "approval" | "health";

export const SOURCE_LIST_MAX_QUERY_LENGTH = 100;
export const SOURCE_FILTER_MAX_VALUES = 60;
export const SOURCE_INDEX_MAX_ROWS = 5000;

export interface SourceListFilters {
  levels: CoverageLevel[];
  states: string[];
  platforms: string[];
  approvals: SourceApprovalState[];
  healths: SourceHealthState[];
  q: string | null;
}

export function emptySourceListFilters(): SourceListFilters {
  return { levels: [], states: [], platforms: [], approvals: [], healths: [], q: null };
}

export interface AdminDataSourceIndexItem {
  id: string;
  label: string;
  stateCode: string;
  level: CoverageLevel;
  issuerType: string;
  jurisdictionLevel: string | null;
  providerFamily: string;
  approvalState: SourceApprovalState;
  isEnabled: boolean;
  crawlerSourceId: string | null;
}

export interface AdminDataSourceIndexResponse {
  items: AdminDataSourceIndexItem[];
  total: number;
  truncated: boolean;
}

export function isCoverageLevel(value: string): value is CoverageLevel {
  return (COVERAGE_LEVELS as readonly string[]).includes(value);
}

export function coverageLevelOf(value: string | null | undefined): CoverageLevel {
  return typeof value === "string" && isCoverageLevel(value) ? value : "unknown";
}
