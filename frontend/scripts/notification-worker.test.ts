import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(script).toContain("NODE_ENV=production is using the");
    expect(script).toContain("DATABASE_PATH");
    expect(packageJson).toContain("\"worker:notifications\"");
    expect(packageJson).toContain("\"worker:notifications:check\"");
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
});
