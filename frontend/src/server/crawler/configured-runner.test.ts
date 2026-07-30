import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});
