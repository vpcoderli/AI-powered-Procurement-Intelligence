import { beforeEach, describe, expect, it, vi } from "vitest";
import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import * as notificationService from "@/server/notifications/service";
import { createStateCrawlerRunPost } from "./route";

vi.mock("@/server/notifications/service", () => ({
  sendMatchedAlertNotifications: vi.fn(),
}));

describe("POST /api/crawler/state/run", () => {
  const runCrawlerSourceOnce = vi.fn();
  const sendMatchedAlertNotifications = vi.mocked(notificationService.sendMatchedAlertNotifications);

  beforeEach(() => {
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
  });

  it("requires crawler token when configured", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/state/run"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Crawler run token is required.",
    });
    expect(runCrawlerSourceOnce).not.toHaveBeenCalled();
  });

  it("runs all supported state sources by default", async () => {
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce, owner: "state_route_test" });

    const response = await POST(new Request("http://localhost/api/crawler/state/run", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed");
    expect(body.results.map((result: { source: string }) => result.source)).toEqual(
      STATE_CRAWLER_SOURCES.map((source) => source.id),
    );
    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(50);
    expect(runCrawlerSourceOnce.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        source: "al_state_procurement",
        owner: "state_route_test",
        runnerOptions: { allowFixtureFallback: true },
      }),
    );
  });

  it("passes selected sources, query, and limit into each source run", async () => {
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: ["il_bidbuy", "fl_mfmp"],
          query: "data",
          limit: 12,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results.map((result: { source: string }) => result.source)).toEqual(["il_bidbuy", "fl_mfmp"]);
    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(2);
    expect(runCrawlerSourceOnce.mock.calls[0][1].runnerOptions).toEqual({
      query: "data",
      limit: 12,
      allowFixtureFallback: true,
    });
    expect(runCrawlerSourceOnce.mock.calls[1][1].runnerOptions).toEqual({
      query: "data",
      limit: 12,
      allowFixtureFallback: true,
    });
  });

  it("continues after a source failure and returns per-source results", async () => {
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
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce });

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
});
