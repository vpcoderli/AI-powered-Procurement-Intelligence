import { execFile, type ExecFileException, type ExecFileOptions } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawlableSource } from "./source-registry";
import { buildCrawlTaskPayload, listPagesFor, runCrawlTask } from "./state-runner";

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
  it.each(["county", "city", "township", "special_district"])("preserves legacy %s identity when jurisdictionLevel is null", (issuerType) => {
    expect(buildCrawlTaskPayload(source({ issuerType, jurisdictionLevel: null }), { taskId: "legacy-local" }).jurisdiction_level)
      .toBe(issuerType);
  });
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
      limit: null,
      query: null,
      date_range: null,
      list_kind: "open",
      start_page: 1,
      max_pages: 4,
      stop_before: null,
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

  it("reads the per-source page budget from fetch_config.list_pages", () => {
    expect(listPagesFor(source({ fetchConfig: { list_pages: 8 } }))).toBe(8);
    expect(listPagesFor(source({ fetchConfig: { list_pages: 0 } }))).toBe(4);
    expect(listPagesFor(source({ fetchConfig: { list_pages: "9" } }))).toBe(4);
    expect(listPagesFor(source({ fetchConfig: { list_pages: 51 } }))).toBe(4);
    expect(buildCrawlTaskPayload(source({ fetchConfig: { list_pages: 8 } }), { taskId: "t" }).max_pages).toBe(8);
  });

  it("passes an explicit history request through", () => {
    const payload = buildCrawlTaskPayload(source(), { taskId: "t", listKind: "awarded", startPage: 5, maxPages: 2, stopBefore: "2024-09-24" });
    expect(payload).toMatchObject({ list_kind: "awarded", start_page: 5, max_pages: 2, stop_before: "2024-09-24" });
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
      // fetch_task exits 1 on exception; execFile surfaces that as a non-null error whose `code`
      // is the exit status (a number), even though stdout still carries the JSON result payload.
      callback(Object.assign(new Error("Command failed: python3 -m apsi_crawler.cli fetch-task"), { code: 1 }), stdout, "");
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

  describe("errorCode precedence", () => {
    // `fetch-task` prints a failure document and then exits 1 on EVERY exception, and Node's execFile
    // reports that as an Error whose `code` is the numeric exit status (verified against a real child:
    // `code: 1`, `killed: false`, `signal: null`, stdout intact). A spawn failure carries a string code.
    const failedWith = (code: number | string, message = "Command failed: python3 -m apsi_crawler.cli fetch-task") =>
      Object.assign(new Error(message), { code });

    function finishChild(error: ExecFileException | null, stdout: string, stderr = "") {
      mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
        callback(error, stdout, stderr);
        return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
      }) as typeof execFile);
    }

    const bidnet = () => source({ id: "bidnet_co_denver", label: "Denver, CO (BidNet)", stateCode: "CO", providerFamily: "bidnet" });
    const failureDocument = (overrides: Record<string, unknown> = {}) => ({
      source: "bidnet_co_denver",
      runId: "run_challenge",
      status: "failure",
      startedAt: "2026-09-29T00:00:00.000Z",
      finishedAt: "2026-09-29T00:00:03.000Z",
      durationMs: 3000,
      metadata: {},
      bids: [],
      errorCode: "BidNetChallengeError",
      errorMessage: "BidNet is serving an AWS WAF bot challenge (HTTP 202): the platform is temporarily rate-limiting automated access. Re-run this source later at a lower frequency — challenges are never bypassed.",
      errorStack: "Traceback (most recent call last): ...",
      taskId: "tsk_precedence",
      ...overrides,
    });

    it("keeps the failure document's own errorCode ahead of the exit status Node reports", async () => {
      const runPayload = failureDocument();
      const stdout = JSON.stringify(runPayload);
      finishChild(failedWith(1), stdout);

      const result = await runCrawlTask(bidnet(), { taskId: "tsk_precedence" });

      expect(result).toEqual({
        ok: false,
        source: "bidnet_co_denver",
        status: "failure",
        stdout,
        stderr: "",
        fetchedCount: 0,
        errorCode: "BidNetChallengeError",
        payload: runPayload,
      });
    });

    it("reports the exit status when the child exited without printing a result document", async () => {
      finishChild(failedWith(1), "not json", "Traceback (most recent call last): ImportError: No module named requests");

      const result = await runCrawlTask(source(), { taskId: "tsk_crash" });

      expect(result).toMatchObject({ ok: false, status: "failure", errorCode: "1", payload: null });
      expect(result.stderr).toContain("Traceback");
    });

    it("reports Node's own spawn error code when the interpreter cannot be started", async () => {
      finishChild(failedWith("ENOENT", "spawn python3 ENOENT"), "");

      const result = await runCrawlTask(source(), { taskId: "tsk_spawn" });

      expect(result).toMatchObject({ ok: false, status: "failure", errorCode: "ENOENT", payload: null, fetchedCount: 0 });
      expect(result.stderr).toContain("spawn python3 ENOENT");
    });

    it.each([[""], ["   "], [42], [null]])("falls back to the exit status when the document's errorCode is %j", async (errorCode) => {
      finishChild(failedWith(1), JSON.stringify(failureDocument({ errorCode })));

      const result = await runCrawlTask(bidnet(), { taskId: "tsk_unusable_code" });

      expect(result).toMatchObject({ ok: false, status: "failure", errorCode: "1" });
    });

    it("reports CrawlerOutputError when the child exited cleanly without a result document", async () => {
      finishChild(null, "");

      const result = await runCrawlTask(source(), { taskId: "tsk_silent" });

      expect(result).toMatchObject({ ok: false, status: "failure", errorCode: "CrawlerOutputError", payload: null });
    });

    it("lets a lost lease win over a structured errorCode in stdout", async () => {
      const controller = new AbortController();
      mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
        controller.abort(new Error("lease lost"));
        callback(failedWith(1), JSON.stringify(failureDocument()), "");
        return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
      }) as typeof execFile);

      const result = await runCrawlTask(bidnet(), { taskId: "tsk_lost" }, { signal: controller.signal, assertLease: async () => {} });

      expect(result).toMatchObject({ ok: false, errorCode: "CrawlerLeaseLostError", payload: null });
    });

    it("lets the task timeout win over a structured errorCode in stdout", async () => {
      finishChild(Object.assign(new Error("Command timed out"), { killed: true, signal: "SIGKILL" as const }), JSON.stringify(failureDocument()));

      const result = await runCrawlTask(bidnet(), { taskId: "tsk_timeout" });

      expect(result).toMatchObject({ ok: false, errorCode: "CrawlerTaskTimeoutError", payload: null });
    });
  });
});

describe("durable detail history contract", () => {
  it("passes persisted records and an explicit detail-only mode through the child contract", () => {
    const history = [{ id: "ca_caleprocure:old", source_bid_id: "old", raw_payload: { enrichment: { outcome: { attempted_at: "2026-09-01T00:00:00Z" } } } }];
    const options = { taskId: "backfill", detailHistory: history, detailBackfillOnly: true };
    expect(buildCrawlTaskPayload(source(), options)).toMatchObject({ detail_history: history, detail_backfill_only: true });
  });
});

describe("history loaded from persisted records", () => {
  it("loads only the exact canonical source namespace before launching Python", async () => {
    const { createTestDatabase } = await import("@/server/db/test-utils");
    const { bids } = await import("@/server/db/schema");
    const database = await createTestDatabase();
    try {
      const stored = { source: "California Cal eProcure", sourceBidId: "old", title: "Repair county roads", description: "Repair county roads", issuerName: "County", issuerType: "state", stateCode: "CA", sourceUrl: "https://caleprocure.ca.gov/bid/old", firstSeenAt: "2026-08-01", lastSeenAt: "2026-08-01", createdAt: "2026-08-01", updatedAt: "2026-08-01", rawPayload: JSON.stringify({ enrichment: { outcome: { attempted_at: "2026-09-01T00:00:00Z", attempt_count: 2 } } }) };
      database.db.insert(bids).values([
        { ...stored, id: "ca_caleprocure:old", dedupeKey: "ca_caleprocure:old" },
        { ...stored, source: "Other Source", id: "caXcaleprocure:old", dedupeKey: "caXcaleprocure:old" },
        { ...stored, id: "ca_caleprocure:bad", sourceBidId: "bad", dedupeKey: "ca_caleprocure:bad", title: "Untitled old record", firstSeenAt: "2020-01-01" },
        { ...stored, id: "ca_caleprocure:wrong", sourceBidId: "wrong", dedupeKey: "ca_caleprocure:wrong", stateCode: "NY" },
      ]).run();
      const stdinEnd = vi.fn();
      mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
        callback(null, JSON.stringify({ status: "success", bids: [] }), "");
        return { stdin: { end: stdinEnd } } as unknown as ReturnType<typeof execFile>;
      }) as typeof execFile);
      const options = { taskId: "persisted", historyStore: { database: database.db } };
      await runCrawlTask(source(), options);
      const payload = JSON.parse(stdinEnd.mock.calls[0][0]);
      expect(payload.detail_history).toHaveLength(1);
      expect(payload.detail_history[0]).toMatchObject({ id: "ca_caleprocure:old", source_bid_id: "old", source_url: stored.sourceUrl, raw_payload: { enrichment: { outcome: { attempt_count: 2 } } } });
    } finally {
      await database.cleanup();
    }
  });
});

describe("detail retry coverage fence", () => {
  it("forces partial coverage on a history-only child result", async () => {
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(null, JSON.stringify({ status: "success", bids: [], metadata: { pagination: { complete: true } } }), "");
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    }) as typeof execFile);
    const options = { taskId: "backfill-fenced", detailHistory: [], detailBackfillOnly: true };
    expect((await runCrawlTask(source(), options)).payload?.metadata).toMatchObject({ mode: "detail_backfill", pagination: { complete: false } });
  });
});
