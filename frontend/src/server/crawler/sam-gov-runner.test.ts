import { execFile, type ExecFileException, type ExecFileOptions } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { bids, crawlerLogs } from "@/server/db/schema";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import { CrawlerLeaseLostError } from "./execution-context";
import { importCrawlerJsonRunIntoMysql } from "./mysql-json-importer";
import { runSamGovCrawler } from "./sam-gov-runner";

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
  source: "SAM.gov",
  runId: "run_1",
  status: "success",
  startedAt: "2026-06-01T00:00:00.000Z",
  finishedAt: "2026-06-01T00:00:01.000Z",
  durationMs: 1000,
  metadata: {},
  bids: [
    {
      id: "sam_bid_1",
      source: "SAM.gov",
      source_bid_id: "SAM-1",
      dedupe_key: "SAM.gov:SAM-1",
      title: "SAM bid",
      description: "SAM bid description",
      issuer_name: "Federal Agency",
      issuer_type: "federal",
      state_code: "US",
      source_url: "https://sam.gov/opp/SAM-1",
    },
  ],
});

describe("SAM.gov crawler runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves a transaction lease failure as a nonretryable lease result", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@127.0.0.1:3306/test");
    mockedImportCrawlerJsonRunIntoMysql.mockRejectedValueOnce(new CrawlerLeaseLostError());
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(null, mysqlJsonPayload, "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);
    const result = await runSamGovCrawler({}, { signal: new AbortController().signal, assertLease: async () => {} });
    expect(result).toMatchObject({ ok: false, status: "failure", errorCode: "CrawlerLeaseLostError" });
  });

  it("passes its transaction lease fence to the MySQL importer", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@127.0.0.1:3306/test");
    const signal = new AbortController().signal;
    const lease = { source: "sam_gov", owner: "unique_attempt", now: () => "2026-09-15T00:00:00.000Z", signal };
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(null, mysqlJsonPayload, "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);
    expect((await runSamGovCrawler({}, { signal, lease, assertLease: async () => {} })).ok).toBe(true);
    expect(mockedImportCrawlerJsonRunIntoMysql.mock.calls[0][2]).toBe(lease);
  });

  it("never exposes the live SQLite database to a managed child that loses its lease", async () => {
    const database = await createTestDatabase();
    const controller = new AbortController();
    const assertLease = vi.fn(async () => { throw new CrawlerLeaseLostError(); });
    try {
      mockedExecFile.mockImplementationOnce(((_command: string, args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
        // Simulate the existing Python CLI: --database writes before the parent sees stdout.
        if (args.includes("--database")) importCrawlerJsonRunIntoSqlite(database.db, JSON.parse(mysqlJsonPayload));
        controller.abort(new CrawlerLeaseLostError());
        callback(null, mysqlJsonPayload, "");
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);
      const result = await runSamGovCrawler({ databasePath: database.databasePath }, { signal: controller.signal, assertLease });
      expect(result).toMatchObject({ ok: false, errorCode: "CrawlerLeaseLostError" });
      expect(database.db.select().from(bids).all()).toEqual([]);
      expect(mockedExecFile.mock.calls[0][1]).toContain("--output-json");
      expect(mockedExecFile.mock.calls[0][1]).not.toContain("--database");
    } finally {
      await database.cleanup();
    }
  });

  it("imports managed SQLite output only after checking the lease", async () => {
    const database = await createTestDatabase();
    const assertLease = vi.fn(async () => {
      expect(database.db.select().from(bids).all()).toEqual([]);
    });
    try {
      mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
        callback(null, mysqlJsonPayload, "");
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);
      const result = await runSamGovCrawler({ databasePath: database.databasePath }, { signal: new AbortController().signal, assertLease });
      expect(result.ok).toBe(true);
      expect(assertLease).toHaveBeenCalledTimes(1);
      expect(database.db.select().from(bids).all()).toHaveLength(1);
      expect(database.db.select().from(crawlerLogs).all()).toHaveLength(1);
    } finally {
      await database.cleanup();
    }
  });

  it("uses configured runtime and timeout, and skips MySQL import after cancellation", async () => {
    vi.stubEnv("CRAWLER_PYTHON_BIN", "/opt/python");
    vi.stubEnv("CRAWLER_DIRECTORY", "/crawler");
    vi.stubEnv("CRAWLER_TASK_TIMEOUT_MS", "1234");
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@127.0.0.1:3306/test");
    const controller = new AbortController();
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      callback(null, mysqlJsonPayload, "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);
    const result = await runSamGovCrawler({}, { signal: controller.signal, assertLease: async () => { throw new Error("lease lost"); } });
    expect(mockedExecFile.mock.calls[0][0]).toBe("/opt/python");
    const runtime = mockedExecFile.mock.calls[0][2] as ExecFileOptions;
    expect({ cwd: runtime.cwd, timeout: runtime.timeout, killSignal: runtime.killSignal }).toEqual({ cwd: "/crawler", timeout: 1234, killSignal: "SIGKILL" });
    expect(result).toMatchObject({ ok: false, errorCode: "CrawlerLeaseLostError" });
    expect(mockedImportCrawlerJsonRunIntoMysql).not.toHaveBeenCalled();
  });

  it("does not import successful-looking partial stdout after subprocess timeout", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@127.0.0.1:3306/test");
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(Object.assign(new Error("timed out"), { killed: true, signal: "SIGKILL" as const }), mysqlJsonPayload, "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);
    const result = await runSamGovCrawler();
    expect(result).toMatchObject({ ok: false, errorCode: "CrawlerTaskTimeoutError" });
    expect(mockedImportCrawlerJsonRunIntoMysql).not.toHaveBeenCalled();
  });

  it("starts the Python crawler with documented date and pagination options", async () => {
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(null, "imported 1", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runSamGovCrawler({
      postedFrom: "05/01/2026",
      postedTo: "05/19/2026",
      limit: 50,
      maxRecords: 75,
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(result).toEqual({
      ok: true,
      source: "SAM.gov",
      status: "success",
      stdout: "imported 1",
      stderr: "",
    });
    expect(mockedExecFile).toHaveBeenCalledWith(
      "python3",
      [
        "-m",
        "apsi_crawler.cli",
        "fetch-sam-gov",
        "--database",
        "/tmp/apsi.sqlite",
        "--posted-from",
        "05/01/2026",
        "--posted-to",
        "05/19/2026",
        "--limit",
        "50",
        "--max-records",
        "75",
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

  it("returns failure metadata when the crawler exits with an error", async () => {
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(new Error("crawler failed"), "", "trace");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runSamGovCrawler({
      postedFrom: "05/01/2026",
      postedTo: "05/19/2026",
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failure");
    expect(result.stderr).toBe("trace");
  });

  it("passes archive document options by default", async () => {
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(null, "imported 1", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await runSamGovCrawler({
      postedFrom: "05/01/2026",
      postedTo: "05/19/2026",
      databasePath: "/tmp/apsi.sqlite",
      archiveDir: "/tmp/attachments",
    });

    expect(mockedExecFile.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--archive-documents", "--archive-dir", "/tmp/attachments"]),
    );
  });

  it("runs the Python crawler in JSON mode and imports directly into MySQL when MySQL is configured", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@127.0.0.1:3306/winbids");
    mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      callback(null, mysqlJsonPayload, "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await expect(runSamGovCrawler({
      postedFrom: "05/01/2026",
      postedTo: "05/19/2026",
    })).resolves.toMatchObject({
      ok: true,
      status: "success",
    });

    const args = mockedExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("--output-json");
    expect(args).not.toContain("--database");
    expect(mockedImportCrawlerJsonRunIntoMysql).toHaveBeenCalledWith(expect.anything(), JSON.parse(mysqlJsonPayload), undefined);
  });
});
