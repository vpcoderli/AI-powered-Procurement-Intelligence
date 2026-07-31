import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, crawlerLogs, dataSources } from "@/server/db/schema";
import { classifyCrawlerFailure } from "./failure-classifier";
import type { RunCrawlerSourceOnceOptions } from "./orchestrator";
import { runSamGovCrawler } from "./sam-gov-runner";
import { runCrawlTask } from "./state-runner";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import {
  buildCrawlerFailureInput,
  parseStateCrawlerLimit,
  runConfiguredCrawlerSourcesOnce,
} from "./configured-runner";

// Mocked so the "threads stateRunnerOptions" test can observe exactly what configured-runner.ts
// passes into each runner without spawning a real python3 subprocess.
vi.mock("./state-runner", () => ({ runCrawlTask: vi.fn() }));
vi.mock("./sam-gov-runner", () => ({ runSamGovCrawler: vi.fn() }));
// Partial mock: everything delegates to the real implementation (so the "imports crawler JSON
// payloads" describe block below exercises the real SQLite importer against `testDb.db`)
// except `importCrawlerJsonRunIntoSqlite`, which is wrapped in a spy so one test can force a
// single call to throw and verify the containment behaviour without a contrived DB fixture.
vi.mock("./sqlite-json-importer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sqlite-json-importer")>();
  return {
    ...actual,
    importCrawlerJsonRunIntoSqlite: vi.fn(actual.importCrawlerJsonRunIntoSqlite),
  };
});

const mockedRunCrawlTask = vi.mocked(runCrawlTask);
const mockedRunSamGovCrawler = vi.mocked(runSamGovCrawler);
const mockedImportCrawlerJsonRunIntoSqlite = vi.mocked(importCrawlerJsonRunIntoSqlite);

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

  it("threads a concrete errorCode from the runner result into the failure classification", async () => {
    insertSource("classified_failure", { lastSuccessAt: null, consecutiveFailures: 2 });

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
          stderr: "no records returned",
          errorCode: "EmptyCrawlerResultError",
          fetchedCount: 0,
        },
      })) as never,
    });

    // "empty" degrades at the lower 3-failure threshold, vs. 5 for "unknown"/"network". Seeding
    // consecutiveFailures at 2 means this only crosses the threshold if the concrete errorCode
    // on the runner result actually reached classifyCrawlerFailure via buildCrawlerFailureInput,
    // rather than being dropped and falling back to "unknown" (threshold 5, would stay approved
    // at count 3). "network"/"Timeout" can't distinguish this the same way, since it shares
    // "unknown"'s threshold and force-degrade behaviour exactly — see buildCrawlerFailureInput's
    // own unit tests below for a direct, DB-independent check of the "Timeout" -> "network"
    // mapping.
    const row = getSource("classified_failure");
    expect(row?.consecutiveFailures).toBe(3);
    expect(row?.approvalStatus).toBe("needs_review");
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

describe("runConfiguredCrawlerSourcesOnce dispatches health write-back through the MySQL control store", () => {
  // These tests run against a stubbed `{ query, execute }` pool and assert the SQL text/bound
  // params reaching `execute`, mirroring the fake-pool convention already used for the MySQL
  // twins themselves in source-health-repository.test.ts. `query` stands in for
  // `listCrawlableSourcesFromMysql`'s read; `execute` stands in for the write-back call the
  // dispatch loop makes afterwards. No real database is required since these never touch
  // `options.database` (the mysql branch bypasses it entirely) and `runCrawlerSourceOnce` is
  // always overridden with a fake.

  function mysqlSourceRow(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      label: id,
      issuerType: "state",
      stateCode: "CA",
      baseUrl: "https://example.gov",
      cadence: "daily",
      providerFamily: null,
      jurisdictionLevel: "state",
      jurisdictionName: "California",
      fipsCode: "06",
      fetchConfig: "{}",
      lastSuccessAt: null,
      consecutiveFailures: 0,
      ...overrides,
    };
  }

  it("records success through recordSourceSuccessInMysql, not the failure twin", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }] as [unknown, unknown?]);
    const query = vi.fn(async () => [[mysqlSourceRow("mysql_due_source")]] as [unknown[], unknown?]);
    const mysql = { query, execute };

    await runConfiguredCrawlerSourcesOnce({
      database: {} as AppDatabase,
      mysql: mysql as never,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: (async (_db, options) => ({
        ok: true,
        source: options.source,
        status: "success",
      })) as never,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    // Distinguishes the success twin's SQL from the failure twin's textually, so a swapped
    // branch (calling the failure twin on success) would fail this assertion.
    expect(sql).toContain("last_success_at");
    expect(sql).not.toContain("last_failure_at");
    expect(params).toEqual([NOW, NOW, "mysql_due_source"]);
  });

  it("records failure through recordSourceFailureInMysql, not the success twin", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }] as [unknown, unknown?]);
    const query = vi.fn(async () => [[mysqlSourceRow("mysql_failing_source")]] as [unknown[], unknown?]);
    const mysql = { query, execute };

    await runConfiguredCrawlerSourcesOnce({
      database: {} as AppDatabase,
      mysql: mysql as never,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
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

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("last_failure_at");
    expect(sql).not.toContain("last_success_at");
    // forceDegrade=0 ("unknown" isn't shouldFlagForReview), threshold=5 (default).
    expect(params).toEqual([NOW, 0, 5, NOW, "mysql_failing_source"]);
  });

  it("passes the MySQL control store to every dispatched source", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }] as [unknown, unknown?]);
    const query = vi.fn(
      async () =>
        [[mysqlSourceRow("mysql_source_a"), mysqlSourceRow("mysql_source_b")]] as [unknown[], unknown?],
    );
    const mysql = { query, execute };

    const calls: RunCrawlerSourceOnceOptions<unknown>[] = [];
    await runConfiguredCrawlerSourcesOnce({
      database: {} as AppDatabase,
      mysql: mysql as never,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: (async (_db, options) => {
        calls.push(options);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.mysql === mysql)).toBe(true);
  });

  it("does not abort the batch when a health write-back rejects", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("db exploded"))
      .mockResolvedValue([{ affectedRows: 1, insertId: 0 }]);
    const query = vi.fn(
      async () =>
        [[mysqlSourceRow("mysql_source_first"), mysqlSourceRow("mysql_source_second")]] as [
          unknown[],
          unknown?,
        ],
    );
    const mysql = { query, execute };
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const attempted: string[] = [];
    const results = await runConfiguredCrawlerSourcesOnce({
      database: {} as AppDatabase,
      mysql: mysql as never,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: (async (_db, options) => {
        attempted.push(options.source);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    // The first source's write-back rejects; the loop must still run and return the second.
    expect(attempted).toEqual(["mysql_source_first", "mysql_source_second"]);
    expect(results).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});

describe("runConfiguredCrawlerSourcesOnce threads stateRunnerOptions into state sources, not SAM.gov", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
    mockedRunCrawlTask.mockReset();
    mockedRunSamGovCrawler.mockReset();
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

  it("passes stateRunnerOptions.limit/query into runCrawlTask for a state source, and nothing into SAM.gov's runner", async () => {
    insertSource("state_source_with_limit", { lastSuccessAt: null });
    insertSource("sam_gov", { issuerType: "federal", lastSuccessAt: null });

    mockedRunCrawlTask.mockResolvedValue({
      ok: true,
      source: "state_source_with_limit",
      status: "success",
      stdout: "",
      stderr: "",
      fetchedCount: 0,
      errorCode: null,
      payload: null,
    });
    mockedRunSamGovCrawler.mockResolvedValue({
      ok: true,
      source: "SAM.gov",
      status: "success",
      stdout: "",
      stderr: "",
    });

    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      stateRunnerOptions: { limit: 7, query: "roads" },
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      // Unlike the other describe blocks' fakes, this one actually invokes `options.runner()`
      // so the mocked `runCrawlTask`/`runSamGovCrawler` calls (and their arguments) are
      // observable — the other tests never call it, since they only care about which source
      // got dispatched, not what its runner closure was built with.
      runCrawlerSourceOnce: (async (_db, options) => {
        await options.runner();
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    expect(mockedRunSamGovCrawler).toHaveBeenCalledTimes(1);
    expect(mockedRunSamGovCrawler).toHaveBeenCalledWith();

    expect(mockedRunCrawlTask).toHaveBeenCalledTimes(1);
    const [sourceArg, taskOptions] = mockedRunCrawlTask.mock.calls[0];
    expect(sourceArg.id).toBe("state_source_with_limit");
    expect(taskOptions).toEqual({
      taskId: `tsk_state_source_with_limit_${new Date(NOW).getTime()}`,
      limit: 7,
      query: "roads",
    });
  });
});

describe("runConfiguredCrawlerSourcesOnce imports the runCrawlTask JSON payload (Task X5)", () => {
  // These exercise the runner closure end to end: runCrawlerSourceOnce is faked (as in the
  // "threads stateRunnerOptions" block above) just enough to invoke `options.runner()`, so the
  // mocked runCrawlTask result flows through the real stampJurisdiction + (spied-but-real)
  // importCrawlerJsonRunIntoSqlite and lands in testDb.db.
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
    mockedRunCrawlTask.mockReset();
    // Only clear call history — mockReset() would also discard the real passthrough
    // implementation the module factory above wired in via vi.fn(actual.importCrawlerJsonRunIntoSqlite).
    mockedImportCrawlerJsonRunIntoSqlite.mockClear();
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
        jurisdictionName: "California",
        fipsCode: "06",
        lastSuccessAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .run();
  }

  const runnerInvokingOrchestrator = (async (_db, options) => {
    await options.runner();
    return { ok: true, source: options.source, status: "success" };
  }) as never;

  function successPayload(sourceId: string): CrawlerJsonRunPayload {
    return {
      source: sourceId,
      runId: `run_${sourceId}`,
      status: "success",
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 10,
      metadata: {},
      bids: [
        {
          id: `bid_${sourceId}`,
          source: sourceId,
          source_bid_id: "1",
          dedupe_key: `${sourceId}:1`,
          title: "Imported via configured runner",
          description: "d",
          issuer_name: "Issuer",
          issuer_type: "state",
          state_code: "CA",
          source_url: "https://example.com/1",
        },
      ],
      errorCode: null,
      errorMessage: null,
      errorStack: null,
    };
  }

  it("persists bids (with jurisdiction stamped from the source) and a crawler_logs row on a successful payload", async () => {
    insertSource("import_success_source");
    mockedRunCrawlTask.mockResolvedValue({
      ok: true,
      source: "import_success_source",
      status: "success",
      stdout: "",
      stderr: "",
      fetchedCount: 1,
      errorCode: null,
      payload: successPayload("import_success_source"),
    });

    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: runnerInvokingOrchestrator,
    });

    const bidRow = testDb.db.select().from(bids).where(eq(bids.id, "bid_import_success_source")).get();
    expect(bidRow).toMatchObject({
      title: "Imported via configured runner",
      jurisdictionLevel: "state",
      jurisdictionName: "California",
      fipsCode: "06",
    });

    const logRows = testDb.db
      .select()
      .from(crawlerLogs)
      .where(eq(crawlerLogs.runId, "run_import_success_source"))
      .all();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({ status: "success", fetchedCount: 1, insertedCount: 1 });
  });

  it("persists only a crawler_logs row (no bids) on a failure payload", async () => {
    insertSource("import_failure_source");
    mockedRunCrawlTask.mockResolvedValue({
      ok: false,
      source: "import_failure_source",
      status: "failure",
      stdout: "",
      stderr: "no records",
      fetchedCount: 0,
      errorCode: "EmptyCrawlerResultError",
      payload: {
        source: "import_failure_source",
        runId: "run_import_failure_source",
        status: "failure",
        startedAt: NOW,
        finishedAt: NOW,
        durationMs: 5,
        metadata: {},
        bids: [],
        errorCode: "EmptyCrawlerResultError",
        errorMessage: "No bids found",
        errorStack: null,
      },
    });

    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: runnerInvokingOrchestrator,
    });

    const bidRows = testDb.db.select().from(bids).all();
    expect(bidRows).toHaveLength(0);

    const logRows = testDb.db
      .select()
      .from(crawlerLogs)
      .where(eq(crawlerLogs.runId, "run_import_failure_source"))
      .all();
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({ status: "failure", errorCode: "EmptyCrawlerResultError" });
  });

  it("contains an importer throw to the offending source and still runs the next source", async () => {
    insertSource("import_throw_source_a");
    insertSource("import_throw_source_b");
    mockedRunCrawlTask.mockImplementation(async (sourceArg) => ({
      ok: true,
      source: sourceArg.id,
      status: "success",
      stdout: "",
      stderr: "",
      fetchedCount: 1,
      errorCode: null,
      payload: successPayload(sourceArg.id),
    }));
    mockedImportCrawlerJsonRunIntoSqlite.mockImplementationOnce(() => {
      throw new Error("import boom");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const results = await runConfiguredCrawlerSourcesOnce({
      database: testDb.db,
      owner: "test",
      now: new Date(NOW),
      matcher: async () => ({ matched: 0, matches: [] }) as never,
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
      runCrawlerSourceOnce: runnerInvokingOrchestrator,
    });

    // Both sources ran to completion despite the first import throwing.
    expect(results).toHaveLength(2);
    expect(mockedImportCrawlerJsonRunIntoSqlite).toHaveBeenCalledTimes(2);

    // Exactly one of the two imports actually persisted (the other's throw happened before any
    // write), and the failure was logged rather than propagated.
    expect(testDb.db.select().from(bids).all()).toHaveLength(1);
    expect(testDb.db.select().from(crawlerLogs).all()).toHaveLength(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [loggedPayload] = consoleErrorSpy.mock.calls[0] as [string];
    expect(JSON.parse(loggedPayload)).toMatchObject({ event: "crawler_json_import_failed" });

    consoleErrorSpy.mockRestore();
  });
});

describe("buildCrawlerFailureInput", () => {
  it("threads a concrete errorCode through to classifyCrawlerFailure and classifies it correctly", () => {
    const input = buildCrawlerFailureInput({
      ok: false,
      source: "some_source",
      status: "failure",
      stdout: "",
      stderr: "read timed out",
      errorCode: "Timeout",
      fetchedCount: 0,
    } as never);

    expect(input).toEqual({ errorCode: "Timeout", errorMessage: "read timed out", fetchedCount: 0 });
    expect(classifyCrawlerFailure(input)).toBe("network");
  });

  it("falls back to null fields when the runner carries neither errorCode nor fetchedCount (e.g. SAM.gov)", () => {
    const input = buildCrawlerFailureInput({
      ok: false,
      source: "SAM.gov",
      status: "failure",
      stdout: "",
      stderr: "some stderr",
    });

    expect(input).toEqual({ errorCode: null, errorMessage: "some stderr", fetchedCount: null });
    expect(classifyCrawlerFailure(input)).toBe("unknown");
  });
});
