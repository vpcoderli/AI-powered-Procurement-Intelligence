import { execFile } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("starts the Python crawler with documented date and pagination options", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
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
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
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
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
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
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
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
    expect(mockedImportCrawlerJsonRunIntoMysql).toHaveBeenCalledWith(expect.anything(), JSON.parse(mysqlJsonPayload));
  });
});
