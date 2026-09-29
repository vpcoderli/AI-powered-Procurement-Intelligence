import { AdminApiError } from "@/lib/api/admin";
import {
  COVERAGE_LEVELS,
  SOURCE_APPROVAL_STATES,
  SOURCE_HEALTH_STATES,
  SOURCE_LIST_DEFAULT_PAGE_SIZE,
  SOURCE_LIST_MAX_QUERY_LENGTH,
  SOURCE_LIST_PAGE_SIZES,
  SOURCE_LIST_SORT_KEYS,
  SOURCE_PLATFORM_PATTERN,
  SOURCE_STATE_PATTERN,
  defaultSourceListQuery,
  type SourceFacetCount,
  type SourceFacetKey,
  type SourceListQuery,
  type SourceListSortKey,
} from "@/server/admin/data-source-list-contract";

const FACET_FIELD = {
  level: "levels",
  state: "states",
  platform: "platforms",
  approval: "approvals",
  health: "healths",
} as const satisfies Record<SourceFacetKey, keyof SourceListQuery>;

/**
 * The page URL, read leniently: unknown values are dropped (and reported so the page can say so and
 * rewrite the URL) and never reach the API, which would answer 400 for them.
 */
export function readSourceListQuery(params: URLSearchParams): { query: SourceListQuery; invalid: boolean } {
  let invalid = false;
  const keep = (values: string[], accept: (value: string) => boolean) => {
    const unique = Array.from(new Set(values));
    const kept = unique.filter(accept);
    if (kept.length !== unique.length) invalid = true;
    return kept;
  };
  const oneOf = (allowed: readonly string[]) => (value: string) => allowed.includes(value);

  const rawSort = params.get("sort") ?? "label";
  const descending = rawSort.startsWith("-");
  const sortKey = descending ? rawSort.slice(1) : rawSort;
  const sortIsValid = (SOURCE_LIST_SORT_KEYS as readonly string[]).includes(sortKey);
  if (!sortIsValid) invalid = true;

  const rawPage = params.get("page");
  const page = rawPage && /^\d+$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  if (rawPage !== null && page !== Number(rawPage)) invalid = true;

  const rawPageSize = params.get("pageSize");
  const pageSize = rawPageSize && (SOURCE_LIST_PAGE_SIZES as readonly number[]).includes(Number(rawPageSize)) ? Number(rawPageSize) : SOURCE_LIST_DEFAULT_PAGE_SIZE;
  if (rawPageSize !== null && pageSize !== Number(rawPageSize)) invalid = true;

  const q = (params.get("q") ?? "").trim().slice(0, SOURCE_LIST_MAX_QUERY_LENGTH);

  const query: SourceListQuery = {
    levels: keep(params.getAll("level"), oneOf(COVERAGE_LEVELS)) as SourceListQuery["levels"],
    states: keep(params.getAll("state").map((value) => value.toUpperCase()), (value) => SOURCE_STATE_PATTERN.test(value)),
    platforms: keep(params.getAll("platform").map((value) => value.toLowerCase()), (value) => SOURCE_PLATFORM_PATTERN.test(value)),
    approvals: keep(params.getAll("approval"), oneOf(SOURCE_APPROVAL_STATES)) as SourceListQuery["approvals"],
    healths: keep(params.getAll("health"), oneOf(SOURCE_HEALTH_STATES)) as SourceListQuery["healths"],
    q: q || null,
    sort: sortIsValid ? (sortKey as SourceListSortKey) : "label",
    descending: sortIsValid ? descending : false,
    page,
    pageSize,
  };
  return { query, invalid };
}

/** Canonical search string ("" for the defaults); the page writes it with router.replace. */
export function writeSourceListQuery(query: SourceListQuery): string {
  const params = new URLSearchParams();
  for (const level of query.levels) params.append("level", level);
  for (const state of query.states) params.append("state", state);
  for (const platform of query.platforms) params.append("platform", platform);
  for (const approval of query.approvals) params.append("approval", approval);
  for (const health of query.healths) params.append("health", health);
  if (query.q) params.set("q", query.q);
  if (query.sort !== "label" || query.descending) params.set("sort", `${query.descending ? "-" : ""}${query.sort}`);
  if (query.page !== 1) params.set("page", String(query.page));
  if (query.pageSize !== SOURCE_LIST_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function selectedFacetValues(query: SourceListQuery, facet: SourceFacetKey): string[] {
  return [...query[FACET_FIELD[facet]]];
}

export function toggleFacetValue(query: SourceListQuery, facet: SourceFacetKey, value: string): SourceListQuery {
  const current = selectedFacetValues(query, facet);
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  return { ...query, [FACET_FIELD[facet]]: next, page: 1 };
}

/** The facet's counted values plus any selected value the counts no longer contain (count 0), so it stays clearable. */
export function facetOptions(counts: readonly SourceFacetCount[], selected: readonly string[]): SourceFacetCount[] {
  const known = new Set(counts.map((count) => count.value));
  return [...counts, ...selected.filter((value) => !known.has(value)).map((value) => ({ value, count: 0 }))];
}

export function pageRange(total: number, page: number, pageSize: number) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return { from: 0, to: 0, lastPage };
  return { from: (page - 1) * pageSize + 1, to: Math.min(total, page * pageSize), lastPage };
}

export function lastRunOf(item: { lastSuccessAt: string | null; lastFailureAt: string | null }): string | null {
  if (!item.lastSuccessAt) return item.lastFailureAt;
  if (!item.lastFailureAt) return item.lastSuccessAt;
  return item.lastSuccessAt >= item.lastFailureAt ? item.lastSuccessAt : item.lastFailureAt;
}

/**
 * What to load when the API refuses `query` with a 400. A page past the end is the usual cause (rows changed under
 * the user, for example after approving the whole last page), so the same filters are tried again from page 1
 * first. Only a refusal of page 1 means the filters themselves are the problem: then the defaults are shown and
 * `fellBack` tells the page to say so. The defaults have nothing left to fall back to, so this never loops.
 */
export function recoverRejectedQuery(query: SourceListQuery): { query: SourceListQuery; fellBack: boolean } {
  if (query.page > 1) return { query: { ...query, page: 1 }, fellBack: false };
  return { query: defaultSourceListQuery(), fellBack: true };
}

/**
 * A failed list request, tagged with the query string it was made for: an answer for an older query must never be
 * blamed on the query the URL holds by the time the answer arrives.
 */
export class ListRequestError extends Error {
  readonly canonical: string;
  readonly failure: unknown;

  constructor(canonical: string, failure: unknown) {
    super(failure instanceof Error ? failure.message : "The source list request failed.");
    this.canonical = canonical;
    this.failure = failure;
  }
}

/**
 * The recovery to make for a failed list request, or null when there is none: the failure is not the API refusing
 * the query (a 400), or it answers an older query than the one the URL holds now (the newer request answers for itself).
 */
export function recoveryForListError(
  error: unknown,
  canonical: string,
  query: SourceListQuery,
): { query: SourceListQuery; fellBack: boolean } | null {
  if (!(error instanceof ListRequestError) || !(error.failure instanceof AdminApiError) || error.failure.status !== 400) return null;
  if (error.canonical !== canonical) return null;
  return recoverRejectedQuery(query);
}

export function hasActiveFilters(query: SourceListQuery): boolean {
  const defaults = defaultSourceListQuery();
  return (
    query.levels.length + query.states.length + query.platforms.length + query.approvals.length + query.healths.length > 0 ||
    query.q !== defaults.q
  );
}
