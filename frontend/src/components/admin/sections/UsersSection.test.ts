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
    expect(source).toContain(
      "if (!featureOverrideUser || !featureOverrideCanBeSaved(isEnabled, featureOverrideExpiresAt, featureOverrideExpiresAtBadInput)) return;",
    );
    expect(source).toMatch(
      /onClick=\{\(\) => saveFeatureOverride\(true\)\}\s+disabled=\{isLoadingFeatureOverrides \|\| isUpdatingFeatureOverride \|\| !featureOverrideCanBeSaved\(true, featureOverrideExpiresAt, featureOverrideExpiresAtBadInput\)\}/,
    );
    expect(source).toMatch(
      /onClick=\{\(\) => saveFeatureOverride\(false\)\}\s+disabled=\{isLoadingFeatureOverrides \|\| isUpdatingFeatureOverride \|\| !featureOverrideCanBeSaved\(false, featureOverrideExpiresAt, featureOverrideExpiresAtBadInput\)\}/,
    );
    expect(source).toMatch(/onClick=\{\(\) => saveFeatureOverride\(null\)\}\s+disabled=\{isLoadingFeatureOverrides \|\| isUpdatingFeatureOverride\}/);
    expect(source).toContain("aria-invalid={isUnreadableDateInput(featureOverrideExpiresAt, featureOverrideExpiresAtBadInput) || undefined}");
    // What is sent for a day, and for an emptied input, is built as before.
    expect(source).toContain("expiresAt: isEnabled === null ? null : endOfDayIsoFromDateInput(featureOverrideExpiresAt),");
  });
});

// A date <input> that the user has cleared one segment of, or typed only some of, reports value "" with validity.badInput: the
// same "" as an emptied input, which the route stores as "no expiry". So a slip while typing an expiry saved a permanent override.
describe("feature override expiry, half typed", () => {
  it("does not save an enable or a disable while the date input is half typed, though its value reads empty", () => {
    for (const isEnabled of [true, false]) expect(featureOverrideCanBeSaved(isEnabled, "", true), String(isEnabled)).toBe(false);
  });

  it("takes the flag as the word of the input, whatever value it reads", () => {
    for (const isEnabled of [true, false]) expect(featureOverrideCanBeSaved(isEnabled, "2026-12-31", true), String(isEnabled)).toBe(false);
  });

  it("still lets an override be cleared while the field is half typed, because clearing sends no expiry", () => {
    expect(featureOverrideCanBeSaved(null, "", true)).toBe(true);
    expect(featureOverrideCanBeSaved(null, "2026-12-31", true)).toBe(true);
  });

  it("still saves an emptied date (no badInput) as an override with no expiry, and a day as the end of that day", () => {
    for (const isEnabled of [true, false, null]) {
      expect(featureOverrideCanBeSaved(isEnabled, "", false), `${isEnabled} emptied`).toBe(true);
      expect(featureOverrideCanBeSaved(isEnabled, "2026-12-31", false), `${isEnabled} day`).toBe(true);
    }
    // A caller that has only the value keeps the old answer.
    expect(featureOverrideCanBeSaved(true, "")).toBe(true);
  });

  // Chrome fires input/change for the edit that empties a complete date, but not for clearing the segments that are left or for
  // typing into an empty field (see readDateInput), so the input is read on change, on key up and on blur, and a reset of the
  // form has to reset the field itself: React does not rewrite a value it already holds, so a half-typed date would survive a
  // reset to "".
  it("reads the input on change, key up and blur into a flag apart from the controlled value", () => {
    const source = readFileSync(new URL("UsersSection.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/import \{[^}]*\breadDateInput\b[^}]*\} from "\.\.\/admin-format";/);
    expect(source).toContain("const [featureOverrideExpiresAtBadInput, setFeatureOverrideExpiresAtBadInput] = useState(false);");
    expect(source).toContain("onChange={(event) => recordExpiresAtInput(event.currentTarget)}");
    expect(source).toContain("onKeyUp={(event) => recordExpiresAtInput(event.currentTarget)}");
    expect(source).toContain("onBlur={(event) => recordExpiresAtInput(event.currentTarget)}");
    expect(source).toContain("const reading = readDateInput(input);");
    expect(source).toContain("setFeatureOverrideExpiresAt(reading.value);");
    expect(source).toContain("setFeatureOverrideExpiresAtBadInput(reading.badInput);");
    expect(source).toContain("value={featureOverrideExpiresAt}");
    expect(source).not.toContain("onChange={(event) => setFeatureOverrideExpiresAt(event.target.value)}");
  });

  it("resets the flag and the field together whenever the form is filled from stored data", () => {
    const source = readFileSync(new URL("UsersSection.tsx", import.meta.url), "utf8");
    const sync = source.slice(source.indexOf("const syncFeatureOverrideForm"), source.indexOf("const recordExpiresAtInput"));

    expect(sync).toContain("setFeatureOverrideExpiresAt(form.expiresAt);");
    expect(sync).toContain("setFeatureOverrideExpiresAtBadInput(false);");
    // A new key remounts the input, which drops whatever the user had half typed.
    expect(sync).toContain("setFeatureOverrideFormVersion((version) => version + 1);");
    expect(source).toContain("key={featureOverrideFormVersion}");
  });
});
