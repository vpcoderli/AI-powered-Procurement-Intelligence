import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "./lock-repository";
import { sendMatchedAlertNotifications, sendMatchedAlertNotificationsFromMysql } from "@/server/notifications/service";
import { matchEnabledSearchAlerts, matchEnabledSearchAlertsFromMysql } from "@/server/search-alerts/matcher";
import {
  runCrawlerSourceOnce as defaultRunCrawlerSourceOnce,
  type CrawlerMatcher,
  type CrawlerNotifier,
  type CrawlerRunResult,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "./orchestrator";
import { classifyCrawlerFailure, type CrawlerFailureInput } from "./failure-classifier";
import { importCrawlerJsonRunIntoMysql } from "./mysql-json-importer";
import { runSamGovCrawler } from "./sam-gov-runner";
import { listCrawlableSources, listCrawlableSourcesFromMysql, type CrawlableSource } from "./source-registry";
import { selectDueSources } from "./scheduler";
import {
  recordSourceFailure,
  recordSourceFailureInMysql,
  recordSourceSuccess,
  recordSourceSuccessInMysql,
} from "./source-health-repository";
import { importCrawlerJsonRunIntoSqlite, stampJurisdiction } from "./sqlite-json-importer";
import { runCrawlTask, type CrawlTaskOptions, type CrawlTaskResult } from "./state-runner";

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
}

export function parseStateCrawlerLimit() {
  const value = Number(process.env.STATE_CRAWLER_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function runConfiguredCrawlerSourcesOnce(
  options: RunConfiguredCrawlerSourcesOnceOptions,
) {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
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

  for (const source of dueSources) {
    const isSamGov = source.id === "sam_gov" || source.issuerType === "federal";

    const result = await runCrawlerSourceOnce(options.database, {
      mysql: options.mysql,
      source: source.id,
      owner: options.owner,
      runner: isSamGov
        ? runSamGovCrawler
        : () =>
            runStateSourceAndImport(source, options, {
              taskId: `tsk_${source.id}_${now.getTime()}`,
              limit: options.stateRunnerOptions?.limit,
              query: options.stateRunnerOptions?.query ?? null,
            }),
      matcher,
      notifier,
    });

    results.push(result);
    await recordSourceHealthOutcome(options, source.id, result, nowIso);
  }

  return results;
}

/**
 * Runs the JSON task contract for one state source, then persists whatever it returned.
 *
 * `runCrawlTask` itself only spawns the Python subprocess and parses its stdout into a
 * `CrawlTaskResult` — Task X5 found that nothing downstream ever wrote `result.payload` to the
 * database, so `crawler:once` was updating source health while silently persisting zero bids
 * and zero crawler_logs rows on both dialects. This wraps that call with the missing write:
 * stamp the source's jurisdiction onto every bid (bids don't carry their own jurisdiction,
 * only the source registry does) and import through the dialect-appropriate importer — for
 * both success and failure payloads, since a failure payload still needs its crawler_logs row.
 *
 * The import step is contained exactly like `recordSourceHealthOutcome` below: caught and
 * logged rather than thrown, so one source's persistence bug can't stop the rest of the batch
 * from running. The original `CrawlTaskResult` is returned unchanged either way — this function
 * only adds a side effect, it does not change what the orchestrator/health write-back see.
 */
async function runStateSourceAndImport(
  source: CrawlableSource,
  options: RunConfiguredCrawlerSourcesOnceOptions,
  taskOptions: CrawlTaskOptions,
): Promise<CrawlTaskResult> {
  const result = await runCrawlTask(source, taskOptions);

  if (result.payload) {
    const stamped = stampJurisdiction(result.payload, source);
    try {
      if (options.mysql) {
        await importCrawlerJsonRunIntoMysql(options.mysql, stamped);
      } else {
        importCrawlerJsonRunIntoSqlite(options.database, stamped);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "crawler_json_import_failed",
          source: source.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return result;
}

/**
 * Persists the crawl outcome against the source row so Task 4's `selectDueSources` and Task
 * 11's degrade/backoff logic actually have data to act on. Without this, `last_success_at`
 * stays NULL forever, `selectDueSources` treats a NULL `lastSuccessAt` as "due immediately",
 * and every source is due on every cycle regardless of cadence — cadence scheduling silently
 * does nothing.
 *
 * Only "success" and "failure" represent an actual crawl attempt. "locked" (another owner is
 * mid-run), "disabled", and "blocked" (governance/legal hold) mean the runner never executed,
 * so writing health data for them would be wrong — e.g. incrementing `consecutive_failures`
 * for a `blocked` source would eventually demote an as-yet-unreviewed source into
 * `needs_review` for the sole reason that it isn't approved yet.
 *
 * A write-back failure is logged and swallowed rather than thrown, so one source's
 * bookkeeping error can't stop the rest of the batch from running.
 */
async function recordSourceHealthOutcome(
  options: RunConfiguredCrawlerSourcesOnceOptions,
  sourceId: string,
  result: RunCrawlerSourceOnceResult,
  at: string,
): Promise<void> {
  try {
    if (result.ok) {
      if (options.mysql) {
        await recordSourceSuccessInMysql(options.mysql, sourceId, at);
      } else {
        recordSourceSuccess(options.database, sourceId, at);
      }
      return;
    }

    if (result.status !== "failure") {
      // "locked" / "disabled" / "blocked": the crawler never ran, so there is nothing to record.
      return;
    }

    const kind = classifyCrawlerFailure(buildCrawlerFailureInput(result.runner));

    if (options.mysql) {
      await recordSourceFailureInMysql(options.mysql, { sourceId, at, kind });
    } else {
      recordSourceFailure(options.database, { sourceId, at, kind });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "crawler_health_write_back_failed",
        source: sourceId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Maps a crawl run's result onto `classifyCrawlerFailure`'s input shape.
 *
 * `runCrawlTask`'s result (`CrawlTaskResult`) carries `errorCode`/`fetchedCount` at runtime,
 * which `classifyCrawlerFailure` was built to consume, but `RunCrawlerSourceOnceResult["runner"]`
 * is statically typed as the narrower `CrawlerRunResult` shared by every runner. SAM.gov runs
 * through `runSamGovCrawler` instead, whose result carries neither field, so both read as
 * `undefined` here and `classifyCrawlerFailure` falls back to `"unknown"` — a deliberate choice:
 * SAM.gov failures still count toward the consecutive-failure backoff, they just aren't
 * distinguished by failure kind the way state-source failures are.
 *
 * Exported so this mapping can be asserted directly: the failure classifier's threshold table
 * currently makes "network" and "unknown" behave identically once recorded (both default to a
 * threshold of 5 with no forced degrade), so a test that only inspects `data_sources` after the
 * fact cannot tell whether a concrete `errorCode` actually reached the classifier or was dropped
 * — this function gives a seam to check that directly.
 */
export function buildCrawlerFailureInput(runner: CrawlerRunResult): CrawlerFailureInput {
  const extended = runner as CrawlerRunResult & {
    errorCode?: string | null;
    fetchedCount?: number | null;
  };

  return {
    errorCode: extended.errorCode ?? null,
    errorMessage: extended.stderr ?? null,
    fetchedCount: extended.fetchedCount ?? null,
  };
}
