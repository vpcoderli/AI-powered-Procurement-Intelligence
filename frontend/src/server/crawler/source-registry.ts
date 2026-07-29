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

export function listCrawlableSources(db: AppDatabase): CrawlableSource[] {
  const rows = db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.isEnabled, 1),
        or(isNull(dataSources.approvedForIngestion), eq(dataSources.approvedForIngestion, 1)),
        or(isNull(dataSources.approvalStatus), eq(dataSources.approvalStatus, "approved")),
        or(
          isNull(dataSources.legalReviewStatus),
          inArray(dataSources.legalReviewStatus, LEGAL_REVIEW_ALLOWED),
        ),
      ),
    )
    .all();

  return rows.map((row) => ({
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
  }));
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

export async function listCrawlableSourcesFromMysql(
  pool: MysqlSourceStore,
): Promise<CrawlableSource[]> {
  const rows = await mysqlSelectMany<MysqlSourceRow>(
    pool,
    `
      SELECT
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
      FROM data_sources
      WHERE is_enabled = 1
        AND (approved_for_ingestion IS NULL OR approved_for_ingestion = 1)
        AND (approval_status IS NULL OR approval_status = 'approved')
        AND (legal_review_status IS NULL OR legal_review_status IN ('approved_public', 'approved'))
    `,
  );

  return rows.map((row) => ({
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
  }));
}
