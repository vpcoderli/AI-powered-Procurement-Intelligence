import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin config registry page section", () => {
  it("loads and renders the config registry matrix with minimal states", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("listAdminConfigEntries");
    expect(page).toContain("Config Registry");
    expect(page).toContain("Config Matrix");
    expect(page).toContain("configEntries");
    expect(page).toContain("configRegistryStatus");
    expect(page).toContain("refreshConfigRegistry");
    expect(page).toContain("updateAdminConfigEntry");
    expect(page).toContain("configEditDrafts");
    expect(page).toContain("handleConfigRegistrySave");
    expect(page).toContain("Config JSON");
    expect(page).toContain("Change reason");
    expect(page).toContain("Save config");
    expect(page).toContain("changeReason");
    expect(page).toContain("scopeType");
  });

  it("keeps config registry loading and editing admin-only", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("const canManageConfig = isAdmin");
    expect(page).toContain("if (!canManageConfig) return Promise.resolve()");
    expect(page).toContain("{canManageConfig && state.status === \"ready\" && (");
  });
});
