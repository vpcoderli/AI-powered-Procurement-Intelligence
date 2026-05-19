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
    expect(STATE_CRAWLER_SOURCES.map((source) => source.id)).toEqual([
      "ca_caleprocure",
      "tx_esbd",
      "ny_contract_reporter",
      "fl_mfmp",
      "il_bidbuy",
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
