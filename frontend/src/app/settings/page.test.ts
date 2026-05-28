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
    expect(page).toContain("fetchAccountSubscription");
    expect(page).toContain("fetchBillingInvoices");
    expect(page).toContain("createCheckoutSession");
    expect(page).toContain("cancelAccountSubscription");
    expect(page).toContain("fetchAccountWorkspace");
    expect(page).toContain("updateAccountWorkspace");
    expect(page).toContain("inviteWorkspaceMember");
    expect(page).toContain("updateWorkspaceMemberRole");
    expect(page).toContain("removeWorkspaceMember");
    expect(page).toContain("user?.email");
    expect(page).toContain("workspaceData");
    expect(page).toContain("settings.team");
    expect(page).toContain("settings.inviteMember");
    expect(page).toContain("settings.temporaryPassword");
    expect(page).toContain("settings.changeRole");
    expect(page).toContain("settings.removeMember");
    expect(page).toContain("settings.memberUpdated");
    expect(page).toContain("settings.memberRemoved");
    expect(page).toContain("displayName");
    expect(page).toContain("refreshSession");
    expect(page).toContain("settings.billing");
    expect(page).toContain("settings.availablePlans");
    expect(page).toContain("settings.startCheckout");
    expect(page).toContain("settings.checkoutStarted");
    expect(page).toContain("settings.cancelSubscription");
    expect(page).toContain("settings.invoiceHistory");
    expect(page).toContain("settings.noInvoices");
    expect(page).toContain("settings.viewInvoice");
  });
});
