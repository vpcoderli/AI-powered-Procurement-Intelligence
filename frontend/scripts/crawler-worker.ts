import { createDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";
import { createLogger } from "../src/lib/observability/logger";
import { captureException } from "../src/lib/observability/sentry";

const workerLogger = createLogger({ service: "worker:crawler" });
import {
  runCrawlerSourceOnce as defaultRunCrawlerSourceOnce,
  type CrawlerNotifier,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "../src/server/crawler/orchestrator";
import { sendMatchedAlertNotifications, sendMatchedAlertNotificationsFromMysql } from "../src/server/notifications/service";
import { createNotificationProvider } from "../src/server/notifications/provider";
import { createRetryingNotificationProvider } from "../src/server/notifications/retrying-provider";
import { emitWorkerFailureAlert } from "../src/lib/resilience/failure-alerts";
import { retryResultWithBackoff } from "../src/lib/resilience/retry";
import type { AppDatabase } from "../src/server/db/client";
import type { MysqlCrawlerLockStore } from "../src/server/crawler/lock-repository";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const PRODUCTION_LIKE_ENV_VALUES = new Set(["production", "prod", "staging"]);
type WorkerEnv = NonNullable<Parameters<typeof isMysqlDatabaseUrlConfigured>[0]>;

function workerArgs() {
  return new Set(process.argv.slice(2));
}

function envValue(env: WorkerEnv, name: string) {
  return env[name]?.trim() ?? "";
}

function isProductionLikeWorkerRuntime(env: WorkerEnv) {
  return [
    envValue(env, "NODE_ENV"),
    envValue(env, "APP_ENV"),
    envValue(env, "DEPLOY_ENV"),
    envValue(env, "VERCEL_ENV"),
    envValue(env, "RUNTIME_ENV"),
  ].some((value) => PRODUCTION_LIKE_ENV_VALUES.has(value.toLowerCase()));
}

function sqliteResolutionMessage(env: WorkerEnv) {
  if (envValue(env, "DATABASE_URL") && !/^mysql2?:\/\//.test(envValue(env, "DATABASE_URL"))) {
    return "DATABASE_URL resolves to SQLite; production and staging worker runtimes must use DATABASE_URL or MYSQL_DATABASE_URL with mysql:// or mysql2://";
  }
  if (envValue(env, "MYSQL_DATABASE_URL") && !/^mysql2?:\/\//.test(envValue(env, "MYSQL_DATABASE_URL"))) {
    return "MYSQL_DATABASE_URL resolves to SQLite; production and staging worker runtimes must use DATABASE_URL or MYSQL_DATABASE_URL with mysql:// or mysql2://";
  }
  return "DATABASE_URL or MYSQL_DATABASE_URL must use mysql:// or mysql2:// for production and staging worker runtimes";
}

function positiveIntegerEnv(name: string, env: WorkerEnv = process.env) {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function intervalMs() {
  return positiveIntegerEnv("CRAWLER_WORKER_INTERVAL_MS") ?? DEFAULT_INTERVAL_MS;
}

function owner() {
  return process.env.CRAWLER_OWNER ?? `crawler-worker:${process.pid}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function crawlerRetryMaxAttempts() {
  return positiveIntegerEnv("CRAWLER_WORKER_RETRY_MAX_ATTEMPTS") ?? 3;
}

function crawlerRetryBaseDelayMs() {
  return positiveIntegerEnv("CRAWLER_WORKER_RETRY_BASE_DELAY_MS") ?? 500;
}

function crawlerRetryMaxDelayMs() {
  return positiveIntegerEnv("CRAWLER_WORKER_RETRY_MAX_DELAY_MS") ?? 30_000;
}

/**
 * Wraps the default `runCrawlerSourceOnce` (one crawler source: acquire crawlerLocks row,
 * run the crawler subprocess, match+notify, release lock) with retry+backoff, retried
 * per-source rather than for the whole tick, so one flaky state portal doesn't block or
 * repeat work for the other 50 configured sources. Each retry attempt re-runs the full
 * acquire-lock -> run -> release-lock cycle for that source; the crawlerLocks table (see
 * lock-repository.ts) already guarantees only one owner holds the lock at a time and the
 * lock is always released in a `finally`, so re-attempting is safe and does not risk a
 * stuck lock or duplicate concurrent runs of the same source.
 *
 * Only the crawler subprocess failing (`ok: false` / status "failure") is treated as
 * retryable-by-default; "locked" (another owner is already running it), "disabled", and
 * "blocked" (governance/legal hold) are terminal for this tick and are returned as-is
 * without consuming a retry attempt, since retrying them cannot change the outcome.
 */
function createRetryingRunCrawlerSourceOnce(runCrawlerSourceOnce: typeof defaultRunCrawlerSourceOnce) {
  const maxAttempts = crawlerRetryMaxAttempts();
  const baseDelayMs = crawlerRetryBaseDelayMs();
  const maxDelayMs = crawlerRetryMaxDelayMs();
  const nonRetryableStatuses = new Set(["locked", "disabled", "blocked"]);

  return async function retryingRunCrawlerSourceOnce<TOptions>(
    db: Parameters<typeof defaultRunCrawlerSourceOnce>[0],
    options: RunCrawlerSourceOnceOptions<TOptions>,
  ): Promise<RunCrawlerSourceOnceResult> {
    let attemptsMade = 0;

    const result = await retryResultWithBackoff<RunCrawlerSourceOnceResult>(
      () => runCrawlerSourceOnce(db, options),
      {
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        isOk: (attemptResult) => attemptResult.ok || nonRetryableStatuses.has(attemptResult.status),
        toError: (attemptResult) =>
          new Error(
            attemptResult.ok
              ? "unreachable"
              : attemptResult.status === "failure"
                ? attemptResult.runner.stderr || `Crawler source ${attemptResult.source} failed`
                : `Crawler source ${attemptResult.source} did not run (${attemptResult.status})`,
          ),
        onAttemptFailure: ({ attempt, retryable }) => {
          attemptsMade = attempt;
          if (attempt < maxAttempts && retryable) {
            console.warn(
              JSON.stringify({
                worker: "crawler-worker",
                event: "source_retry",
                source: options.source,
                attempt,
                maxAttempts,
              }),
            );
          }
        },
      },
    );

    if (!result.ok && result.status === "failure") {
      emitWorkerFailureAlert({
        worker: "crawler-worker",
        reason: "crawler_source_retries_exhausted",
        itemId: options.source,
        // `attemptsMade` reflects the actual number of run attempts made for this source —
        // this is 1 when the first failure was already terminal, not the configured
        // `maxAttempts`.
        attempts: attemptsMade || maxAttempts,
        error: result.runner.stderr || `Crawler source ${options.source} failed`,
        context: { owner: options.owner, stdout: result.runner.stdout?.slice(0, 2000) },
      });
    }

    return result;
  };
}

/**
 * Builds the search-alert notifier used after a successful crawler run, backed by a
 * retrying notification provider (see `createRetryingNotificationProvider`) so a single
 * transient send failure doesn't immediately burn one of a queued notification's limited
 * `notification_outbox.attempt_count` retries. Mirrors the default notifier wiring in
 * `configured-runner.ts` (MySQL vs SQLite dispatch) but swaps in the retrying provider.
 */
function createRetryingCrawlerNotifier(database: AppDatabase, mysql?: MysqlCrawlerLockStore): CrawlerNotifier {
  const retryingProvider = createRetryingNotificationProvider(createNotificationProvider(), {
    worker: "crawler-worker",
    maxAttempts: sendRetryMaxAttempts(),
    baseDelayMs: sendRetryBaseDelayMs(),
    maxDelayMs: sendRetryMaxDelayMs(),
  });

  return ({ alertMatching }) =>
    mysql
      ? sendMatchedAlertNotificationsFromMysql(mysql, alertMatching, retryingProvider)
      : sendMatchedAlertNotifications(database, alertMatching, retryingProvider);
}

function sendRetryMaxAttempts() {
  return positiveIntegerEnv("CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS") ?? 3;
}

function sendRetryBaseDelayMs() {
  return positiveIntegerEnv("CRAWLER_WORKER_SEND_RETRY_BASE_DELAY_MS") ?? 200;
}

function sendRetryMaxDelayMs() {
  return positiveIntegerEnv("CRAWLER_WORKER_SEND_RETRY_MAX_DELAY_MS") ?? 10_000;
}

function validateCrawlerWorkerEnvironment(env: WorkerEnv = process.env) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strictMode = isProductionLikeWorkerRuntime(env);

  for (const name of [
    "CRAWLER_WORKER_INTERVAL_MS",
    "STATE_CRAWLER_LIMIT",
    "CRAWLER_WORKER_RETRY_MAX_ATTEMPTS",
    "CRAWLER_WORKER_RETRY_BASE_DELAY_MS",
    "CRAWLER_WORKER_RETRY_MAX_DELAY_MS",
    "CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS",
    "CRAWLER_WORKER_SEND_RETRY_BASE_DELAY_MS",
    "CRAWLER_WORKER_SEND_RETRY_MAX_DELAY_MS",
  ]) {
    if (env[name]?.trim() && !positiveIntegerEnv(name, env)) {
      errors.push(`${name} must be a positive integer`);
    }
  }

  const mysqlConfigured = isMysqlDatabaseUrlConfigured(env);
  if (strictMode && !mysqlConfigured) {
    errors.push(sqliteResolutionMessage(env));
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return {
    ok: true,
    database: mysqlConfigured ? "mysql" : "sqlite",
    strictMode,
    owner: env.CRAWLER_OWNER?.trim() || `crawler-worker:<pid>`,
    intervalMs: env.CRAWLER_WORKER_INTERVAL_MS?.trim() || String(DEFAULT_INTERVAL_MS),
    stateLimit: env.STATE_CRAWLER_LIMIT?.trim() || "default",
    retryMaxAttempts: env.CRAWLER_WORKER_RETRY_MAX_ATTEMPTS?.trim() || "default",
    retryBaseDelayMs: env.CRAWLER_WORKER_RETRY_BASE_DELAY_MS?.trim() || "default",
    retryMaxDelayMs: env.CRAWLER_WORKER_RETRY_MAX_DELAY_MS?.trim() || "default",
    sendRetryMaxAttempts: env.CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS?.trim() || "default",
    sendRetryBaseDelayMs: env.CRAWLER_WORKER_SEND_RETRY_BASE_DELAY_MS?.trim() || "default",
    sendRetryMaxDelayMs: env.CRAWLER_WORKER_SEND_RETRY_MAX_DELAY_MS?.trim() || "default",
    warnings,
  };
}

async function main() {
  validateCrawlerWorkerEnvironment();

  const db = createDatabase();
  runMigrations(db);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const retryingRunCrawlerSourceOnce = createRetryingRunCrawlerSourceOnce(defaultRunCrawlerSourceOnce);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : undefined;
  const notifier = createRetryingCrawlerNotifier(db, mysql);

  try {
    while (!stopping) {
      const results = await runConfiguredCrawlerSourcesOnce({
        database: db,
        mysql,
        owner: owner(),
        stateRunnerOptions: { limit: parseStateCrawlerLimit() },
        runCrawlerSourceOnce: retryingRunCrawlerSourceOnce,
        notifier,
      });
      workerLogger.info("crawler_run_completed", { results });

      if (!stopping) {
        await sleep(intervalMs());
      }
    }
  } finally {
    await closeResolvedMysqlPool();
    db.$client.close();
  }
}

if (workerArgs().has("--check")) {
  try {
    console.log(JSON.stringify(validateCrawlerWorkerEnvironment(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  void main().catch((error) => {
    workerLogger.error("crawler_worker_crashed", { error });
    captureException(error, { worker: "crawler" });
    process.exitCode = 1;
  });
}
