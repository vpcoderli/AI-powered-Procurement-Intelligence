import type { AppDatabase } from "@/server/db/client";
import { sourceBidIdLikePattern } from "@/server/crawler/lifecycle";
import { coverageLevelOf, type CoverageLevel, type SourceApprovalState, type SourceHealthState } from "./data-source-list-contract";
import { APPROVAL_STATE_SQL, HEALTH_STATE_SQL, LEVEL_SQL, PLATFORM_SQL } from "./data-source-sql";
import {
  getAdminDataSource,
  getAdminDataSourceFromMysql,
  type AdminDataSource,
  type AdminDataSourceRecord,
  type MysqlDataSourcesStore,
} from "./data-sources-repository";
import {
  evaluateLedgeredApproval,
  isLocalSource,
  readinessBucket,
  type ApprovalReadinessBucket,
  type LedgeredApprovalReason,
} from "./ledgered-approval";
import {
  effectivePlatformReview,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  type EffectivePlatformReview,
  type MysqlPlatformReviewsStore,
  type PlatformReview,
} from "./platform-reviews-repository";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner, type AdminSqlRunner } from "./sql-runner";

export interface AdminSourceStates {
  level: CoverageLevel;
  platform: string;
  approval: SourceApprovalState;
  health: SourceHealthState;
}

export interface AdminSourceReadiness {
  bucket: ApprovalReadinessBucket;
  reason: LedgeredApprovalReason | null;
  platformReview: EffectivePlatformReview;
}

export interface AdminSourceBid {
  id: string;
  title: string;
  publishedDate: string | null;
  deadlineDate: string | null;
  lifecycleStatus: string;
}

export interface AdminSourceBids {
  counts: { open: number; closed: number; awarded: number; total: number };
  latest: AdminSourceBid[];
}

export interface AdminDataSourceDetail {
  source: AdminDataSource;
  logSourceKeys: string[];
  states: AdminSourceStates;
  readiness: AdminSourceReadiness | null;
  bids: AdminSourceBids;
}

export const SOURCE_STATES_SQL = `SELECT ${LEVEL_SQL} AS coverage_level, ${PLATFORM_SQL} AS platform, ${APPROVAL_STATE_SQL} AS approval_state, ${HEALTH_STATE_SQL} AS health_state FROM data_sources WHERE id = ?`;

/** A source's bids carry `<data_sources.id>:` — and, for older state-portal rows, `<crawler id>:` — as their id prefix. */
export function bidIdPrefixesForSource(source: Pick<AdminDataSource, "id" | "crawlerSourceId">): string[] {
  return Array.from(new Set([source.id, source.crawlerSourceId].filter((value): value is string => Boolean(value))));
}

export async function computeSourceDetail(deps: {
  sql: AdminSqlRunner;
  record: AdminDataSourceRecord;
  reviews: readonly PlatformReview[];
  now: Date;
}): Promise<AdminDataSourceDetail> {
  const { source, logSourceKeys } = deps.record;
  const prefixes = bidIdPrefixesForSource(source);
  const bidWhere = `(${prefixes.map(() => "id LIKE ? ESCAPE '!'").join(" OR ")})`;
  const bidValues = prefixes.map((prefix) => sourceBidIdLikePattern(prefix));

  const [stateRows, countRows, latestRows] = await Promise.all([
    deps.sql.all<{ coverage_level: string; platform: string; approval_state: string; health_state: string }>(SOURCE_STATES_SQL, [source.id]),
    deps.sql.all<{ lifecycle_status: string; total: unknown }>(
      `SELECT lifecycle_status, COUNT(*) AS total FROM bids WHERE ${bidWhere} GROUP BY lifecycle_status`,
      bidValues,
    ),
    deps.sql.all<{ id: string; title: string; published_date: string | null; deadline_date: string | null; lifecycle_status: string }>(
      `SELECT id, title, published_date, deadline_date, lifecycle_status FROM bids WHERE ${bidWhere} ORDER BY created_at DESC, id DESC LIMIT 10`,
      bidValues,
    ),
  ]);

  const counts = { open: 0, closed: 0, awarded: 0, total: 0 };
  for (const row of countRows) {
    const total = sqlCount(row.total);
    counts.total += total;
    if (row.lifecycle_status === "open" || row.lifecycle_status === "closed" || row.lifecycle_status === "awarded") {
      counts[row.lifecycle_status] += total;
    }
  }

  let readiness: AdminSourceReadiness | null = null;
  if (isLocalSource(source)) {
    const platformReview = effectivePlatformReview(deps.reviews, source.providerFamily, deps.now);
    const evaluation = evaluateLedgeredApproval(source, platformReview, deps.now);
    readiness = { bucket: readinessBucket(evaluation), reason: evaluation.reason, platformReview };
  }

  const states = stateRows[0];
  return {
    source,
    logSourceKeys,
    states: {
      level: coverageLevelOf(states?.coverage_level),
      platform: states?.platform ?? source.providerFamily,
      approval: (states?.approval_state ?? "approved") as SourceApprovalState,
      health: (states?.health_state ?? "never_run") as SourceHealthState,
    },
    readiness,
    bids: {
      counts,
      latest: latestRows.map((row) => ({
        id: row.id,
        title: row.title,
        publishedDate: row.published_date ?? null,
        deadlineDate: row.deadline_date ?? null,
        lifecycleStatus: row.lifecycle_status,
      })),
    },
  };
}

export async function getAdminDataSourceDetail(db: AppDatabase, id: string, now = new Date()): Promise<AdminDataSourceDetail> {
  const record = await getAdminDataSource(db, id);
  return computeSourceDetail({ sql: sqliteSqlRunner(db), record, reviews: listPlatformReviews(db), now });
}

export async function getAdminDataSourceDetailFromMysql(
  mysql: MysqlDataSourcesStore & MysqlPlatformReviewsStore,
  id: string,
  now = new Date(),
): Promise<AdminDataSourceDetail> {
  const record = await getAdminDataSourceFromMysql(mysql, id);
  return computeSourceDetail({ sql: mysqlSqlRunner(mysql), record, reviews: await listPlatformReviewsFromMysql(mysql), now });
}
