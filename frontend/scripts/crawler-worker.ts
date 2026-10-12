import { createDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit } from "../src/server/crawler/configured-runner";
import { createCrawlerWorkerTick } from "../src/server/crawler/worker-tick";
import { createLogger } from "../src/lib/observability/logger";
import { captureException } from "../src/lib/observability/sentry";
import type { CrawlerNotifier } from "../src/server/crawler/orchestrator";
import { sendMatchedAlertNotifications, sendMatchedAlertNotificationsFromMysql } from "../src/server/notifications/service";
import { createNotificationProvider } from "../src/server/notifications/provider";
import { createRetryingNotificationProvider } from "../src/server/notifications/retrying-provider";
import type { AppDatabase } from "../src/server/db/client";
import type { MysqlCrawlerLockStore } from "../src/server/crawler/lock-repository";

const workerLogger = createLogger({ service: "worker:crawler" });
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

// A ref'd timer keeps a SQLite worker alive between ticks when no database socket is open.
function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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

  // Everything from the moment the shared pool is resolved sits inside this try/finally, so a worker that crashes
  // while starting (a bad notification provider config, say) still releases it: the pool's idle-connection timer
  // would otherwise keep the process alive and its supervisor would never restart it.
  try {
    const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : undefined;
    const notifier = createRetryingCrawlerNotifier(db, mysql);
    const tick = createCrawlerWorkerTick({
      database: db,
      mysql,
      owner: owner(),
      stateRunnerOptions: { limit: parseStateCrawlerLimit() },
      notifier,
      tickMs: intervalMs(),
      isStopping: () => stopping,
    });

    while (!stopping) {
      const { lists, prechecks, backfill, precheckError, lifecycleSweep, lifecycleSweepError } = await tick();
      workerLogger.info("crawler_run_completed", { results: lists });
      if (prechecks) workerLogger.info("crawler_precheck_queue_completed", { prechecks });
      if (precheckError) {
        workerLogger.error("crawler_precheck_queue_failed", { error: precheckError });
        captureException(precheckError, { worker: "crawler", step: "precheck_queue" });
      }
      // A sweep that closed nothing is the normal case and stays quiet; one that closed bids, or failed, is logged.
      if (lifecycleSweep && lifecycleSweep.closed > 0) {
        workerLogger.info("crawler_lifecycle_sweep", { event: "crawler_lifecycle_sweep", ...lifecycleSweep });
      }
      if (lifecycleSweepError) {
        workerLogger.error("crawler_lifecycle_sweep", { event: "crawler_lifecycle_sweep", error: lifecycleSweepError });
        captureException(new Error(lifecycleSweepError), { worker: "crawler", step: "lifecycle_sweep" });
      }
      if (backfill.length) workerLogger.info("crawler_detail_backfill_completed", { results: backfill });

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
