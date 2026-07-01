import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bidsService from "@/server/bids/service";
import type { BidListResponse } from "@/server/bids/types";
import * as mysqlRuntime from "@/server/db/mysql";
import * as notificationInsights from "@/server/dashboard/notifications";
import * as pipelineInsights from "@/server/dashboard/pipeline";
import * as intentsService from "@/server/intents/service";
import * as riskChecklist from "@/server/risk/checklist";
import type { RiskChecklistReport } from "@/server/risk/checklist";
import { createDashboardSummary } from "./summary";

vi.mock("@/server/bids/service", () => ({
  getSavedBids: vi.fn(),
  queryBids: vi.fn(),
  queryBidsFromDatabase: vi.fn(),
}));

vi.mock("@/server/db/mysql", () => ({
  isMysqlDatabaseUrlConfigured: vi.fn(),
  resolveMysqlPool: vi.fn(),
}));

vi.mock("@/server/dashboard/notifications", () => ({
  listDashboardNotificationInsightsForRuntime: vi.fn(),
}));

vi.mock("@/server/dashboard/pipeline", () => ({
  listDashboardPipelineInsightsForRuntime: vi.fn(),
}));

vi.mock("@/server/intents/service", () => ({
  listUserIntents: vi.fn(),
}));

vi.mock("@/server/risk/checklist", () => ({
  createRiskChecklistReport: vi.fn(),
  createRiskChecklistReportFromMysql: vi.fn(),
}));

function bidResponse(total: number): BidListResponse {
  return {
    bids: [],
    total,
    filters: {
      q: "",
      states: [],
      issuerType: "all",
      deadline: "any",
      published: "any",
      sort: "relevance",
    },
  };
}

const riskReport: RiskChecklistReport = {
  ok: true,
  checkedAt: "2026-06-03T00:00:00.000Z",
  checks: [
    {
      id: "state-coverage",
      label: "50 state data coverage",
      ok: true,
      summary: "50/50 required states have at least one active bid",
    },
    {
      id: "state-content",
      label: "State bid content is non-empty",
      ok: true,
      summary: "1096 state bids checked for title, issuer, URL, state, and description",
    },
    {
      id: "attachment-downloads",
      label: "Attachments use safe non-404 download routes",
      ok: true,
      summary: "166 state attachments checked",
    },
  ],
};

describe("dashboard summary MySQL runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(true);
    vi.mocked(mysqlRuntime.resolveMysqlPool).mockReturnValue({ query: vi.fn() } as never);
    vi.mocked(bidsService.queryBids).mockImplementation(async (query) => {
      if (query.published === "last7") return bidResponse(12);
      if (query.deadline === "next7") return bidResponse(3);
      return bidResponse(0);
    });
    vi.mocked(bidsService.getSavedBids).mockResolvedValue({ savedBidIds: ["bid_1"], bids: [] });
    vi.mocked(intentsService.listUserIntents).mockResolvedValue([]);
    vi.mocked(riskChecklist.createRiskChecklistReportFromMysql).mockResolvedValue(riskReport);
    vi.mocked(notificationInsights.listDashboardNotificationInsightsForRuntime).mockResolvedValue({
      failedNotifications: 0,
      pendingNotifications: 0,
      failedDigestRuns: 0,
      recentDigestMatches: 0,
    });
    vi.mocked(pipelineInsights.listDashboardPipelineInsightsForRuntime).mockResolvedValue({
      workspaceItems: 0,
      blockedItems: 0,
      openItems: 0,
      missingArtifactLinks: 0,
      readyPackages: 2,
      exportedPackages: 1,
    });
  });

  it("uses runtime MySQL adapters instead of SQLite-only dashboard dependencies", async () => {
    const now = new Date("2026-06-03T00:00:00.000Z");
    const summary = await createDashboardSummary(
      { select: () => { throw new Error("SQLite db should not be used for bid or risk summary"); } },
      { userId: "user_1", role: "user", tier: "business" },
      now,
    );

    expect(summary.briefs).toMatchObject({
      newMatches: { value: 12 },
      dueSoon: { value: 3 },
      evidenceRisks: { value: 0 },
      readyPackages: { value: 2 },
    });
    expect(bidsService.queryBids).toHaveBeenCalledTimes(2);
    expect(bidsService.queryBidsFromDatabase).not.toHaveBeenCalled();
    expect(riskChecklist.createRiskChecklistReportFromMysql).toHaveBeenCalledWith(
      expect.anything(),
      now,
    );
    expect(riskChecklist.createRiskChecklistReport).not.toHaveBeenCalled();
  });
});
