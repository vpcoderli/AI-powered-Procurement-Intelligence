import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawlableSource } from "./source-registry";
import { buildCrawlTaskPayload, runCrawlTask } from "./state-runner";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

function source(overrides: Partial<CrawlableSource> = {}): CrawlableSource {
  return {
    id: "ca_caleprocure",
    label: "California Cal eProcure",
    issuerType: "state",
    stateCode: "CA",
    baseUrl: "https://caleprocure.ca.gov",
    cadence: "daily",
    providerFamily: null,
    jurisdictionLevel: "state",
    jurisdictionName: "California",
    fipsCode: "06",
    fetchConfig: { base_url: "https://caleprocure.ca.gov" },
    lastSuccessAt: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("buildCrawlTaskPayload", () => {
  it("carries source identity and fetch config into the contract", () => {
    const payload = buildCrawlTaskPayload(source(), { taskId: "tsk_1" });
    expect(payload).toEqual({
      task_id: "tsk_1",
      source_id: "ca_caleprocure",
      label: "California Cal eProcure",
      state_code: "CA",
      provider_family: null,
      jurisdiction_level: "state",
      fetch_config: { base_url: "https://caleprocure.ca.gov" },
      limit: 25,
      query: null,
      date_range: null,
    });
  });

  it("carries a published-date window into date_range when options provide one", () => {
    const payload = buildCrawlTaskPayload(source(), {
      taskId: "tsk_win",
      postedFrom: "2026-08-01",
      postedTo: "2026-08-21",
    });
    expect(payload.date_range).toEqual({ from: "2026-08-01", to: "2026-08-21" });
  });

  it("supports open-ended windows (from-only and to-only)", () => {
    expect(
      buildCrawlTaskPayload(source(), { taskId: "tsk_from", postedFrom: "2026-08-01" }).date_range,
    ).toEqual({ from: "2026-08-01", to: null });
    expect(
      buildCrawlTaskPayload(source(), { taskId: "tsk_to", postedTo: "2026-08-21" }).date_range,
    ).toEqual({ from: null, to: "2026-08-21" });
  });

  it("defaults fetch_config.base_url from the source base URL when absent", () => {
    const payload = buildCrawlTaskPayload(source({ fetchConfig: {} }), { taskId: "tsk_2" });
    expect(payload.fetch_config).toEqual({ base_url: "https://caleprocure.ca.gov" });
  });

  it("honours explicit limit and query", () => {
    const payload = buildCrawlTaskPayload(source(), { taskId: "tsk_3", limit: 5, query: "road" });
    expect(payload.limit).toBe(5);
    expect(payload.query).toBe("road");
  });

  it("omits fetch_config.base_url when neither fetchConfig nor the source carry one", () => {
    // Both fetchConfig.base_url and source.baseUrl absent — a real state for rows the
    // registry has not backfilled yet (source-registry.ts maps an unset DB baseUrl to
    // null). We do not fabricate a URL: the Python side (task_source_from_payload)
    // falls back to base_url="" in this case, which makes the fetch fail loudly through
    // the normal empty-result path instead of silently pointing at a wrong host.
    const payload = buildCrawlTaskPayload(source({ fetchConfig: {}, baseUrl: null }), {
      taskId: "tsk_4",
    });
    expect(payload.fetch_config).toEqual({});
    expect(payload.fetch_config.base_url).toBeUndefined();
  });
});

describe("runCrawlTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the JSON task payload to the child's stdin and closes it", async () => {
    const stdinEnd = vi.fn();
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ status: "success", bids: [], errorCode: null }), "");
      return { stdin: { end: stdinEnd } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const testSource = source();
    const options = { taskId: "tsk_stdin" };
    await runCrawlTask(testSource, options);

    expect(stdinEnd).toHaveBeenCalledTimes(1);
    expect(stdinEnd).toHaveBeenCalledWith(
      JSON.stringify(buildCrawlTaskPayload(testSource, options)),
    );
  });

  it("maps a successful camelCase stdout payload to a CrawlTaskResult", async () => {
    const runPayload = {
      source: "ca_caleprocure",
      runId: "run_success",
      status: "success",
      startedAt: "2026-07-29T00:00:00.000Z",
      finishedAt: "2026-07-29T00:00:01.000Z",
      durationMs: 1000,
      metadata: {},
      bids: [{ id: "bid_1" }, { id: "bid_2" }],
      errorCode: null,
      errorMessage: null,
      errorStack: null,
      taskId: "tsk_success",
    };
    const stdout = JSON.stringify(runPayload);
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, stdout, "");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runCrawlTask(source(), { taskId: "tsk_success" });

    expect(result).toEqual({
      ok: true,
      source: "ca_caleprocure",
      status: "success",
      stdout,
      stderr: "",
      fetchedCount: 2,
      errorCode: null,
      payload: runPayload,
    });
  });

  it("maps a failure camelCase stdout payload to a CrawlTaskResult, preserving errorCode", async () => {
    const runPayload = {
      source: "ca_caleprocure",
      runId: "run_failure",
      status: "failure",
      startedAt: "2026-07-29T00:00:00.000Z",
      finishedAt: "2026-07-29T00:00:01.000Z",
      durationMs: 500,
      metadata: {},
      bids: [],
      errorCode: "EmptyCrawlerResultError",
      errorMessage: "No bids found",
      errorStack: "Traceback (most recent call last): ...",
      taskId: "tsk_failure",
    };
    const stdout = JSON.stringify(runPayload);
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      // fetch_task exits 1 on exception; execFile surfaces that as a non-null error
      // even though stdout still carries the JSON result payload.
      callback(new Error("Command failed with exit code 1"), stdout, "");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runCrawlTask(source(), { taskId: "tsk_failure" });

    expect(result).toEqual({
      ok: false,
      source: "ca_caleprocure",
      status: "failure",
      stdout,
      stderr: "",
      fetchedCount: 0,
      errorCode: "EmptyCrawlerResultError",
      payload: runPayload,
    });
  });

  it("sets payload to null when stdout is not valid JSON", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(new Error("Command failed with exit code 1"), "not json", "traceback");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runCrawlTask(source(), { taskId: "tsk_unparseable" });

    expect(result.payload).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failure");
  });

  it("sets payload to null when stdout parses but carries no status field", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ unrelated: true }), "");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runCrawlTask(source(), { taskId: "tsk_no_status" });

    expect(result.payload).toBeNull();
  });
});
