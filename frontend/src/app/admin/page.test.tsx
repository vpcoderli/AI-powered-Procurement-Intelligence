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
    expect(page).toContain("{canManageConfig && !isFullyFailedDashboard && (");
  });

  it("renders source health classification filter structure in the data sources section", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("sourceHealthClassificationFilter");
    expect(page).toContain("setSourceHealthClassificationFilter");
    expect(page).toContain("sourceHealthClassificationFilteredSummary");
    expect(page).toContain("sourceHealthClassificationEmpty");
    expect(page).toContain("sources.length === 0");
  });

  it("renders source health triage queue fields and dispositions in the data sources section", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const en = readFileSync(new URL("../../lib/i18n/dictionaries/en.ts", import.meta.url), "utf8");
    const zh = readFileSync(new URL("../../lib/i18n/dictionaries/zh.ts", import.meta.url), "utf8");

    expect(page).toContain("liveHealthOwner");
    expect(page).toContain("liveHealthDisposition");
    expect(page).toContain("liveHealthNextReviewAt");
    expect(page).toContain("liveHealthNotes");
    expect(page).toContain("liveHealthReviewedAt");
    expect(page).toContain("sourceHealthTriageStatus");
    expect(page).toContain("updateSourceHealthTriage");
    expect(page).toContain("sourceHealthTriagePatchForAction");
    expect(page).toContain('t("admin.sourceHealthTriage")');
    expect(page).toContain('t("admin.sourceHealthTriage_unassigned")');
    expect(page).toContain('t("admin.sourceHealthTriage_overdue")');
    expect(page).toContain('t("admin.sourceHealthTriage_scheduled")');
    expect(page).toContain('t("admin.sourceHealthDisposition_accepted_fallback")');
    expect(page).toContain('t("admin.sourceHealthDisposition_manual")');
    expect(page).toContain('t("admin.sourceHealthDisposition_vendor_account")');
    expect(page).toContain("sourceHealthTriageAssign");
    expect(page).toContain("sourceHealthTriageAcceptFallback");
    expect(page).toContain("sourceHealthTriageClear");

    for (const dictionary of [en, zh]) {
      expect(dictionary).toContain("sourceHealthTriage");
      expect(dictionary).toContain("sourceHealthTriage_unassigned");
      expect(dictionary).toContain("sourceHealthTriage_overdue");
      expect(dictionary).toContain("sourceHealthTriage_scheduled");
      expect(dictionary).toContain("sourceHealthDisposition_accepted_fallback");
      expect(dictionary).toContain("sourceHealthDisposition_manual");
      expect(dictionary).toContain("sourceHealthDisposition_vendor_account");
      expect(dictionary).toContain("sourceHealthTriageAssign");
      expect(dictionary).toContain("sourceHealthTriageAcceptFallback");
      expect(dictionary).toContain("sourceHealthTriageClear");
    }
  });
});
