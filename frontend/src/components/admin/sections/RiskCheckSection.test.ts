import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import {
  filterStateDataQualityActionsByRecommendedAction,
  filterStateDataQualityRows,
  STATE_DATA_QUALITY_RISK_FILTERS,
  stateAttachmentRealRatio,
  stateDataQualityP0BlockerNotice,
  toRiskSectionData,
} from "./RiskCheckSection";

const enAdmin = en.admin as Record<string, string>;
const zhAdmin = zh.admin as Record<string, string>;
/** The page's `t` in one language, for the `admin.` keys the section reads. */
const tIn = (dictionary: Record<string, string>) => (key: string) => dictionary[key.replace(/^admin\./, "")] ?? key;
const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

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
    expect(source).toContain('t("admin.stateQualityActionQueue")');
    expect(source).toContain("report.actions");
    expect(source).toContain("recommendedAction");
    expect(source).toContain('t("admin.stateQualityP0Notice")');
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
      tIn(enAdmin),
    );

    expect(notice).toBe(
      "CA/FL/IL/NY/TX P0 blockers are state data quality blockers; currently blocked: CA/FL/IL/NY/TX. These are not live source-health failures.",
    );
    expect(notice).not.toContain("source-health production risk");
    expect(stateDataQualityP0BlockerNotice([{ stateCode: "CA", riskLevel: "P1" }], tIn(enAdmin))).toBeNull();
  });

  it("names only the watched states that are P0 blockers, in the language of the page", () => {
    const rows = [
      { stateCode: "TX", riskLevel: "P0" },
      { stateCode: "CA", riskLevel: "P0" },
      { stateCode: "FL", riskLevel: "P1" },
      // Not a watched state, so it is not named even at P0.
      { stateCode: "WA", riskLevel: "P0" },
    ];

    expect(stateDataQualityP0BlockerNotice(rows, tIn(enAdmin))).toBe(
      "CA/FL/IL/NY/TX P0 blockers are state data quality blockers; currently blocked: CA/TX. These are not live source-health failures.",
    );
    const zhNotice = stateDataQualityP0BlockerNotice(rows, tIn(zhAdmin));
    expect(zhNotice).toBe("CA/FL/IL/NY/TX 的 P0 阻断项属于州级数据质量阻断项；当前受阻：CA/TX。这些并非 Live 来源健康故障。");
    expect(zhNotice).not.toMatch(/[{}]/);
  });

  it("words the matrix as its summary sentence and the console do", () => {
    // The columns are named as the summary sentence names them, in both languages.
    for (const dictionary of [enAdmin, zhAdmin]) {
      for (const key of ["stateQualityColumnBids", "stateQualityColumnAttachmentRatio", "stateQualityColumnReasonCode"]) {
        expect(dictionary.stateQualitySummary, key).toContain(dictionary[key]);
      }
    }
    // Containment alone cannot tell 招标数 from the bare 招标, which is a substring of the summary too: the column
    // counts bids, so it is named exactly as the summary sentence names it.
    expect(zhAdmin.stateQualityColumnBids).toBe("招标数");
    // A table row is a 记录 in the empty-state message, and the notice uses the console's own "Live 来源健康" term.
    expect(zhAdmin.stateQualityNoRows).toContain("数据质量记录");
    expect(zhAdmin.stateQualityP0Notice).toContain(zhAdmin.liveSourceHealth);
  });

  it("keeps no English UI copy in the matrix", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    // The keys are blanked so that a key name is not read as English copy.
    const sourceWithoutKeys = source.replace(/admin\.[A-Za-z_]+/g, "admin.");
    for (const literal of [
      "State data quality action queue",
      "No state data quality actions are open.",
      "No state data quality rows match this filter.",
      "Recommended action",
      "Risk filter",
      "Reason code",
      "P0 blocker review",
      "total states:",
      "all recommended actions",
      "all reason codes",
      "attachment real ratio",
      "enabled source",
      "CA/FL/IL/NY/TX P0 blockers",
      "not live source-health failures",
      "Summary:",
    ]) {
      expect(sourceWithoutKeys, literal).not.toContain(literal);
    }
    // The table headers, the badges and the filter labels are all looked up.
    for (const key of [
      "stateQualityColumnState",
      "stateQualityColumnRisk",
      "stateQualityColumnBids",
      "stateQualityColumnEnabledSource",
      "stateQualityColumnAttachmentRatio",
      "stateQualityColumnReasonCode",
      "stateQualityPass",
      "stateQualityBlockerReview",
      "stateQualitySummary",
      "stateQualityTotalStates",
      "stateQualityActionCount",
      "stateQualityRecommendedAction",
      "stateQualityAllRecommendedActions",
      "stateQualityNoActions",
      "stateQualityDueHours",
      "stateQualityRiskFilter",
      "stateQualityFilterAll",
      "stateQualityReasonCode",
      "stateQualityAllReasonCodes",
      "stateQualityNoRows",
      "stateQualityReasonNone",
    ]) {
      expect(source, key).toContain(`t("admin.${key}")`);
    }
  });

  it("has an English and a different Chinese text, with the same placeholders, for every key it uses", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    const keys = [...new Set([...source.matchAll(/\bt\("admin\.([A-Za-z_]+)"\)/g)].map((match) => match[1]))];
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(enAdmin[key], `en ${key}`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key}`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key} differs from en`).not.toBe(enAdmin[key]);
      expect(placeholders(zhAdmin[key]), `${key} placeholders`).toEqual(placeholders(enAdmin[key]));
    }
  });

  it("formats the real attachment ratio of a state row", () => {
    expect(stateAttachmentRealRatio({ attachmentSummary: { realFileOpenable: 3, total: 4 } } as never)).toBe("3/4 (75%)");
    expect(stateAttachmentRealRatio({ attachmentSummary: { realFileOpenable: 0, total: 0 } } as never)).toBe("0/0 (0%)");
  });
});
