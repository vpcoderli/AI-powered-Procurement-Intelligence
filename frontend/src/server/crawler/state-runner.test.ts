import { execFile } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importCrawlerJsonRunIntoMysql } from "./mysql-json-importer";
import type { CrawlableSource } from "./source-registry";
import {
  STATE_CRAWLER_SOURCES,
  buildCrawlTaskPayload,
  createStateCrawlerRunner,
  runCrawlTask,
  runStateCrawler,
} from "./state-runner";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));
vi.mock("./mysql-json-importer", () => ({
  importCrawlerJsonRunIntoMysql: vi.fn(async () => ({
    fetchedCount: 1,
    insertedCount: 1,
    updatedCount: 0,
    logCount: 1,
  })),
}));

const mockedExecFile = vi.mocked(execFile);
const mockedImportCrawlerJsonRunIntoMysql = vi.mocked(importCrawlerJsonRunIntoMysql);

const mysqlJsonPayload = JSON.stringify({
  source: "il_bidbuy",
  runId: "run_1",
  status: "success",
  startedAt: "2026-06-01T00:00:00.000Z",
  finishedAt: "2026-06-01T00:00:01.000Z",
  durationMs: 1000,
  metadata: {},
  bids: [
    {
      id: "il_bid_1",
      source: "il_bidbuy",
      source_bid_id: "IL-1",
      dedupe_key: "il_bidbuy:IL-1",
      title: "Illinois bid",
      description: "Illinois bid description",
      issuer_name: "Illinois Agency",
      issuer_type: "state",
      state_code: "IL",
      source_url: "https://example.com/il-1",
    },
  ],
});

describe("state crawler runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists the supported state crawler sources in run order", () => {
    expect(STATE_CRAWLER_SOURCES).toHaveLength(50);
    expect(STATE_CRAWLER_SOURCES.map((source) => source.id)).toEqual([
      "al_state_procurement",
      "ak_state_procurement",
      "az_state_procurement",
      "ar_state_procurement",
      "ca_caleprocure",
      "co_state_procurement",
      "ct_state_procurement",
      "de_state_procurement",
      "fl_mfmp",
      "ga_state_procurement",
      "hi_state_procurement",
      "id_state_procurement",
      "il_bidbuy",
      "in_state_procurement",
      "ia_state_procurement",
      "ks_state_procurement",
      "ky_state_procurement",
      "la_state_procurement",
      "me_state_procurement",
      "md_state_procurement",
      "ma_state_procurement",
      "mi_state_procurement",
      "mn_state_procurement",
      "ms_state_procurement",
      "mo_state_procurement",
      "mt_state_procurement",
      "ne_state_procurement",
      "nv_state_procurement",
      "nh_state_procurement",
      "nj_state_procurement",
      "nm_state_procurement",
      "ny_contract_reporter",
      "nc_state_procurement",
      "nd_state_procurement",
      "oh_state_procurement",
      "ok_state_procurement",
      "or_state_procurement",
      "pa_state_procurement",
      "ri_state_procurement",
      "sc_state_procurement",
      "sd_state_procurement",
      "tn_state_procurement",
      "tx_esbd",
      "ut_state_procurement",
      "vt_state_procurement",
      "va_state_procurement",
      "wa_state_procurement",
      "wv_state_procurement",
      "wi_state_procurement",
      "wy_state_procurement",
    ]);
  });

  it("starts the Python fetch-state crawler with source, query, limit, and database path", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runStateCrawler({
      source: "il_bidbuy",
      query: "data",
      limit: 25,
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(result).toEqual({
      ok: true,
      source: "il_bidbuy",
      status: "success",
      stdout: "done",
      stderr: "",
    });
    expect(mockedExecFile).toHaveBeenCalledWith(
      "python3",
      [
        "-m",
        "apsi_crawler.cli",
        "fetch-state",
        "--database",
        "/tmp/apsi.sqlite",
        "--source",
        "il_bidbuy",
        "--limit",
        "25",
        "--query",
        "data",
        "--archive-documents",
        "--archive-dir",
        path.resolve(process.cwd(), "data", "attachments"),
      ],
      expect.objectContaining({
        cwd: path.resolve(process.cwd(), "..", "crawler"),
      }),
      expect.any(Function),
    );
  });

  it("omits query when it is empty", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await runStateCrawler({
      source: "ca_caleprocure",
      limit: 10,
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(mockedExecFile.mock.calls[0][1]).toEqual([
      "-m",
      "apsi_crawler.cli",
      "fetch-state",
      "--database",
      "/tmp/apsi.sqlite",
      "--source",
      "ca_caleprocure",
      "--limit",
      "10",
      "--archive-documents",
      "--archive-dir",
      path.resolve(process.cwd(), "data", "attachments"),
    ]);
  });

  it("passes fixture fallback flag when enabled", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await runStateCrawler({
      source: "ny_contract_reporter",
      allowFixtureFallback: true,
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(mockedExecFile.mock.calls[0][1]).toContain("--fallback-fixture");
  });

  it("passes archive document options by default", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await runStateCrawler({
      source: "il_bidbuy",
      databasePath: "/tmp/apsi.sqlite",
      archiveDir: "/tmp/attachments",
    });

    expect(mockedExecFile.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--archive-documents", "--archive-dir", "/tmp/attachments"]),
    );
  });

  it("can disable archive document options for tests and dry runs", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await runStateCrawler({
      source: "il_bidbuy",
      databasePath: "/tmp/apsi.sqlite",
      archiveDocuments: false,
    });

    expect(mockedExecFile.mock.calls[0][1]).not.toContain("--archive-documents");
  });

  it("returns failure metadata when the Python crawler exits with an error", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(new Error("crawler failed"), "", "trace");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runStateCrawler({
      source: "tx_esbd",
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(result).toEqual({
      ok: false,
      source: "tx_esbd",
      status: "failure",
      stdout: "",
      stderr: "trace",
    });
  });

  it("creates a source-specific runner for the orchestrator", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const runner = createStateCrawlerRunner("fl_mfmp");
    const result = await runner({ limit: 5, databasePath: "/tmp/apsi.sqlite" });

    expect(result.source).toBe("fl_mfmp");
    expect(mockedExecFile.mock.calls[0][1]).toContain("fl_mfmp");
  });

  it("runs the Python crawler in JSON mode and imports directly into MySQL when MySQL is configured", async () => {
    vi.stubEnv("MYSQL_DATABASE_URL", "mysql://user:pass@127.0.0.1:3306/winbids");
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, mysqlJsonPayload, "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await expect(runStateCrawler({
      source: "il_bidbuy",
      limit: 5,
    })).resolves.toMatchObject({
      ok: true,
      status: "success",
    });

    const args = mockedExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("--output-json");
    expect(args).not.toContain("--database");
    expect(mockedImportCrawlerJsonRunIntoMysql).toHaveBeenCalledWith(expect.anything(), JSON.parse(mysqlJsonPayload));
  });
});

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
    });
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
    const stdout = JSON.stringify({
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
    });
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
    });
  });

  it("maps a failure camelCase stdout payload to a CrawlTaskResult, preserving errorCode", async () => {
    const stdout = JSON.stringify({
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
    });
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
    });
  });
});
