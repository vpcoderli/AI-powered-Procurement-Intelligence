import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as notificationService from "@/server/notifications/service";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, crawlerLogs, dataSources } from "@/server/db/schema";
import { runCrawlTask } from "@/server/crawler/state-runner";
import { importCrawlerJsonRunIntoSqlite } from "@/server/crawler/sqlite-json-importer";
import type { CrawlerJsonRunPayload } from "@/server/crawler/mysql-json-importer";
import { createStateCrawlerRunPost } from "./route";

vi.mock("@/server/notifications/service", () => ({
  sendMatchedAlertNotifications: vi.fn(),
}));

// Mocked so the "dispatches through runCrawlTask" test can observe exactly what the route
// passes into the Python task contract without spawning a real python3 subprocess.
vi.mock("@/server/crawler/state-runner", () => ({ runCrawlTask: vi.fn() }));

// Partial mock: everything delegates to the real implementation (so the persistence tests below
// exercise the real SQLite importer against `testDb.db`) except `importCrawlerJsonRunIntoSqlite`
// itself, which is wrapped in a spy so one test can force a single call to throw and verify the
// containment behaviour without a contrived DB fixture. Mirrors configured-runner.test.ts's
// identical setup for its own "imports the runCrawlTask JSON payload" coverage.
vi.mock("@/server/crawler/sqlite-json-importer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/crawler/sqlite-json-importer")>();
  return {
    ...actual,
    importCrawlerJsonRunIntoSqlite: vi.fn(actual.importCrawlerJsonRunIntoSqlite),
  };
});

const mockedRunCrawlTask = vi.mocked(runCrawlTask);
const mockedImportCrawlerJsonRunIntoSqlite = vi.mocked(importCrawlerJsonRunIntoSqlite);
const NOW = "2026-07-30T00:00:00.000Z";

// Unlike the default `runCrawlerSourceOnce` fake configured in `beforeEach` below (which never
// calls `options.runner()`), this one actually invokes it and reflects the runner's `ok` field —
// mirroring orchestrator.ts's real success/failure branch — so the persistence tests can also
// assert that a contained import failure never turns a fetch success into a reported failure.
const runnerInvokingOrchestrator = (async (_database, options) => {
  const runner = await options.runner();
  if (!runner.ok) {
    return { ok: false, source: options.source, status: "failure", runner };
  }
  return {
    ok: true,
    source: options.source,
    status: "success",
    runner,
    alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 },
    notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
  };
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
        title: "Imported via manual admin run",
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

function failurePayload(sourceId: string): CrawlerJsonRunPayload {
  return {
    source: sourceId,
    runId: `run_${sourceId}`,
    status: "failure",
    startedAt: NOW,
    finishedAt: NOW,
    durationMs: 5,
    metadata: {},
    bids: [],
    errorCode: "EmptyCrawlerResultError",
    errorMessage: "No bids found",
    errorStack: null,
  };
}

describe("POST /api/crawler/state/run", () => {
  let testDb: TestDatabase;
  const runCrawlerSourceOnce = vi.fn();
  const sendMatchedAlertNotifications = vi.mocked(notificationService.sendMatchedAlertNotifications);

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    runCrawlerSourceOnce.mockImplementation(async (_database, options) => ({
      ok: true,
      source: options.source,
      status: "success",
      runner: {
        ok: true,
        source: options.source,
        status: "success",
        stdout: "done",
        stderr: "",
      },
      alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 },
      notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
    }));
    sendMatchedAlertNotifications.mockResolvedValue({
      queued: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
    mockedRunCrawlTask.mockResolvedValue({
      ok: true,
      source: "unused",
      status: "success",
      stdout: "",
      stderr: "",
      fetchedCount: 0,
      errorCode: null,
      payload: null,
    });
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

  it("requires crawler token when configured", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/state/run"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Crawler run token is required.",
    });
    expect(runCrawlerSourceOnce).not.toHaveBeenCalled();
  });

  it("runs every state source found in data_sources by default, excluding non-state issuers", async () => {
    insertSource("il_bidbuy");
    insertSource("fl_mfmp");
    // Must be excluded: this route is state-only, SAM.gov has its own sibling route/runner.
    insertSource("sam_gov", { issuerType: "federal", stateCode: "US" });

    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce, owner: "state_route_test" });

    const response = await POST(new Request("http://localhost/api/crawler/state/run", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed");
    expect(body.results.map((result: { source: string }) => result.source).sort()).toEqual([
      "fl_mfmp",
      "il_bidbuy",
    ]);
    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(2);
    expect(runCrawlerSourceOnce.mock.calls[0][1]).toEqual(
      expect.objectContaining({ owner: "state_route_test" }),
    );
  });

  it("excludes disabled and governance-denied sources from the default run", async () => {
    insertSource("approved_source");
    insertSource("disabled_source", { isEnabled: 0 });
    insertSource("denied_source", { approvedForIngestion: 0 });

    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/state/run", { method: "POST" }));
    const body = await response.json();

    expect(body.results.map((result: { source: string }) => result.source)).toEqual(["approved_source"]);
  });

  it("runs exactly the requested sources, not the rest of data_sources", async () => {
    insertSource("il_bidbuy");
    insertSource("fl_mfmp");
    insertSource("ca_caleprocure");

    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["il_bidbuy", "fl_mfmp"], query: "data", limit: 12 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results.map((result: { source: string }) => result.source)).toEqual(["il_bidbuy", "fl_mfmp"]);
    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(2);
  });

  it("drops unrecognized ids from a mixed request but keeps the recognized ones", async () => {
    insertSource("il_bidbuy");
    insertSource("fl_mfmp");

    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["il_bidbuy", "not_a_real_source"] }),
      }),
    );
    const body = await response.json();

    expect(body.results.map((result: { source: string }) => result.source)).toEqual(["il_bidbuy"]);
  });

  it("falls back to running every known source when nothing requested matches", async () => {
    insertSource("il_bidbuy");
    insertSource("fl_mfmp");

    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["not_a_real_source"] }),
      }),
    );
    const body = await response.json();

    expect(body.results.map((result: { source: string }) => result.source).sort()).toEqual([
      "fl_mfmp",
      "il_bidbuy",
    ]);
  });

  it("continues after a source failure and returns per-source results", async () => {
    insertSource("il_bidbuy");
    insertSource("fl_mfmp");
    runCrawlerSourceOnce
      .mockResolvedValueOnce({
        ok: false,
        source: "il_bidbuy",
        status: "failure",
        runner: { ok: false, source: "il_bidbuy", status: "failure", stdout: "", stderr: "failed" },
      })
      .mockResolvedValueOnce({
        ok: true,
        source: "fl_mfmp",
        status: "success",
        runner: { ok: true, source: "fl_mfmp", status: "success", stdout: "done", stderr: "" },
        alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 },
        notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
      });
    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["il_bidbuy", "fl_mfmp"] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed_with_failures");
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe("failure");
    expect(body.results[1].status).toBe("success");
  });

  it("surfaces blocked source governance results without running later side effects", async () => {
    insertSource("il_bidbuy");
    runCrawlerSourceOnce.mockResolvedValueOnce({
      ok: false,
      source: "il_bidbuy",
      status: "blocked",
      reason: "Source governance has not approved ingestion.",
      approvalStatus: "blocked",
      legalReviewStatus: "restricted",
      approvedForIngestion: false,
    });
    const POST = createStateCrawlerRunPost({ database: testDb.db, runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["il_bidbuy"] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: false,
      status: "completed_with_failures",
      results: [
        {
          ok: false,
          source: "il_bidbuy",
          status: "blocked",
          reason: "Source governance has not approved ingestion.",
          approvalStatus: "blocked",
          legalReviewStatus: "restricted",
          approvedForIngestion: false,
        },
      ],
    });
  });

  it("dispatches through runCrawlTask with the requested query/limit and a per-run task id", async () => {
    insertSource("il_bidbuy");
    const now = new Date(NOW);

    const POST = createStateCrawlerRunPost({
      database: testDb.db,
      now: () => now,
      runCrawlerSourceOnce: (async (_database, options) => {
        await options.runner();
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });

    await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["il_bidbuy"], query: "roads", limit: 9 }),
      }),
    );

    expect(mockedRunCrawlTask).toHaveBeenCalledTimes(1);
    const [sourceArg, taskOptions] = mockedRunCrawlTask.mock.calls[0];
    expect(sourceArg.id).toBe("il_bidbuy");
    expect(taskOptions).toEqual({
      taskId: `tsk_il_bidbuy_${now.getTime()}`,
      limit: 9,
      query: "roads",
    });
  });

  // Task X7: the manual admin-trigger route had the same drop-the-payload gap Task X5 (commit
  // f83ca11) fixed on the scheduled path — runCrawlTask's result was parsed but never written to
  // the database. These exercise the runner closure end to end: runCrawlerSourceOnce is faked
  // (via runnerInvokingOrchestrator, above) just enough to invoke `options.runner()`, so the
  // mocked runCrawlTask result flows through the real stampJurisdiction + (spied-but-real)
  // importCrawlerJsonRunIntoSqlite and lands in testDb.db, exactly like
  // configured-runner.test.ts's equivalent describe block for the scheduled path.
  describe("persists the runCrawlTask JSON payload (Task X7)", () => {
    it("persists bids and a crawler_logs row when a manual run's task result carries a success payload", async () => {
      insertSource("manual_persist_success");
      mockedRunCrawlTask.mockResolvedValue({
        ok: true,
        source: "manual_persist_success",
        status: "success",
        stdout: "",
        stderr: "",
        fetchedCount: 1,
        errorCode: null,
        payload: successPayload("manual_persist_success"),
      });

      const POST = createStateCrawlerRunPost({
        database: testDb.db,
        runCrawlerSourceOnce: runnerInvokingOrchestrator,
      });

      const response = await POST(
        new Request("http://localhost/api/crawler/state/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sources: ["manual_persist_success"] }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("completed");

      const bidRow = testDb.db.select().from(bids).where(eq(bids.id, "bid_manual_persist_success")).get();
      expect(bidRow).toMatchObject({ title: "Imported via manual admin run" });

      const logRows = testDb.db
        .select()
        .from(crawlerLogs)
        .where(eq(crawlerLogs.runId, "run_manual_persist_success"))
        .all();
      expect(logRows).toHaveLength(1);
      expect(logRows[0]).toMatchObject({ status: "success", fetchedCount: 1, insertedCount: 1 });
    });

    it("writes only a crawler_logs row (no bids) when a manual run's task result carries a failure payload", async () => {
      insertSource("manual_persist_failure");
      mockedRunCrawlTask.mockResolvedValue({
        ok: false,
        source: "manual_persist_failure",
        status: "failure",
        stdout: "",
        stderr: "no records",
        fetchedCount: 0,
        errorCode: "EmptyCrawlerResultError",
        payload: failurePayload("manual_persist_failure"),
      });

      const POST = createStateCrawlerRunPost({
        database: testDb.db,
        runCrawlerSourceOnce: runnerInvokingOrchestrator,
      });

      const response = await POST(
        new Request("http://localhost/api/crawler/state/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sources: ["manual_persist_failure"] }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.status).toBe("completed_with_failures");

      const bidRows = testDb.db.select().from(bids).all();
      expect(bidRows).toHaveLength(0);

      const logRows = testDb.db
        .select()
        .from(crawlerLogs)
        .where(eq(crawlerLogs.runId, "run_manual_persist_failure"))
        .all();
      expect(logRows).toHaveLength(1);
      expect(logRows[0]).toMatchObject({ status: "failure", errorCode: "EmptyCrawlerResultError" });
    });

    it("contains an importer throw to the offending source and still runs the remaining requested sources", async () => {
      insertSource("manual_throw_a");
      insertSource("manual_throw_b");
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

      const POST = createStateCrawlerRunPost({
        database: testDb.db,
        runCrawlerSourceOnce: runnerInvokingOrchestrator,
      });

      const response = await POST(
        new Request("http://localhost/api/crawler/state/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sources: ["manual_throw_a", "manual_throw_b"] }),
        }),
      );
      const body = await response.json();

      // Both sources ran to completion despite the first import throwing, and — since the
      // import failure is contained rather than propagated — both are still reported as
      // successful fetches: a persistence bug must not silently turn into a reported failure.
      expect(response.status).toBe(200);
      expect(body.status).toBe("completed");
      expect(body.results).toHaveLength(2);
      expect(mockedImportCrawlerJsonRunIntoSqlite).toHaveBeenCalledTimes(2);

      // Exactly one of the two imports actually persisted (the other's throw happened before
      // any write), and the failure was logged rather than propagated.
      expect(testDb.db.select().from(bids).all()).toHaveLength(1);
      expect(testDb.db.select().from(crawlerLogs).all()).toHaveLength(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [loggedPayload] = consoleErrorSpy.mock.calls[0] as [string];
      expect(JSON.parse(loggedPayload)).toMatchObject({ event: "crawler_json_import_failed" });

      consoleErrorSpy.mockRestore();
    });

    it("stamps jurisdiction from the source registry onto persisted bids on the manual run path too", async () => {
      insertSource("manual_jurisdiction_source", { jurisdictionName: "California", fipsCode: "06" });
      mockedRunCrawlTask.mockResolvedValue({
        ok: true,
        source: "manual_jurisdiction_source",
        status: "success",
        stdout: "",
        stderr: "",
        fetchedCount: 1,
        errorCode: null,
        payload: successPayload("manual_jurisdiction_source"),
      });

      const POST = createStateCrawlerRunPost({
        database: testDb.db,
        runCrawlerSourceOnce: runnerInvokingOrchestrator,
      });

      await POST(
        new Request("http://localhost/api/crawler/state/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sources: ["manual_jurisdiction_source"] }),
        }),
      );

      const bidRow = testDb.db
        .select()
        .from(bids)
        .where(eq(bids.id, "bid_manual_jurisdiction_source"))
        .get();
      expect(bidRow).toMatchObject({
        jurisdictionLevel: "state",
        jurisdictionName: "California",
        fipsCode: "06",
      });
    });

    // Coordinator addendum to Task X7: as committed in f83ca11, stampJurisdiction ran outside
    // the try/catch that contains the importer calls, so a throw from stamping — not just from
    // importing — would propagate uncaught out of the runner closure. Neither this route's loop
    // nor configured-runner.ts's guards its own runCrawlerSourceOnce call, so that throw would
    // have aborted the entire batch rather than just the offending source. Reproduces the actual
    // trigger (a payload whose `bids` is truthy but not an array — normally unreachable since
    // Python's fetch-task always emits a real array, but the TS side only validates a `status`
    // field before casting the rest) against the real, unmocked stampJurisdiction, unlike
    // crawl-task-persistence.test.ts's equivalent unit-level test which mocks the throw.
    it("does not abort the batch when one source's payload has a non-array bids value", async () => {
      insertSource("malformed_bids_source");
      insertSource("normal_source_after_malformed");
      mockedRunCrawlTask.mockImplementation(async (sourceArg) => {
        if (sourceArg.id === "malformed_bids_source") {
          return {
            ok: true,
            source: sourceArg.id,
            status: "success",
            stdout: "",
            stderr: "",
            fetchedCount: 0,
            errorCode: null,
            payload: { ...successPayload(sourceArg.id), bids: "not-an-array" as never },
          };
        }
        return {
          ok: true,
          source: sourceArg.id,
          status: "success",
          stdout: "",
          stderr: "",
          fetchedCount: 1,
          errorCode: null,
          payload: successPayload(sourceArg.id),
        };
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const POST = createStateCrawlerRunPost({
        database: testDb.db,
        runCrawlerSourceOnce: runnerInvokingOrchestrator,
      });

      const response = await POST(
        new Request("http://localhost/api/crawler/state/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sources: ["malformed_bids_source", "normal_source_after_malformed"] }),
        }),
      );
      const body = await response.json();

      // The batch must not abort: both sources still get a result, and — since the stamp
      // failure is contained rather than propagated — both are still reported as successful
      // fetches, same as an importer throw.
      expect(response.status).toBe(200);
      expect(body.status).toBe("completed");
      expect(body.results).toHaveLength(2);

      // The malformed source persisted nothing (stampJurisdiction threw before the importer
      // ever ran), but the next source in the batch still ran and persisted normally.
      const badBidRows = testDb.db.select().from(bids).where(eq(bids.id, "bid_malformed_bids_source")).all();
      expect(badBidRows).toHaveLength(0);
      const goodBidRow = testDb.db
        .select()
        .from(bids)
        .where(eq(bids.id, "bid_normal_source_after_malformed"))
        .get();
      expect(goodBidRow).toMatchObject({ title: "Imported via manual admin run" });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const [loggedPayload] = consoleErrorSpy.mock.calls[0] as [string];
      expect(JSON.parse(loggedPayload)).toMatchObject({
        event: "crawler_json_import_failed",
        source: "malformed_bids_source",
      });

      consoleErrorSpy.mockRestore();
    });
  });
});
