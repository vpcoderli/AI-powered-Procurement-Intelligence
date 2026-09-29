import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

const KEYS = [
  "growthFunnelTitle",
  "growthExportLeads",
  "growthRequestDemo",
  "growthSignupComplete",
  "growthProfileStarted",
  "growthProfileComplete",
  "growthFirstMatchedBid",
  "growthLatestLeads",
  "growthNoLeads",
] as const;

describe("growth funnel section", () => {
  it("renders every label through the dictionary", () => {
    const source = readFileSync(new URL("GrowthFunnelSection.tsx", import.meta.url), "utf8");
    for (const key of KEYS) expect(source).toContain(`t("admin.${key}")`);
    for (const literal of ["Request Demo", "Signup complete", "Profile started", "Profile complete", "First matched bid", "Export leads CSV"]) {
      expect(source).not.toContain(`>${literal}<`);
      expect(source).not.toContain(`"${literal}"`);
    }
    expect(source).toContain("/api/admin/marketing/leads/export");
    expect(source).toContain("getAdminMarketingFunnel()");
    expect(source).not.toContain('id="data-sources"');
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the funnel data it took over from the dashboard page", () => {
    const source = readFileSync(new URL("GrowthFunnelSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("getAdminMarketingFunnel");
    expect(source).toContain("requestDemoSubmitted");
    expect(source).toContain("latestRequestDemoLeads");
  });

  it("has distinct Chinese copy", () => {
    const enAdmin = en.admin as Record<string, string>;
    const zhAdmin = zh.admin as Record<string, string>;
    for (const key of KEYS) expect(zhAdmin[key]).not.toBe(enAdmin[key]);
  });

  it("follows the resource render rule", () => {
    const source = readFileSync(new URL("GrowthFunnelSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("useAdminResource(loadFunnel)");
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
  });
});
