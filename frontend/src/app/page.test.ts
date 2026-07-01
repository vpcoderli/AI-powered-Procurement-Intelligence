import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function sliceBetween(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return value.slice(startIndex, endIndex);
}

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
    expect(page).toContain("getMarketingHomepageContent");
    expect(page).toContain("auth.isLoading");
    expect(page).toContain("if (!auth.user)");
    expect(page).toContain("fetchDashboardSummary");
    expect(page).toContain("auth.user");
  });

  it("turns the anonymous home route into the Homepage PRD marketing surface", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("marketing-navigation");
    expect(page).toContain('key === "sign_in"');
    expect(page).toContain('key === "start_free"');
    expect(page).toContain('eventName="click_request_demo"');
    expect(page).toContain("content.sections.howItWorks");
    expect(page).toContain("content.sections.productMap");
    expect(page).toContain("content.sections.pricing");
    expect(page).toContain("content.sections.resources");
    expect(page).toContain("resource.href");
    expect(page).toContain("content.sections.faq");
    expect(page).toContain("how-it-works");
    expect(page).toContain("product-map");
    expect(page).toContain("knowledge-station");
    expect(page).toContain("pricing");
    expect(page).toContain("resources");
    expect(page).toContain("safe-claims");
    expect(page).toContain("requestDemo");
  });

  it("keeps login and registration visible in the anonymous homepage header", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain('aria-label="Anonymous account actions"');
    expect(page).toContain('item.key === "sign_in"');
    expect(page).toContain('item.key === "start_free"');
    expect(page).toContain('href="/login"');
    expect(page).toContain('href="/register"');
  });

  it("keeps signed-in users on the command center instead of the anonymous marketing nav", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("if (!auth.user) return <PublicHome language={language} />");
    expect(page).toContain('aria-label="WinBids command overview"');
    expect(page).toContain("copy.title");
    expect(page).toContain("fetchDashboardSummary()");
  });

  it("tracks homepage funnel actions through the local analytics seam", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("recordHomepageAnalyticsEvent");
    expect(page).toContain('eventNames={["click_start_free", "start_signup"]}');
    expect(page).toContain('"view_homepage"');
    expect(page).toContain('"click_start_free"');
    expect(page).toContain('"click_see_how_it_works"');
    expect(page).toContain('"click_pricing_tier"');
    expect(page).toContain('"click_public_search"');
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

  it("uses native anchor links for dashboard CTAs instead of Base UI button render overrides", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).not.toContain('render={<Link');
    expect(page).toContain("buttonVariants");
  });

  it("wires Product 6 procurement intelligence into the signed-in command center only", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const publicHome = sliceBetween(page, "function PublicHome", "function DashboardLoading");
    const dashboardEffect = sliceBetween(page, "useEffect(() =>", "if (auth.isLoading) return <DashboardLoading />");

    expect(page).toContain('import { fetchProcurementIntelligence } from "@/lib/api/intelligence"');
    expect(page).toContain("import type { ProcurementIntelligenceSummary }");
    expect(page).toContain("const [intelligence, setIntelligence] = useState<ProcurementIntelligenceSummary | null>(null)");
    expect(dashboardEffect).toContain("fetchProcurementIntelligence()");
    expect(dashboardEffect).toContain("Promise.all");
    expect(dashboardEffect).toContain("if (auth.isLoading || !userId)");
    expect(publicHome).not.toContain("fetchProcurementIntelligence");
    expect(publicHome).not.toContain("intelligence?.");
  });

  it("shows deterministic Product 6 cockpit metrics, top signals, and limitations without claiming live LLM use", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("Product 6");
    expect(page).toContain("Procurement intelligence");
    expect(page).toContain("intelligence?.cockpit.activePursuits");
    expect(page).toContain("intelligence?.cockpit.needsAction");
    expect(page).toContain("intelligence?.cockpit.decisionQueue");
    expect(page).toContain("intelligence?.cockpit.staleOrAtRisk");
    expect(page).toContain("intelligence?.cockpit.averageMatchScore");
    expect(page).toContain("intelligence?.topSignals");
    expect(page).toContain("intelligence?.limitations");
    expect(page).toContain("deterministic_local");
    expect(page).toContain("no live LLM");
    expect(page).toContain("llm");
    expect(page).toContain("not_used");
  });
});
