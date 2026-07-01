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

describe("state data quality check script", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
