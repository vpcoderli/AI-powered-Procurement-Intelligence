import { describe, expect, it } from "vitest";
import { checkLiveSourceHealth, formatLiveSourceHealthReport } from "./live-source-health";

function response(status: number, statusText = "OK") {
  return { status, statusText, ok: status >= 200 && status < 400 };
}

function textResponse(status: number, body: string, statusText = "OK") {
  return {
    status,
    statusText,
    ok: status >= 200 && status < 400,
    text: async () => body,
  };
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
      classification: "ok",
      httpStatus: 200,
      statusCode: 200,
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

  it("can inspect successful GET bodies for empty or access-challenge pages", async () => {
    const report = await checkLiveSourceHealth(
      [
        {
          id: "az_state_procurement",
          stateCode: "AZ",
          label: "Arizona State Procurement",
          baseUrl: "https://app.az.gov",
          sourceAuthority: "official",
          trustStatus: "beta",
        },
        {
          id: "nv_state_procurement",
          stateCode: "NV",
          label: "Nevada State Procurement",
          baseUrl: "https://purchasing.nv.gov",
          sourceAuthority: "official",
          trustStatus: "beta",
        },
      ],
      {
        inspectBody: true,
        fetchImpl: async (url, init) => {
          if (init?.method === "HEAD") return response(200) as Response;
          const target = String(url);
          if (target.includes("az.gov")) return textResponse(200, "  ") as Response;
          return textResponse(
            200,
            "<html><title>Login required</title><body>captcha verification</body></html>",
          ) as Response;
        },
      },
    );

    expect(report.ok).toBe(false);
    expect(report.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "az_state_procurement",
          status: "unhealthy",
          classification: "empty_or_placeholder",
          method: "GET",
          errorCode: "empty_body",
          recommendedAction: "browser_or_access_review",
        }),
        expect.objectContaining({
          sourceId: "nv_state_procurement",
          status: "unhealthy",
          classification: "bot_check",
          method: "GET",
          errorCode: "access_challenge",
          recommendedAction: "browser_or_access_review",
        }),
      ]),
    );
  });

  it("classifies live probe outcomes with short sanitized evidence", async () => {
    const checkedAt = new Date("2026-06-10T04:00:00.000Z");
    const sources = [
      {
        id: "ca_forbidden",
        stateCode: "CA",
        label: "California Forbidden",
        baseUrl: "https://example.test/forbidden",
        sourceAuthority: "official",
        trustStatus: "verified",
      },
      {
        id: "tx_timeout",
        stateCode: "TX",
        label: "Texas Timeout",
        baseUrl: "https://example.test/timeout",
        sourceAuthority: "official",
        trustStatus: "verified",
      },
      {
        id: "fl_bot",
        stateCode: "FL",
        label: "Florida Bot Check",
        baseUrl: "https://example.test/bot",
        sourceAuthority: "official",
        trustStatus: "verified",
      },
      {
        id: "ny_login",
        stateCode: "NY",
        label: "New York Login",
        baseUrl: "https://example.test/login",
        sourceAuthority: "official",
        trustStatus: "verified",
      },
      {
        id: "az_empty",
        stateCode: "AZ",
        label: "Arizona Empty",
        baseUrl: "https://example.test/empty",
        sourceAuthority: "official",
        trustStatus: "verified",
      },
      {
        id: "wa_ok",
        stateCode: "WA",
        label: "Washington OK",
        baseUrl: "https://example.test/ok",
        sourceAuthority: "official",
        trustStatus: "verified",
      },
    ];

    const report = await checkLiveSourceHealth(sources, {
      inspectBody: true,
      now: checkedAt,
      fetchImpl: async (url, init) => {
        const target = String(url);

        if (target.includes("timeout")) {
          throw new DOMException("The operation timed out", "AbortError");
        }

        if (init?.method === "HEAD") {
          return response(200) as Response;
        }

        if (target.includes("forbidden")) {
          return textResponse(403, "<html><body>Access denied</body></html>", "Forbidden") as Response;
        }
        if (target.includes("bot")) {
          return textResponse(
            200,
            "<html><title>Security Check</title><body>"
              + "Verify you are human before continuing. token=super-secret-value"
              + "</body></html>",
          ) as Response;
        }
        if (target.includes("login")) {
          return textResponse(
            200,
            "<html><body>Please sign in to continue with your vendor account.</body></html>",
          ) as Response;
        }
        if (target.includes("empty")) {
          return textResponse(200, "<html><body>Coming soon</body></html>") as Response;
        }

        return textResponse(200, "<html><body>Open bids and procurement notices</body></html>") as Response;
      },
    });

    expect(report.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "ca_forbidden",
          checkedAt: "2026-06-10T04:00:00.000Z",
          classification: "forbidden",
          reason: "HTTP 403 Forbidden",
          statusCode: 403,
          evidenceSnippets: expect.arrayContaining(["HTTP 403 Forbidden"]),
        }),
        expect.objectContaining({
          sourceId: "tx_timeout",
          classification: "timeout",
          reason: "Timed out while probing source.",
          statusCode: null,
        }),
        expect.objectContaining({
          sourceId: "fl_bot",
          classification: "bot_check",
          reason: "Body inspection found bot-check or CAPTCHA content.",
        }),
        expect.objectContaining({
          sourceId: "ny_login",
          classification: "login_required",
          reason: "Body inspection found login-required content.",
        }),
        expect.objectContaining({
          sourceId: "az_empty",
          classification: "empty_or_placeholder",
          reason: "HTTP success returned an empty or placeholder response body.",
        }),
        expect.objectContaining({
          sourceId: "wa_ok",
          classification: "ok",
          reason: "Source responded with usable content.",
          status: "healthy",
          statusCode: 200,
        }),
      ]),
    );

    const botResult = report.results.find((result) => result.sourceId === "fl_bot") as
      | { evidenceSnippets?: string[] }
      | undefined;
    const botEvidence = botResult?.evidenceSnippets ?? [];
    expect(botEvidence.join(" ")).toContain("Verify you are human");
    expect(botEvidence.join(" ")).not.toContain("super-secret-value");
    expect(Math.max(...botEvidence.map((snippet) => snippet.length))).toBeLessThanOrEqual(180);
  });
});
