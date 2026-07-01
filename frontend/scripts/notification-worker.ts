const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const SUPPORTED_NOTIFICATION_PROVIDERS = new Set(["file", "console", "http"]);
const PRODUCTION_LIKE_ENV_VALUES = new Set(["production", "prod", "staging"]);

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

function sendRetryMaxAttempts() {
  return positiveIntegerEnv("NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS") ?? 3;
}

function sendRetryBaseDelayMs() {
  return positiveIntegerEnv("NOTIFICATION_WORKER_SEND_RETRY_BASE_DELAY_MS") ?? 200;
}

function sendRetryMaxDelayMs() {
  return positiveIntegerEnv("NOTIFICATION_WORKER_SEND_RETRY_MAX_DELAY_MS") ?? 10_000;
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
  const strictMode = isProductionLikeWorkerRuntime(env);

  if (!SUPPORTED_NOTIFICATION_PROVIDERS.has(provider)) {
    errors.push("NOTIFICATION_PROVIDER must be file, console, or http");
  }

  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_INTERVAL_MS", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_DUNNING_LIMIT", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_DELIVERY_LIMIT", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_MAX_ATTEMPTS", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_SEND_RETRY_BASE_DELAY_MS", errors);
  validatePositiveIntegerEnv(env, "NOTIFICATION_WORKER_SEND_RETRY_MAX_DELAY_MS", errors);

  if (provider === "http") {
    validateHttpUrl(env.NOTIFICATION_HTTP_ENDPOINT, "NOTIFICATION_HTTP_ENDPOINT", errors);
    if (!env.NOTIFICATION_HTTP_TOKEN?.trim()) {
      warnings.push("NOTIFICATION_HTTP_TOKEN is not set; outbound provider calls will be unauthenticated.");
    }
  }

  if (strictMode && (provider === "file" || provider === "console")) {
    errors.push(
      `NOTIFICATION_PROVIDER=${provider} is a local/dev fallback and cannot be used for production or staging launch; set NOTIFICATION_PROVIDER=http`,
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
    provider,
    database: mysqlConfigured ? "mysql" : "sqlite",
    databasePath: env.DATABASE_PATH?.trim() || "data/apsi.sqlite",
    strictMode,
    runOnce: env.NOTIFICATION_WORKER_RUN_ONCE === "1" || env.NOTIFICATION_WORKER_RUN_ONCE === "true",
    intervalMs: env.NOTIFICATION_WORKER_INTERVAL_MS?.trim() || String(DEFAULT_INTERVAL_MS),
    dunningLimit: env.NOTIFICATION_WORKER_DUNNING_LIMIT?.trim() || "default",
    deliveryLimit: env.NOTIFICATION_WORKER_DELIVERY_LIMIT?.trim() || "default",
    maxAttempts: env.NOTIFICATION_WORKER_MAX_ATTEMPTS?.trim() || "default",
    sendRetryMaxAttempts: env.NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS?.trim() || "default",
    sendRetryBaseDelayMs: env.NOTIFICATION_WORKER_SEND_RETRY_BASE_DELAY_MS?.trim() || "default",
    sendRetryMaxDelayMs: env.NOTIFICATION_WORKER_SEND_RETRY_MAX_DELAY_MS?.trim() || "default",
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
    { deliverPendingNotifications },
    { createNotificationProvider },
    { createRetryingNotificationProvider },
  ] = await Promise.all([
    import("../src/server/db/client"),
    import("../src/server/db/mysql"),
    import("../src/server/db/migrate"),
    import("../src/server/notifications/worker"),
    import("../src/server/notifications/delivery"),
    import("../src/server/notifications/provider"),
    import("../src/server/notifications/retrying-provider"),
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

  // Wrap the configured notification provider (file/console/http) so a single transient
  // send failure (e.g. a dropped connection to the http provider endpoint) gets a few fast
  // in-process retries before this tick's delivery attempt is recorded. This does not
  // change how many times `notification_outbox.attempt_count` increments per tick — see
  // `createRetryingNotificationProvider` for why that durable, cross-tick retry mechanism
  // (governed by NOTIFICATION_WORKER_MAX_ATTEMPTS) is left untouched.
  const retryingProvider = createRetryingNotificationProvider(createNotificationProvider(), {
    worker: "notification-worker",
    maxAttempts: sendRetryMaxAttempts(),
    baseDelayMs: sendRetryBaseDelayMs(),
    maxDelayMs: sendRetryMaxDelayMs(),
  });

  try {
    do {
      const result = await runNotificationWorkerOnce(db, {
        dunningLimit: positiveIntegerEnv("NOTIFICATION_WORKER_DUNNING_LIMIT"),
        deliveryLimit: positiveIntegerEnv("NOTIFICATION_WORKER_DELIVERY_LIMIT"),
        maxAttempts: positiveIntegerEnv("NOTIFICATION_WORKER_MAX_ATTEMPTS"),
        deliverer: (workerDb, _provider, deliveryOptions) =>
          deliverPendingNotifications(workerDb, retryingProvider, deliveryOptions),
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
