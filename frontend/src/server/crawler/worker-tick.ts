import { emitWorkerFailureAlert } from "@/lib/resilience/failure-alerts";
import { sweepExpiredBids as defaultSweepExpiredBids, type LifecycleSweepResult, type MysqlSweepStore } from "@/server/bids/lifecycle-sweep";
import { runConfiguredCrawlerSourcesOnce, type RunConfiguredCrawlerSourcesOnceOptions } from "./configured-runner";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { DEFAULT_TICK_MS, PlatformPauseRegistry, PlatformTickBudget, platformBudgetsFromEnv } from "./platform-budget";
import { PlatformDeferralTracker } from "./platform-deferral";
import { PrecheckRetryRegistry, runQueuedPrechecksOnce, type RunQueuedPrechecksOnceOptions, type RunQueuedPrechecksOnceResult } from "./precheck-queue-runner";

type WorkerTickOptions = Omit<Pick<RunConfiguredCrawlerSourcesOnceOptions,
  "database" | "mysql" | "owner" | "stateRunnerOptions" | "matcher" | "notifier" | "tickMs" | "isStopping"
>, "mysql"> & {
  /** A MySQL pool: besides what the lists and prechecks use, the deadline sweep holds its transactions on connections from it. */
  mysql?: NonNullable<RunConfiguredCrawlerSourcesOnceOptions["mysql"]> & MysqlSweepStore;
};

/** Work and clock adapters at the tick seam; production uses the existing runner implementations. */
type WorkerTickAdapters = Pick<RunConfiguredCrawlerSourcesOnceOptions, "runCrawlerSourceOnce" | "platformBudgets"> &
  Pick<RunQueuedPrechecksOnceOptions, "runSourcePrecheck"> & {
    clock?: () => number;
    sleep?: (ms: number) => Promise<void>;
    sweepExpiredBids?: typeof defaultSweepExpiredBids;
  };

export interface CrawlerWorkerTickResult {
  lists: RunCrawlerSourceOnceResult[];
  prechecks: RunQueuedPrechecksOnceResult | null;
  backfill: RunCrawlerSourceOnceResult[];
  /** Queue failures remain isolated from completed ingestion and the next worker tick. */
  precheckError: unknown | null;
  /** Bids the deadline sweep examined and closed this tick; absent when it did not run or failed. */
  lifecycleSweep?: LifecycleSweepResult;
  /** Why the deadline sweep failed. Like a precheck failure, it never fails the tick or its other stages. */
  lifecycleSweepError?: string;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One worker's complete tick. The returned function owns list → precheck → deadline sweep → optional
 * historical ordering, one budget and contact timeline per tick, and pauses/retry state for its lifetime.
 * Each crawl attempt still runs through the existing source lease, fencing, and public-page guards.
 */
export function createCrawlerWorkerTick(options: WorkerTickOptions, adapters: WorkerTickAdapters = {}) {
  const pauses = new PlatformPauseRegistry();
  const precheckRetries = new PrecheckRetryRegistry();
  const clock = adapters.clock ?? Date.now;
  const wait = adapters.sleep ?? sleep;
  const sweepExpiredBids = adapters.sweepExpiredBids ?? defaultSweepExpiredBids;

  return async (): Promise<CrawlerWorkerTickResult> => {
    const budget = new PlatformTickBudget(adapters.platformBudgets ?? platformBudgetsFromEnv(), options.tickMs ?? DEFAULT_TICK_MS);
    const timeline = new PlatformDeferralTracker({ now: clock, sleep: wait });
    const attempts = new Map<string, number>();
    const maxAttempts = positiveIntegerEnv("CRAWLER_WORKER_RETRY_MAX_ATTEMPTS", 3);
    const shared: RunConfiguredCrawlerSourcesOnceOptions = {
      ...options,
      now: new Date(clock()),
      clock,
      platformBudget: budget,
      platformPauses: pauses,
      platformTracker: timeline,
      runCrawlerSourceOnce: adapters.runCrawlerSourceOnce,
      includeDetailBackfill: false,
      retry: {
        maxAttempts,
        baseDelayMs: positiveIntegerEnv("CRAWLER_WORKER_RETRY_BASE_DELAY_MS", 500),
        maxDelayMs: positiveIntegerEnv("CRAWLER_WORKER_RETRY_MAX_DELAY_MS", 30_000),
        sleep: wait,
        onAttemptFailure: ({ attempt, retryable, error }) => {
          const result = error as RunCrawlerSourceOnceResult;
          attempts.set(result.source, attempt);
          if (retryable && attempt < maxAttempts) {
            console.warn(JSON.stringify({ worker: "crawler-worker", event: "source_retry", source: result.source, attempt, maxAttempts }));
          }
        },
      },
    };
    const reportFailures = (results: RunCrawlerSourceOnceResult[]) => {
      for (const result of results) {
        if (result.status !== "failure") continue;
        emitWorkerFailureAlert({
          worker: "crawler-worker",
          reason: "crawler_source_retries_exhausted",
          itemId: result.source,
          attempts: attempts.get(result.source) ?? 1,
          error: result.runner.stderr || `Crawler source ${result.source} failed`,
          context: { owner: options.owner, stdout: result.runner.stdout?.slice(0, 2000) },
        });
      }
    };

    const lists = await runConfiguredCrawlerSourcesOnce(shared);
    reportFailures(lists);
    let prechecks: RunQueuedPrechecksOnceResult | null = null;
    let precheckError: unknown | null = null;
    if (!options.isStopping?.()) {
      try {
        prechecks = await runQueuedPrechecksOnce({
          database: options.database,
          mysql: options.mysql,
          now: shared.now,
          budget,
          pauses,
          retries: precheckRetries,
          clock,
          platformTracker: timeline,
          runSourcePrecheck: adapters.runSourcePrecheck,
          isStopping: options.isStopping,
        });
      } catch (error) {
        precheckError = error;
      }
    }
    // An import closes a bid whose deadline has passed, but only while its portal still lists it: close the stored ones here.
    let lifecycleSweep: LifecycleSweepResult | undefined;
    let lifecycleSweepError: string | undefined;
    if (!options.isStopping?.()) {
      try {
        lifecycleSweep = await sweepExpiredBids(options.mysql ? { mysql: options.mysql } : { database: options.database }, { now: new Date(clock()) });
      } catch (error) {
        lifecycleSweepError = error instanceof Error ? error.message : String(error);
      }
    }
    const backfill = process.env.CRAWLER_DETAIL_BACKFILL_ENABLED === "true" && !options.isStopping?.()
      ? await runConfiguredCrawlerSourcesOnce({
        ...shared,
        detailBackfillOnly: true,
        automaticDetailBackfill: true,
        matcher: async () => ({ evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }),
        notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      })
      : [];
    reportFailures(backfill);
    return {
      lists, prechecks, backfill, precheckError,
      ...(lifecycleSweep ? { lifecycleSweep } : {}),
      ...(lifecycleSweepError !== undefined ? { lifecycleSweepError } : {}),
    };
  };
}
