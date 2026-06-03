import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("command center dashboard", () => {
  it("focuses the home dashboard on executive summary, notifications, and source health", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("Command Center");
    expect(page).toContain("Today Brief");
    expect(page).toContain("Notification Inbox");
    expect(page).toContain("Pipeline Health");
    expect(page).toContain("Data Trust");
    expect(page).toContain("winbids-workspace");
    expect(page).toContain("fetchDashboardSummary");
  });

  it("does not duplicate the bid search workbench on the home route", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).not.toContain("BidCard");
    expect(page).not.toContain("STATE_FILTERS");
    expect(page).not.toContain("Discovery controls");
    expect(page).not.toContain("fetchBids");
  });

  it("renders dashboard summary values from the API instead of hard-coded command-center metrics", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const api = readFileSync(new URL("../lib/api/dashboard.ts", import.meta.url), "utf8");

    expect(api).toContain("/api/dashboard/summary");
    expect(page).toContain("summary?.briefs.newMatches.value");
    expect(page).toContain("summary?.pipeline.saved");
    expect(page).toContain("summary?.dataTrust.stateCoverage.value");
    expect(page).toContain("summary?.notifications");
  });

  it("shows a different public home for unauthenticated visitors and only fetches dashboard data for signed-in users", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("useAuth");
    expect(page).toContain("PublicHome");
    expect(page).toContain("auth.isLoading");
    expect(page).toContain("if (!auth.user)");
    expect(page).toContain("fetchDashboardSummary");
    expect(page).toContain("auth.user");
  });

  it("adds admin-only command-center actions for operator roles", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("adminConsoleRoles");
    expect(page).toContain("isAdminUser");
    expect(page).toContain("/admin");
    expect(page).toContain("adminAction");
  });

  it("keeps admin source-health links out of the ordinary user dashboard", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("{isAdminUser && (");
    expect(page).toContain("copy.sourceHealth");
    expect(page).toContain("copy.viewSources");
    expect(page).not.toContain('render={<Link href="/admin" />}>\n              {copy.viewSources}');
  });

  it("links pipeline health metrics into intent drill-down views", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("pipelineHref");
    expect(page).toContain("/intents?pipeline=ready");
    expect(page).toContain("/intents?pipeline=blocked");
    expect(page).toContain("/intents?pipeline=missing-artifacts");
    expect(page).toContain("/intents?pipeline=exported");
  });
});
