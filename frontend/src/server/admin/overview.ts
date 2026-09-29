import type { AppDatabase } from "@/server/db/client";
import { isThrottleFailure } from "@/server/crawler/platform-deferral";
import { listAdminBidQaItems, listAdminBidQaItemsFromMysql } from "./bid-qa-repository";
import { COVERAGE_LEVELS, coverageLevelOf, type CoverageLevel } from "./data-source-list-contract";
import { LEVEL_SQL, LOCAL_SOURCE_SQL, SCHEDULED_SQL } from "./data-source-sql";
import {
  listLocalLedgerSources,
  listLocalLedgerSourcesFromMysql,
  type AdminDataSource,
  type MysqlDataSourcesStore,
} from "./data-sources-repository";
import { summarizeApprovalReadiness, type ApprovalReadinessBucket } from "./ledgered-approval";
import {
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  type EffectivePlatformReview,
  type MysqlPlatformReviewsStore,
  type PlatformReview,
} from "./platform-reviews-repository";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner, type AdminSqlRunner } from "./sql-runner";
import { isSyntheticProviderFamily } from "./synthetic-provider-families";

export interface CoverageLevelCounts {
  level: CoverageLevel;
  total: number;
  enabled: number;
  approved: number;
  awaitingApproval: number;
  blocked: number;
  neverRun: number;
}

export interface AdminOverviewCoverage {
  totals: { sources: number; scheduled: number; awaitingApproval: number; neverRun: number };
  byLevel: CoverageLevelCounts[];
  byState: Array<{ stateCode: string; total: number; byLevel: Partial<Record<CoverageLevel, number>> }>;
}

export interface AdminOverviewPipelineRow {
  providerFamily: string;
  platformReview: EffectivePlatformReview;
  counts: Record<ApprovalReadinessBucket, number>;
  queued: number;
  oldestQueuedAt: string | null;
}

export interface AdminOverviewRunCounts {
  success: number;
  failure: number;
  other: number;
}

export interface AdminOverviewCrawlHealth {
  runs24h: AdminOverviewRunCounts;
  runs7d: AdminOverviewRunCounts;
  lastRunAt: string | null;
  failingSources: number;
  worstFailing: Array<{ id: string; label: string; consecutiveFailures: number; lastFailureAt: string | null }>;
  throttleEvents24h: number;
}

export interface AdminOverviewBids {
  open: number;
  closed: number;
  awarded: number;
  new24h: number;
  new7d: number;
  openByLevel: Partial<Record<CoverageLevel, number>>;
  pendingQa: number;
}

export type AdminOverviewSectionKey = "coverage" | "pipeline" | "crawlHealth" | "bids";

export interface AdminOverviewSectionError {
  code: "SECTION_FAILED";
  message: string;
}

export interface AdminOverview {
  generatedAt: string;
  coverage: AdminOverviewCoverage | null;
  pipeline: AdminOverviewPipelineRow[] | null;
  crawlHealth: AdminOverviewCrawlHealth | null;
  bids: AdminOverviewBids | null;
  errors: Partial<Record<AdminOverviewSectionKey, AdminOverviewSectionError>>;
}

export const COVERAGE_SQL = `SELECT ${LEVEL_SQL} AS coverage_level, state_code AS state_code, COUNT(*) AS total, SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) AS enabled, SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN approval_status = 'blocked' THEN 1 ELSE 0 END) AS blocked, SUM(CASE WHEN ${LOCAL_SOURCE_SQL} AND (approval_status IS NULL OR approval_status = 'needs_review') THEN 1 ELSE 0 END) AS awaiting_approval, SUM(CASE WHEN last_success_at IS NULL AND last_failure_at IS NULL THEN 1 ELSE 0 END) AS never_run, SUM(CASE WHEN ${SCHEDULED_SQL} THEN 1 ELSE 0 END) AS scheduled FROM data_sources GROUP BY ${LEVEL_SQL}, state_code`;

export const CRAWL_RUNS_SQL = `SELECT status, SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS last_24h, COUNT(*) AS last_7d FROM crawler_logs WHERE source <> 'attachment_repair' AND started_at >= ? GROUP BY status`;
export const LAST_RUN_SQL = `SELECT MAX(started_at) AS last_run_at FROM crawler_logs WHERE source <> 'attachment_repair'`;
export const FAILING_COUNT_SQL = `SELECT COUNT(*) AS failing FROM data_sources WHERE is_enabled = 1 AND consecutive_failures > 0`;
export const WORST_FAILING_SQL = `SELECT id, label, consecutive_failures, last_failure_at FROM data_sources WHERE is_enabled = 1 AND consecutive_failures > 0 ORDER BY consecutive_failures DESC, last_failure_at DESC, id ASC LIMIT 5`;
export const THROTTLE_CANDIDATES_SQL = `SELECT error_code, error_message FROM crawler_logs WHERE status = 'failure' AND source <> 'attachment_repair' AND started_at >= ? AND (error_code = 'HtmlPageError' OR error_code LIKE '%ChallengeError')`;
export const BIDS_BY_LIFECYCLE_SQL = `SELECT lifecycle_status, COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_24h, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d FROM bids GROUP BY lifecycle_status`;
export const OPEN_BIDS_BY_LEVEL_SQL = `SELECT ${LEVEL_SQL} AS coverage_level, COUNT(*) AS total FROM bids WHERE lifecycle_status = 'open' GROUP BY ${LEVEL_SQL}`;

interface CoverageRow {
  coverage_level: string;
  state_code: string;
  total: unknown;
  enabled: unknown;
  approved: unknown;
  blocked: unknown;
  awaiting_approval: unknown;
  never_run: unknown;
  scheduled: unknown;
}

export function foldCoverage(rows: readonly CoverageRow[]): AdminOverviewCoverage {
  const totals = { sources: 0, scheduled: 0, awaitingApproval: 0, neverRun: 0 };
  const byLevel = new Map<CoverageLevel, CoverageLevelCounts>();
  const byState = new Map<string, { stateCode: string; total: number; byLevel: Partial<Record<CoverageLevel, number>> }>();

  for (const row of rows) {
    const level = coverageLevelOf(row.coverage_level);
    const total = sqlCount(row.total);
    const awaitingApproval = sqlCount(row.awaiting_approval);
    const neverRun = sqlCount(row.never_run);
    totals.sources += total;
    totals.scheduled += sqlCount(row.scheduled);
    totals.awaitingApproval += awaitingApproval;
    totals.neverRun += neverRun;

    const levelEntry = byLevel.get(level) ?? { level, total: 0, enabled: 0, approved: 0, awaitingApproval: 0, blocked: 0, neverRun: 0 };
    levelEntry.total += total;
    levelEntry.enabled += sqlCount(row.enabled);
    levelEntry.approved += sqlCount(row.approved);
    levelEntry.awaitingApproval += awaitingApproval;
    levelEntry.blocked += sqlCount(row.blocked);
    levelEntry.neverRun += neverRun;
    byLevel.set(level, levelEntry);

    const stateEntry = byState.get(row.state_code) ?? { stateCode: row.state_code, total: 0, byLevel: {} };
    stateEntry.total += total;
    stateEntry.byLevel[level] = (stateEntry.byLevel[level] ?? 0) + total;
    byState.set(row.state_code, stateEntry);
  }

  return {
    totals,
    byLevel: COVERAGE_LEVELS.flatMap((level) => {
      const entry = byLevel.get(level);
      return entry ? [entry] : [];
    }),
    byState: [...byState.values()].sort((a, b) => b.total - a.total || a.stateCode.localeCompare(b.stateCode)),
  };
}

export function buildPipeline(sources: readonly AdminDataSource[], reviews: readonly PlatformReview[], now: Date): AdminOverviewPipelineRow[] {
  const families = [...new Set(sources.map((source) => source.providerFamily))]
    .filter((family) => !isSyntheticProviderFamily(family))
    .sort((a, b) => a.localeCompare(b));

  return families.map((family) => {
    const summary = summarizeApprovalReadiness(sources, reviews, now, family);
    const queuedAt = sources
      .filter((source) => source.providerFamily === family && source.precheckRequestedAt)
      .map((source) => source.precheckRequestedAt as string)
      .sort();
    return {
      providerFamily: family,
      platformReview: summary.platformReview ?? { status: "missing", review: null },
      counts: summary.counts,
      queued: queuedAt.length,
      oldestQueuedAt: queuedAt[0] ?? null,
    };
  });
}

export function foldRuns(rows: ReadonlyArray<{ status: string; last_24h: unknown; last_7d: unknown }>) {
  const runs24h: AdminOverviewRunCounts = { success: 0, failure: 0, other: 0 };
  const runs7d: AdminOverviewRunCounts = { success: 0, failure: 0, other: 0 };
  for (const row of rows) {
    const key: keyof AdminOverviewRunCounts = row.status === "success" ? "success" : row.status === "failure" ? "failure" : "other";
    runs24h[key] += sqlCount(row.last_24h);
    runs7d[key] += sqlCount(row.last_7d);
  }
  return { runs24h, runs7d };
}

export function foldBids(
  lifecycleRows: ReadonlyArray<{ lifecycle_status: string; total: unknown; new_24h: unknown; new_7d: unknown }>,
  levelRows: ReadonlyArray<{ coverage_level: string; total: unknown }>,
  pendingQa: number,
): AdminOverviewBids {
  const summary: AdminOverviewBids = { open: 0, closed: 0, awarded: 0, new24h: 0, new7d: 0, openByLevel: {}, pendingQa };
  for (const row of lifecycleRows) {
    if (row.lifecycle_status === "open" || row.lifecycle_status === "closed" || row.lifecycle_status === "awarded") {
      summary[row.lifecycle_status] += sqlCount(row.total);
    }
    summary.new24h += sqlCount(row.new_24h);
    summary.new7d += sqlCount(row.new_7d);
  }
  for (const row of levelRows) {
    const level = coverageLevelOf(row.coverage_level);
    summary.openByLevel[level] = (summary.openByLevel[level] ?? 0) + sqlCount(row.total);
  }
  return summary;
}

export interface AdminOverviewDependencies {
  sql: AdminSqlRunner;
  listLedgerSources: () => Promise<AdminDataSource[]>;
  listPlatformReviews: () => Promise<PlatformReview[]>;
  bidQaNeedsReview: () => Promise<number>;
  now: Date;
  onSectionError?: (section: AdminOverviewSectionKey, error: unknown) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SECTION_FAILED_MESSAGE = "This section could not be computed.";

export async function computeAdminOverview(deps: AdminOverviewDependencies): Promise<AdminOverview> {
  const errors: AdminOverview["errors"] = {};
  const since24h = new Date(deps.now.getTime() - DAY_MS).toISOString();
  const since7d = new Date(deps.now.getTime() - 7 * DAY_MS).toISOString();
  const reportError =
    deps.onSectionError ?? ((section: AdminOverviewSectionKey, error: unknown) => console.error(`[admin-overview] ${section} failed`, error));

  async function section<T>(key: AdminOverviewSectionKey, compute: () => Promise<T>): Promise<T | null> {
    try {
      return await compute();
    } catch (error) {
      reportError(key, error);
      errors[key] = { code: "SECTION_FAILED", message: SECTION_FAILED_MESSAGE };
      return null;
    }
  }

  const [coverage, pipeline, crawlHealth, bids] = await Promise.all([
    section("coverage", async () => foldCoverage(await deps.sql.all<CoverageRow>(COVERAGE_SQL))),
    section("pipeline", async () => buildPipeline(await deps.listLedgerSources(), await deps.listPlatformReviews(), deps.now)),
    section("crawlHealth", async () => {
      const [runRows, lastRunRows, failingRows, worstRows, throttleRows] = await Promise.all([
        deps.sql.all<{ status: string; last_24h: unknown; last_7d: unknown }>(CRAWL_RUNS_SQL, [since24h, since7d]),
        deps.sql.all<{ last_run_at: string | null }>(LAST_RUN_SQL),
        deps.sql.all<{ failing: unknown }>(FAILING_COUNT_SQL),
        deps.sql.all<{ id: string; label: string; consecutive_failures: unknown; last_failure_at: string | null }>(WORST_FAILING_SQL),
        deps.sql.all<{ error_code: string | null; error_message: string | null }>(THROTTLE_CANDIDATES_SQL, [since24h]),
      ]);
      return {
        ...foldRuns(runRows),
        lastRunAt: lastRunRows[0]?.last_run_at ?? null,
        failingSources: sqlCount(failingRows[0]?.failing),
        worstFailing: worstRows.map((row) => ({
          id: row.id,
          label: row.label,
          consecutiveFailures: sqlCount(row.consecutive_failures),
          lastFailureAt: row.last_failure_at ?? null,
        })),
        throttleEvents24h: throttleRows.filter((row) => isThrottleFailure({ errorCode: row.error_code, errorMessage: row.error_message })).length,
      };
    }),
    section("bids", async () => {
      const [lifecycleRows, levelRows, pendingQa] = await Promise.all([
        deps.sql.all<{ lifecycle_status: string; total: unknown; new_24h: unknown; new_7d: unknown }>(BIDS_BY_LIFECYCLE_SQL, [since24h, since7d]),
        deps.sql.all<{ coverage_level: string; total: unknown }>(OPEN_BIDS_BY_LEVEL_SQL),
        deps.bidQaNeedsReview(),
      ]);
      return foldBids(lifecycleRows, levelRows, pendingQa);
    }),
  ]);

  return { generatedAt: deps.now.toISOString(), coverage, pipeline, crawlHealth, bids, errors };
}

export function getAdminOverview(db: AppDatabase, now = new Date()): Promise<AdminOverview> {
  return computeAdminOverview({
    sql: sqliteSqlRunner(db),
    listLedgerSources: () => listLocalLedgerSources(db),
    listPlatformReviews: async () => listPlatformReviews(db),
    bidQaNeedsReview: async () => (await listAdminBidQaItems(db, { limit: 1 })).summary.needsReview,
    now,
  });
}

export type AdminOverviewMysqlStore = MysqlDataSourcesStore &
  MysqlPlatformReviewsStore &
  Parameters<typeof listAdminBidQaItemsFromMysql>[0];

export function getAdminOverviewFromMysql(mysql: AdminOverviewMysqlStore, now = new Date()): Promise<AdminOverview> {
  return computeAdminOverview({
    sql: mysqlSqlRunner(mysql),
    listLedgerSources: () => listLocalLedgerSourcesFromMysql(mysql),
    listPlatformReviews: () => listPlatformReviewsFromMysql(mysql),
    bidQaNeedsReview: async () => (await listAdminBidQaItemsFromMysql(mysql, { limit: 1 })).summary.needsReview,
    now,
  });
}
