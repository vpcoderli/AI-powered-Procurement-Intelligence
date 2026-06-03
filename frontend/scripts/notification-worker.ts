const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const SUPPORTED_NOTIFICATION_PROVIDERS = new Set(["file", "console", "http"]);

type WorkerEnv = Record<string, string | undefined>;

function workerArgs() {
  return new Set(process.argv.slice(2));
}

function positiveIntegerEnv(name: string) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function intervalMs() {
  const value = positiveIntegerEnv("NOTIFICATION_WORKER_INTERVAL_MS");
  return value ?? DEFAULT_INTERVAL_MS;
}

function runOnce() {
  return process.env.NOTIFICATION_WORKER_RUN_ONCE === "1" ||
    process.env.NOTIFICATION_WORKER_RUN_ONCE === "true";
}

function databasePath() {
  return process.env.DATABASE_PATH?.trim() || undefined;
}

function validatePositiveIntegerEnv(env: WorkerEnv, name: string, errors: string[]) {
  if (!env[name]?.trim()) return;

  const value = Number(env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${name} must be a positive integer`);
  }
}

function validateHttpUrl(value: string | undefined, name: string, errors: string[]) {
  if (!value?.trim()) {
    errors.push(`${name} is required when NOTIFICATION_PROVIDER=http`);
    return;
  }

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${name} must be an http or https URL`);
    }
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

function validateWorkerEnvironment(env: WorkerEnv = process.env) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const provider = env.NOTIFICATION_PROVIDER?.trim() || "file";

  if (!SUPPORTED_NOTIFICATION_PROVIDERS.has(provider)) {
    errors.push("NOTIFICATION_PROVIDER must be file, console, or http");
  }

  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_INTERVAL_MS", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_DUNNING_LIMIT", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_DELIVERY_LIMIT", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_MAX_ATTEMPTS", errors);

  if (provider === "http") {
    validateHttpUrl(env.NOTIFICATION_HTTP_ENDPOINT, "NOTIFICATION_HTTP_ENDPOINT", errors);
    if (!env.NOTIFICATION_HTTP_TOKEN?.trim()) {
      warnings.push("NOTIFICATION_HTTP_TOKEN is not set; outbound provider calls will be unauthenticated.");
    }
  }

  if (env.NODE_ENV === "production" && provider !== "http") {
    warnings.push(
      `NODE_ENV=production is using the ${provider} notification provider fallback; set NOTIFICATION_PROVIDER=http for live email delivery.`,
    );
  }

  const mysqlConfigured = Boolean(
    env.DATABASE_URL?.trim()?.match(/^mysql2?:\/\//) ||
      env.MYSQL_DATABASE_URL?.trim()?.match(/^mysql2?:\/\//),
  );

  if (env.NODE_ENV === "production" && !mysqlConfigured && !env.DATABASE_PATH?.trim()) {
    warnings.push("DATABASE_PATH is not set; worker will use ./data/apsi.sqlite relative to the process working directory.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return {
    ok: true,
    provider,
    database: mysqlConfigured ? "mysql" : "sqlite",
    databasePath: env.DATABASE_PATH?.trim() || "data/apsi.sqlite",
    runOnce: env.NOTIFICATION_WORKER_RUN_ONCE === "1" || env.NOTIFICATION_WORKER_RUN_ONCE === "true",
    intervalMs: env.NOTIFICATION_WORKER_INTERVAL_MS?.trim() || String(DEFAULT_INTERVAL_MS),
    dunningLimit: env.NOTIFICATION_WORKER_DUNNING_LIMIT?.trim() || "default",
    deliveryLimit: env.NOTIFICATION_WORKER_DELIVERY_LIMIT?.trim() || "default",
    maxAttempts: env.NOTIFICATION_WORKER_MAX_ATTEMPTS?.trim() || "default",
    warnings,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop() {
  validateWorkerEnvironment();

  const [
    { createDatabase },
    { isMysqlDatabaseUrlConfigured, resolveMysqlPool, closeResolvedMysqlPool, runMysqlMigrations },
    { runMigrations },
    { runNotificationWorkerOnce },
  ] = await Promise.all([
    import("../src/server/db/client"),
    import("../src/server/db/mysql"),
    import("../src/server/db/migrate"),
    import("../src/server/notifications/worker"),
  ]);
  const mysqlEnabled = isMysqlDatabaseUrlConfigured();
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

  try {
    do {
      const result = await runNotificationWorkerOnce(db, {
        dunningLimit: positiveIntegerEnv("NOTIFICATION_WORKER_DUNNING_LIMIT"),
        deliveryLimit: positiveIntegerEnv("NOTIFICATION_WORKER_DELIVERY_LIMIT"),
        maxAttempts: positiveIntegerEnv("NOTIFICATION_WORKER_MAX_ATTEMPTS"),
      });
      console.log(JSON.stringify(result, null, 2));

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
    console.log(JSON.stringify(validateWorkerEnvironment(), null, 2));
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
