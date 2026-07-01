import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const tsxBin = path.join(frontendDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

function runWorkerCheck(script: string, env: Record<string, string | undefined>) {
  return spawnSync(tsxBin, [`scripts/${script}`, "--check"], {
    cwd: frontendDir,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      APP_ENV: "",
      DEPLOY_ENV: "",
      VERCEL_ENV: "",
      DATABASE_URL: "",
      MYSQL_DATABASE_URL: "",
      DATABASE_PATH: "",
      NOTIFICATION_PROVIDER: "",
      NOTIFICATION_HTTP_ENDPOINT: "",
      NOTIFICATION_HTTP_TOKEN: "",
      ...env,
    },
  });
}

describe("notification worker script", () => {
  it("exposes a deployable notification worker loop", () => {
    const script = readFileSync(new URL("notification-worker.ts", import.meta.url), "utf8");
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

    expect(script).toContain("--check");
    expect(script).toContain("validateWorkerEnvironment");
    expect(script).toContain("runNotificationWorkerOnce");
    expect(script).toContain("NOTIFICATION_WORKER_INTERVAL_MS");
    expect(script).toContain("NOTIFICATION_WORKER_RUN_ONCE");
    expect(script).toContain("NOTIFICATION_WORKER_DELIVERY_LIMIT");
    expect(script).toContain("NOTIFICATION_WORKER_DUNNING_LIMIT");
    expect(script).toContain("NOTIFICATION_PROVIDER");
    expect(script).toContain("NOTIFICATION_HTTP_ENDPOINT");
    expect(script).toContain("local/dev fallback and cannot be used for production or staging launch");
    expect(script).toContain("DATABASE_PATH");
    expect(packageJson).toContain("\"worker:notifications\"");
    expect(packageJson).toContain("\"worker:notifications:check\"");
  });

  it("wraps notification delivery in a retrying provider with configurable backoff", () => {
    const script = readFileSync(new URL("notification-worker.ts", import.meta.url), "utf8");

    expect(script).toContain("createRetryingNotificationProvider");
    expect(script).toContain("NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS");
    expect(script).toContain("NOTIFICATION_WORKER_SEND_RETRY_BASE_DELAY_MS");
    expect(script).toContain("NOTIFICATION_WORKER_SEND_RETRY_MAX_DELAY_MS");
  });

  it("rejects a non-positive-integer send retry env var during --check", () => {
    const result = runWorkerCheck("notification-worker.ts", {
      NODE_ENV: "development",
      NOTIFICATION_PROVIDER: "file",
      NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS: "0",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS must be a positive integer");
  });

  it("blocks production check when DATABASE_URL resolves to SQLite even if MYSQL_DATABASE_URL is set", () => {
    const result = runWorkerCheck("notification-worker.ts", {
      NODE_ENV: "production",
      DATABASE_URL: "sqlite://data/prod.sqlite",
      MYSQL_DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
      NOTIFICATION_PROVIDER: "http",
      NOTIFICATION_HTTP_ENDPOINT: "https://notifications.example.com/send",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL resolves to SQLite");
  });

  it("blocks production check when the notification provider is file or console", () => {
    const result = runWorkerCheck("notification-worker.ts", {
      NODE_ENV: "production",
      DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
      NOTIFICATION_PROVIDER: "console",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NOTIFICATION_PROVIDER=console is a local/dev fallback");
  });

  it("keeps local development check usable with SQLite and file notifications", () => {
    const result = runWorkerCheck("notification-worker.ts", {
      NODE_ENV: "development",
      NOTIFICATION_PROVIDER: "file",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("\"ok\": true");
    expect(result.stdout).toContain("\"provider\": \"file\"");
    expect(result.stdout).toContain("\"database\": \"sqlite\"");
  });
});

describe("event worker script", () => {
  it("exposes a deployable event outbox worker loop", () => {
    const script = readFileSync(new URL("event-worker.ts", import.meta.url), "utf8");
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

    expect(script).toContain("--check");
    expect(script).toContain("validateEventWorkerEnvironment");
    expect(script).toContain("deliverPendingEventOutboxRowsFromMysql");
    expect(script).toContain("EVENT_WORKER_INTERVAL_MS");
    expect(script).toContain("EVENT_WORKER_RUN_ONCE");
    expect(script).toContain("EVENT_WORKER_DELIVERY_LIMIT");
    expect(script).toContain("EVENT_WORKER_MAX_ATTEMPTS");
    expect(packageJson).toContain("\"worker:events\"");
    expect(packageJson).toContain("\"worker:events:check\"");
  });

  it("blocks production check when the database runtime resolves to SQLite", () => {
    const result = runWorkerCheck("event-worker.ts", {
      NODE_ENV: "production",
      DATABASE_URL: "sqlite://data/prod.sqlite",
      MYSQL_DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL resolves to SQLite");
  });

  it("wraps outbox delivery in a retrying handler with configurable backoff", () => {
    const script = readFileSync(new URL("event-worker.ts", import.meta.url), "utf8");

    expect(script).toContain("createRetryingEventOutboxHandler");
    expect(script).toContain("EVENT_WORKER_DELIVERY_RETRY_MAX_ATTEMPTS");
    expect(script).toContain("EVENT_WORKER_DELIVERY_RETRY_BASE_DELAY_MS");
    expect(script).toContain("EVENT_WORKER_DELIVERY_RETRY_MAX_DELAY_MS");
  });

  it("rejects a non-positive-integer delivery retry env var during --check", () => {
    const result = runWorkerCheck("event-worker.ts", {
      NODE_ENV: "test",
      EVENT_WORKER_DELIVERY_RETRY_MAX_ATTEMPTS: "-1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EVENT_WORKER_DELIVERY_RETRY_MAX_ATTEMPTS must be a positive integer");
  });
});

describe("crawler worker script", () => {
  it("exposes a deployable crawler worker preflight check", () => {
    const script = readFileSync(new URL("crawler-worker.ts", import.meta.url), "utf8");
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

    expect(script).toContain("--check");
    expect(script).toContain("validateCrawlerWorkerEnvironment");
    expect(script).toContain("CRAWLER_WORKER_INTERVAL_MS");
    expect(script).toContain("STATE_CRAWLER_LIMIT");
    expect(script).toContain("CRAWLER_OWNER");
    expect(packageJson).toContain("\"worker:crawler\"");
    expect(packageJson).toContain("\"worker:crawler:check\"");
    expect(packageJson).toContain("\"workers:check\"");
  });

  it("blocks staging-like checks when the database runtime resolves to SQLite", () => {
    const result = runWorkerCheck("crawler-worker.ts", {
      NODE_ENV: "test",
      APP_ENV: "staging",
      DATABASE_URL: "sqlite://data/staging.sqlite",
      MYSQL_DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL resolves to SQLite");
  });

  it("retries each crawler source independently with configurable backoff and alerts on exhaustion", () => {
    const script = readFileSync(new URL("crawler-worker.ts", import.meta.url), "utf8");

    expect(script).toContain("createRetryingRunCrawlerSourceOnce");
    expect(script).toContain("retryResultWithBackoff");
    expect(script).toContain("emitWorkerFailureAlert");
    expect(script).toContain("CRAWLER_WORKER_RETRY_MAX_ATTEMPTS");
    expect(script).toContain("CRAWLER_WORKER_RETRY_BASE_DELAY_MS");
    expect(script).toContain("CRAWLER_WORKER_RETRY_MAX_DELAY_MS");
    expect(script).toContain("CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS");
  });

  it("rejects a non-positive-integer crawler retry env var during --check", () => {
    const result = runWorkerCheck("crawler-worker.ts", {
      NODE_ENV: "test",
      CRAWLER_WORKER_RETRY_MAX_ATTEMPTS: "abc",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CRAWLER_WORKER_RETRY_MAX_ATTEMPTS must be a positive integer");
  });

  it("rejects a non-positive-integer crawler send-retry env var during --check", () => {
    const result = runWorkerCheck("crawler-worker.ts", {
      NODE_ENV: "test",
      CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS: "0",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS must be a positive integer");
  });
});
