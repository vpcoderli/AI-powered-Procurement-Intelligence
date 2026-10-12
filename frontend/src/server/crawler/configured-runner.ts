import type { AppDatabase } from "@/server/db/client";
import { historyAge, loadDetailBackfillCandidates } from "./detail-history";
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
import { retryCrawlerSourceResult, type CrawlerRetryOptions } from "./retrying-runner";
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
  /** Retry persisted missing bodies without listing or claiming current source liveness. */
  detailBackfillOnly?: boolean;
  sourceIds?: string[];
  /** Append a controlled historical sweep to the existing worker tick; defaults to env, false. */
  includeDetailBackfill?: boolean;
  detailBackfillMaxSources?: number;
  /** Internal: automatic retries exclude manual cadence and skip records still cooling down. */
  automaticDetailBackfill?: boolean;
  /** Shared when a normal tick appends historical work, preserving platform request spacing. */
  platformTracker?: PlatformDeferralTracker;
  runCrawlerSourceOnce?: ConfiguredRunner;
  /** Retry individual source attempts here so each attempt observes the shared controls. */
  retry?: Omit<CrawlerRetryOptions, "canRetry">;
  /** Stop admitting work after worker shutdown; an already-running lease completes normally. */
  isStopping?: () => boolean;
  /** Contract C7 knobs (injectable sleeper/interval); defaults come from the environment. */
  platformDeferral?: PlatformDeferralOptions;
  /** Hourly request budgets per provider_family (spec 2026-09-24 §5.5); defaults from CRAWLER_PLATFORM_BUDGETS over `bidnet=60`. */
  platformBudgets?: Map<string, number | null>;
  /** Length of one worker tick: a tick may spend budget × tickMs / 1 h. Defaults to 15 minutes. */
  tickMs?: number;
  /** Spec §5.5: one budget per tick, shared with the precheck step that runs after the lists; default: built here. */
  platformBudget?: PlatformTickBudget;
  /** The worker passes one registry for its lifetime so a pause outlives a tick; default: fresh per call. */
  platformPauses?: PlatformPauseRegistry;
  /** Wall clock for pauses (tests). */
  clock?: () => number;
}

function detailBackfillSourceCap(options: RunConfiguredCrawlerSourcesOnceOptions): number {
  const value = options.detailBackfillMaxSources ?? Number(process.env.CRAWLER_DETAIL_BACKFILL_MAX_SOURCES_PER_TICK ?? 10);
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : 10;
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
  const budget = options.platformBudget ?? new PlatformTickBudget(options.platformBudgets ?? platformBudgetsFromEnv(), options.tickMs ?? DEFAULT_TICK_MS);
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
  const selectedSources = options.sourceIds ? allSources.filter((source) => options.sourceIds!.includes(source.id)) : allSources;
  let dueSources = options.detailBackfillOnly ? selectedSources : selectDueSources(selectedSources, now, { uncappedFamilies: budget.budgetedFamilies() });
  if (options.detailBackfillOnly && options.automaticDetailBackfill) {
    const queue: Array<{ source: CrawlableSource; oldest: number }> = [];
    for (const source of selectedSources) {
      const enrichment = source.fetchConfig.enrichment as { enabled?: unknown } | null;
      if (source.cadence === "manual" || (source.id !== "sam_gov" && enrichment?.enabled !== true)) continue;
      const [oldest] = await loadDetailBackfillCandidates({ database: options.database, mysql: options.mysql }, source.id, source, { limit: 1, now });
      if (oldest) queue.push({ source, oldest: historyAge(oldest) });
    }
    dueSources = queue.sort((left, right) => left.oldest - right.oldest || left.source.id.localeCompare(right.source.id))
      .map(({ source }) => source);
  }
  const results: RunCrawlerSourceOnceResult[] = [];
  const platform = options.platformTracker ?? new PlatformDeferralTracker(options.platformDeferral);

  let historicalSourcesStarted = 0;
  for (const source of dueSources) {
    if (options.isStopping?.()) break;
    if (options.automaticDetailBackfill && historicalSourcesStarted >= detailBackfillSourceCap(options)) break;
    const family = source.providerFamily;
    const isSamGov = source.id === "sam_gov";
    if (options.detailBackfillOnly) {
      // Nothing due: a run would only record `deferred` outcomes for rows still cooling down.
      const [candidate] = await loadDetailBackfillCandidates({ database: options.database, mysql: options.mysql }, source.id, source, { limit: 1, now });
      if (!candidate) continue;
    }

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
    let reserved = budget.isBudgeted(family) ? budget.reserve(family, listPagesFor(source)) : null;
    if (budget.isBudgeted(family) && reserved === null) {
      skip(family, "budget");
      continue;
    }
    historicalSourcesStarted += 1;
    const runAttempt = async (): Promise<RunCrawlerSourceOnceResult | null> => {
      await platform.waitForPlatformSlot(source);
      if (options.isStopping?.()) {
        if (reserved !== null && family) budget.settle(family, reserved, 0);
        return null;
      }
      let effectiveSource = source;
      if (options.detailBackfillOnly && reserved !== null) {
        const rawEnrichment = source.fetchConfig.enrichment;
        const enrichment = rawEnrichment && typeof rawEnrichment === "object" && !Array.isArray(rawEnrichment) ? rawEnrichment as Record<string, unknown> : {};
        const requested = typeof enrichment.max_details_per_run === "number" ? enrichment.max_details_per_run : 25;
        effectiveSource = { ...source, fetchConfig: { ...source.fetchConfig, enrichment: { ...enrichment, max_details_per_run: Math.max(1, Math.min(requested, reserved)) } } };
      }
      let result: RunCrawlerSourceOnceResult;
      try {
        result = await runCrawlerSourceOnce(options.database, {
          mysql: options.mysql,
          source: source.id,
          owner: options.owner,
          runner: isSamGov
            ? (_runnerOptions, context) => runSamGovCrawler({ historyStore: { database: options.database, mysql: options.mysql }, detailBackfillOnly: options.detailBackfillOnly, ...(options.detailBackfillOnly && reserved !== null ? { maxDescriptions: reserved } : {}) }, context)
            : (_runnerOptions, context) =>
                runStateSourceAndImport(effectiveSource, options, {
                  taskId: `tsk_${source.id}_${now.getTime()}`,
                  limit: options.stateRunnerOptions?.limit,
                  query: options.stateRunnerOptions?.query ?? null,
                  detailBackfillOnly: options.detailBackfillOnly,
                }, context),
          matcher,
          notifier,
        });
      } catch (error) {
        result = crawlerExceptionResult(source.id, error);
      }
      if (reserved !== null && family) {
        const contacted = result.status === "success" || result.status === "failure";
        budget.settle(family, reserved, contacted ? requestsMadeOf(result) ?? reserved : 0);
      }
      platform.observe(source, result);
      if (family && isPlatformThrottleSignature(result)) pauses.pause(family, clock() + pauseMs);
      return result;
    };

    const result = options.retry ? await retryCrawlerSourceResult(runAttempt, {
      ...options.retry,
      canRetry: () => {
        if (options.isStopping?.() || platform.deferredBy(source) || pauses.pausedUntil(family, clock()) !== null) return false;
        if (!budget.isBudgeted(family)) return true;
        reserved = budget.reserve(family, listPagesFor(source));
        return reserved !== null;
      },
    }) : await runAttempt();

    if (result === null) break;
    results.push(result);
    if (!options.detailBackfillOnly) await recordSourceHealthOutcome(options, source.id, result, (options.now ?? new Date()).toISOString());
  }

  for (const [family, counts] of skipped) {
    console.info(JSON.stringify({ event: "crawler_platform_sources_skipped", family, ...counts }));
  }

  const includeDetailBackfill = options.includeDetailBackfill ?? process.env.CRAWLER_DETAIL_BACKFILL_ENABLED === "true";
  if (!options.detailBackfillOnly && includeDetailBackfill) {
    const historical = await runConfiguredCrawlerSourcesOnce({
      ...options,
      detailBackfillOnly: true,
      automaticDetailBackfill: true,
      includeDetailBackfill: false,
      platformBudget: budget,
      platformPauses: pauses,
      platformTracker: platform,
      matcher: async () => ({ evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }),
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
    });
    results.push(...historical);
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
  const result = await runCrawlTask(source, { ...taskOptions, historyStore: { database: options.database, mysql: options.mysql } }, context);
  await context?.assertLease();
  return persistCrawlTaskResult(options.database, options.mysql, source, result, context?.lease);
}
