import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
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

  it("starts and settles each access write under its own user id", () => {
    const source = readFileSync(new URL("UsersSection.tsx", import.meta.url), "utf8");
    const update = source.slice(source.indexOf("const updateUserAccess"), source.indexOf("const syncFeatureOverrideForm"));

    expect(update).toContain("setUserBusy(user.id, true);");
    expect(update).toMatch(/\.finally\(\(\) => \{\s+setUserBusy\(user.id, false\);\s+\}\);/);
    expect(source).toContain("const isPending = pendingUserIds.has(user.id);");
    expect(source).not.toContain("setPendingUserId");
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

/** A source file next to this test, or one level over, as text. */
function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

// Opening the panel loads the user's overrides and refills the form when they arrive, and saving refills it from the answer. Both
// handlers used to refill for the feature their own closure held (the one selected when the request started) while the select
// stayed live: switching features meanwhile left the form holding the old feature's reason and expiry under the new feature's
// name, and Enable saved the new feature with them.
describe("feature override panel, feature switch", () => {
  const read = () => readSource("UsersSection.tsx");
  const between = (source: string, from: string, to: string) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    if (start === -1 || end === -1) throw new Error(`no slice from "${from}" to "${to}"`);
    return source.slice(start, end);
  };

  it("locks the feature select while the overrides load, as it does the buttons", () => {
    // From the select's value to its first option: the attributes of the tag, whatever their layout.
    const select = between(read(), "value={featureOverrideFeature}", "OVERRIDABLE_FEATURES.map(");

    expect(select).toContain("disabled={isLoadingFeatureOverrides}");
    // The change handler is unchanged: the form is refilled from what is loaded for the feature chosen.
    expect(select).toContain("setFeatureOverrideFeature(feature);");
    expect(select).toContain("syncFeatureOverrideForm(featureOverrideData, feature);");
  });

  it("keeps the selected feature in a ref that an effect writes, never render", () => {
    const source = read();

    expect(source).toMatch(/import \{[^}]*\buseEffect\b[^}]*\} from "react";/);
    expect(source).toMatch(/import \{[^}]*\buseRef\b[^}]*\} from "react";/);
    expect(source).toContain("const featureOverrideFeatureRef = useRef(featureOverrideFeature);");
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s+featureOverrideFeatureRef\.current = featureOverrideFeature;\s+\}, \[featureOverrideFeature\]\);/,
    );
    // The only write is the one in that effect.
    expect(source.match(/featureOverrideFeatureRef\.current =/g)).toHaveLength(1);
  });

  it("refills the form from a load with the feature selected when it completes, not the one selected when it started", () => {
    const open = between(read(), "const openFeatureOverrides", "const selectedFeatureOverride");

    // Opening still clears the form for the feature selected at the click, which is the render's own value.
    expect(open).toContain("syncFeatureOverrideForm(null, featureOverrideFeature);");
    expect(open).toContain("syncFeatureOverrideForm(response, featureOverrideFeatureRef.current);");
    expect(open).not.toContain("syncFeatureOverrideForm(response, featureOverrideFeature);");
  });

  it("refills the form from a save the same way, and still saves the feature that was selected at the click", () => {
    const save = between(read(), "const saveFeatureOverride", "const handleCreateAdminUser");

    expect(save).toContain("syncFeatureOverrideForm(response, featureOverrideFeatureRef.current);");
    expect(save).not.toContain("syncFeatureOverrideForm(response, featureOverrideFeature);");
    expect(save).toContain("featureKey: featureOverrideFeature,");
  });
});

// The switch column's header and the two states of an account were one key (`admin.enabled`) and, in Chinese, 启用 and 已禁用: 启用 is
// the console's word for the action (a button), and a disabled thing is 已停用 everywhere else (team members, source health, the
// approval reasons). The header is a noun of its own now.
describe("users section state words in the dictionary", () => {
  const enAdmin = en.admin as Record<string, string>;
  const zhAdmin = zh.admin as Record<string, string>;

  it("words the Chinese states as the rest of the console does", () => {
    expect(zhAdmin.enabled).toBe("已启用");
    expect(zhAdmin.disabled).toBe("已停用");
    expect(zhAdmin.enabled).toBe(zhAdmin.overviewColumnEnabled);
    expect(zhAdmin.disabled).toBe(zhAdmin.sourcesHealth_disabled);
    expect(zhAdmin.enabled).toBe(zh.settings.memberStatus_active);
    expect(zhAdmin.disabled).toBe(zh.settings.memberStatus_disabled);
    // 启用 / 停用 alone are the actions.
    expect(zhAdmin.enabled).not.toBe(zhAdmin.sourceDetailEnable);
    expect(zhAdmin.disabled).not.toBe(zhAdmin.sourceDetailDisable);
  });

  it("keeps the English states as they were", () => {
    expect(enAdmin.enabled).toBe("Enabled");
    expect(enAdmin.disabled).toBe("Disabled");
  });

  it("gives the switch column its own header, a noun in Chinese and the same word as before in English", () => {
    expect(enAdmin.enabledColumn).toBe("Enabled");
    expect(zhAdmin.enabledColumn).toBe("启用状态");
    for (const state of [zhAdmin.enabled, zhAdmin.disabled, zhAdmin.sourceDetailEnable, zhAdmin.sourceDetailDisable]) {
      expect(zhAdmin.enabledColumn).not.toBe(state);
    }
  });

  it("leaves no 已禁用 in the console's Chinese text, whichever key holds it", () => {
    for (const [key, value] of Object.entries(zhAdmin)) expect(value, key).not.toContain("已禁用");
    // The batch run panel's word for a source the crawler skipped because it is disabled.
    expect(zhAdmin.batchRunStatus_disabled).toBe(zhAdmin.sourcesHealth_disabled);
  });

  it("uses the header key for both column headers and the state keys for the states only", () => {
    const users = readSource("UsersSection.tsx");
    const sources = readSource("../sources/SourcesListView.tsx");

    expect(users).toContain('<TableHead className="text-right">{t("admin.enabledColumn")}</TableHead>');
    expect(sources).toContain('<TableHead>{t("admin.enabledColumn")}</TableHead>');
    for (const source of [users, sources]) expect(source).not.toMatch(/<TableHead[^>]*>\{t\("admin\.(enabled|disabled)"\)\}/);
  });
});
