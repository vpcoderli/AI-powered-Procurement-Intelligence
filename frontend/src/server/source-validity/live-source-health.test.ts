import { describe, expect, it } from "vitest";
import { checkLiveSourceHealth, formatLiveSourceHealthReport } from "./live-source-health";

function response(status: number, statusText = "OK") {
  return { status, statusText, ok: status >= 200 && status < 400 };
}

describe("live source health", () => {
  it("checks source base URLs with HEAD and summarizes healthy sources", async () => {
    const report = await checkLiveSourceHealth(
      [
        {
          id: "ca_caleprocure",
          stateCode: "CA",
          label: "California Cal eProcure",
          baseUrl: "https://caleprocure.ca.gov",
          sourceAuthority: "official",
          trustStatus: "verified",
        },
      ],
      {
        fetchImpl: async () => response(200) as Response,
      },
    );

    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({
      total: 1,
      healthy: 1,
      unhealthy: 0,
      skipped: 0,
    });
    expect(report.results[0]).toMatchObject({
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      status: "healthy",
      httpStatus: 200,
      method: "HEAD",
    });
  });

  it("falls back to GET when HEAD is not supported", async () => {
    const methods: string[] = [];

    const report = await checkLiveSourceHealth(
      [
        {
          id: "tx_esbd",
          stateCode: "TX",
          label: "Texas ESBD",
          baseUrl: "https://www.txsmartbuy.gov/esbd",
          sourceAuthority: "official",
          trustStatus: "verified",
        },
      ],
      {
        fetchImpl: async (_url, init) => {
          methods.push(init?.method ?? "GET");
          return (init?.method === "HEAD" ? response(405, "Method Not Allowed") : response(200)) as Response;
        },
      },
    );

    expect(methods).toEqual(["HEAD", "GET"]);
    expect(report.ok).toBe(true);
    expect(report.results[0]).toMatchObject({
      status: "healthy",
      httpStatus: 200,
      method: "GET",
    });
  });

  it("reports unhealthy sources without throwing when fetch fails", async () => {
    const report = await checkLiveSourceHealth(
      [
        {
          id: "mi_state_procurement",
          stateCode: "MI",
          label: "Michigan State Procurement",
          baseUrl: "https://www.michigan.gov/dtmb/procurement",
          sourceAuthority: "public_aggregator",
          trustStatus: "fallback",
        },
      ],
      {
        fetchImpl: async () => {
          throw new Error("network blocked");
        },
      },
    );

    expect(report.ok).toBe(false);
    expect(report.summary.unhealthy).toBe(1);
    expect(report.results[0]).toMatchObject({
      status: "unhealthy",
      errorCode: "fetch_error",
    });
    expect(formatLiveSourceHealthReport(report)).toContain("FAIL MI mi_state_procurement");
  });

  it("classifies live failures into operator actions", async () => {
    const report = await checkLiveSourceHealth(
      [
        {
          id: "oh_state_procurement",
          stateCode: "OH",
          label: "Ohio State Procurement",
          baseUrl: "https://old.example.invalid",
          sourceAuthority: "official",
          trustStatus: "beta",
        },
        {
          id: "ca_caleprocure",
          stateCode: "CA",
          label: "California Cal eProcure",
          baseUrl: "https://caleprocure.ca.gov",
          sourceAuthority: "official",
          trustStatus: "verified",
        },
        {
          id: "al_state_procurement",
          stateCode: "AL",
          label: "Alabama State Procurement",
          baseUrl: "https://purchasing.alabama.gov",
          sourceAuthority: "public_aggregator",
          trustStatus: "fallback",
        },
      ],
      {
        fetchImpl: async (url) => {
          const target = String(url);
          if (target.includes("old.example.invalid")) return response(404, "Not Found") as Response;
          if (target.includes("caleprocure")) return response(403, "Forbidden") as Response;
          throw new Error("This operation was aborted");
        },
      },
    );

    expect(report.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "oh_state_procurement",
          operationalSeverity: "critical",
          recommendedAction: "update_registry_url",
        }),
        expect.objectContaining({
          sourceId: "ca_caleprocure",
          operationalSeverity: "warning",
          recommendedAction: "browser_or_access_review",
        }),
        expect.objectContaining({
          sourceId: "al_state_procurement",
          operationalSeverity: "warning",
          recommendedAction: "retry_or_increase_timeout",
        }),
      ]),
    );
    expect(formatLiveSourceHealthReport(report)).toContain("action=update_registry_url severity=critical");
  });
});
