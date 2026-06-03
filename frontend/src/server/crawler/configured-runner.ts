import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "./lock-repository";
import { sendMatchedAlertNotifications, sendMatchedAlertNotificationsFromMysql } from "@/server/notifications/service";
import { matchEnabledSearchAlerts, matchEnabledSearchAlertsFromMysql } from "@/server/search-alerts/matcher";
import {
  runCrawlerSourceOnce as defaultRunCrawlerSourceOnce,
  type CrawlerMatcher,
  type CrawlerNotifier,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "./orchestrator";
import { runSamGovCrawler } from "./sam-gov-runner";
import {
  STATE_CRAWLER_SOURCES,
  createStateCrawlerRunner,
  type StateCrawlerOrchestratorOptions,
  type StateCrawlerSourceId,
} from "./state-runner";

export const CONFIGURED_CRAWLER_SOURCES = [
  { source: "SAM.gov", kind: "sam" },
  ...STATE_CRAWLER_SOURCES.map((source) => ({ source: source.id, kind: "state" as const })),
] as const;

type ConfiguredRunner = <TOptions>(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions<TOptions>,
) => Promise<RunCrawlerSourceOnceResult>;

export interface RunConfiguredCrawlerSourcesOnceOptions {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  matcher?: CrawlerMatcher;
  notifier?: CrawlerNotifier;
  stateRunnerOptions?: StateCrawlerOrchestratorOptions;
  runCrawlerSourceOnce?: ConfiguredRunner;
}

export function parseStateCrawlerLimit() {
  const value = Number(process.env.STATE_CRAWLER_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function runConfiguredCrawlerSourcesOnce(options: RunConfiguredCrawlerSourcesOnceOptions) {
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
  const results: RunCrawlerSourceOnceResult[] = [];

  for (const configuredSource of CONFIGURED_CRAWLER_SOURCES) {
    if (configuredSource.kind === "sam") {
      results.push(
        await runCrawlerSourceOnce(options.database, {
          mysql: options.mysql,
          source: configuredSource.source,
          owner: options.owner,
          runner: runSamGovCrawler,
          matcher,
          notifier,
        }),
      );
      continue;
    }

    results.push(
      await runCrawlerSourceOnce(options.database, {
        mysql: options.mysql,
        source: configuredSource.source,
        owner: options.owner,
        runner: createStateCrawlerRunner(configuredSource.source as StateCrawlerSourceId),
        runnerOptions: options.stateRunnerOptions,
        matcher,
        notifier,
      }),
    );
  }

  return results;
}
