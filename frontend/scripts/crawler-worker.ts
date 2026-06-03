import { createDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
type WorkerEnv = Record<string, string | undefined>;

function workerArgs() {
  return new Set(process.argv.slice(2));
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

  for (const name of ["CRAWLER_WORKER_INTERVAL_MS", "STATE_CRAWLER_LIMIT"]) {
    if (env[name]?.trim() && !positiveIntegerEnv(name, env)) {
      errors.push(`${name} must be a positive integer`);
    }
  }

  const mysqlConfigured = Boolean(
    env.DATABASE_URL?.trim()?.match(/^mysql2?:\/\//) ||
      env.MYSQL_DATABASE_URL?.trim()?.match(/^mysql2?:\/\//),
  );
  if (env.NODE_ENV === "production" && !mysqlConfigured && !env.DATABASE_PATH?.trim()) {
    warnings.push("DATABASE_PATH is not set; crawler worker will use ./data/apsi.sqlite relative to the process working directory.");
  }

  if (env.NODE_ENV === "production" && !mysqlConfigured) {
    warnings.push("NODE_ENV=production is not using MySQL; set DATABASE_URL or MYSQL_DATABASE_URL for production crawler deployment.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return {
    ok: true,
    database: mysqlConfigured ? "mysql" : "sqlite",
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
      console.log(JSON.stringify(results, null, 2));

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
    console.error(error);
    process.exitCode = 1;
  });
}
