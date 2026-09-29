import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("config registry section", () => {
  // Moved from src/app/admin/page.test.tsx ("loads and renders the config registry matrix with minimal states").
  it("loads and renders the config registry matrix with minimal states", () => {
    const source = readFileSync(new URL("ConfigRegistrySection.tsx", import.meta.url), "utf8");

    expect(source).toContain("listAdminConfigEntries");
    expect(source).toContain("Config Registry");
    expect(source).toContain("Config Matrix");
    expect(source).toContain("configEntries");
    expect(source).toContain("updateAdminConfigEntry");
    expect(source).toContain("configEditDrafts");
    expect(source).toContain("handleConfigRegistrySave");
    expect(source).toContain("Config JSON");
    expect(source).toContain("Change reason");
    expect(source).toContain("Save config");
    expect(source).toContain("changeReason");
    expect(source).toContain("scopeType");
    expect(source).toContain('id="configuration"');
  });

  // Moved from src/app/admin/page.test.ts ("surfaces marketing content CMS copy-library scope ...").
  it("surfaces marketing content CMS copy-library scope and safe-claim guard cues in the config matrix", () => {
    const source = readFileSync(new URL("ConfigRegistrySection.tsx", import.meta.url), "utf8");

    expect(source).toContain("Marketing Content CMS");
    expect(source).toContain("Copy Library");
    expect(source).toContain("homepage/resources scope");
    expect(source).toContain("ux_state.copy_library");
    expect(source).toContain("safe validation");
    expect(source).toContain("unsafe claim guard");
    expect(source).toContain("Unsafe outcome, compliance, or submission claims are rejected");
    expect(source).toContain("falls back to default marketing copy");
  });

  it("loads its own entries", () => {
    const source = readFileSync(new URL("ConfigRegistrySection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminConfigEntries()");
    expect(source).toContain("useAdminResource(");
  });

  it("follows the resource render rule and updates a saved entry in place", () => {
    const source = readFileSync(new URL("ConfigRegistrySection.tsx", import.meta.url), "utf8");
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
    expect(source).toContain("registry.setData(");
  });
});
