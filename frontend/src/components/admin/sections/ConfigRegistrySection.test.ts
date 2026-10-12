import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

const source = readFileSync(new URL("ConfigRegistrySection.tsx", import.meta.url), "utf8");
const enAdmin = en.admin as Record<string, string>;
const zhAdmin = zh.admin as Record<string, string>;
const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

/** The component with its dictionary keys blanked, so a key such as `configRegistryRefreshing` is not read as the word "Refreshing". */
const sourceWithoutKeys = source.replace(/admin\.[A-Za-z_]+/g, "admin.");
/** Every `admin.` key the component looks up with a literal `t("admin.<key>")`. */
const literalKeys = [...new Set([...source.matchAll(/\bt\("admin\.([A-Za-z_]+)"\)/g)].map((match) => match[1]))];
/** The status labels it looks up through `t(\`admin.configRegistryStatus_${status}\`)`. */
const statusKeys = ["active", "draft", "inactive"].map((status) => `configRegistryStatus_${status}`);

describe("config registry section", () => {
  it("starts and settles each config save under its own entry id", () => {
    const save = source.slice(source.indexOf("const handleConfigRegistrySave"), source.indexOf("const onDraftChange"));

    expect(save).toContain("setConfigBusy(entry.id, true);");
    expect(save).toMatch(/\.finally\(\(\) => \{\s+setConfigBusy\(entry.id, false\);\s+\}\);/);
    expect(source).toContain("const isSaving = savingConfigEntryIds.has(entry.id);");
    expect(source).not.toContain("setSavingConfigEntryId");
  });
  // Moved from src/app/admin/page.test.tsx ("loads and renders the config registry matrix with minimal states").
  it("loads and renders the config registry matrix with minimal states", () => {
    expect(source).toContain("listAdminConfigEntries");
    expect(source).toContain('t("admin.configRegistryTitle")');
    expect(source).toContain('t("admin.configRegistrySubtitle")');
    expect(source).toContain("configEntries");
    expect(source).toContain("updateAdminConfigEntry");
    expect(source).toContain("configEditDrafts");
    expect(source).toContain("handleConfigRegistrySave");
    expect(source).toContain('t("admin.configRegistryConfigJson")');
    expect(source).toContain('t("admin.configRegistryChangeReason")');
    expect(source).toContain('t("admin.configRegistrySave")');
    expect(source).toContain("changeReason");
    expect(source).toContain("scopeType");
    expect(source).toContain('id="configuration"');
  });

  // Moved from src/app/admin/page.test.ts ("surfaces marketing content CMS copy-library scope ...").
  it("surfaces marketing content CMS copy-library scope and safe-claim guard cues in the config matrix", () => {
    for (const key of [
      "configRegistryCmsTitle",
      "configRegistryCmsDescription",
      "configRegistrySafeValidationLabel",
      "configRegistrySafeValidationText",
      "configRegistryCopyLibraryNote",
    ]) {
      expect(source, key).toContain(`t("admin.${key}")`);
    }
    expect(source).toContain("ux_state.copy_library");

    // The cues themselves live in the dictionary now.
    expect(enAdmin.configRegistryCmsTitle).toContain("Marketing Content CMS");
    expect(enAdmin.configRegistryCmsDescription).toContain("Copy Library");
    expect(enAdmin.configRegistryCmsDescription).toContain("homepage/resources scope");
    expect(enAdmin.configRegistrySafeValidationLabel).toContain("safe validation");
    expect(enAdmin.configRegistrySafeValidationText).toContain("unsafe claim guard");
    expect(enAdmin.configRegistrySafeValidationText).toContain("Unsafe outcome, compliance, or submission claims are rejected");
    expect(enAdmin.configRegistrySafeValidationText).toContain("falls back to default marketing copy");
    expect(enAdmin.configRegistryCopyLibraryNote).toContain("Copy Library");
    expect(enAdmin.configRegistryCopyLibraryNote).toContain("homepage/resources scope");
    expect(enAdmin.configRegistryCopyLibraryNote).toContain("unsafe claim guard");
  });

  it("puts the CMS entry id in a code chip at the {key} placeholder of the description, in both languages", () => {
    expect(source).toContain('t("admin.configRegistryCmsDescription").split("{key}")');
    expect(enAdmin.configRegistryCmsDescription.split("{key}")).toHaveLength(2);
    expect(zhAdmin.configRegistryCmsDescription.split("{key}")).toHaveLength(2);
  });

  it("loads its own entries", () => {
    expect(source).toContain("listAdminConfigEntries()");
    expect(source).toContain("useAdminResource(");
  });

  it("follows the resource render rule and updates a saved entry in place", () => {
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
    expect(source).toContain("registry.setData(");
  });

  // A failed reload with entries on screen shows the render rule's notice only, never a second banner.
  it("reports a failed refresh once, through the render rule's notice", () => {
    expect(source).not.toContain("isError");
    expect(source).not.toContain("Config registry could not be loaded.");
    expect(source).toContain('{registry.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}');
  });

  it("keeps no English UI copy in the component", () => {
    // Titles, buttons, headers, the empty state and the four notices all come from the dictionary.
    for (const literal of [
      "Config Registry",
      "Config Matrix",
      "Marketing Content CMS",
      "Copy Library",
      "safe validation",
      "unsafe claim guard",
      "Unsafe outcome",
      "No config registry entries found.",
      "Config JSON",
      "Change reason",
      "Save config",
      "Config JSON is invalid.",
      "Change reason is required.",
      "Config saved.",
      "Config update failed.",
      "Refreshing",
      "Last:",
    ]) {
      expect(sourceWithoutKeys, literal).not.toContain(literal);
    }
    for (const notice of ["InvalidJson", "ReasonRequired", "Saved", "SaveFailed"]) {
      expect(source).toContain(`setNotice(t("admin.configRegistry${notice}"))`);
    }
    // The saved reason is admin-typed text: a replacer function keeps a `$&` in it literal.
    expect(source).toContain('.replace("{reason}", () => entry.changeReason || "-")');
    // Statuses are listed once and labelled through the dictionary (an unknown one prints as stored).
    expect(source).toContain("CONFIG_STATUSES.map(");
    expect(source).toContain("t(`admin.configRegistryStatus_${status}`)");
    expect(source).not.toContain('<option value="active">');
  });

  it("has an English and a different Chinese text for every key it uses", () => {
    expect(literalKeys.length).toBeGreaterThan(20);
    for (const key of [...literalKeys, ...statusKeys]) {
      expect(enAdmin[key], `en ${key}`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key}`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key} differs from en`).not.toBe(enAdmin[key]);
      expect(placeholders(zhAdmin[key]), `${key} placeholders`).toEqual(placeholders(enAdmin[key]));
    }
  });

  it("gives every config status a label", () => {
    expect(statusKeys.map((key) => enAdmin[key])).toEqual(["active", "draft", "inactive"]);
    expect(statusKeys.map((key) => zhAdmin[key])).toEqual(["已启用", "草稿", "已停用"]);
  });

  it("words the Chinese status labels and the safe-validation sentence as the console does", () => {
    // 已启用 / 已停用 are the console's status words (overview column, source health); 启用 / 停用 alone are its buttons.
    expect(zhAdmin.configRegistryStatus_active).toBe(zhAdmin.overviewColumnEnabled);
    expect(zhAdmin.configRegistryStatus_inactive).toBe(zhAdmin.sourcesHealth_disabled);
    expect(zhAdmin.configRegistryStatus_active).not.toBe(zhAdmin.sourceDetailEnable);
    expect(zhAdmin.configRegistryStatus_inactive).not.toBe(zhAdmin.sourceDetailDisable);
    // The label ends in the colon, so the sentence after it carries none of its own.
    expect(zhAdmin.configRegistrySafeValidationLabel).toMatch(/：$/);
    expect(zhAdmin.configRegistrySafeValidationText).not.toMatch(/[:：]/);
  });
});
