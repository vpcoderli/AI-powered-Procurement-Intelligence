import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mysqlRuntime from "../src/server/db/mysql";
import * as stateDataQuality from "../src/server/source-validity/state-data-quality";
import {
  createStateDataQualityCheckReport,
  formatStateDataQualityCheckHelp,
  parseStateDataQualityCheckArgs,
} from "./state-data-quality-check";

vi.mock("../src/server/db/client", () => ({
  db: { runtime: "sqlite" },
}));

vi.mock("../src/server/db/mysql", () => ({
  closeResolvedMysqlPool: vi.fn(),
  isMysqlDatabaseUrlConfigured: vi.fn(),
  resolveMysqlPool: vi.fn(),
}));

vi.mock("../src/server/source-validity/state-data-quality", () => ({
  cleanupDuplicateCanonicalStateSources: vi.fn(),
  createStateDataQualityReport: vi.fn(),
  createStateDataQualityReportFromMysql: vi.fn(),
  formatStateDataQualityReport: vi.fn(),
}));

const report = {
  ok: true,
  checkedAt: "2026-06-30T00:00:00.000Z",
  summary: {
    totalStates: 50,
    p0BlockerStates: 0,
    p1WarningStates: 0,
    p2WarningStates: 0,
  },
  actions: [],
  attachmentWorklist: [],
  rows: [],
};

function testEnv(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "test",
    ...values,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

/** Lets every already-queued promise callback run, so "has not happened yet" can be asserted. */
const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("state data quality check script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mysqlRuntime.closeResolvedMysqlPool).mockResolvedValue(undefined);
  });

  it("parses report-only and json output modes", () => {
    expect(parseStateDataQualityCheckArgs([])).toEqual({
      json: false,
      reportOnly: false,
      fixCanonicalSources: false,
      help: false,
    });
    expect(parseStateDataQualityCheckArgs(["--json", "--report-only", "--fix-canonical-sources"])).toEqual({
      json: true,
      reportOnly: true,
      fixCanonicalSources: true,
      help: false,
    });
  });

  it("documents the local 50-state summary command", () => {
    expect(parseStateDataQualityCheckArgs(["--help"])).toMatchObject({ help: true });
    expect(formatStateDataQualityCheckHelp()).toContain("State Data Quality Check");
    expect(formatStateDataQualityCheckHelp()).toContain("tsx scripts/state-data-quality-check.ts");
    expect(formatStateDataQualityCheckHelp()).toContain("50 state quality summary");
    expect(formatStateDataQualityCheckHelp()).toContain("--fix-canonical-sources");
  });

  it("uses the MySQL quality gate when DATABASE_URL is a MySQL URL", async () => {
    const now = new Date("2026-06-30T00:00:00.000Z");
    const mysql = { query: vi.fn() };
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(true);
    vi.mocked(mysqlRuntime.resolveMysqlPool).mockReturnValue(mysql as never);
    vi.mocked(stateDataQuality.createStateDataQualityReportFromMysql).mockResolvedValue(report);

    await expect(
      createStateDataQualityCheckReport(now, {
        ...testEnv({ DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/winbids" }),
      }),
    ).resolves.toBe(report);

    expect(mysqlRuntime.isMysqlDatabaseUrlConfigured).toHaveBeenCalledWith(expect.objectContaining({
      DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/winbids",
    }));
    expect(mysqlRuntime.resolveMysqlPool).toHaveBeenCalledOnce();
    expect(stateDataQuality.createStateDataQualityReportFromMysql).toHaveBeenCalledWith(mysql, now);
    expect(stateDataQuality.createStateDataQualityReport).not.toHaveBeenCalled();
  });

  it("keeps the SQLite quality gate as the default runtime", async () => {
    const now = new Date("2026-06-30T00:00:00.000Z");
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(false);
    vi.mocked(stateDataQuality.createStateDataQualityReport).mockResolvedValue(report);

    await expect(createStateDataQualityCheckReport(now, testEnv())).resolves.toBe(report);

    expect(stateDataQuality.createStateDataQualityReport).toHaveBeenCalledWith({ runtime: "sqlite" }, now);
    expect(stateDataQuality.createStateDataQualityReportFromMysql).not.toHaveBeenCalled();
    expect(mysqlRuntime.resolveMysqlPool).not.toHaveBeenCalled();
    expect(mysqlRuntime.closeResolvedMysqlPool).not.toHaveBeenCalled();
  });

  // mysql2 keeps a process alive for as long as its pool is open: for the connections, and, since the pool sets
  // maxIdle below its limit, for the idle-connection timer even when none was ever opened. This script prints
  // its report and is then done, so the report is the only use of the shared pool and must release it on every
  // path; main() then either returns or calls process.exit(1) with nothing left open.
  describe("MySQL pool lifetime", () => {
    const now = new Date("2026-06-30T00:00:00.000Z");
    const mysqlEnv = testEnv({ DATABASE_URL: "mysql://user:pass@127.0.0.1:3306/winbids" });

    beforeEach(() => {
      vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(true);
      vi.mocked(mysqlRuntime.resolveMysqlPool).mockReturnValue({ query: vi.fn() } as never);
    });

    it("ends the shared pool once the report is built, and not while its queries still run", async () => {
      const building = deferred<typeof report>();
      vi.mocked(stateDataQuality.createStateDataQualityReportFromMysql).mockReturnValue(building.promise);

      const result = createStateDataQualityCheckReport(now, mysqlEnv);
      await nextTick();
      expect(mysqlRuntime.closeResolvedMysqlPool).not.toHaveBeenCalled();

      building.resolve(report);
      await expect(result).resolves.toBe(report);
      expect(mysqlRuntime.closeResolvedMysqlPool).toHaveBeenCalledOnce();
    });

    it("ends the shared pool when the report fails, and still reports the failure", async () => {
      vi.mocked(stateDataQuality.createStateDataQualityReportFromMysql).mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:3306"),
      );

      await expect(createStateDataQualityCheckReport(now, mysqlEnv)).rejects.toThrow("connect ECONNREFUSED");
      expect(mysqlRuntime.closeResolvedMysqlPool).toHaveBeenCalledOnce();
    });

    it("does not hand the report back before the pool has finished closing", async () => {
      const closing = deferred();
      vi.mocked(mysqlRuntime.closeResolvedMysqlPool).mockReturnValue(closing.promise);
      vi.mocked(stateDataQuality.createStateDataQualityReportFromMysql).mockResolvedValue(report);

      let handedBack = false;
      const result = createStateDataQualityCheckReport(now, mysqlEnv).then((value) => {
        handedBack = true;
        return value;
      });
      await nextTick();
      expect(mysqlRuntime.closeResolvedMysqlPool).toHaveBeenCalledOnce();
      expect(handedBack).toBe(false);

      closing.resolve();
      await expect(result).resolves.toBe(report);
    });
  });
});
