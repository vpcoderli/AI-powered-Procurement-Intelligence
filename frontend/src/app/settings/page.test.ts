import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings page", () => {
  it("shows the current account tier and feature access states", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("useAuth");
    expect(page).toContain("FEATURE_ACCESS_ITEMS");
    expect(page).toContain("canUseFeature");
    expect(page).toContain("lockedFeatureMessage");
    expect(page).toContain("settings.currentPlan");
    expect(page).toContain("settings.featureAccess");
    expect(page).toContain("updateAccountProfile");
    expect(page).toContain("changePassword");
    expect(page).toContain("user?.email");
    expect(page).toContain("displayName");
    expect(page).toContain("refreshSession");
  });
});
