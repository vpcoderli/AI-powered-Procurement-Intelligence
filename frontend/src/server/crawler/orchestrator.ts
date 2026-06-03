import { or, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectOne } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import type { SearchAlertMatchResult } from "@/server/search-alerts/matcher";
import {
  acquireCrawlerLock,
  acquireCrawlerLockFromMysql,
  releaseCrawlerLock,
  releaseCrawlerLockFromMysql,
  type MysqlCrawlerLockStore,
} from "./lock-repository";

export interface CrawlerNotificationResult {
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface CrawlerRunResult {
  ok: boolean;
  source: string;
  status: "success" | "failure";
  stdout: string;
  stderr: string;
}

export type CrawlerRunner<TOptions = unknown> = (options?: TOptions) => Promise<CrawlerRunResult>;
export type CrawlerMatcher = () => Promise<SearchAlertMatchResult & { matches?: unknown[] }>;
export type CrawlerNotifier = (input: {
  source: string;
  runner: CrawlerRunResult;
  alertMatching: SearchAlertMatchResult & { matches?: unknown[] };
}) => Promise<CrawlerNotificationResult>;

export interface RunCrawlerSourceOnceOptions<TOptions = unknown> {
  mysql?: MysqlCrawlerLockStore;
  source: string;
  owner: string;
  runner: CrawlerRunner<TOptions>;
  runnerOptions?: TOptions;
  matcher: CrawlerMatcher;
  notifier: CrawlerNotifier;
  now?: () => Date;
  lockTtlMs?: number;
}

export type RunCrawlerSourceOnceResult =
  | {
      ok: true;
      source: string;
      status: "success";
      runner: CrawlerRunResult;
      alertMatching: SearchAlertMatchResult & { matches?: unknown[] };
      notification: CrawlerNotificationResult;
    }
  | {
      ok: false;
      source: string;
      status: "failure";
      runner: CrawlerRunResult;
    }
  | {
      ok: false;
      source: string;
      status: "locked";
      lockedBy?: string;
      lockExpiresAt?: string;
    }
  | {
      ok: false;
      source: string;
      status: "disabled";
    }
  | {
      ok: false;
      source: string;
      status: "blocked";
      reason: string;
      approvalStatus?: string | null;
      legalReviewStatus?: string | null;
      approvedForIngestion?: boolean | null;
    };

function sourceIdFor(source: string) {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface SourceRunControl {
  isEnabled: boolean;
  approvedForIngestion?: boolean | null;
  approvalStatus?: string | null;
  legalReviewStatus?: string | null;
}

function sourceRunControl(db: AppDatabase, source: string): SourceRunControl {
  const sourceRow = db
    .select()
    .from(dataSources)
    .where(or(eq(dataSources.label, source), eq(dataSources.id, source), eq(dataSources.id, sourceIdFor(source))))
    .limit(1)
    .get();

  return sourceRow
    ? {
        isEnabled: sourceRow.isEnabled === 1,
        approvedForIngestion:
          sourceRow.approvedForIngestion === null || sourceRow.approvedForIngestion === undefined
            ? null
            : sourceRow.approvedForIngestion === 1,
        approvalStatus: sourceRow.approvalStatus,
        legalReviewStatus: sourceRow.legalReviewStatus,
      }
    : { isEnabled: true };
}

async function sourceRunControlFromMysql(mysql: MysqlCrawlerLockStore, source: string): Promise<SourceRunControl> {
  const row = await mysqlSelectOne<{
    isEnabled?: number | string;
    is_enabled?: number | string;
    approvedForIngestion?: number | string | null;
    approved_for_ingestion?: number | string | null;
    approvalStatus?: string | null;
    approval_status?: string | null;
    legalReviewStatus?: string | null;
    legal_review_status?: string | null;
  }>(
    mysql,
    `
      SELECT
        is_enabled AS isEnabled,
        approved_for_ingestion AS approvedForIngestion,
        approval_status AS approvalStatus,
        legal_review_status AS legalReviewStatus
      FROM data_sources
      WHERE label = ? OR id = ? OR id = ?
      LIMIT 1
    `,
    [source, source, sourceIdFor(source)],
  );

  if (!row) return { isEnabled: true };

  const approvedForIngestion = row.approvedForIngestion ?? row.approved_for_ingestion;

  return {
    isEnabled: Number(row.isEnabled ?? row.is_enabled) === 1,
    approvedForIngestion:
      approvedForIngestion === null || approvedForIngestion === undefined
        ? null
        : Number(approvedForIngestion) === 1,
    approvalStatus: row.approvalStatus ?? row.approval_status ?? null,
    legalReviewStatus: row.legalReviewStatus ?? row.legal_review_status ?? null,
  };
}

function legalReviewAllowsIngestion(status?: string | null) {
  return !status || status === "approved_public" || status === "approved";
}

function blockedReasonFor(control: SourceRunControl) {
  if (control.approvedForIngestion === false) return "Source governance has not approved ingestion.";
  if (control.approvalStatus && control.approvalStatus !== "approved") {
    return "Source governance has not approved ingestion.";
  }
  if (!legalReviewAllowsIngestion(control.legalReviewStatus)) {
    return "Source legal review has not approved ingestion.";
  }

  return null;
}

export async function runCrawlerSourceOnce<TOptions = unknown>(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions<TOptions>,
): Promise<RunCrawlerSourceOnceResult> {
  const sourceControl = options.mysql
    ? await sourceRunControlFromMysql(options.mysql, options.source)
    : sourceRunControl(db, options.source);

  if (!sourceControl.isEnabled) {
    return {
      ok: false,
      source: options.source,
      status: "disabled",
    };
  }

  const blockedReason = blockedReasonFor(sourceControl);
  if (blockedReason) {
    return {
      ok: false,
      source: options.source,
      status: "blocked",
      reason: blockedReason,
      approvalStatus: sourceControl.approvalStatus,
      legalReviewStatus: sourceControl.legalReviewStatus,
      approvedForIngestion: sourceControl.approvedForIngestion,
    };
  }

  const now = options.now ?? (() => new Date());
  const lockTtlMs = options.lockTtlMs ?? 10 * 60 * 1000;
  const acquiredAt = now();
  const expiresAt = new Date(acquiredAt.getTime() + lockTtlMs);
  const lockInput = {
    source: options.source,
    owner: options.owner,
    acquiredAt: acquiredAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const lock = options.mysql
    ? await acquireCrawlerLockFromMysql(options.mysql, lockInput)
    : acquireCrawlerLock(db, lockInput);

  if (!lock.acquired) {
    return {
      ok: false,
      source: options.source,
      status: "locked",
      lockedBy: lock.owner,
      lockExpiresAt: lock.expiresAt,
    };
  }

  try {
    const runner = await options.runner(options.runnerOptions);

    if (!runner.ok) {
      return {
        ok: false,
        source: options.source,
        status: "failure",
        runner,
      };
    }

    const alertMatching = await options.matcher();
    const notification = await options.notifier({
      source: options.source,
      runner,
      alertMatching,
    });

    return {
      ok: true,
      source: options.source,
      status: "success",
      runner,
      alertMatching,
      notification,
    };
  } finally {
    const releaseInput = {
      source: options.source,
      owner: options.owner,
    };
    if (options.mysql) {
      await releaseCrawlerLockFromMysql(options.mysql, releaseInput);
    } else {
      releaseCrawlerLock(db, releaseInput);
    }
  }
}
