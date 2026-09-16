import { execFile, type ExecFileException, type ExecFileOptions } from "node:child_process";
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
    vi.unstubAllEnvs();
  });

  it("uses configured runtime paths and a finite hard timeout", async () => {
    vi.stubEnv("CRAWLER_PYTHON_BIN", "/opt/crawler/bin/python");
    vi.stubEnv("CRAWLER_DIRECTORY", "/crawler");
    vi.stubEnv("CRAWLER_TASK_TIMEOUT_MS", "1234");
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error("Command timed out"), { killed: true, signal: "SIGKILL" as const }), "", "");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);
    const result = await runCrawlTask(source(), { taskId: "timed" });
    expect(mockedExecFile).toHaveBeenCalledWith("/opt/crawler/bin/python", expect.any(Array), expect.objectContaining({ cwd: "/crawler", timeout: 1234, killSignal: "SIGKILL" }), expect.any(Function));
    expect(result).toMatchObject({ ok: false, errorCode: "CrawlerTaskTimeoutError", payload: null });
    expect(result.stderr).toContain("timed out");
  });

  it("forwards cancellation to the child and never exposes success after lease loss", async () => {
    const controller = new AbortController();
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort(new Error("lease lost"));
      callback(null, JSON.stringify({ status: "success", bids: [] }), "");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);
    const result = await runCrawlTask(source(), { taskId: "lost" }, { signal: controller.signal, assertLease: async () => {} });
    expect(result).toMatchObject({ ok: false, errorCode: "CrawlerLeaseLostError", payload: null });
  });

  it("never exposes a success payload when the child exited non-zero", async () => {
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      // e.g. stdout was truncated by maxBuffer after a success document was flushed, or the
      // interpreter died on exit; the process contract says exit code and status move together.
      callback(Object.assign(new Error("Command failed: exit code 1"), { code: 1 }), JSON.stringify({ status: "success", runId: "r", bids: [{ id: "bid_1" }], metadata: { mode: "live" } }), "Traceback");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);
    const result = await runCrawlTask(source(), { taskId: "exit1" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failure");
    expect(result.payload).toMatchObject({ status: "failure", bids: [], errorCode: "1", metadata: { mode: "live", fetchedBeforeProcessFailure: 1 } });
  });

  it("writes the JSON task payload to the child's stdin and closes it", async () => {
    const stdinEnd = vi.fn();
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
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
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
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
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
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
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(new Error("Command failed with exit code 1"), "not json", "traceback");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runCrawlTask(source(), { taskId: "tsk_unparseable" });

    expect(result.payload).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.status).toBe("failure");
  });

  it("reads a stdout payload larger than Node's default 1 MiB execFile buffer", async () => {
    // Enrichment writes `description` + `full_description` (each capped at 20 000 chars) for up
    // to 200 records per run, so a real fetch-task stdout can easily exceed the 1 MiB default
    // `maxBuffer`. When it does, Node SIGTERMs the child and hands back TRUNCATED stdout plus
    // ERR_CHILD_PROCESS_STDIO_MAXBUFFER — JSON.parse then throws and the whole run is recorded
    // as a failure with zero bids. The mock below reproduces exactly that Node behaviour so the
    // explicit maxBuffer on the execFile options is what keeps this test green.
    const bid = { id: "bid_big", description: "x".repeat(20_000), fullDescription: "y".repeat(20_000) };
    const runPayload = {
      source: "ca_caleprocure",
      runId: "run_big",
      status: "success",
      startedAt: "2026-09-15T00:00:00.000Z",
      finishedAt: "2026-09-15T00:00:01.000Z",
      durationMs: 1000,
      metadata: {},
      bids: Array.from({ length: 30 }, (_, index) => ({ ...bid, id: `bid_${index}` })),
      errorCode: null,
      errorMessage: null,
      errorStack: null,
      taskId: "tsk_big",
    };
    const stdout = JSON.stringify(runPayload);
    expect(Buffer.byteLength(stdout)).toBeGreaterThan(1024 * 1024);

    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      const maxBuffer = (options as { maxBuffer?: number }).maxBuffer ?? 1024 * 1024;
      if (Buffer.byteLength(stdout) > maxBuffer) {
        const error = Object.assign(new Error("stdout maxBuffer length exceeded"), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
        callback(error, stdout.slice(0, maxBuffer), "");
      } else {
        callback(null, stdout, "");
      }
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runCrawlTask(source(), { taskId: "tsk_big" });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("success");
    expect(result.fetchedCount).toBe(30);
    expect(result.payload).toEqual(runPayload);
  });

  it("sets payload to null when stdout parses but carries no status field", async () => {
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(null, JSON.stringify({ unrelated: true }), "");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runCrawlTask(source(), { taskId: "tsk_no_status" });

    expect(result.payload).toBeNull();
  });
});
