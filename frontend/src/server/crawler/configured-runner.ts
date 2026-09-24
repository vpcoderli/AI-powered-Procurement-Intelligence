import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "./lock-repository";
import { sendMatchedAlertNotifications, sendMatchedAlertNotificationsFromMysql } from "@/server/notifications/service";
import { matchEnabledSearchAlerts, matchEnabledSearchAlertsFromMysql } from "@/server/search-alerts/matcher";
import {
  crawlerExceptionResult,
  runCrawlerSourceOnce as defaultRunCrawlerSourceOnce,
  type CrawlerMatcher,
  type CrawlerNotifier,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "./orchestrator";
import { recordSourceHealthOutcome } from "./source-health-outcome";
import {
  PlatformDeferralTracker,
  isPlatformThrottleSignature,
  platformDeferredResult,
  type PlatformDeferralOptions,
} from "./platform-deferral";
import {
  DEFAULT_TICK_MS,
  PlatformPauseRegistry,
  PlatformTickBudget,
  platformBudgetsFromEnv,
  platformPauseMs,
  requestsMadeOf,
} from "./platform-budget";
import type { CrawlerExecutionContext } from "./execution-context";
import { persistCrawlTaskResult } from "./crawl-task-persistence";
import { runSamGovCrawler } from "./sam-gov-runner";
import { listCrawlableSources, listCrawlableSourcesFromMysql, type CrawlableSource } from "./source-registry";
import { selectDueSources } from "./scheduler";
import { listPagesFor, runCrawlTask, type CrawlTaskOptions, type CrawlTaskResult } from "./state-runner";

export { buildCrawlerFailureInput } from "./source-health-outcome";

type ConfiguredRunner = <TOptions>(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions<TOptions>,
) => Promise<RunCrawlerSourceOnceResult>;

export interface RunConfiguredCrawlerSourcesOnceOptions {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  now?: Date;
  matcher?: CrawlerMatcher;
  notifier?: CrawlerNotifier;
  stateRunnerOptions?: { limit?: number; query?: string | null };
  runCrawlerSourceOnce?: ConfiguredRunner;
  /** Contract C7 knobs (injectable sleeper/interval); defaults come from the environment. */
  platformDeferral?: PlatformDeferralOptions;
  /** Hourly request budgets per provider_family (spec 2026-09-24 §5.5); defaults from CRAWLER_PLATFORM_BUDGETS over `bidnet=60`. */
  platformBudgets?: Map<string, number | null>;
  /** Length of one worker tick: a tick may spend budget × tickMs / 1 h. Defaults to 15 minutes. */
  tickMs?: number;
  /** The worker passes one registry for its lifetime so a pause outlives a tick; default: fresh per call. */
  platformPauses?: PlatformPauseRegistry;
  /** Wall clock for pauses (tests). */
  clock?: () => number;
}

export function parseStateCrawlerLimit() {
  const value = Number(process.env.STATE_CRAWLER_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function runConfiguredCrawlerSourcesOnce(
  options: RunConfiguredCrawlerSourcesOnceOptions,
) {
  const now = options.now ?? new Date();

  const matcher = options.matcher ?? (
    options.mysql
      ? (() => matchEnabledSearchAlertsFromMysql(options.mysql!))
      : (() => matchEnabledSearchAlerts(options.database))
  );
  const notifier =
    options.notifier ?? (
      options.mysql
        ? (({ alertMatching }) => sendMatchedAlertNotificationsFromMysql(options.mysql!, alertMatching))
        : (({ alertMatching }) => sendMatchedAlertNotifications(options.database, alertMatching))
    );
  const runCrawlerSourceOnce = options.runCrawlerSourceOnce ?? defaultRunCrawlerSourceOnce;

  // MysqlCrawlerLockStore 同时声明了 query 与 execute,结构上是 MysqlSourceStore
  // 的超集,可直接传入——不要加 `as never` 之类的类型逃逸。
  const allSources: CrawlableSource[] = options.mysql
    ? await listCrawlableSourcesFromMysql(options.mysql)
    : listCrawlableSources(options.database);

  // Per-platform hourly request budget (spec 2026-09-24 §5.5): a tick may spend at most its
  // share of each budgeted family's hourly allowance, and a family that just answered with a
  // throttle signature is paused for CRAWLER_PLATFORM_PAUSE_MS regardless of budget. Neither
  // check contacts the source, records a result, or consumes a retry — the source stays due
  // for a later tick.
  const budget = new PlatformTickBudget(options.platformBudgets ?? platformBudgetsFromEnv(), options.tickMs ?? DEFAULT_TICK_MS);
  const pauses = options.platformPauses ?? new PlatformPauseRegistry();
  const clock = options.clock ?? (() => Date.now());
  const pauseMs = platformPauseMs();
  const skipped = new Map<string, { paused: number; budget: number }>();
  const skip = (family: string, reason: "paused" | "budget") => {
    const counts = skipped.get(family) ?? { paused: 0, budget: 0 };
    counts[reason] += 1;
    skipped.set(family, counts);
  };

  // Budgeted families are no longer subject to the flat per-tick concurrency cap; the budget
  // itself decides how many of them run this tick.
  const dueSources = selectDueSources(allSources, now, { uncappedFamilies: budget.budgetedFamilies() });
  const results: RunCrawlerSourceOnceResult[] = [];
  const platform = new PlatformDeferralTracker(options.platformDeferral);

  for (const source of dueSources) {
    const family = source.providerFamily;
    const isSamGov = source.id === "sam_gov" || source.issuerType === "federal";

    // Same-tick throttle first: the existing C7 behavior reports these as `deferred` results.
    const throttledBy = platform.deferredBy(source);
    if (throttledBy) {
      // Never contacted: no health write-back, no notifications, no retry.
      results.push(platformDeferredResult(source.id, throttledBy));
      continue;
    }
    // Paused by an earlier tick, or out of this tick's budget: not contacted, not a result,
    // still due next tick.
    if (family && pauses.pausedUntil(family, clock()) !== null) {
      skip(family, "paused");
      continue;
    }
    const reserved = budget.isBudgeted(family) ? budget.reserve(family, listPagesFor(source)) : null;
    if (budget.isBudgeted(family) && reserved === null) {
      skip(family, "budget");
      continue;
    }
    await platform.waitForPlatformSlot(source);

    let result: RunCrawlerSourceOnceResult;
    try {
      result = await runCrawlerSourceOnce(options.database, {
        mysql: options.mysql,
        source: source.id,
        owner: options.owner,
        runner: isSamGov
          ? (_runnerOptions, context) => runSamGovCrawler(undefined, context)
          : (_runnerOptions, context) =>
              runStateSourceAndImport(source, options, {
                taskId: `tsk_${source.id}_${now.getTime()}`,
                limit: options.stateRunnerOptions?.limit,
                query: options.stateRunnerOptions?.query ?? null,
              }, context),
        matcher,
        notifier,
      });
    } catch (error) {
      result = crawlerExceptionResult(source.id, error);
    }

    results.push(result);
    if (reserved !== null && family) budget.settle(family, reserved, requestsMadeOf(result) ?? reserved);
    platform.observe(source, result);
    if (family && isPlatformThrottleSignature(result)) pauses.pause(family, clock() + pauseMs);
    await recordSourceHealthOutcome(options, source.id, result, (options.now ?? new Date()).toISOString());
  }

  for (const [family, counts] of skipped) {
    console.info(JSON.stringify({ event: "crawler_platform_sources_skipped", family, ...counts }));
  }

  return results;
}

/** Verify the source lease after fetching and immediately before starting persistence. */
async function runStateSourceAndImport(
  source: CrawlableSource,
  options: RunConfiguredCrawlerSourcesOnceOptions,
  taskOptions: CrawlTaskOptions,
  context?: CrawlerExecutionContext,
): Promise<CrawlTaskResult> {
  const result = await runCrawlTask(source, taskOptions, context);
  await context?.assertLease();
  return persistCrawlTaskResult(options.database, options.mysql, source, result, context?.lease);
}
