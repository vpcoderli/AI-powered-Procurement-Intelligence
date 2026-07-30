import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "./configured-runner";

describe("parseStateCrawlerLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses positive state crawler limits from the environment", () => {
    vi.stubEnv("STATE_CRAWLER_LIMIT", "12");

    expect(parseStateCrawlerLimit()).toBe(12);
  });

  it("ignores empty, non-numeric, and non-positive state crawler limits", () => {
    vi.stubEnv("STATE_CRAWLER_LIMIT", "");
    expect(parseStateCrawlerLimit()).toBeUndefined();

    vi.stubEnv("STATE_CRAWLER_LIMIT", "abc");
    expect(parseStateCrawlerLimit()).toBeUndefined();

    vi.stubEnv("STATE_CRAWLER_LIMIT", "0");
    expect(parseStateCrawlerLimit()).toBeUndefined();
  });
});

const NOW = "2026-07-29T12:00:00.000Z";

describe("runConfiguredCrawlerSourcesOnce reads sources from the database", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function insertSource(id: string, overrides: Record<string, unknown> = {}) {
    testDb.db
      .insert(dataSources)
      .values({
        id,
        label: id,
        issuerType: "state",
        stateCode: "CA",
        baseUrl: "https://example.gov",
        isEnabled: 1,
        cadence: "daily",
        approvedForIngestion: 1,
        approvalStatus: "approved",
        legalReviewStatus: "approved_public",
        jurisdictionLevel: "state",
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .run();
  }

  function getSource(id: string) {
    return testDb.db.select().from(dataSources).where(eq(dataSources.id, id)).get();
  }

  const noopMatcher = async () => ({ matched: 0, matches: [] }) as never;
  const noopNotifier = async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 });

  it("runs only sources that are due", async () => {
    insertSource("due_source", { lastSuccessAt: null });
    insertSource("not_due_source", { lastSuccessAt: NOW });

    const attempted: string[] = [];
    const results = await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: (async (_db, options) => {
        attempted.push(options.source);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    expect(attempted).toEqual(["due_source"]);
    expect(results).toHaveLength(1);
  });

  it("skips sources that governance has not approved", async () => {
    insertSource("blocked_source", { approvalStatus: "needs_review", lastSuccessAt: null });

    const attempted: string[] = [];
    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: (async (_db, options) => {
        attempted.push(options.source);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    expect(attempted).toEqual([]);
  });

  it("records success and resets the failure counter when a due source succeeds", async () => {
    insertSource("succeeding_source", { lastSuccessAt: null, consecutiveFailures: 3 });

    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: noopMatcher,
      notifier: noopNotifier,
      runCrawlerSourceOnce: (async (_db, options) => ({
        ok: true,
        source: options.source,
        status: "success",
      })) as never,
    });

    const row = getSource("succeeding_source");
    expect(row?.lastSuccessAt).toBe(NOW);
    expect(row?.consecutiveFailures).toBe(0);
  });

  it("increments consecutive_failures and leaves last_success_at untouched when a due source fails", async () => {
    insertSource("failing_source", { lastSuccessAt: null, consecutiveFailures: 0 });

    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: noopMatcher,
      notifier: noopNotifier,
      runCrawlerSourceOnce: (async (_db, options) => ({
        ok: false,
        source: options.source,
        status: "failure",
        runner: {
          ok: false,
          source: options.source,
          status: "failure",
          stdout: "",
          stderr: "boom",
        },
      })) as never,
    });

    const row = getSource("failing_source");
    expect(row?.consecutiveFailures).toBe(1);
    expect(row?.lastSuccessAt).toBeNull();
    expect(row?.lastFailureAt).toBe(NOW);
  });

  it("does not write back health when the source outcome is not an attempt (blocked)", async () => {
    insertSource("blocked_by_control", { lastSuccessAt: null, consecutiveFailures: 0 });

    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: noopMatcher,
      notifier: noopNotifier,
      runCrawlerSourceOnce: (async (_db, options) => ({
        ok: false,
        source: options.source,
        status: "blocked",
        reason: "governance hold",
      })) as never,
    });

    const row = getSource("blocked_by_control");
    expect(row?.lastSuccessAt).toBeNull();
    expect(row?.lastFailureAt).toBeNull();
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.approvalStatus).toBe("approved");
  });

  it("closes the loop: a source is not due again until its cadence interval passes after a recorded success", async () => {
    insertSource("closes_the_loop", { lastSuccessAt: null });

    const attempted: string[] = [];
    const fakeRunCrawlerSourceOnce = (async (_db, options) => {
      attempted.push(options.source);
      return { ok: true, source: options.source, status: "success" };
    }) as never;

    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: noopMatcher,
      notifier: noopNotifier,
      runCrawlerSourceOnce: fakeRunCrawlerSourceOnce,
    });

    expect(attempted).toEqual(["closes_the_loop"]);

    // One hour later, well inside the "daily" cadence's 24h interval: without the health
    // write-back from the first run, `last_success_at` would still be NULL and
    // `selectDueSources` would treat the source as due again, defeating cadence scheduling
    // entirely.
    const oneHourLater = new Date(new Date(NOW).getTime() + 60 * 60 * 1000);
    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: oneHourLater,
      matcher: noopMatcher,
      notifier: noopNotifier,
      runCrawlerSourceOnce: fakeRunCrawlerSourceOnce,
    });

    expect(attempted).toEqual(["closes_the_loop"]);
  });
});
