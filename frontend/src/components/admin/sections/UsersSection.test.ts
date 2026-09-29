import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { endOfDayIsoFromDateInput } from "../admin-format";
import { featureOverrideCanBeSaved, featureOverrideFormValues } from "./UsersSection";

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

// The feature-overrides route stores a null `expiresAt` as "no expiry" (the override never lapses), and endOfDayIsoFromDateInput
// answers null for text Date cannot read (a five- or six-digit year, which a date <input> in desktop Chrome takes) just as it does
// for an emptied input. So one slip in the year of an Enable or Disable saved a permanent override.
describe("feature override expiry", () => {
  const typedByMistake = ["20261-12-31", "275760-09-13", "10000-01-01", "2026-13-45"];

  it("still saves an emptied date, as an override with no expiry", () => {
    for (const isEnabled of [true, false, null]) expect(featureOverrideCanBeSaved(isEnabled, ""), String(isEnabled)).toBe(true);
    expect(endOfDayIsoFromDateInput("")).toBeNull();
  });

  it("still saves a day, sent as the end of that day in UTC", () => {
    for (const isEnabled of [true, false, null]) expect(featureOverrideCanBeSaved(isEnabled, "2026-12-31"), String(isEnabled)).toBe(true);
    expect(endOfDayIsoFromDateInput("2026-12-31")).toBe("2026-12-31T23:59:59.000Z");
    expect(featureOverrideCanBeSaved(true, "9999-12-31")).toBe(true);
  });

  it("does not save an enable or a disable while the date is text that is no day", () => {
    for (const typed of typedByMistake) {
      expect(endOfDayIsoFromDateInput(typed), typed).toBeNull();
      expect(featureOverrideCanBeSaved(true, typed), `enable ${typed}`).toBe(false);
      expect(featureOverrideCanBeSaved(false, typed), `disable ${typed}`).toBe(false);
    }
  });

  it("lets an override be cleared whatever the date field holds, because clearing sends no expiry", () => {
    for (const typed of ["", "2026-12-31", ...typedByMistake]) expect(featureOverrideCanBeSaved(null, typed), typed).toBe(true);
  });

  it("holds back Enable and Disable, not Clear, and marks the date field invalid, with no new string", () => {
    const source = readFileSync(new URL("UsersSection.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*\bisUnreadableDateInput\b[^}]*\} from "\.\.\/admin-format";/);
    // The handler refuses as well, so no save goes out even if a button were enabled.
    expect(source).toContain("if (!featureOverrideUser || !featureOverrideCanBeSaved(isEnabled, featureOverrideExpiresAt)) return;");
    expect(source).toMatch(/onClick=\{\(\) => saveFeatureOverride\(true\)\}\s+disabled=\{isLoadingFeatureOverrides \|\| isUpdatingFeatureOverride \|\| !featureOverrideCanBeSaved\(true, featureOverrideExpiresAt\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => saveFeatureOverride\(false\)\}\s+disabled=\{isLoadingFeatureOverrides \|\| isUpdatingFeatureOverride \|\| !featureOverrideCanBeSaved\(false, featureOverrideExpiresAt\)\}/);
    expect(source).toMatch(/onClick=\{\(\) => saveFeatureOverride\(null\)\}\s+disabled=\{isLoadingFeatureOverrides \|\| isUpdatingFeatureOverride\}/);
    expect(source).toContain("aria-invalid={isUnreadableDateInput(featureOverrideExpiresAt) || undefined}");
    // What is sent for a day, and for an emptied input, is built as before.
    expect(source).toContain("expiresAt: isEnabled === null ? null : endOfDayIsoFromDateInput(featureOverrideExpiresAt),");
  });
});
