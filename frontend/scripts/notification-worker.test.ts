import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("notification worker script", () => {
  it("exposes a deployable notification worker loop", () => {
    const script = readFileSync(new URL("notification-worker.ts", import.meta.url), "utf8");
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

    expect(script).toContain("runNotificationWorkerOnce");
    expect(script).toContain("NOTIFICATION_WORKER_INTERVAL_MS");
    expect(script).toContain("NOTIFICATION_WORKER_RUN_ONCE");
    expect(script).toContain("NOTIFICATION_WORKER_DELIVERY_LIMIT");
    expect(script).toContain("NOTIFICATION_WORKER_DUNNING_LIMIT");
    expect(packageJson).toContain("\"worker:notifications\"");
  });
});
