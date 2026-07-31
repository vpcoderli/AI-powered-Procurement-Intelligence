import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";

export interface CrawlableSource {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string | null;
  cadence: string;
  providerFamily: string | null;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  fipsCode: string | null;
  fetchConfig: Record<string, unknown>;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export interface MysqlSourceStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

/**
 * Governance gating semantics must match orchestrator.ts's blockedReasonFor exactly:
 * a source is excluded only on an EXPLICIT denial. NULL means "never reviewed", not
 * "denied".
 *
 * Production data as of 2026-07-29: 45 beta state sources have approved_for_ingestion=0
 * (explicitly denied, correctly excluded), 5 verified sources have 1, and 6 rows have all
 * three governance columns NULL — including sam_gov. Treating NULL as denied would
 * silently stop crawling SAM.gov.
 */
const LEGAL_REVIEW_ALLOWED = ["approved_public", "approved"];

function parseFetchConfig(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toCrawlableSource(row: typeof dataSources.$inferSelect): CrawlableSource {
  return {
    id: row.id,
    label: row.label,
    issuerType: row.issuerType,
    stateCode: row.stateCode,
    baseUrl: row.baseUrl ?? null,
    cadence: row.cadence,
    providerFamily: row.providerFamily ?? null,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    jurisdictionName: row.jurisdictionName ?? null,
    fipsCode: row.fipsCode ?? null,
    fetchConfig: parseFetchConfig(row.fetchConfig),
    lastSuccessAt: row.lastSuccessAt ?? null,
    consecutiveFailures: row.consecutiveFailures ?? 0,
  };
}

export function listCrawlableSources(db: AppDatabase): CrawlableSource[] {
  const rows = db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.isEnabled, 1),
        or(isNull(dataSources.approvedForIngestion), eq(dataSources.approvedForIngestion, 1)),
        or(
          eq(dataSources.approvalStatus, "approved"),
          and(
            isNull(dataSources.approvalStatus),
            or(
              isNull(dataSources.jurisdictionLevel),
              inArray(dataSources.jurisdictionLevel, ["federal", "state"]),
            ),
          ),
        ),
        or(
          isNull(dataSources.legalReviewStatus),
          inArray(dataSources.legalReviewStatus, LEGAL_REVIEW_ALLOWED),
        ),
      ),
    )
    .all();

  return rows.map(toCrawlableSource);
}

/**
 * Every `data_sources` row, with NO governance gate -- unlike listCrawlableSources above.
 * Used only to resolve explicitly-requested source ids on the manual admin run route
 * (/api/crawler/state/run): a blocked or needs_review source must still be *found* here so
 * it can be dispatched through runCrawlerSourceOnce and come back with its real
 * orchestrator-computed "blocked"/"disabled" result, instead of being treated as "not
 * requested" -- which is what used to trigger a silent fallback to running every other
 * approved source instead.
 */
export function listAllSources(db: AppDatabase): CrawlableSource[] {
  return db.select().from(dataSources).all().map(toCrawlableSource);
}

interface MysqlSourceRow {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string | null;
  cadence: string | null;
  providerFamily: string | null;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  fipsCode: string | null;
  fetchConfig: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number | string | null;
}

const MYSQL_SOURCE_COLUMNS = `
  id,
  label,
  issuer_type AS issuerType,
  state_code AS stateCode,
  base_url AS baseUrl,
  cadence,
  provider_family AS providerFamily,
  jurisdiction_level AS jurisdictionLevel,
  jurisdiction_name AS jurisdictionName,
  fips_code AS fipsCode,
  fetch_config AS fetchConfig,
  last_success_at AS lastSuccessAt,
  consecutive_failures AS consecutiveFailures
`;

function toCrawlableSourceFromMysqlRow(row: MysqlSourceRow): CrawlableSource {
  return {
    id: row.id,
    label: row.label,
    issuerType: row.issuerType,
    stateCode: row.stateCode,
    baseUrl: row.baseUrl ?? null,
    cadence: row.cadence ?? "daily",
    providerFamily: row.providerFamily ?? null,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    jurisdictionName: row.jurisdictionName ?? null,
    fipsCode: row.fipsCode ?? null,
    fetchConfig: parseFetchConfig(row.fetchConfig),
    lastSuccessAt: row.lastSuccessAt ?? null,
    consecutiveFailures: Number(row.consecutiveFailures ?? 0),
  };
}

export async function listCrawlableSourcesFromMysql(
  pool: MysqlSourceStore,
): Promise<CrawlableSource[]> {
  const rows = await mysqlSelectMany<MysqlSourceRow>(
    pool,
    `
      SELECT ${MYSQL_SOURCE_COLUMNS}
      FROM data_sources
      WHERE is_enabled = 1
        AND (approved_for_ingestion IS NULL OR approved_for_ingestion = 1)
        AND (
          approval_status = 'approved'
          OR (
            approval_status IS NULL
            AND (jurisdiction_level IS NULL OR jurisdiction_level IN ('federal', 'state'))
          )
        )
        AND (legal_review_status IS NULL OR legal_review_status IN ('approved_public', 'approved'))
    `,
  );

  return rows.map(toCrawlableSourceFromMysqlRow);
}

/**
 * MySQL twin of listAllSources above — every `data_sources` row, no governance gate.
 */
export async function listAllSourcesFromMysql(pool: MysqlSourceStore): Promise<CrawlableSource[]> {
  const rows = await mysqlSelectMany<MysqlSourceRow>(pool, `SELECT ${MYSQL_SOURCE_COLUMNS} FROM data_sources`);
  return rows.map(toCrawlableSourceFromMysqlRow);
}
