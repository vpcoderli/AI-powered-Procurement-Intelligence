import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLogger } from "../src/lib/observability/logger";
import { captureException } from "../src/lib/observability/sentry";

/**
 * Attachment repair worker (spec: docs/superpowers/specs/2026-09-16-attachment-repair-design.md).
 *
 * Mirrors `crawler-worker.ts` / `notification-worker.ts`: `--check` validates the environment and
 * prints the resolved settings as JSON without opening a database, `--once` (or
 * `ATTACHMENT_WORKER_RUN_ONCE=1`) runs a single pass, otherwise it loops every
 * `ATTACHMENT_WORKER_INTERVAL_MS` (default 6 h) until SIGINT/SIGTERM.
 *
 * The heavy modules are imported lazily inside `runLoop` (the notification-worker pattern) so
 * `--check` stays a pure environment probe: it must keep working inside the worker image even when
 * no database is reachable, and it must not pay for loading the repair service and its Drizzle /
 * MySQL dependencies.
 */

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRODUCTION_LIKE_ENV_VALUES = new Set(["production", "prod", "staging"]);
const workerLogger = createLogger({ service: "worker:attachments" });

type WorkerEnv = Record<string, string | undefined>;

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

function resolvedDatabaseUrl(env: WorkerEnv) {
  return envValue(env, "DATABASE_URL") || envValue(env, "MYSQL_DATABASE_URL");
}

function mysqlDatabaseRuntimeConfigured(env: WorkerEnv) {
  return /^mysql2?:\/\//.test(resolvedDatabaseUrl(env));
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
  return positiveIntegerEnv("ATTACHMENT_WORKER_INTERVAL_MS") ?? DEFAULT_INTERVAL_MS;
}

function runOnce() {
  return (
    workerArgs().has("--once") ||
    process.env.ATTACHMENT_WORKER_RUN_ONCE === "1" ||
    process.env.ATTACHMENT_WORKER_RUN_ONCE === "true"
  );
}

function owner() {
  return process.env.CRAWLER_OWNER?.trim() || `attachment_worker:${process.pid}`;
}

function databasePath() {
  return process.env.DATABASE_PATH?.trim() || undefined;
}

function maxPerSource() {
  return positiveIntegerEnv("ATTACHMENT_REPAIR_MAX_PER_SOURCE");
}

function browserDownloaderUrl() {
  return process.env.BROWSER_DOWNLOADER_URL?.trim() || null;
}

/** Optional comma-separated data_sources ids; restricts a run (e.g. a targeted re-download). */
function sourceIds() {
  const ids = (process.env.ATTACHMENT_REPAIR_SOURCE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves the archive root exactly the way `runAttachmentRepairOnce` does, so `--check` reports
 * the directory the worker will actually write into. `CRAWLER_ATTACHMENT_DIR` is a
 * path-separator-delimited list (see `allowedAttachmentDirs` in `src/server/bids/attachments.ts`);
 * the first entry is the write root and the rest stay readable.
 */
function resolveArchiveRoot(env: WorkerEnv = process.env) {
  const configured = (env.CRAWLER_ATTACHMENT_DIR ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return configured[0] ?? path.resolve(process.cwd(), "data", "attachments");
}

function validateHttpUrl(value: string, name: string, errors: string[]) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${name} must be an http or https URL`);
    }
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

export function validateAttachmentWorkerEnvironment(env: WorkerEnv = process.env) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strictMode = isProductionLikeWorkerRuntime(env);

  for (const name of ["ATTACHMENT_WORKER_INTERVAL_MS", "ATTACHMENT_REPAIR_MAX_PER_SOURCE"]) {
    if (env[name]?.trim() && !positiveIntegerEnv(name, env)) {
      errors.push(`${name} must be a positive integer`);
    }
  }

  const downloaderUrl = envValue(env, "BROWSER_DOWNLOADER_URL");
  if (downloaderUrl) {
    validateHttpUrl(downloaderUrl, "BROWSER_DOWNLOADER_URL", errors);
  } else {
    warnings.push(
      "BROWSER_DOWNLOADER_URL is not set; sources configured with attachments.mode=browser stay queued with failure_kind=browser_unavailable.",
    );
  }

  const mysqlConfigured = mysqlDatabaseRuntimeConfigured(env);
  if (strictMode && !mysqlConfigured) {
    errors.push(sqliteResolutionMessage(env));
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return {
    ok: true,
    database: mysqlConfigured ? "mysql" : "sqlite",
    databasePath: env.DATABASE_PATH?.trim() || "data/apsi.sqlite",
    strictMode,
    owner: env.CRAWLER_OWNER?.trim() || "attachment_worker:<pid>",
    runOnce: env.ATTACHMENT_WORKER_RUN_ONCE === "1" || env.ATTACHMENT_WORKER_RUN_ONCE === "true",
    intervalMs: env.ATTACHMENT_WORKER_INTERVAL_MS?.trim() || String(DEFAULT_INTERVAL_MS),
    maxPerSource: env.ATTACHMENT_REPAIR_MAX_PER_SOURCE?.trim() || "per-source policy",
    sourceIds: env.ATTACHMENT_REPAIR_SOURCE_IDS?.trim() || "all",
    browserDownloaderUrl: downloaderUrl || "unset",
    archiveRoot: resolveArchiveRoot(env),
    warnings,
  };
}

export async function runLoop() {
  validateAttachmentWorkerEnvironment();

  const [
    { createDatabase },
    { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool, runMysqlMigrations },
    { runMigrations },
    { runAttachmentRepairOnce },
  ] = await Promise.all([
    import("../src/server/db/client"),
    import("../src/server/db/mysql"),
    import("../src/server/db/migrate"),
    import("../src/server/attachments/repair-service"),
  ]);

  const mysqlEnabled = isMysqlDatabaseUrlConfigured();
  // In MySQL mode the exported Drizzle `db` proxy throws on any access, so the worker keeps a
  // throwaway in-memory SQLite handle purely to satisfy the `database` argument; every read and
  // write goes through the MySQL pool inside the repair service.
  const db = mysqlEnabled ? createDatabase(":memory:") : createDatabase(databasePath());
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

  const mysql = mysqlEnabled ? resolveMysqlPool() : undefined;

  try {
    do {
      const result = await runAttachmentRepairOnce({
        database: db,
        mysql,
        owner: owner(),
        maxPerSource: maxPerSource(),
        sourceIds: sourceIds(),
        browserDownloaderUrl: browserDownloaderUrl(),
      });
      workerLogger.info("attachment_repair_completed", { result });

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

/**
 * Only run the CLI when this file is the process entry point. Vitest imports the module to drive
 * `runLoop` against a mocked repair service, and that import must not start a worker loop.
 */
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectInvocation()) {
  if (workerArgs().has("--check")) {
    try {
      console.log(JSON.stringify(validateAttachmentWorkerEnvironment(), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  } else {
    void runLoop().catch((error) => {
      workerLogger.error("attachment_repair_crashed", { error });
      captureException(error, { worker: "attachments" });
      process.exitCode = 1;
    });
  }
}
