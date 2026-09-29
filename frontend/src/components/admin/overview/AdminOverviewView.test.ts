import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin overview view", () => {
  it("loads only the overview endpoint and renders the four blocks", () => {
    const view = readFileSync(new URL("AdminOverviewView.tsx", import.meta.url), "utf8");
    expect(view).toContain("getAdminOverview()");
    for (const call of ["listAdminDataSources", "listAdminCrawlerLogs", "listAdminDataSourcesPage"]) expect(view).not.toContain(call);
    for (const key of ["overviewCoverageTitle", "overviewPipelineTitle", "overviewCrawlTitle", "overviewBidsTitle", "overviewPauseHint", "overviewSectionFailed"]) {
      expect(view).toContain(`t("admin.${key}")`);
    }
    expect(view).toContain('canViewAdminPath(role, "/admin/quality/bids")');
    expect(view).toContain('href="/admin/sources/onboarding"');
  });

  // t() is a plain dot-path lookup: a `{placeholder}` renders literally unless the caller resolves it.
  it("resolves the {time}, {date} and {count} placeholders itself", () => {
    const view = readFileSync(new URL("AdminOverviewView.tsx", import.meta.url), "utf8");
    expect(view).toContain('.replace("{time}"');
    expect(view).toContain('.replace("{date}"');
    expect(view).toContain('.replace("{count}"');
    for (const key of ["overviewGeneratedAt", "overviewPipelineNextReview", "overviewShowAllStates", "overviewConsecutiveFailures"]) {
      expect(view).toMatch(new RegExp(`t\\("admin\\.${key}"\\)\\.replace\\("\\{(time|date|count)\\}"`));
    }
  });

  // nextReviewAt is a date-level value; formatDate would shift it into the viewer's zone and add a time.
  it("prints the review date with the shared, timezone-independent label and reuses the panels' helpers", () => {
    const view = readFileSync(new URL("AdminOverviewView.tsx", import.meta.url), "utf8");
    expect(view).toContain("platformReviewDateLabel(row.platformReview.review.nextReviewAt)");
    expect(view).not.toContain("formatDate(row.platformReview");
    expect(view).toContain("platformReviewStatusTone(row.platformReview.status)");
    expect(view).toContain("READINESS_BUCKETS.map(");
    // No local copy of the tone helper or of the bucket list to drift from the panels'.
    expect(view).not.toContain("function reviewStatusTone");
    expect(view).not.toContain('"awaiting_precheck"');
  });
});
