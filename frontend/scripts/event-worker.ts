import { createDatabase, type AppDatabase } from "../src/server/db/client";
import {
  closeResolvedMysqlPool,
  isMysqlDatabaseUrlConfigured,
  resolveMysqlPool,
  runMysqlMigrations,
} from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import {
  deliverPendingEventOutboxRows,
  deliverPendingEventOutboxRowsFromMysql,
  type EventOutboxHandler,
} from "../src/server/events/event-log";
import { createRetryingEventOutboxHandler } from "../src/server/events/retrying-outbox-handler";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const PRODUCTION_LIKE_ENV_VALUES = new Set(["production", "prod", "staging"]);

type WorkerEnv = NonNullable<Parameters<typeof isMysqlDatabaseUrlConfigured>[0]>;

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
  return positiveIntegerEnv("EVENT_WORKER_INTERVAL_MS") ?? DEFAULT_INTERVAL_MS;
}

function runOnce() {
  return process.env.EVENT_WORKER_RUN_ONCE === "1" || process.env.EVENT_WORKER_RUN_ONCE === "true";
}

function workerArgs() {
  return new Set(process.argv.slice(2));
}

function deliveryRetryMaxAttempts() {
  return positiveIntegerEnv("EVENT_WORKER_DELIVERY_RETRY_MAX_ATTEMPTS") ?? 3;
}

function deliveryRetryBaseDelayMs() {
  return positiveIntegerEnv("EVENT_WORKER_DELIVERY_RETRY_BASE_DELAY_MS") ?? 200;
}

function deliveryRetryMaxDelayMs() {
  return positiveIntegerEnv("EVENT_WORKER_DELIVERY_RETRY_MAX_DELAY_MS") ?? 10_000;
}

function validateEventWorkerEnvironment(env: WorkerEnv = process.env) {
  const errors: string[] = [];
  for (const name of [
    "EVENT_WORKER_INTERVAL_MS",
    "EVENT_WORKER_DELIVERY_LIMIT",
    "EVENT_WORKER_MAX_ATTEMPTS",
    "EVENT_WORKER_DELIVERY_RETRY_MAX_ATTEMPTS",
    "EVENT_WORKER_DELIVERY_RETRY_BASE_DELAY_MS",
    "EVENT_WORKER_DELIVERY_RETRY_MAX_DELAY_MS",
  ]) {
    if (env[name]?.trim() && !positiveIntegerEnv(name, env)) {
      errors.push(`${name} must be a positive integer`);
    }
  }

  const mysqlConfigured = isMysqlDatabaseUrlConfigured(env);
  const strictMode = isProductionLikeWorkerRuntime(env);
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
    runOnce: runOnce(),
    intervalMs: env.EVENT_WORKER_INTERVAL_MS?.trim() || String(DEFAULT_INTERVAL_MS),
    deliveryLimit: env.EVENT_WORKER_DELIVERY_LIMIT?.trim() || "default",
    maxAttempts: env.EVENT_WORKER_MAX_ATTEMPTS?.trim() || "default",
    deliveryRetryMaxAttempts: env.EVENT_WORKER_DELIVERY_RETRY_MAX_ATTEMPTS?.trim() || "default",
    deliveryRetryBaseDelayMs: env.EVENT_WORKER_DELIVERY_RETRY_BASE_DELAY_MS?.trim() || "default",
    deliveryRetryMaxDelayMs: env.EVENT_WORKER_DELIVERY_RETRY_MAX_DELAY_MS?.trim() || "default",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * No-op outbox handler mirroring `event-log.ts`'s private `defaultEventOutboxHandler`
 * (not exported — this worker never had a real destination adapter wired in). Kept here,
 * wrapped in retry, so this worker's call site already has the retry-wiring pattern in
 * place for whenever a real destination adapter (e.g. the marketing CRM handoff in
 * `src/server/marketing/crm.ts`) is wired into this worker instead of the placeholder.
 */
async function noopEventOutboxHandler(): Promise<{ ok: true }> {
  return { ok: true };
}

function createRetryingDefaultHandler(): EventOutboxHandler {
  return createRetryingEventOutboxHandler(noopEventOutboxHandler, {
    worker: "event-worker",
    maxAttempts: deliveryRetryMaxAttempts(),
    baseDelayMs: deliveryRetryBaseDelayMs(),
    maxDelayMs: deliveryRetryMaxDelayMs(),
  });
}

async function runWorkerOnce(db: AppDatabase) {
  const options = {
    limit: positiveIntegerEnv("EVENT_WORKER_DELIVERY_LIMIT"),
    maxAttempts: positiveIntegerEnv("EVENT_WORKER_MAX_ATTEMPTS"),
  };
  const handler = createRetryingDefaultHandler();

  if (isMysqlDatabaseUrlConfigured()) {
    return deliverPendingEventOutboxRowsFromMysql(resolveMysqlPool(), handler, options);
  }

  return deliverPendingEventOutboxRows(db, handler, options);
}

async function runLoop() {
  validateEventWorkerEnvironment();

  const mysqlEnabled = isMysqlDatabaseUrlConfigured();
  const db = mysqlEnabled ? createDatabase(":memory:") : createDatabase(process.env.DATABASE_PATH?.trim() || undefined);
  if (mysqlEnabled) {
    await runMysqlMigrations(resolveMysqlPool());
  } else {
    runMigrations(db);
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      console.log(JSON.stringify(await runWorkerOnce(db), null, 2));

      if (runOnce()) {
        break;
      }

      if (!stopping) {
        await sleep(intervalMs());
      }
    } while (!stopping);
  } finally {
    await closeResolvedMysqlPool();
    db.$client.close();
  }
}

if (workerArgs().has("--check")) {
  try {
    console.log(JSON.stringify(validateEventWorkerEnvironment(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  void runLoop().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
