import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin page", () => {
  it("renders the admin access gate and the page header", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("useAuth");
    expect(page).toContain("canAccessAdminConsole");
    expect(page).toContain('t("admin.authLoading")');
    expect(page).toContain('t("admin.loginRequiredTitle")');
    expect(page).toContain('t("admin.forbiddenTitle")');
    expect(page).toContain('t("admin.title")');
    expect(page).toContain('t("admin.description")');
  });

  it("no longer loads or renders the risk check and bid QA sections", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    // They live on /admin/quality and /admin/quality/bids now.
    for (const moved of [
      "getAdminRiskChecklist",
      "listAdminBidQaItems",
      "updateAdminBidQaReview",
      "StateDataQualityMatrix",
      "<RiskCheck",
      "bidQaFilters",
      "selectedBidQaIds",
      "refreshRiskReport",
    ]) {
      expect(page).not.toContain(moved);
    }
  });

  it("no longer mounts the onboarding panels, the batch run, the run-all button or the crawler log list", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    // They live on /admin/sources/onboarding and /admin/sources/runs now.
    for (const moved of [
      "PlatformReviewsPanel",
      "LedgeredApprovalPanel",
      "providerFamiliesOf",
      "platformReviewRevision",
      "JurisdictionBatchRunPanel",
      "runNow",
      "isRunning",
      "admin.runStateCrawlers",
      "AdminCrawlerLog",
      "crawlerLogs",
      "listAdminCrawlerLogs",
      "refreshCrawlerLogs",
      "CrawlerLogRow",
      "admin.recentLogs",
    ]) {
      expect(page).not.toContain(moved);
    }
  });
});
