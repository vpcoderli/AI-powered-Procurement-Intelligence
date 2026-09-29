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
});
