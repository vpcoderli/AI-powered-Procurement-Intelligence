import { execFile } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSamGovCrawler } from "./sam-gov-runner";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

describe("SAM.gov crawler runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
