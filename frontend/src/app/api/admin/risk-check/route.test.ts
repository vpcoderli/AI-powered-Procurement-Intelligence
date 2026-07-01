import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import * as mysqlRuntime from "@/server/db/mysql";
import * as riskChecklist from "@/server/risk/checklist";
import * as riskSnapshots from "@/server/risk/snapshots";
import * as stateDataQualityModule from "@/server/source-validity/state-data-quality";
import type { RiskChecklistReport } from "@/server/risk/checklist";
import type { StateDataQualityReport } from "@/server/source-validity/state-data-quality";
import { createTestDatabase } from "@/server/db/test-utils";
import { createAdminRiskCheckGet } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();

  return {
    ...actual,
    requireAdminAccess: vi.fn(),
  };
});
vi.mock("@/server/db/mysql", () => ({
  isMysqlDatabaseUrlConfigured: vi.fn(() => false),
  resolveMysqlPool: vi.fn(),
}));
vi.mock("@/server/risk/checklist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/risk/checklist")>();

  return {
    ...actual,
    createRiskChecklistReportFromMysql: vi.fn(),
  };
});
vi.mock("@/server/risk/snapshots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/risk/snapshots")>();

  return {
    ...actual,
    listRiskChecklistSnapshotsFromMysql: vi.fn(),
    recordRiskChecklistSnapshotFromMysql: vi.fn(),
  };
});
vi.mock("@/server/source-validity/state-data-quality", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/source-validity/state-data-quality")>();

  return {
    ...actual,
    createStateDataQualityReportFromMysql: vi.fn(),
  };
});

const report: RiskChecklistReport = {
  ok: true,
  checkedAt: "2026-06-01T00:00:00.000Z",
  checks: [
    {
      id: "state-coverage",
      label: "50 state data coverage",
      ok: true,
      summary: "50/50 required states have at least one active bid",
    },
  ],
};

const stateDataQuality: StateDataQualityReport = {
  ok: false,
  checkedAt: "2026-06-01T00:00:00.000Z",
  summary: {
    totalStates: 50,
    p0BlockerStates: 5,
    p1WarningStates: 0,
    p2WarningStates: 0,
  },
  actions: [
    {
      id: "CA:ca_caleprocure:missing_state_bid",
      priority: "P0",
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      sourceLabel: "California Cal eProcure",
      reasonCode: "missing_state_bid",
      title: "CA missing_state_bid",
      recommendedAction: "Run or repair the state crawler, then verify at least one active state bid is imported.",
      ownerHint: "data-ops",
      dueInHours: 24,
      evidence: "CA has no active state bid rows.",
    },
  ],
  attachmentWorklist: [],
  rows: [
    {
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      sourceLabel: "California Cal eProcure",
      sourceUrl: "https://caleprocure.ca.gov",
      riskLevel: "P0",
      bidCount: 0,
      enabledSourceCount: 1,
      latestCrawlerStartedAt: null,
      latestSourceHealthCheckedAt: null,
      latestRiskCheckCheckedAt: null,
      attachmentStatus: "download_note",
      attachmentSummary: { total: 0, realFileOpenable: 0, downloadNote: 0, missingOrFailed: 0 },
      reasons: [
        {
          code: "missing_state_bid",
          severity: "P0",
          message: "CA has no active state bid rows.",
        },
      ],
    },
  ],
};

describe("GET /api/admin/risk-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(false);
  });

  it("denies requests without admin console access", async () => {
    const testDb = await createTestDatabase();

    try {
      vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError());
      const GET = createAdminRiskCheckGet(testDb.db, async () => report);

      const response = await GET(new Request("http://localhost/api/admin/risk-check"));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns the risk checklist report for admin console readers", async () => {
    const testDb = await createTestDatabase();
    const createReport = vi.fn().mockResolvedValue(report);

    try {
      vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({
        kind: "admin",
        role: "support",
        userId: "support_1",
      });
      const GET = createAdminRiskCheckGet(testDb.db, createReport);

      const response = await GET(new Request("http://localhost/api/admin/risk-check"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.report).toEqual(report);
      expect(body.history).toEqual([
        expect.objectContaining({
          ok: true,
          checkedAt: report.checkedAt,
          report,
        }),
      ]);
      expect(body.trend).toEqual(expect.objectContaining({
        snapshotCount: 1,
      }));
      expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.anything(), {
        roles: ["admin", "operator", "support"],
      });
      expect(createReport).toHaveBeenCalledWith(testDb.db);
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns the 50-state data quality report with the risk checklist", async () => {
    const testDb = await createTestDatabase();
    const createReport = vi.fn().mockResolvedValue(report);
    const createStateDataQuality = vi.fn().mockResolvedValue(stateDataQuality);

    try {
      vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({
        kind: "admin",
        role: "operator",
        userId: "operator_1",
      });
      const GET = createAdminRiskCheckGet(testDb.db, createReport, createStateDataQuality);

      const response = await GET(new Request("http://localhost/api/admin/risk-check"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.stateDataQuality).toEqual(stateDataQuality);
      expect(body.stateDataQuality.summary).toMatchObject({
        totalStates: 50,
        p0BlockerStates: 5,
      });
      expect(body.stateDataQuality.rows[0]).toMatchObject({
        stateCode: "CA",
        riskLevel: "P0",
        bidCount: 0,
        enabledSourceCount: 1,
      });
      expect(createStateDataQuality).toHaveBeenCalledWith(testDb.db, expect.any(Date));
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns the 50-state data quality report in MySQL runtime", async () => {
    const mysql = { query: vi.fn(), execute: vi.fn() };
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(true);
    vi.mocked(mysqlRuntime.resolveMysqlPool).mockReturnValue(mysql as never);
    vi.mocked(riskChecklist.createRiskChecklistReportFromMysql).mockResolvedValue(report);
    vi.mocked(riskSnapshots.recordRiskChecklistSnapshotFromMysql).mockResolvedValue(undefined);
    vi.mocked(riskSnapshots.listRiskChecklistSnapshotsFromMysql).mockResolvedValue([
      {
        id: "snapshot_mysql_1",
        ok: true,
        checkedAt: report.checkedAt,
        report,
        createdAt: report.checkedAt,
      },
    ]);
    vi.mocked(stateDataQualityModule.createStateDataQualityReportFromMysql).mockResolvedValue(stateDataQuality);
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({
      kind: "admin",
      role: "support",
      userId: "support_1",
    });

    const GET = createAdminRiskCheckGet(undefined, async () => report);
    const response = await GET(new Request("http://localhost/api/admin/risk-check"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stateDataQuality).toEqual(stateDataQuality);
    expect(riskChecklist.createRiskChecklistReportFromMysql).toHaveBeenCalledWith(mysql);
    expect(stateDataQualityModule.createStateDataQualityReportFromMysql).toHaveBeenCalledWith(
      mysql,
      expect.any(Date),
    );
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      roles: ["admin", "operator", "support"],
    });
  });
});
