import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataSources } from "../src/server/db/schema";
import { createTestDatabase } from "../src/server/db/test-utils";
import {
  listLiveSourceHealthSnapshots,
  recordLiveSourceHealthSnapshot,
} from "../src/server/source-validity/health-snapshots";
import {
  formatSourceHealthCheckHelp,
  parseSourceHealthCheckArgs,
  persistLiveSourceHealthSnapshot,
} from "./source-health-check";
import {
  buildSourceHealthOperationalReport,
  formatSourceHealthOperationalReport,
  loadSourceHealthOperationalReport,
  parseSourceHealthReportArgs,
} from "./source-health-report";
import type { LiveSourceHealthReport } from "../src/server/source-validity/live-source-health";

const REPORT = {
  ok: false,
  checkedAt: "2026-06-12T00:00:00.000Z",
  summary: {
    total: 1,
    healthy: 0,
    unhealthy: 1,
    skipped: 0,
  },
  results: [
    {
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      label: "California Cal eProcure",
      url: "https://caleprocure.ca.gov",
      sourceAuthority: "official",
      trustStatus: "verified",
      status: "unhealthy",
      method: "GET",
      httpStatus: 403,
      statusText: "Forbidden",
      errorCode: "http_error",
      errorMessage: "HTTP 403 Forbidden",
      classification: "forbidden",
      reason: "HTTP 403 Forbidden",
      evidenceSnippets: ["403 Forbidden"],
      latencyMs: 120,
      operationalSeverity: "warning",
      recommendedAction: "browser_or_access_review",
    },
  ],
} satisfies LiveSourceHealthReport;

const PREVIOUS_REPORT = {
  ...REPORT,
  ok: true,
  checkedAt: "2026-06-11T00:00:00.000Z",
  summary: {
    total: 1,
    healthy: 1,
    unhealthy: 0,
    skipped: 0,
  },
  results: [
    {
      ...REPORT.results[0],
      status: "healthy",
      httpStatus: 200,
      statusCode: 200,
      statusText: "OK",
      errorCode: null,
      errorMessage: null,
      classification: "ok",
      reason: "Source responded with usable content.",
      evidenceSnippets: ["HTTP 200 OK"],
      operationalSeverity: "none",
      recommendedAction: "none",
    },
  ],
} satisfies LiveSourceHealthReport;

const SENSITIVE_REPORT = {
  ...REPORT,
  results: [
    {
      ...REPORT.results[0],
      url: "https://example.gov/attachments/bid.pdf?token=raw-url-token",
      status: "unhealthy",
      errorMessage: "Portal returned token=raw-token password=raw-password",
      classification: "login_required",
      reason: `<html>${"credential body ".repeat(80)}password=raw-password token=raw-token</html>`,
      evidenceSnippets: [`<html>${"very long external body ".repeat(80)}token=raw-token</html>`],
      recommendedAction: "browser_or_access_review",
    },
  ],
} satisfies LiveSourceHealthReport;

describe("source health check script", () => {
  it("parses persist mode without changing the default report-only behavior", () => {
    expect(parseSourceHealthCheckArgs([])).toMatchObject({
      persist: false,
      reportOnly: false,
      json: false,
      timeoutMs: 10_000,
    });

    expect(parseSourceHealthCheckArgs(["--persist", "--source", "CA", "--json"])).toMatchObject({
      persist: true,
      sourceFilters: ["CA"],
      json: true,
    });
  });

  it("accepts --all as an explicit full source registry selector", () => {
    expect(parseSourceHealthCheckArgs(["--all", "--timeout-ms", "5000", "--report-only"])).toMatchObject({
      sourceFilters: [],
      timeoutMs: 5_000,
      reportOnly: true,
    });
  });

  it("parses body inspection mode for release source health checks", () => {
    expect(parseSourceHealthCheckArgs(["--all", "--inspect-body", "--persist"])).toMatchObject({
      sourceFilters: [],
      inspectBody: true,
      persist: true,
    });
  });

  it("parses the operations snapshot alias without requiring network execution", () => {
    expect(parseSourceHealthCheckArgs(["--all", "--inspect-body", "--write-snapshot", "--report-only"])).toMatchObject({
      sourceFilters: [],
      inspectBody: true,
      persist: true,
      reportOnly: true,
    });
  });

  it("documents scheduled operations usage in help output", () => {
    expect(parseSourceHealthCheckArgs(["--help"])).toMatchObject({
      help: true,
    });

    expect(formatSourceHealthCheckHelp()).toContain("npm run source:health:ops");
    expect(formatSourceHealthCheckHelp()).toContain("npm run source:health:scheduled");
    expect(formatSourceHealthCheckHelp()).toContain("--write-snapshot");
    expect(formatSourceHealthCheckHelp()).toContain("current DB runtime");
    expect(formatSourceHealthCheckHelp()).toContain("403");
    expect(formatSourceHealthCheckHelp()).toContain("bot_check");
    expect(formatSourceHealthCheckHelp()).toContain("login_required");
  });

  it("persists snapshots to SQLite when no MySQL URL is configured", async () => {
    const close = vi.fn();
    const db = { $client: { close } } as never;
    const createSqliteDatabase = vi.fn(() => db);
    const runSqliteMigrations = vi.fn();
    const recordSqliteSnapshot = vi.fn();
    const createMysqlPoolForUrl = vi.fn();
    const recordMysqlSnapshot = vi.fn();

    await expect(
      persistLiveSourceHealthSnapshot(REPORT, {}, {
        createSqliteDatabase,
        runSqliteMigrations,
        recordSqliteSnapshot,
        createMysqlPoolForUrl,
        recordMysqlSnapshot,
      }),
    ).resolves.toBe("sqlite");

    expect(createSqliteDatabase).toHaveBeenCalledTimes(1);
    expect(runSqliteMigrations).toHaveBeenCalledWith(db);
    expect(recordSqliteSnapshot).toHaveBeenCalledWith(db, REPORT);
    expect(close).toHaveBeenCalledTimes(1);
    expect(createMysqlPoolForUrl).not.toHaveBeenCalled();
    expect(recordMysqlSnapshot).not.toHaveBeenCalled();
  });

  it("persists snapshots to MySQL when DATABASE_URL points to MySQL", async () => {
    const pool = {
      query: vi.fn(),
      execute: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    } as never;
    const createSqliteDatabase = vi.fn();
    const recordSqliteSnapshot = vi.fn();
    const createMysqlPoolForUrl = vi.fn(() => pool);
    const recordMysqlSnapshot = vi.fn().mockResolvedValue({});

    await expect(
      persistLiveSourceHealthSnapshot(REPORT, { DATABASE_URL: "mysql2://user:pass@localhost:3306/winbids" }, {
        createSqliteDatabase,
        recordSqliteSnapshot,
        createMysqlPoolForUrl,
        recordMysqlSnapshot,
      }),
    ).resolves.toBe("mysql");

    expect(createMysqlPoolForUrl).toHaveBeenCalledWith("mysql://user:pass@localhost:3306/winbids");
    expect(recordMysqlSnapshot).toHaveBeenCalledWith(pool, REPORT);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(createSqliteDatabase).not.toHaveBeenCalled();
    expect(recordSqliteSnapshot).not.toHaveBeenCalled();
  });

  it("keeps a production-like scheduled alias with fixed non-credentialed operator parameters", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["source:health:check"]).toBe("tsx scripts/source-health-check.ts");
    expect(packageJson.scripts["source:health:ops"]).toContain("scripts/source-health-check.ts");
    expect(packageJson.scripts["source:health:ops"]).toContain("--all");
    expect(packageJson.scripts["source:health:ops"]).toContain("--timeout-ms 10000");
    expect(packageJson.scripts["source:health:ops"]).toContain("--inspect-body");
    expect(packageJson.scripts["source:health:ops"]).toContain("--write-snapshot");
    expect(packageJson.scripts["source:health:ops"]).toContain("--report-only");
    expect(packageJson.scripts["source:health:scheduled"]).toBe("npm run source:health:ops");
  });
});

describe("source health report export", () => {
  it("parses report args and registers a no-probe report script", () => {
    expect(parseSourceHealthReportArgs([])).toEqual({
      format: "markdown",
      output: null,
      help: false,
    });
    expect(parseSourceHealthReportArgs(["--format=json", "--output", "tmp/source-health.json"])).toEqual({
      format: "json",
      output: "tmp/source-health.json",
      help: false,
    });
    expect(() => parseSourceHealthReportArgs(["--format=html"])).toThrow("--format must be markdown, json, or csv.");

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["source:health:report"]).toBe("tsx scripts/source-health-report.ts");
    expect(packageJson.scripts["source:health:report"]).not.toContain("source-health-check");
  });

  it("loads the latest persisted SQLite snapshot with triage and trend without a live probe", async () => {
    const testDb = await createTestDatabase();

    try {
      testDb.db
        .insert(dataSources)
        .values({
          id: "ca_caleprocure",
          label: "California Cal eProcure",
          issuerType: "state",
          stateCode: "CA",
          isEnabled: 1,
          cadence: "daily",
          liveHealthOwner: "source-ops@example.com",
          liveHealthDisposition: "needs_manual_triage",
          liveHealthNextReviewAt: "2026-06-15T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        })
        .run();
      recordLiveSourceHealthSnapshot(testDb.db, PREVIOUS_REPORT, "2026-06-11T00:00:01.000Z");
      recordLiveSourceHealthSnapshot(testDb.db, REPORT, "2026-06-12T00:00:01.000Z");

      const forbiddenLiveProbe = vi.fn(() => {
        throw new Error("report export must not run a live network probe");
      });

      const report = await loadSourceHealthOperationalReport({}, {
        createSqliteDatabase: () => testDb.db,
        runSqliteMigrations: vi.fn(),
        closeSqliteDatabase: vi.fn(),
        listSqliteSnapshots: listLiveSourceHealthSnapshots,
        checkLiveSourceHealth: forbiddenLiveProbe,
        now: () => "2026-06-12T01:00:00.000Z",
      });

      expect(forbiddenLiveProbe).not.toHaveBeenCalled();
      expect(report.runtime).toBe("sqlite");
      expect(report.snapshot?.checkedAt).toBe("2026-06-12T00:00:00.000Z");
      expect(report.summary).toEqual(REPORT.summary);
      expect(report.unhealthyClassificationCounts).toEqual({ forbidden: 1 });
      expect(report.sources).toEqual([
        expect.objectContaining({
          sourceId: "ca_caleprocure",
          url: "https://caleprocure.ca.gov/",
          owner: "source-ops@example.com",
          disposition: "needs_manual_triage",
          nextReviewAt: "2026-06-15T00:00:00.000Z",
          currentStatus: "unhealthy",
          currentStreak: 1,
          healthyPercent: 50,
          recommendedAction: "browser_or_access_review",
        }),
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("loads the latest persisted MySQL snapshot with triage without a live probe", async () => {
    const pool = {
      query: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    } as never;
    const createMysqlPoolForUrl = vi.fn(() => pool);
    const listMysqlSnapshots = vi.fn().mockResolvedValue([
      {
        id: "snapshot_mysql_latest",
        ok: REPORT.ok,
        checkedAt: REPORT.checkedAt,
        createdAt: "2026-06-12T00:00:01.000Z",
        report: REPORT,
      },
    ]);
    const readMysqlTriageRows = vi.fn().mockResolvedValue([
      {
        sourceId: "ca_caleprocure",
        stateCode: "CA",
        owner: "mysql-ops@example.com",
        disposition: "vendor_account",
        nextReviewAt: "2026-06-16T00:00:00.000Z",
      },
    ]);
    const forbiddenLiveProbe = vi.fn(() => {
      throw new Error("report export must not run a live network probe");
    });

    const report = await loadSourceHealthOperationalReport(
      { DATABASE_URL: "mysql://user:pass@localhost:3306/winbids" },
      {
        createMysqlPoolForUrl,
        listMysqlSnapshots,
        readMysqlTriageRows,
        checkLiveSourceHealth: forbiddenLiveProbe,
        now: () => "2026-06-12T01:00:00.000Z",
      },
    );

    expect(forbiddenLiveProbe).not.toHaveBeenCalled();
    expect(createMysqlPoolForUrl).toHaveBeenCalledWith("mysql://user:pass@localhost:3306/winbids");
    expect(listMysqlSnapshots).toHaveBeenCalledWith(pool, 10);
    expect(readMysqlTriageRows).toHaveBeenCalledWith(pool);
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(report.runtime).toBe("mysql");
    expect(report.sources[0]).toMatchObject({
      sourceId: "ca_caleprocure",
      owner: "mysql-ops@example.com",
      disposition: "vendor_account",
      nextReviewAt: "2026-06-16T00:00:00.000Z",
    });
  });

  it("formats a markdown operations report with summary, counts, triage, streak, and action", () => {
    const report = buildSourceHealthOperationalReport({
      runtime: "sqlite",
      generatedAt: "2026-06-12T01:00:00.000Z",
      snapshots: [
        {
          id: "snapshot_latest",
          ok: REPORT.ok,
          checkedAt: REPORT.checkedAt,
          createdAt: "2026-06-12T00:00:01.000Z",
          report: REPORT,
        },
        {
          id: "snapshot_previous",
          ok: PREVIOUS_REPORT.ok,
          checkedAt: PREVIOUS_REPORT.checkedAt,
          createdAt: "2026-06-11T00:00:01.000Z",
          report: PREVIOUS_REPORT,
        },
      ],
      triageBySourceId: new Map([
        [
          "ca_caleprocure",
          {
            owner: "source-ops@example.com",
            disposition: "needs_manual_triage",
            nextReviewAt: "2026-06-15T00:00:00.000Z",
          },
        ],
      ]),
    });

    const markdown = formatSourceHealthOperationalReport(report, "markdown");

    expect(markdown).toContain("# Source Health Report");
    expect(markdown).toContain("| total | 1 |");
    expect(markdown).toContain("| forbidden | 1 |");
    expect(markdown).toContain("source-ops@example.com");
    expect(markdown).toContain("needs_manual_triage");
    expect(markdown).toContain("2026-06-15T00:00:00.000Z");
    expect(markdown).toContain("https://caleprocure.ca.gov/");
    expect(markdown).toContain("unhealthy x1");
    expect(markdown).toContain("browser_or_access_review");
  });

  it("formats sanitized JSON with safe source URLs but without raw credentials, long HTML bodies, or URL secrets", () => {
    const report = buildSourceHealthOperationalReport({
      runtime: "sqlite",
      generatedAt: "2026-06-12T01:00:00.000Z",
      snapshots: [
        {
          id: "snapshot_sensitive",
          ok: SENSITIVE_REPORT.ok,
          checkedAt: SENSITIVE_REPORT.checkedAt,
          createdAt: "2026-06-12T00:00:01.000Z",
          report: SENSITIVE_REPORT,
        },
      ],
      triageBySourceId: new Map(),
    });

    const json = formatSourceHealthOperationalReport(report, "json");

    expect(json).toContain('"summary"');
    expect(json).toContain('"login_required": 1');
    expect(json).toContain('"url": "https://example.gov/attachments/bid.pdf"');
    expect(json).toContain("[REDACTED]");
    expect(json).not.toContain("raw-password");
    expect(json).not.toContain("raw-token");
    expect(json).not.toContain("<html");
    expect(json).not.toContain("raw-url-token");
    expect(json.length).toBeLessThan(6_000);
  });

  it("formats CSV with summary rows, classification counts, triage columns, streak, and action", () => {
    const report = buildSourceHealthOperationalReport({
      runtime: "sqlite",
      generatedAt: "2026-06-12T01:00:00.000Z",
      snapshots: [
        {
          id: "snapshot_latest",
          ok: REPORT.ok,
          checkedAt: REPORT.checkedAt,
          createdAt: "2026-06-12T00:00:01.000Z",
          report: REPORT,
        },
      ],
      triageBySourceId: new Map([
        [
          "ca_caleprocure",
          {
            owner: "source-ops@example.com",
            disposition: "needs_manual_triage",
            nextReviewAt: "2026-06-15T00:00:00.000Z",
          },
        ],
      ]),
    });

    const csv = formatSourceHealthOperationalReport(report, "csv");

    expect(csv.split("\n")[0]).toContain("section,key,value,state_code,source_id");
    expect(csv.split("\n")[0]).toContain("source_url");
    expect(csv).toContain("summary,total,1");
    expect(csv).toContain("classification,forbidden,1");
    expect(csv).toContain("source,,,CA,ca_caleprocure");
    expect(csv).toContain("https://caleprocure.ca.gov/");
    expect(csv).toContain("source-ops@example.com");
    expect(csv).toContain("needs_manual_triage");
    expect(csv).toContain("unhealthy");
    expect(csv).toContain("browser_or_access_review");
  });
});
