import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as notificationService from "@/server/notifications/service";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { runCrawlTask } from "@/server/crawler/state-runner";
import { createStateCrawlerRunPost } from "./route";

vi.mock("@/server/notifications/service", () => ({
  sendMatchedAlertNotifications: vi.fn(),
}));

// Mocked so the "dispatches through runCrawlTask" test can observe exactly what the route
// passes into the Python task contract without spawning a real python3 subprocess.
vi.mock("@/server/crawler/state-runner", () => ({ runCrawlTask: vi.fn() }));

const mockedRunCrawlTask = vi.mocked(runCrawlTask);
const NOW = "2026-07-30T00:00:00.000Z";

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
});
