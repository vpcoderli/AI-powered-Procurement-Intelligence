import { randomUUID } from "node:crypto";
import { CrawlerLeaseLostError, type CrawlerExecutionContext } from "./execution-context";
import { or, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectOne } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import type { SearchAlertMatchResult } from "@/server/search-alerts/matcher";
import {
  renewCrawlerLock,
  renewCrawlerLockFromMysql,
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
  errorCode?: string | null;
  fetchedCount?: number | null;
  payload?: { errorMessage?: string | null; metadata?: Record<string, unknown> | null } | null;
}

export type CrawlerRunner<TOptions = unknown> = (options?: TOptions, context?: CrawlerExecutionContext) => Promise<CrawlerRunResult>;
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
      postProcessingErrors?: Array<{ stage: "matcher" | "notifier"; message: string }>;
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
    }
  | {
      /**
       * Contract C7: an earlier source on the same platform (`provider_family`) answered with a
       * challenge/throttle signature in this tick, so this source was never contacted. Not a
       * source failure — no health write-back, no retry (see platform-deferral.ts).
       */
      ok: false;
      source: string;
      status: "deferred";
      reason: string;
    };

/** Status union of a single source run — imported by the admin batch-run panel. */
export type RunCrawlerSourceOnceStatus = RunCrawlerSourceOnceResult["status"];

function sourceIdFor(source: string) {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface SourceRunControl {
  id?: string;
  jurisdictionLevel?: string | null;
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
        id: sourceRow.id,
        jurisdictionLevel: sourceRow.jurisdictionLevel ?? sourceRow.issuerType,
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
    id?: string;
    jurisdictionLevel?: string | null;
    jurisdiction_level?: string | null;
    issuerType?: string | null;
    issuer_type?: string | null;
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
        id,
        jurisdiction_level AS jurisdictionLevel,
        issuer_type AS issuerType,
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
    id: row.id,
    jurisdictionLevel: row.jurisdictionLevel ?? row.jurisdiction_level ?? row.issuerType ?? row.issuer_type,
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
  if (control.jurisdictionLevel && !["federal", "state"].includes(control.jurisdictionLevel) && control.approvalStatus !== "approved") {
    return "Local source governance requires explicit approval before ingestion.";
  }
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
  const lockSource = sourceControl.id ?? sourceIdFor(options.source);
  // Each attempt receives its own identity so a stale attempt cannot release a newer lease.
  const leaseOwner = `${options.owner}:${randomUUID()}`;
  const acquiredAt = now();
  const expiresAt = new Date(acquiredAt.getTime() + lockTtlMs);
  const lockInput = {
    source: lockSource,
    owner: leaseOwner,
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

  const controller = new AbortController();
  let stopped = false;
  let renewing: Promise<void> | undefined;
  const assertLease = (): Promise<void> => {
    if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
    if (renewing) return renewing;
    renewing = (async () => {
      const checkedAt = now();
      const input = {
        source: lockSource,
        owner: leaseOwner,
        now: checkedAt.toISOString(),
        expiresAt: new Date(checkedAt.getTime() + lockTtlMs).toISOString(),
      };
      try {
        const renewed = options.mysql
          ? await renewCrawlerLockFromMysql(options.mysql, input)
          : renewCrawlerLock(db, input);
        if (!renewed) throw new CrawlerLeaseLostError();
      } catch {
        const error = new CrawlerLeaseLostError();
        controller.abort(error);
        throw error;
      }
    })().finally(() => {
      renewing = undefined;
    });
    return renewing;
  };
  const heartbeat = setInterval(() => {
    if (!stopped) {
      void assertLease().catch(() => { /* The abort signal conveys lease loss to the runner. */ });
    }
  }, Math.max(1, Math.floor(lockTtlMs / 3)));
  heartbeat.unref?.();

  try {
    let runner: CrawlerRunResult;
    try {
      runner = await options.runner(options.runnerOptions, {
        signal: controller.signal,
        assertLease,
        lease: { source: lockSource, owner: leaseOwner, now: () => now().toISOString(), signal: controller.signal },
      });
      if (controller.signal.aborted) throw controller.signal.reason;
    } catch (error) {
      return crawlerExceptionResult(options.source, error);
    }
    if (!runner.ok) return { ok: false, source: options.source, status: "failure", runner };

    // These are independent post-ingestion effects. Their failure must never cause a recrawl.
    const postProcessingErrors: Array<{ stage: "matcher" | "notifier"; message: string }> = [];
    let alertMatching: SearchAlertMatchResult = {
      evaluatedAlerts: 0,
      matchedAlerts: 0,
      updatedAlerts: 0,
      matches: [],
    };
    let notification: CrawlerNotificationResult = { queued: 0, sent: 0, skipped: 0, failed: 0 };
    try {
      alertMatching = await options.matcher();
    } catch (error) {
      postProcessingErrors.push({ stage: "matcher", message: error instanceof Error ? error.message : String(error) });
    }
    if (postProcessingErrors.length === 0) {
      try {
        notification = await options.notifier({ source: options.source, runner, alertMatching });
      } catch (error) {
        postProcessingErrors.push({ stage: "notifier", message: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      ok: true,
      source: options.source,
      status: "success",
      runner,
      alertMatching,
      notification,
      ...(postProcessingErrors.length ? { postProcessingErrors } : {}),
    };
  } finally {
    stopped = true;
    clearInterval(heartbeat);
    await renewing?.catch(() => {});
    const releaseInput = { source: lockSource, owner: leaseOwner };
    try {
      if (options.mysql) await releaseCrawlerLockFromMysql(options.mysql, releaseInput);
      else releaseCrawlerLock(db, releaseInput);
    } catch (error) {
      console.error(JSON.stringify({ event: "crawler_lock_release_failed", source: options.source, error: String(error) }));
    }
  }
}

export function crawlerExceptionResult(source: string, error: unknown): RunCrawlerSourceOnceResult {
  const structured = error as { code?: string; name?: string; message?: string } | null;
  return {
    ok: false,
    source,
    status: "failure",
    runner: {
      ok: false,
      source,
      status: "failure",
      stdout: "",
      stderr: structured?.message ?? String(error),
      errorCode: structured?.code ?? structured?.name ?? "CrawlerExecutionError",
    },
  };
}
