import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";
import type { AppDatabase } from "@/server/db/client";
import {
  COVERAGE_LEVELS,
  SOURCE_APPROVAL_STATES,
  SOURCE_FACET_KEYS,
  SOURCE_FILTER_MAX_VALUES,
  SOURCE_HEALTH_STATES,
  SOURCE_INDEX_MAX_ROWS,
  SOURCE_LIST_DEFAULT_PAGE_SIZE,
  SOURCE_LIST_MAX_PAGE_SIZE,
  SOURCE_LIST_MAX_QUERY_LENGTH,
  SOURCE_LIST_SORT_KEYS,
  SOURCE_PLATFORM_PATTERN,
  SOURCE_STATE_PATTERN,
  coverageLevelOf,
  type AdminDataSourceIndexItem,
  type AdminDataSourceIndexResponse,
  type AdminDataSourceListItem,
  type AdminDataSourceListResponse,
  type SourceApprovalState,
  type SourceFacetCount,
  type SourceFacetKey,
  type SourceHealthState,
  type SourceListFacets,
  type SourceListFilters,
  type SourceListQuery,
  type SourceListSortKey,
} from "./data-source-list-contract";
import { APPROVAL_STATE_SQL, HEALTH_STATE_SQL, LEVEL_SQL, PLATFORM_SQL } from "./data-source-sql";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner, type AdminSqlRunner, type MysqlSqlReader, type SqlValue } from "./sql-runner";

/** A list/index parameter the API cannot honour; routes answer 400 INVALID_REQUEST. */
export class DataSourceQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataSourceQueryError";
  }
}

export interface SqlFragment {
  sql: string;
  values: SqlValue[];
}

function distinctValues(params: URLSearchParams, key: string, normalize: (value: string) => string = (value) => value): string[] {
  const values = Array.from(new Set(params.getAll(key).map((value) => normalize(value.trim())).filter(Boolean)));
  if (values.length > SOURCE_FILTER_MAX_VALUES) {
    throw new DataSourceQueryError(`at most ${SOURCE_FILTER_MAX_VALUES} ${key} values`);
  }
  return values;
}

function allowedValues<T extends string>(values: string[], allowed: readonly T[], key: string): T[] {
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) throw new DataSourceQueryError(`unknown ${key}: ${value}`);
  }
  return values as T[];
}

function matchingValues(values: string[], pattern: RegExp, key: string): string[] {
  for (const value of values) {
    if (!pattern.test(value)) throw new DataSourceQueryError(`invalid ${key}: ${value}`);
  }
  return values;
}

/** Spec §5.1 filters, shared by the paginated list and the index. */
export function parseSourceListFilters(params: URLSearchParams): SourceListFilters {
  const q = params.get("q")?.trim() ?? "";
  if (q.length > SOURCE_LIST_MAX_QUERY_LENGTH) {
    throw new DataSourceQueryError(`q must be at most ${SOURCE_LIST_MAX_QUERY_LENGTH} characters`);
  }

  return {
    levels: allowedValues(distinctValues(params, "level"), COVERAGE_LEVELS, "level"),
    states: matchingValues(distinctValues(params, "state", (value) => value.toUpperCase()), SOURCE_STATE_PATTERN, "state"),
    platforms: matchingValues(distinctValues(params, "platform", (value) => value.toLowerCase()), SOURCE_PLATFORM_PATTERN, "platform"),
    approvals: allowedValues(distinctValues(params, "approval"), SOURCE_APPROVAL_STATES, "approval"),
    healths: allowedValues(distinctValues(params, "health"), SOURCE_HEALTH_STATES, "health"),
    q: q || null,
  };
}

/** `%q%` in lower case with LIKE's wildcards escaped by `!` (use with `ESCAPE '!'`). */
export function likeContainsPattern(query: string): string {
  return `%${query.toLowerCase().replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

/** WHERE clause for the filters; `except` leaves one dimension out (facet counts). */
export function sourceFilterWhere(filters: SourceListFilters, except?: SourceFacetKey): SqlFragment {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  const addIn = (key: SourceFacetKey, expression: string, list: readonly string[]) => {
    if (key === except || list.length === 0) return;
    clauses.push(`${expression} IN (${list.map(() => "?").join(", ")})`);
    values.push(...list);
  };

  addIn("level", LEVEL_SQL, filters.levels);
  addIn("state", "state_code", filters.states);
  addIn("platform", PLATFORM_SQL, filters.platforms);
  addIn("approval", APPROVAL_STATE_SQL, filters.approvals);
  addIn("health", HEALTH_STATE_SQL, filters.healths);
  if (filters.q) {
    const pattern = likeContainsPattern(filters.q);
    clauses.push(
      "(LOWER(id) LIKE ? ESCAPE '!' OR LOWER(label) LIKE ? ESCAPE '!' OR LOWER(COALESCE(jurisdiction_name, '')) LIKE ? ESCAPE '!')",
    );
    values.push(pattern, pattern, pattern);
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

interface IndexRow {
  id: string;
  label: string;
  state_code: string;
  issuer_type: string;
  jurisdiction_level: string | null;
  coverage_level: string;
  platform: string;
  approval_state: string;
  is_enabled: unknown;
}

function toIndexItem(row: IndexRow): AdminDataSourceIndexItem {
  return {
    id: row.id,
    label: row.label,
    stateCode: row.state_code,
    level: coverageLevelOf(row.coverage_level),
    issuerType: row.issuer_type,
    jurisdictionLevel: row.jurisdiction_level ?? null,
    providerFamily: row.platform,
    approvalState: row.approval_state as SourceApprovalState,
    isEnabled: sqlCount(row.is_enabled) === 1,
    crawlerSourceId: stateCrawlerSourceIdForAdminSource({ issuerType: row.issuer_type, stateCode: row.state_code }),
  };
}

/** Every matching source (spec §5.1 index), capped at SOURCE_INDEX_MAX_ROWS. */
export async function listSourceIndex(runner: AdminSqlRunner, filters: SourceListFilters): Promise<AdminDataSourceIndexResponse> {
  const where = sourceFilterWhere(filters);
  const rows = await runner.all<IndexRow>(
    `SELECT id, label, state_code, issuer_type, jurisdiction_level, ${LEVEL_SQL} AS coverage_level, ${PLATFORM_SQL} AS platform, ${APPROVAL_STATE_SQL} AS approval_state, is_enabled FROM data_sources ${where.sql} ORDER BY LOWER(label) ASC, id ASC LIMIT ${SOURCE_INDEX_MAX_ROWS + 1}`,
    where.values,
  );
  const items = rows.slice(0, SOURCE_INDEX_MAX_ROWS).map(toIndexItem);
  return { items, total: items.length, truncated: rows.length > SOURCE_INDEX_MAX_ROWS };
}

export function listAdminDataSourceIndex(db: AppDatabase, filters: SourceListFilters) {
  return listSourceIndex(sqliteSqlRunner(db), filters);
}

export function listAdminDataSourceIndexFromMysql(mysql: MysqlSqlReader, filters: SourceListFilters) {
  return listSourceIndex(mysqlSqlRunner(mysql), filters);
}

function positiveInteger(raw: string | null, fallback: number, key: string): number {
  if (raw === null || raw.trim() === "") return fallback;
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) throw new DataSourceQueryError(`${key} must be a positive integer`);
  return Number(text);
}

/** Spec §5.1 list parameters: the filters plus sort (`-` for descending), page and pageSize. */
export function parseSourceListQuery(params: URLSearchParams): SourceListQuery {
  const filters = parseSourceListFilters(params);
  const rawSort = params.get("sort")?.trim() || "label";
  const descending = rawSort.startsWith("-");
  const sortKey = descending ? rawSort.slice(1) : rawSort;
  if (!(SOURCE_LIST_SORT_KEYS as readonly string[]).includes(sortKey)) throw new DataSourceQueryError(`unknown sort: ${rawSort}`);
  const page = positiveInteger(params.get("page"), 1, "page");
  const pageSize = positiveInteger(params.get("pageSize"), SOURCE_LIST_DEFAULT_PAGE_SIZE, "pageSize");
  if (pageSize > SOURCE_LIST_MAX_PAGE_SIZE) throw new DataSourceQueryError(`pageSize must be at most ${SOURCE_LIST_MAX_PAGE_SIZE}`);

  return { ...filters, sort: sortKey as SourceListSortKey, descending, page, pageSize };
}

const LAST_RUN_AT_SQL =
  "(CASE WHEN last_success_at IS NULL THEN last_failure_at WHEN last_failure_at IS NULL THEN last_success_at WHEN last_success_at >= last_failure_at THEN last_success_at ELSE last_failure_at END)";

/** Stable order: every sort ends on id; rows that never ran sort last in both directions. */
export function sourceListOrderBy(sort: SourceListSortKey, descending: boolean): string {
  const direction = descending ? "DESC" : "ASC";
  switch (sort) {
    case "label":
      return `LOWER(label) ${direction}, id ASC`;
    case "lastRun":
      return `(${LAST_RUN_AT_SQL} IS NULL) ASC, ${LAST_RUN_AT_SQL} ${direction}, id ASC`;
    case "failures":
      return `consecutive_failures ${direction}, LOWER(label) ASC, id ASC`;
    case "updated":
      return `updated_at ${direction}, id ASC`;
  }
}

const FACET_EXPRESSIONS: Record<SourceFacetKey, string> = {
  level: LEVEL_SQL,
  state: "state_code",
  platform: PLATFORM_SQL,
  approval: APPROVAL_STATE_SQL,
  health: HEALTH_STATE_SQL,
};

const LIST_COLUMNS = `id, label, state_code, issuer_type, jurisdiction_level, jurisdiction_name, is_enabled, ${LEVEL_SQL} AS coverage_level, ${PLATFORM_SQL} AS platform, ${APPROVAL_STATE_SQL} AS approval_state, ${HEALTH_STATE_SQL} AS health_state, last_success_at, last_failure_at, consecutive_failures, precheck_requested_at, live_health_disposition`;

interface ListRow extends IndexRow {
  jurisdiction_name: string | null;
  health_state: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: unknown;
  precheck_requested_at: string | null;
  live_health_disposition: string | null;
}

function toListItem(row: ListRow): AdminDataSourceListItem {
  return {
    ...toIndexItem(row),
    jurisdictionName: row.jurisdiction_name ?? null,
    health: row.health_state as SourceHealthState,
    lastSuccessAt: row.last_success_at ?? null,
    lastFailureAt: row.last_failure_at ?? null,
    consecutiveFailures: sqlCount(row.consecutive_failures),
    precheckRequestedAt: row.precheck_requested_at ?? null,
    liveHealthDisposition: row.live_health_disposition ?? null,
  };
}

function orderFacet(key: SourceFacetKey, counts: SourceFacetCount[]): SourceFacetCount[] {
  const canonical: readonly string[] | null =
    key === "level" ? COVERAGE_LEVELS : key === "approval" ? SOURCE_APPROVAL_STATES : key === "health" ? SOURCE_HEALTH_STATES : null;
  if (canonical) return [...counts].sort((a, b) => canonical.indexOf(a.value) - canonical.indexOf(b.value));
  if (key === "state") return [...counts].sort((a, b) => a.value.localeCompare(b.value));
  return [...counts].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

async function sourceFacets(runner: AdminSqlRunner, filters: SourceListFilters): Promise<SourceListFacets> {
  const entries = await Promise.all(
    SOURCE_FACET_KEYS.map(async (key) => {
      const where = sourceFilterWhere(filters, key);
      const expression = FACET_EXPRESSIONS[key];
      const rows = await runner.all<{ facet_value: unknown; total: unknown }>(
        `SELECT ${expression} AS facet_value, COUNT(*) AS total FROM data_sources ${where.sql} GROUP BY ${expression}`,
        where.values,
      );
      return [key, orderFacet(key, rows.map((row) => ({ value: String(row.facet_value), count: sqlCount(row.total) })))] as const;
    }),
  );
  return Object.fromEntries(entries) as SourceListFacets;
}

/** Spec §5.1: one page of compact rows, the total and the facets. */
export async function listSourcePage(runner: AdminSqlRunner, query: SourceListQuery): Promise<AdminDataSourceListResponse> {
  const where = sourceFilterWhere(query);
  const [countRow] = await runner.all<{ total: unknown }>(`SELECT COUNT(*) AS total FROM data_sources ${where.sql}`, where.values);
  const total = sqlCount(countRow?.total);
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
  if (query.page > lastPage) throw new DataSourceQueryError(`page ${query.page} is out of range (last page ${lastPage})`);

  const [rows, facets] = await Promise.all([
    runner.all<ListRow>(
      `SELECT ${LIST_COLUMNS} FROM data_sources ${where.sql} ORDER BY ${sourceListOrderBy(query.sort, query.descending)} LIMIT ? OFFSET ?`,
      [...where.values, query.pageSize, (query.page - 1) * query.pageSize],
    ),
    sourceFacets(runner, query),
  ]);

  return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize, facets };
}

export function listAdminDataSourcesPage(db: AppDatabase, query: SourceListQuery) {
  return listSourcePage(sqliteSqlRunner(db), query);
}

export function listAdminDataSourcesPageFromMysql(mysql: MysqlSqlReader, query: SourceListQuery) {
  return listSourcePage(mysqlSqlRunner(mysql), query);
}
