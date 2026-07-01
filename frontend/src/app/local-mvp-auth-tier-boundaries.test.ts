import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lockedFeatureMessage } from "@/lib/features/useFeature";
import { hasFeature } from "@/server/auth/entitlements";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function sliceBetween(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return value.slice(startIndex, endIndex);
}

describe("local MVP auth and tier boundaries", () => {
  it("keeps unauthenticated home public and away from dashboard summary fetches", () => {
    const page = source("page.tsx");
    const content = source("../lib/marketing/homepage-content.ts");
    const publicHome = sliceBetween(page, "function PublicHome", "function DashboardLoading");

    expect(page).toContain("if (!auth.user) return <PublicHome language={language} />");
    expect(publicHome).toContain("getMarketingHomepageContent(language)");
    expect(content).toContain('signIn: "/login"');
    expect(content).toContain('startFree: "/register"');
    expect(publicHome).not.toContain("fetchDashboardSummary");
    expect(publicHome).not.toContain("summary?.");
  });

  it("only fetches the signed-in dashboard summary after auth resolves to a user", () => {
    const page = source("page.tsx");
    const effect = sliceBetween(page, "useEffect(() =>", "if (auth.isLoading) return <DashboardLoading />");

    expect(page).toContain("const userId = auth.user?.id");
    expect(effect).toContain("if (auth.isLoading || !userId)");
    expect(effect).toContain("fetchDashboardSummary()");
    expect(effect).toContain("}, [auth.isLoading, userId]);");
  });

  it("exposes login and register actions from the shell for anonymous users", () => {
    const layout = source("layout.tsx");
    const topbarActions = source("../components/layout/topbar-auth-actions.tsx");
    const anonymousTopbar = sliceBetween(topbarActions, "if (!user)", "  return (\n    <div className=\"flex items-center gap-2\">\n      <div");

    expect(layout).toContain("TopbarAuthActions");
    expect(anonymousTopbar).toContain('href="/login"');
    expect(anonymousTopbar).toContain('href="/register"');
    expect(anonymousTopbar).not.toContain("logout");
  });

  it("keeps admin source health and admin console CTAs behind admin/operator/support role checks", () => {
    const page = source("page.tsx");
    const sidebar = source("../components/layout/app-sidebar.tsx");

    expect(page).toContain('const adminConsoleRoles: readonly UserRole[] = ["admin", "operator", "support"]');
    expect(page).toContain("const isAdminUser = auth.user ? adminConsoleRoles.includes(auth.user.role) : false");
    const adminOnlyAside = sliceBetween(page, "{isAdminUser && (", "<article className=\"winbids-hero-panel\">\n            <p className=\"winbids-kicker\">Access</p>");

    expect(page).toContain("{isAdminUser && (");
    expect(page).toContain("copy.sourceHealth");
    expect(page).toContain("copy.adminAction");
    expect(adminOnlyAside).toContain("copy.sourceHealth");
    expect(adminOnlyAside).toContain('href="/admin"');

    expect(sidebar).toContain('import { ADMIN_CONSOLE_ROLES } from "@/server/auth/entitlements"');
    expect(sidebar).not.toContain('const adminConsoleRoles = ["admin", "operator", "support"]');
    expect(sidebar).toContain("const isAdminUser = user ?");
    expect(sidebar).toContain("ADMIN_CONSOLE_ROLES.includes");
    expect(sidebar).toContain('url: "/admin"');
  });

  it("keeps paid intent modules on locked feature messages and plan-limit states", () => {
    const intentPage = source("intents/[id]/page.tsx");

    expect(intentPage).toContain('import { lockedFeatureMessage, useFeature } from "@/lib/features/useFeature"');
    expect(intentPage).toContain("function LockedFeatureState");
    expect(intentPage).toContain('code="plan_limit"');

    for (const feature of [
      "submission_guidance",
      "compliance_manifest",
      "pursue_no_bid",
      "response.workspace.create",
      "artifact.vault.upload",
      "quote_workflow",
      "deadline_notifications",
      "knowledge_station",
    ]) {
      expect(intentPage).toContain(`lockedFeatureMessage("${feature}")`);
    }
  });

  it("keeps anonymous users out of personal workspace page and API boundaries", () => {
    const intentPage = source("intents/[id]/page.tsx");
    const routeGuard = source("../server/auth/route-guards.ts");
    const personalCoverage = source("../server/auth/personal-route-coverage.test.ts");

    expect(intentPage).toContain("const intentId = user ? typeof params?.id");
    expect(intentPage).toContain("return <AuthRequiredState />");

    expect(routeGuard).toContain("authRequiredResponse");
    expect(routeGuard).toContain("AUTH_REQUIRED");
    expect(personalCoverage).toContain("personalWorkspaceRoutes");
    expect(personalCoverage).toContain("isAuthenticatedPrincipal");
    expect(personalCoverage).toContain("authRequiredResponse");
  });

  it("keeps the free/pro/business/enterprise feature matrix covered by existing entitlement tests", () => {
    const entitlementsTest = source("../server/auth/entitlements.test.ts");
    const featureHookTest = source("../lib/features/useFeature.test.ts");

    expect(entitlementsTest).toContain("keeps the paid feature entitlement matrix aligned with product tiers");

    for (const tier of ['tier: "free"', 'tier: "pro"', 'tier: "business"', 'tier: "enterprise"']) {
      expect(entitlementsTest).toContain(tier);
    }

    expect(featureHookTest).toContain("canUseFeature(null");
    expect(featureHookTest).toContain('lockedFeatureMessage("submission_guidance")');
    expect(featureHookTest).toContain('lockedFeatureMessage("compliance_manifest")');
  });

  it("keeps paid feature locks upgrade-oriented without granting paid users admin console access", () => {
    expect(lockedFeatureMessage("submission_guidance")).toBe("Upgrade to Pursuit Starter to unlock this feature.");
    expect(lockedFeatureMessage("compliance_manifest")).toBe("Upgrade to Response Builder to unlock this feature.");
    expect(lockedFeatureMessage("knowledge_station")).toBe("Upgrade to Enterprise to unlock this feature.");
    expect(lockedFeatureMessage("admin_console")).toBe("Admin role is required for this feature.");

    expect(hasFeature({ role: "user", tier: "free" }, "submission_guidance")).toBe(false);
    expect(hasFeature({ role: "user", tier: "pro" }, "submission_guidance")).toBe(true);
    expect(hasFeature({ role: "user", tier: "business" }, "compliance_manifest")).toBe(true);
    expect(hasFeature({ role: "user", tier: "enterprise" }, "knowledge_station")).toBe(true);
    expect(hasFeature({ role: "user", tier: "business" }, "admin_console")).toBe(false);
    expect(hasFeature({ role: "admin", tier: "free" }, "admin_console")).toBe(true);
  });
});
