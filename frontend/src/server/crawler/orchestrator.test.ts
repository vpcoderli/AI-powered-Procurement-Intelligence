import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { crawlerLocks } from "@/server/db/schema";
import { acquireCrawlerLock } from "./lock-repository";
import { runCrawlerSourceOnce } from "./orchestrator";

describe("crawler orchestrator", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("runs matcher and notifier after a successful crawler run", async () => {
    const runner = vi.fn(async () => ({
      ok: true,
      source: "SAM.gov" as const,
      status: "success" as const,
      stdout: "done",
      stderr: "",
    }));
    const matcher = vi.fn(async () => ({
      evaluatedAlerts: 0,
      matchedAlerts: 0,
      updatedAlerts: 0,
      matches: [],
    }));
    const notifier = vi.fn(async () => ({
      queued: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    }));

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      runner,
      matcher,
      notifier,
    });

    expect(result.status).toBe("success");
    expect(result.runner).toEqual({
      ok: true,
      source: "SAM.gov",
      status: "success",
      stdout: "done",
      stderr: "",
    });
    expect(result.alertMatching).toEqual({
      evaluatedAlerts: 0,
      matchedAlerts: 0,
      updatedAlerts: 0,
      matches: [],
    });
    expect(result.notification).toEqual({
      queued: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(runner).toHaveBeenCalledBefore(matcher);
    expect(matcher).toHaveBeenCalledBefore(notifier);
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);
  });

  it("releases the lock and skips matcher and notifier when the runner fails", async () => {
    const matcher = vi.fn();
    const notifier = vi.fn();

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      runner: async () => ({
        ok: false,
        source: "SAM.gov" as const,
        status: "failure" as const,
        stdout: "",
        stderr: "failed",
      }),
      matcher,
      notifier,
    });

    expect(result.status).toBe("failure");
    expect(matcher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);
  });

  it("returns locked and skips work when another owner holds the lock", async () => {
    acquireCrawlerLock(testDb.db, {
      source: "SAM.gov",
      owner: "other_owner",
      acquiredAt: "2026-05-19T00:00:00.000Z",
      expiresAt: "2026-05-19T00:10:00.000Z",
    });
    const runner = vi.fn();
    const matcher = vi.fn();
    const notifier = vi.fn();

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:01:00.000Z"),
      runner,
      matcher,
      notifier,
    });

    expect(result).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "locked",
      lockedBy: "other_owner",
      lockExpiresAt: "2026-05-19T00:10:00.000Z",
    });
    expect(runner).not.toHaveBeenCalled();
    expect(matcher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
  });
});
