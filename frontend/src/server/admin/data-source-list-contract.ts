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

/**
 * What a `state` and a `platform` filter value must look like. The list API validates with these and the page's
 * URL reader drops what they refuse, so the page never sends a value the API would answer 400 for.
 */
export const SOURCE_STATE_PATTERN = /^[A-Z]{2}$/;
export const SOURCE_PLATFORM_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

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

export const SOURCE_LIST_SORT_KEYS = ["label", "lastRun", "failures", "updated"] as const;
export type SourceListSortKey = (typeof SOURCE_LIST_SORT_KEYS)[number];

export const SOURCE_LIST_DEFAULT_PAGE_SIZE = 50;
export const SOURCE_LIST_MAX_PAGE_SIZE = 200;
export const SOURCE_LIST_PAGE_SIZES = [25, 50, 100, 200] as const;
export const SOURCE_FACET_KEYS: readonly SourceFacetKey[] = ["level", "state", "platform", "approval", "health"];

export interface SourceListQuery extends SourceListFilters {
  sort: SourceListSortKey;
  descending: boolean;
  page: number;
  pageSize: number;
}

export function defaultSourceListQuery(): SourceListQuery {
  return { ...emptySourceListFilters(), sort: "label", descending: false, page: 1, pageSize: SOURCE_LIST_DEFAULT_PAGE_SIZE };
}

export interface AdminDataSourceListItem {
  id: string;
  label: string;
  stateCode: string;
  level: CoverageLevel;
  issuerType: string;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  providerFamily: string;
  approvalState: SourceApprovalState;
  isEnabled: boolean;
  health: SourceHealthState;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  precheckRequestedAt: string | null;
  liveHealthDisposition: string | null;
  crawlerSourceId: string | null;
}

export interface SourceFacetCount {
  value: string;
  count: number;
}

export type SourceListFacets = Record<SourceFacetKey, SourceFacetCount[]>;

export interface AdminDataSourceListResponse {
  items: AdminDataSourceListItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: SourceListFacets;
}
