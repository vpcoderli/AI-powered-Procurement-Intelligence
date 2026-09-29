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
});
