import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("onboarding section", () => {
  it("mounts the phase-3 panels with the platform families from readiness", () => {
    const source = readFileSync(new URL("OnboardingSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("getAdminApprovalReadiness()");
    expect(source).toContain("providerFamiliesOf(summary.sources)");
    expect(source).toContain("<PlatformReviewsPanel");
    expect(source).toContain("canManage={isAdmin}");
    expect(source).toContain("<LedgeredApprovalPanel");
    expect(source).toContain("canApprove={isAdmin}");
    expect(source).toContain("canRequestPrechecks={canRunOperations}");
    expect(source).toContain("refreshKey={platformReviewRevision}");
  });

  it("puts both panels in the shared panel card", () => {
    const source = readFileSync(new URL("OnboardingSection.tsx", import.meta.url), "utf8");
    const cards = readFileSync(new URL("../AdminStateCards.tsx", import.meta.url), "utf8");
    expect(source.split("<section className={ADMIN_PANEL_CARD}>")).toHaveLength(3);
    expect(source).not.toContain("const PANEL_CARD");
    // The panels end in a hairline of their own; the card drops it on the last edge.
    expect(cards).toContain('export const ADMIN_PANEL_CARD = "rounded-lg border border-slate-200 bg-white shadow-sm [&>div]:border-b-0";');
  });
});
