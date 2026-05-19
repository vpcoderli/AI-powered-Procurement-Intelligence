import { or, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { dataSources } from "@/server/db/schema";
import type { SearchAlertMatchResult } from "@/server/search-alerts/matcher";
import { acquireCrawlerLock, releaseCrawlerLock } from "./lock-repository";

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
    };

function sourceIdFor(source: string) {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function isSourceEnabled(db: AppDatabase, source: string) {
  const sourceRow = db
    .select()
    .from(dataSources)
    .where(or(eq(dataSources.label, source), eq(dataSources.id, source), eq(dataSources.id, sourceIdFor(source))))
    .limit(1)
    .get();

  return sourceRow ? sourceRow.isEnabled === 1 : true;
}

export async function runCrawlerSourceOnce<TOptions = unknown>(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions<TOptions>,
): Promise<RunCrawlerSourceOnceResult> {
  if (!isSourceEnabled(db, options.source)) {
    return {
      ok: false,
      source: options.source,
      status: "disabled",
    };
  }

  const now = options.now ?? (() => new Date());
  const lockTtlMs = options.lockTtlMs ?? 10 * 60 * 1000;
  const acquiredAt = now();
  const expiresAt = new Date(acquiredAt.getTime() + lockTtlMs);
  const lock = acquireCrawlerLock(db, {
    source: options.source,
    owner: options.owner,
    acquiredAt: acquiredAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

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
    releaseCrawlerLock(db, {
      source: options.source,
      owner: options.owner,
    });
  }
}
