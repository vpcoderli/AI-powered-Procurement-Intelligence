import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";
import type { AppDatabase } from "@/server/db/client";
import {
  COVERAGE_LEVELS,
  SOURCE_APPROVAL_STATES,
  SOURCE_FILTER_MAX_VALUES,
  SOURCE_HEALTH_STATES,
  SOURCE_INDEX_MAX_ROWS,
  SOURCE_LIST_MAX_QUERY_LENGTH,
  coverageLevelOf,
  type AdminDataSourceIndexItem,
  type AdminDataSourceIndexResponse,
  type SourceApprovalState,
  type SourceFacetKey,
  type SourceListFilters,
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

const STATE_PATTERN = /^[A-Z]{2}$/;
const PLATFORM_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

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
    states: matchingValues(distinctValues(params, "state", (value) => value.toUpperCase()), STATE_PATTERN, "state"),
    platforms: matchingValues(distinctValues(params, "platform", (value) => value.toLowerCase()), PLATFORM_PATTERN, "platform"),
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
