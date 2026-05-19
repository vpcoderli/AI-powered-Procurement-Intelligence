import { beforeEach, describe, expect, it, vi } from "vitest";
import * as runner from "@/server/crawler/sam-gov-runner";
import { createSamGovRunPost } from "./route";

vi.mock("@/server/crawler/sam-gov-runner", () => ({
  runSamGovCrawler: vi.fn(),
}));

const runSamGovCrawler = vi.mocked(runner.runSamGovCrawler);

describe("POST /api/crawler/sam-gov/run", () => {
  const matchEnabledSearchAlerts = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    runSamGovCrawler.mockResolvedValue({
      ok: true,
      source: "SAM.gov",
      status: "success",
      stdout: "done",
      stderr: "",
    });
    matchEnabledSearchAlerts.mockResolvedValue({
      evaluatedAlerts: 1,
      matchedAlerts: 1,
      updatedAlerts: 1,
    });
  });

  it("requires crawler token when configured", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    const POST = createSamGovRunPost(runSamGovCrawler, matchEnabledSearchAlerts);

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Crawler run token is required.",
    });
    expect(runSamGovCrawler).not.toHaveBeenCalled();
  });

  it("accepts bearer token and forwards JSON options to the runner", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    const POST = createSamGovRunPost(runSamGovCrawler, matchEnabledSearchAlerts);

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
      stdout: "done",
      stderr: "",
      alertMatching: {
        evaluatedAlerts: 1,
        matchedAlerts: 1,
        updatedAlerts: 1,
      },
    });
    expect(runSamGovCrawler).toHaveBeenCalledWith({
      postedFrom: "05/01/2026",
      postedTo: "05/19/2026",
      limit: 50,
      maxRecords: 75,
    });
  });

  it("allows local development when no crawler token is configured", async () => {
    const POST = createSamGovRunPost(runSamGovCrawler, matchEnabledSearchAlerts);

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));

    expect(response.status).toBe(200);
    expect(runSamGovCrawler).toHaveBeenCalledWith({});
  });

  it("does not match alerts when the crawler run fails", async () => {
    runSamGovCrawler.mockResolvedValueOnce({
      ok: false,
      source: "SAM.gov",
      status: "failure",
      stdout: "",
      stderr: "failed",
    });
    const POST = createSamGovRunPost(runSamGovCrawler, matchEnabledSearchAlerts);

    const response = await POST(new Request("http://localhost/api/crawler/sam-gov/run"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "failure",
      stdout: "",
      stderr: "failed",
    });
    expect(matchEnabledSearchAlerts).not.toHaveBeenCalled();
  });
});
