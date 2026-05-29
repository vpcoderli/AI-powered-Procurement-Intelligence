import { execFile } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STATE_CRAWLER_SOURCES, createStateCrawlerRunner, runStateCrawler } from "./state-runner";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

describe("state crawler runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
