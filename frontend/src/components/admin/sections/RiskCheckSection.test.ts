import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterStateDataQualityActionsByRecommendedAction,
  filterStateDataQualityRows,
  STATE_DATA_QUALITY_RISK_FILTERS,
  stateAttachmentRealRatio,
  stateDataQualityP0BlockerNotice,
  toRiskSectionData,
} from "./RiskCheckSection";

describe("risk check section", () => {
  it("titles the matrix as the 50-state portal quality view and loads its own report", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('t("admin.stateQualityMatrixTitle")');
    expect(source).not.toContain("50-state data quality matrix");
    expect(source).toContain("getAdminRiskChecklist()");
    expect(source).toContain("useAdminResource(");
  });

  it("follows the resource render rule and refreshes through the resource", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("useAdminResource(loadRiskReport)");
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
    expect(source).toContain("risk.reload()");
    expect(source).toContain("isRefreshingRiskReport");
  });

  // Moved from src/app/admin/page.test.ts ("keeps successful admin sections ready when one admin API rejects"):
  // the `risk` slice mapping now lives in toRiskSectionData.
  it("maps the risk checklist response to the section data", () => {
    const report = { ok: true, checkedAt: "2026-06-10T00:00:00.000Z", checks: [] };
    const trend = { globalUrlAllPassing: true, stateCoverageDeclined: false, attachmentDownloadCountChanged: false };
    const stateDataQuality = {
      ok: false,
      checkedAt: "2026-06-10T00:00:00.000Z",
      summary: { totalStates: 50, p0BlockerStates: 5, p1WarningStates: 0, p2WarningStates: 0 },
      rows: [],
    };

    const data = toRiskSectionData({ report, history: [], trend, stateDataQuality } as never);
    expect(data.report).toBe(report);
    expect(data.history).toEqual([]);
    expect(data.trend).toBe(trend);
    expect(data.stateDataQuality?.summary).toMatchObject({ totalStates: 50, p0BlockerStates: 5 });

    // An older server answers without a state data quality report.
    expect(toRiskSectionData({ report, history: [], trend } as never).stateDataQuality).toBeNull();
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the risk check and state data quality matrix it took over from the dashboard page", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("getAdminRiskChecklist");
    expect(source).toContain("StateDataQualityMatrix");
    expect(source).toContain("stateDataQuality");
    expect(source).toContain("stateQualityRiskFilter");
    expect(source).toContain("stateQualityReasonFilter");
    expect(source).toContain("STATE_DATA_QUALITY_RISK_FILTERS");
    expect(source).toContain("filterStateDataQualityRows");
    expect(source).toContain("stateAttachmentRealRatio");
    expect(source).toContain("State data quality action queue");
    expect(source).toContain("report.actions");
    expect(source).toContain("recommendedAction");
    expect(source).toContain("CA/FL/IL/NY/TX P0 blockers are state data quality blockers");
    expect(source).toContain("not live source-health failures");
    expect(source).not.toContain("CA/FL/IL/NY/TX source-health production risk");
    expect(source).toContain('t("admin.riskCheck")');
    expect(source).toContain('t("admin.riskCheckGlobalUrlTitle")');
    expect(source).toContain('t("admin.riskCheckGlobalUrlDescription")');
    expect(source).toContain('t("admin.riskCheckMoreIssues")');
    expect(source).toContain('check.id === "global-url-validity"');
    expect(source).toContain('t("admin.refreshRiskCheck")');
    expect(source).toContain('t("admin.exportRiskCheck")');
    expect(source).toContain("refreshRiskReport");
    expect(source).toContain("exportRiskReport");
    expect(source).toContain("URL.createObjectURL");
    expect(source).toContain("risk-check-report");
    expect(source).toContain("riskDetailBidHref");
    expect(source).toContain("bidDetailPath");
    expect(source).toContain("RiskDetailItem");
    expect(source).toContain('t("admin.riskCheckHistory")');
    expect(source).toContain('t("admin.riskCheckHistoryEmpty")');
    expect(source).toContain('t("admin.riskCheckTrend")');
    expect(source).toContain('t("admin.riskTrendGlobalUrlStable")');
    expect(source).toContain('t("admin.riskTrendStateCoverageDeclined")');
    expect(source).toContain('t("admin.riskTrendAttachmentChanged")');
    expect(source).toContain("riskHistory");
    expect(source).toContain("riskTrend");
    expect(source).toContain("riskReport");
    expect(source).toContain("RiskCheck");
  });

  // Moved from src/app/admin/page.test.ts ("filters state data quality action rows by recommended action").
  it("filters state data quality action rows by recommended action", () => {
    const actions = [
      {
        id: "ca:crawler",
        recommendedAction: "Run or repair the state crawler, then verify at least one active state bid is imported.",
      },
      {
        id: "tx:archive",
        recommendedAction: "Re-archive the failed attachment and verify the stored file and checksum.",
      },
      {
        id: "ny:crawler",
        recommendedAction: "Run or repair the state crawler, then verify at least one active state bid is imported.",
      },
    ];

    expect(filterStateDataQualityActionsByRecommendedAction(actions, "all").map((action) => action.id)).toEqual([
      "ca:crawler",
      "tx:archive",
      "ny:crawler",
    ]);
    expect(
      filterStateDataQualityActionsByRecommendedAction(
        actions,
        "Run or repair the state crawler, then verify at least one active state bid is imported.",
      ).map((action) => action.id),
    ).toEqual(["ca:crawler", "ny:crawler"]);
  });

  // Moved from src/app/admin/page.test.ts ("filters state data quality matrix rows by P0/P1/P2 and reason code").
  it("filters state data quality matrix rows by P0/P1/P2 and reason code", () => {
    expect(STATE_DATA_QUALITY_RISK_FILTERS).toEqual(["all", "P0", "P1", "P2"]);

    const rows = [
      {
        stateCode: "CA",
        riskLevel: "P0",
        reasons: [{ code: "missing_state_bid", severity: "P0", message: "missing" }],
      },
      {
        stateCode: "FL",
        riskLevel: "P1",
        reasons: [{ code: "fixture_fallback", severity: "P1", message: "fallback" }],
      },
      {
        stateCode: "IL",
        riskLevel: "P2",
        reasons: [{ code: "risk_check_stale_or_missing", severity: "P2", message: "stale" }],
      },
      {
        stateCode: "TX",
        riskLevel: "P0",
        reasons: [{ code: "attachment_archive_invalid", severity: "P0", message: "archive" }],
      },
    ];

    expect(
      filterStateDataQualityRows(rows, { riskLevel: "P0", reasonCode: "all" }).map((row) => row.stateCode),
    ).toEqual(["CA", "TX"]);
    expect(
      filterStateDataQualityRows(rows, { riskLevel: "all", reasonCode: "fixture_fallback" }).map((row) => row.stateCode),
    ).toEqual(["FL"]);
    expect(
      filterStateDataQualityRows(rows, { riskLevel: "P0", reasonCode: "missing_state_bid" }).map((row) => row.stateCode),
    ).toEqual(["CA"]);
  });

  // Moved from src/app/admin/page.test.ts ("describes CA FL IL NY TX P0 blockers as state data quality blockers ...").
  it("describes CA FL IL NY TX P0 blockers as state data quality blockers, not source health production risk", () => {
    const notice = stateDataQualityP0BlockerNotice(
      ["CA", "FL", "IL", "NY", "TX"].map((stateCode) => ({
        stateCode,
        riskLevel: "P0",
      })),
    );

    expect(notice).toContain("CA/FL/IL/NY/TX P0 blockers are state data quality blockers");
    expect(notice).toContain("not live source-health failures");
    expect(notice).not.toContain("source-health production risk");
    expect(stateDataQualityP0BlockerNotice([{ stateCode: "CA", riskLevel: "P1" }])).toBeNull();
  });

  it("formats the real attachment ratio of a state row", () => {
    expect(stateAttachmentRealRatio({ attachmentSummary: { realFileOpenable: 3, total: 4 } } as never)).toBe("3/4 (75%)");
    expect(stateAttachmentRealRatio({ attachmentSummary: { realFileOpenable: 0, total: 0 } } as never)).toBe("0/0 (0%)");
  });
});
