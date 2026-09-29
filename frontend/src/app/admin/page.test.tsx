import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin sources page section", () => {
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

    expect(page).toContain("sourceHealthTriageStatus");
    expect(page).toContain("updateSourceHealthTriage");
    expect(page).toContain("sourceHealthTriagePatchForAction");
    expect(page).toContain('t("admin.sourceHealthTriage")');

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
