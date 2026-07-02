import { createDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";
import { createLogger } from "../src/lib/observability/logger";
import { captureException } from "../src/lib/observability/sentry";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateCrawlerWorkerEnvironment(env: WorkerEnv = process.env) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strictMode = isProductionLikeWorkerRuntime(env);

  for (const name of ["CRAWLER_WORKER_INTERVAL_MS", "STATE_CRAWLER_LIMIT"]) {
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

  try {
    while (!stopping) {
      const results = await runConfiguredCrawlerSourcesOnce({
        database: db,
        mysql: isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : undefined,
        owner: owner(),
        stateRunnerOptions: { limit: parseStateCrawlerLimit() },
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
