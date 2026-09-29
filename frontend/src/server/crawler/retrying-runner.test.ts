import { describe, expect, it, vi } from "vitest";
import { classifyCrawlerFailure, shouldRetry } from "./failure-classifier";
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

  describe("HtmlPageError from the HTML fetcher", () => {
    it.each([
      ["a transport failure", "HTML request failed: HTTPSConnectionPool(host='www.bidnetdirect.com', port=443): Read timed out. (read timeout=30)"],
      ["a 500 answer", "HTML request failed with status 500: Internal Server Error"],
      ["a 503 answer", "HTML request failed with status 503: Service Unavailable"],
    ])("still retries %s up to the configured attempts", async (_what, message) => {
      const run = vi.fn(async () => failure("HtmlPageError", message));
      await retryCrawlerSourceResult(run, { maxAttempts: 4, sleep: async () => {} });
      expect(run).toHaveBeenCalledTimes(4);
    });

    it.each([
      ["a 404 answer", "HTML request failed with status 404: Not Found"],
      ["a non-HTML content type", "HTML response content type was not HTML: application/json"],
      ["an empty body", "HTML response was empty"],
      ["missing table headers", "HTML table was missing required headers: title"],
    ])("does not retry %s: the page itself came back wrong", async (_what, message) => {
      const run = vi.fn(async () => failure("HtmlPageError", message));
      await retryCrawlerSourceResult(run, { maxAttempts: 3, sleep: async () => {} });
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe("a throttled platform", () => {
    // A challenge or a rate limit is answered by the platform pause (the rest of the platform is deferred for this tick,
    // then paused), not by hitting the platform again: retrying would only turn one refusal into several.
    it.each([
      ["a 429 answer", "HTML request failed with status 429: slow down"],
      ["a 403 answer", "HTML request failed with status 403: Forbidden"],
      ["an AWS WAF 202 challenge", "HTML request failed with status 202: "],
    ])("never retries %s, although source health reads it as a network failure", async (_what, message) => {
      // The classifier alone would retry it; the throttle signature is what stops the retry.
      expect(shouldRetry(classifyCrawlerFailure({ errorCode: "HtmlPageError", errorMessage: message }))).toBe(true);

      const run = vi.fn(async () => failure("HtmlPageError", message));
      await retryCrawlerSourceResult(run, { maxAttempts: 3, sleep: async () => {} });

      expect(run).toHaveBeenCalledTimes(1);
    });

    it("never retries a BidNet challenge", async () => {
      const run = vi.fn(async () => failure("BidNetChallengeError", "BidNet is serving an AWS WAF bot challenge (HTTP 202): the platform is temporarily rate-limiting automated access."));
      await retryCrawlerSourceResult(run, { maxAttempts: 3, sleep: async () => {} });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("stops retrying as soon as an attempt comes back throttled, and returns that result", async () => {
      const answers = [
        failure("HtmlPageError", "HTML request failed with status 503: Service Unavailable"),
        failure("HtmlPageError", "HTML request failed with status 429: slow down"),
        failure("HtmlPageError", "HTML request failed with status 503: Service Unavailable"),
      ];
      let attempt = 0;
      const run = vi.fn(async () => answers[attempt++]);

      const result = await retryCrawlerSourceResult(run, { maxAttempts: 3, sleep: async () => {} });

      expect(run).toHaveBeenCalledTimes(2);
      expect(result).toBe(answers[1]);
    });
  });
});
