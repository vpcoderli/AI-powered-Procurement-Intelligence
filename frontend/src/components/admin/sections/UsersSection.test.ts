import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { featureOverrideFormValues } from "./UsersSection";

describe("users section", () => {
  it("prefills the override form from the stored override", () => {
    expect(featureOverrideFormValues(null, "submission_guidance")).toEqual({ reason: "", expiresAt: "" });
    const data = {
      overrides: [{ featureKey: "submission_guidance", reason: "Pilot", expiresAt: "2026-12-31T23:59:59.000Z" }],
    } as never;
    expect(featureOverrideFormValues(data, "submission_guidance")).toEqual({ reason: "Pilot", expiresAt: "2026-12-31" });
  });

  it("owns its data and its header action", () => {
    const source = readFileSync(new URL("UsersSection.tsx", import.meta.url), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("listAdminUsers(userFilters)");
    expect(source).toContain("useAdminResource(loadUsers)");
    expect(source).toContain("createAdminUser(");
    expect(source).toContain("updateAdminUserFeatureOverride(");
    expect(source).toContain("reconcileAdminSubscriptions(");
    expect(source).toContain('t("admin.inviteUser")');
    expect(source).not.toContain("listAdminUserAuditLogs");
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the user access controls it took over from the dashboard page", () => {
    const source = readFileSync(new URL("UsersSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("listAdminUsers");
    expect(source).toContain("createAdminUser");
    expect(source).toContain("listAdminUserFeatureOverrides");
    expect(source).toContain("reconcileAdminSubscriptions");
    expect(source).toContain("updateAdminUserAccess");
    expect(source).toContain("updateAdminUserFeatureOverride");
    expect(source).toContain('t("admin.users")');
    expect(source).toContain('t("admin.temporaryPassword")');
    expect(source).toContain("invitationDraft");
    expect(source).toContain("handleCreateAdminUser");
    expect(source).toContain('t("admin.featureOverrides")');
    expect(source).toContain('t("admin.overrideReason")');
    expect(source).toContain('t("admin.overrideExpiresAt")');
    expect(source).toContain('t("admin.overrideExpired")');
    expect(source).toContain("featureOverrideReason");
    expect(source).toContain("featureOverrideExpiresAt");
    expect(source).toContain("userFilters");
    expect(source).toContain("featureOverrideUser");
    expect(source).toContain("USER_ROLES");
    expect(source).toContain("ACCOUNT_TIERS");
    expect(source).toContain('t("admin.reconcileSubscriptions")');
  });
});
