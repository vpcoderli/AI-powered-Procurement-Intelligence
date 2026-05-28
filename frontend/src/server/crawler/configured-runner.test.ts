import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import type { RunCrawlerSourceOnceOptions } from "./orchestrator";
import {
  CONFIGURED_CRAWLER_SOURCES,
  parseStateCrawlerLimit,
  runConfiguredCrawlerSourcesOnce,
} from "./configured-runner";

describe("configured crawler runner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs SAM.gov first, then configured state sources", async () => {
    const calls: RunCrawlerSourceOnceOptions<unknown>[] = [];
    const runCrawlerSourceOnce = vi.fn(async (_db, options) => {
      calls.push(options);
      return successResult(options.source);
    });

    const results = await runConfiguredCrawlerSourcesOnce({
      database: {} as AppDatabase,
      owner: "test-owner",
      runCrawlerSourceOnce,
    });

    expect(results).toHaveLength(51);
    expect(results[0].source).toBe("SAM.gov");
    expect(results.slice(1).map((result) => result.source)).toEqual(
      CONFIGURED_CRAWLER_SOURCES.slice(1).map((source) => source.source),
    );
    expect(calls.map((call) => call.source)).toEqual(
      CONFIGURED_CRAWLER_SOURCES.map((source) => source.source),
    );
  });

  it("continues after one source fails", async () => {
    const runCrawlerSourceOnce = vi.fn(async (_db, options) => {
      if (options.source === "tx_esbd") {
        return failureResult(options.source);
      }
      return successResult(options.source);
    });

    const results = await runConfiguredCrawlerSourcesOnce({
      database: {} as AppDatabase,
      owner: "test-owner",
      runCrawlerSourceOnce,
    });

    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(51);
    expect(results.find((result) => result.source === "tx_esbd")?.status).toBe("failure");
    expect(results.at(-1)?.source).toBe("wy_state_procurement");
  });

  it("passes configured state limit to state runners only", async () => {
    const calls: RunCrawlerSourceOnceOptions<unknown>[] = [];
    const runCrawlerSourceOnce = vi.fn(async (_db, options) => {
      calls.push(options);
      return successResult(options.source);
    });

    await runConfiguredCrawlerSourcesOnce({
      database: {} as AppDatabase,
      owner: "test-owner",
      stateRunnerOptions: { limit: 7 },
      runCrawlerSourceOnce,
    });

    expect(calls[0].runnerOptions).toBeUndefined();
    expect(calls.slice(1)).toHaveLength(50);
    expect(calls.slice(1).map((call) => call.runnerOptions)).toEqual(
      Array.from({ length: 50 }, () => ({ limit: 7 })),
    );
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

function successResult(source: string) {
  return {
    ok: true as const,
    source,
    status: "success" as const,
    runner: { ok: true, source, status: "success" as const, stdout: "", stderr: "" },
    alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] },
    notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
  };
}

function failureResult(source: string) {
  return {
    ok: false as const,
    source,
    status: "failure" as const,
    runner: { ok: false, source, status: "failure" as const, stdout: "", stderr: "failed" },
  };
}
