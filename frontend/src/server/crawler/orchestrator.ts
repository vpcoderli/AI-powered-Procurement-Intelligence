import type { AppDatabase } from "@/server/db/client";
import type { SearchAlertMatchResult } from "@/server/search-alerts/matcher";
import type { SamGovCrawlerRunOptions, SamGovCrawlerRunResult } from "./sam-gov-runner";
import { acquireCrawlerLock, releaseCrawlerLock } from "./lock-repository";

export interface CrawlerNotificationResult {
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
}

export type CrawlerRunner = (options?: SamGovCrawlerRunOptions) => Promise<SamGovCrawlerRunResult>;
export type CrawlerMatcher = () => Promise<SearchAlertMatchResult & { matches?: unknown[] }>;
export type CrawlerNotifier = (input: {
  source: string;
  runner: SamGovCrawlerRunResult;
  alertMatching: SearchAlertMatchResult & { matches?: unknown[] };
}) => Promise<CrawlerNotificationResult>;

export interface RunCrawlerSourceOnceOptions {
  source: string;
  owner: string;
  runner: CrawlerRunner;
  runnerOptions?: SamGovCrawlerRunOptions;
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
      runner: SamGovCrawlerRunResult;
      alertMatching: SearchAlertMatchResult & { matches?: unknown[] };
      notification: CrawlerNotificationResult;
    }
  | {
      ok: false;
      source: string;
      status: "failure";
      runner: SamGovCrawlerRunResult;
    }
  | {
      ok: false;
      source: string;
      status: "locked";
      lockedBy?: string;
      lockExpiresAt?: string;
    };

export async function runCrawlerSourceOnce(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions,
): Promise<RunCrawlerSourceOnceResult> {
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
