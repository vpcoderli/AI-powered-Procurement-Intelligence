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
import { PlatformDeferralTracker, platformDeferredResult, type PlatformDeferralOptions } from "./platform-deferral";
import type { CrawlerExecutionContext } from "./execution-context";
import { persistCrawlTaskResult } from "./crawl-task-persistence";
import { runSamGovCrawler } from "./sam-gov-runner";
import { listCrawlableSources, listCrawlableSourcesFromMysql, type CrawlableSource } from "./source-registry";
import { selectDueSources } from "./scheduler";
import { runCrawlTask, type CrawlTaskOptions, type CrawlTaskResult } from "./state-runner";

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

  const dueSources = selectDueSources(allSources, now);
  const results: RunCrawlerSourceOnceResult[] = [];
  const platform = new PlatformDeferralTracker(options.platformDeferral);

  for (const source of dueSources) {
    const isSamGov = source.id === "sam_gov" || source.issuerType === "federal";

    const throttledBy = platform.deferredBy(source);
    if (throttledBy) {
      // Never contacted: no health write-back, no notifications, no retry.
      results.push(platformDeferredResult(source.id, throttledBy));
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
    platform.observe(source, result);
    await recordSourceHealthOutcome(options, source.id, result, (options.now ?? new Date()).toISOString());
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
