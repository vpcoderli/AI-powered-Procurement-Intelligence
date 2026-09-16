import { describe, expect, it, vi } from "vitest";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { retryCrawlerSourceResult } from "./retrying-runner";

function failure(errorCode: string, errorMessage = ""): RunCrawlerSourceOnceResult {
  return { ok: false, source: "source", status: "failure", runner: { ok: false, source: "source", status: "failure", stdout: "", stderr: "", errorCode, payload: { errorMessage } } };
}

describe("crawler retries", () => {
  it.each(["HtmlPageError", "EmptyCrawlerResultError", "CrawlerPersistenceError", "CrawlerLeaseLostError", "Error"])("does not retry %s", async (code) => {
    const run = vi.fn(async () => failure(code));
    await retryCrawlerSourceResult(run, { maxAttempts: 3, sleep: async () => {} });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([["HTTPError", "503 Service Unavailable"], ["ReadTimeout", ""], ["ECONNRESET", ""]])("retries structured transient failure %s %s", async (code, message) => {
    const run = vi.fn(async () => failure(code, message));
    await retryCrawlerSourceResult(run, { maxAttempts: 3, sleep: async () => {} });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("treats a platform deferral as terminal — the whole platform is throttled, retrying makes it worse", async () => {
    const deferred = vi.fn(
      async (): Promise<RunCrawlerSourceOnceResult> => ({
        ok: false,
        source: "bidnet_ny_erie",
        status: "deferred",
        reason: "platform_throttled:bidnet_co_denver",
      }),
    );

    await expect(retryCrawlerSourceResult(deferred, { maxAttempts: 3, sleep: async () => {} })).resolves.toMatchObject({
      status: "deferred",
    });
    expect(deferred).toHaveBeenCalledTimes(1);
  });

  it("does not retry HTTP 403 or a successful ingestion with notification errors", async () => {
    const denied = vi.fn(async () => failure("HTTPError", "403 Forbidden"));
    await retryCrawlerSourceResult(denied, { maxAttempts: 3, sleep: async () => {} });
    expect(denied).toHaveBeenCalledTimes(1);
    const ingested = vi.fn(async (): Promise<RunCrawlerSourceOnceResult> => ({ ok: true, source: "source", status: "success", runner: { ok: true, source: "source", status: "success", stdout: "", stderr: "" }, alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }, notification: { queued: 0, sent: 0, skipped: 0, failed: 0 }, postProcessingErrors: [{ stage: "notifier", message: "network failed" }] }));
    await retryCrawlerSourceResult(ingested, { maxAttempts: 3 });
    expect(ingested).toHaveBeenCalledTimes(1);
  });
});
