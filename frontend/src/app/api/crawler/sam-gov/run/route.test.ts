import { beforeEach, describe, expect, it, vi } from "vitest";
import * as notificationService from "@/server/notifications/service";
import { createSamGovRunPost } from "./route";

vi.mock("@/server/notifications/service", () => ({
  sendMatchedAlertNotifications: vi.fn(),
}));

describe("POST /api/crawler/sam-gov/run", () => {
  const runCrawlerSourceOnce = vi.fn();
  const sendMatchedAlertNotifications = vi.mocked(notificationService.sendMatchedAlertNotifications);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    runCrawlerSourceOnce.mockResolvedValue({
      ok: true,
      source: "SAM.gov",
      status: "success",
      runner: {
        ok: true,
        source: "SAM.gov",
        status: "success",
        stdout: "done",
        stderr: "",
      },
      alertMatching: {
        evaluatedAlerts: 1,
        matchedAlerts: 1,
        updatedAlerts: 1,
      },
      notification: {
        queued: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
      },
    });
    sendMatchedAlertNotifications.mockResolvedValue({
      queued: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("requires crawler token when configured", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    const POST = createSamGovRunPost({ runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Crawler run token is required.",
    });
    expect(runCrawlerSourceOnce).not.toHaveBeenCalled();
  });

  it("allows local admin bypass when a crawler token is configured", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    vi.stubEnv("ADMIN_UI_LOCAL_BYPASS", "true");
    const POST = createSamGovRunPost({ runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));

    expect(response.status).toBe(200);
    expect(runCrawlerSourceOnce).toHaveBeenCalled();
  });

  it("accepts bearer token and forwards JSON options to the orchestrator", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    const POST = createSamGovRunPost({ runCrawlerSourceOnce, owner: "route_test" });

    const response = await POST(
      new Request("http://localhost/api/crawler/sam-gov/run", {
        method: "POST",
        headers: {
          authorization: "Bearer local-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          postedFrom: "05/01/2026",
          postedTo: "05/19/2026",
          limit: 50,
          maxRecords: 75,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      source: "SAM.gov",
      status: "success",
      runner: {
        ok: true,
        source: "SAM.gov",
        status: "success",
        stdout: "done",
        stderr: "",
      },
      alertMatching: {
        evaluatedAlerts: 1,
        matchedAlerts: 1,
        updatedAlerts: 1,
      },
      notification: {
        queued: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
      },
    });
    expect(runCrawlerSourceOnce).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: "SAM.gov",
        owner: "route_test",
        runnerOptions: {
          postedFrom: "05/01/2026",
          postedTo: "05/19/2026",
          limit: 50,
          maxRecords: 75,
        },
      }),
    );
    const options = runCrawlerSourceOnce.mock.calls[0][1];
    expect(options.runner).toEqual(expect.any(Function));
    expect(options.matcher).toEqual(expect.any(Function));
    expect(options.notifier).toEqual(expect.any(Function));
  });

  it("uses the notification service as the default notifier", async () => {
    const database = { db: true } as never;
    const POST = createSamGovRunPost({ runCrawlerSourceOnce, database });

    await POST(new Request("http://localhost/api/crawler/sam-gov/run"));
    const notifier = runCrawlerSourceOnce.mock.calls[0][1].notifier;
    const result = await notifier({
      source: "SAM.gov",
      runner: {
        ok: true,
        source: "SAM.gov",
        status: "success",
        stdout: "done",
        stderr: "",
      },
      alertMatching: {
        evaluatedAlerts: 1,
        matchedAlerts: 1,
        updatedAlerts: 1,
        matches: [],
      },
    });

    expect(sendMatchedAlertNotifications).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ evaluatedAlerts: 1 }),
    );
    expect(result).toEqual({
      queued: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("allows local development when no crawler token is configured", async () => {
    const POST = createSamGovRunPost({ runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));

    expect(response.status).toBe(200);
    expect(runCrawlerSourceOnce).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runnerOptions: {},
      }),
    );
  });

  it("returns conflict when the orchestrator reports a held lock", async () => {
    runCrawlerSourceOnce.mockResolvedValueOnce({
      ok: false,
      source: "SAM.gov",
      status: "locked",
      lockedBy: "worker_1",
      lockExpiresAt: "2026-05-19T00:10:00.000Z",
    });
    const POST = createSamGovRunPost({ runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "locked",
      lockedBy: "worker_1",
      lockExpiresAt: "2026-05-19T00:10:00.000Z",
    });
  });

  it("returns server error when the orchestrator reports failure", async () => {
    runCrawlerSourceOnce.mockResolvedValueOnce({
      ok: false,
      source: "SAM.gov",
      status: "failure",
      runner: {
        ok: false,
        source: "SAM.gov",
        status: "failure",
        stdout: "",
        stderr: "failed",
      },
    });
    const POST = createSamGovRunPost({ runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "failure",
      runner: {
        ok: false,
        source: "SAM.gov",
        status: "failure",
        stdout: "",
        stderr: "failed",
      },
    });
  });
});
