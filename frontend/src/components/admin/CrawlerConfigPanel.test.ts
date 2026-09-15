import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminDataSource } from "@/lib/api/admin";
import { buildCrawlerConfigPatch, formFromSource } from "./CrawlerConfigPanel";

const source = {
  id: "il_bidbuy",
  label: "Illinois BidBuy",
  cadence: "daily",
  baseUrl: "https://www.bidbuy.illinois.gov",
  fetchConfig: {
    base_url: "https://www.bidbuy.illinois.gov",
    enrichment: {
      enabled: true,
      fields: ["description", "attachments"],
      max_details_per_run: 10,
      min_interval_seconds: 2,
      timeout_seconds: 15,
      detail_selectors: { description: "div.x" },
      attachment_url_template: "https://x/{id}",
    },
  },
} as unknown as AdminDataSource;

describe("formFromSource", () => {
  it("hydrates the form from fetch_config.enrichment, cadence and baseUrl", () => {
    expect(formFromSource(source)).toEqual({
      cadence: "daily",
      baseUrl: "https://www.bidbuy.illinois.gov",
      enabled: true,
      fields: ["description", "attachments"],
      // Numeric fields live in the form as raw strings so a half-typed or momentarily empty
      // input stays empty instead of snapping to 0; they are coerced in buildCrawlerConfigPatch.
      maxDetailsPerRun: "10",
      minIntervalSeconds: "2",
      timeoutSeconds: "15",
      detailSelectors: { description: "div.x" },
      attachmentUrlTemplate: "https://x/{id}",
    });
  });

  it("falls back to the daily cadence and an empty base URL for unusable rows", () => {
    const hydrated = formFromSource({
      ...source,
      cadence: "fortnightly",
      baseUrl: null,
      fetchConfig: {},
    } as unknown as AdminDataSource);

    expect(hydrated.cadence).toBe("daily");
    expect(hydrated.baseUrl).toBe("");
    // An absent `enrichment` block falls back to the shared defaults (disabled, all fields).
    expect(hydrated.enabled).toBe(false);
    expect(hydrated.fields).toEqual(["description", "attachments", "category", "contact", "published_date"]);
    expect(hydrated.attachmentUrlTemplate).toBe("");
    expect(hydrated.maxDetailsPerRun).toBe("25");
    expect(hydrated.minIntervalSeconds).toBe("3");
    expect(hydrated.timeoutSeconds).toBe("20");
  });
});

describe("buildCrawlerConfigPatch", () => {
  it("serializes the form back into a PATCH body preserving unrelated fetch_config keys", () => {
    const patch = buildCrawlerConfigPatch(
      { ...source, fetchConfig: { ...source.fetchConfig, custom_flag: true } } as AdminDataSource,
      { ...formFromSource(source), enabled: false, cadence: "weekly", baseUrl: "https://new.example.gov" },
    );

    expect(patch).toEqual({
      cadence: "weekly",
      baseUrl: "https://new.example.gov",
      fetchConfig: {
        base_url: "https://www.bidbuy.illinois.gov",
        custom_flag: true,
        enrichment: {
          enabled: false,
          fields: ["description", "attachments"],
          max_details_per_run: 10,
          min_interval_seconds: 2,
          timeout_seconds: 15,
          detail_selectors: { description: "div.x" },
          attachment_url_template: "https://x/{id}",
        },
      },
    });
  });

  it("drops blank selectors and a blank template", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      detailSelectors: { description: "  " },
      attachmentUrlTemplate: "",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;
    expect(enrichment.detail_selectors).toEqual({});
    expect(enrichment.attachment_url_template).toBeNull();
  });

  it("trims retained selectors and templates, and sends a blank base URL as null", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      baseUrl: "   ",
      detailSelectors: { description: "  div.x  ", contact: "" },
      attachmentUrlTemplate: "  https://x/{id}  ",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    expect(patch.baseUrl).toBeNull();
    expect(enrichment.detail_selectors).toEqual({ description: "div.x" });
    expect(enrichment.attachment_url_template).toBe("https://x/{id}");
  });

  it("keeps the row's saved numbers when a numeric input is cleared, never sending 0", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      maxDetailsPerRun: "",
      minIntervalSeconds: "   ",
      timeoutSeconds: "",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    // An emptied field means "leave this one alone": it falls back to the value currently saved
    // on the row, so a cleared input can never post an out-of-range 0.
    expect(enrichment.max_details_per_run).toBe(10);
    expect(enrichment.min_interval_seconds).toBe(2);
    expect(enrichment.timeout_seconds).toBe(15);
  });

  it("falls back to the shared defaults when the row itself has no saved enrichment numbers", () => {
    const bare = { ...source, fetchConfig: {} } as unknown as AdminDataSource;
    const patch = buildCrawlerConfigPatch(bare, {
      ...formFromSource(bare),
      maxDetailsPerRun: "",
      minIntervalSeconds: "",
      timeoutSeconds: "abc",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    expect(enrichment.max_details_per_run).toBe(25);
    expect(enrichment.min_interval_seconds).toBe(3);
    expect(enrichment.timeout_seconds).toBe(20);
  });

  it("coerces edited numeric strings, including a fractional interval", () => {
    const patch = buildCrawlerConfigPatch(source, {
      ...formFromSource(source),
      maxDetailsPerRun: "200",
      minIntervalSeconds: "1.5",
      timeoutSeconds: "60",
    });
    const enrichment = (patch.fetchConfig as { enrichment: Record<string, unknown> }).enrichment;

    expect(enrichment.max_details_per_run).toBe(200);
    expect(enrichment.min_interval_seconds).toBe(1.5);
    expect(enrichment.timeout_seconds).toBe(60);
  });
});

describe("CrawlerConfigPanel wiring", () => {
  const component = readFileSync(new URL("CrawlerConfigPanel.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");

  it("saves through updateAdminDataSource and reports via i18n", () => {
    expect(component).toContain("updateAdminDataSource(source.id, buildCrawlerConfigPatch(source, form))");
    expect(component).toContain('t("admin.crawlerConfigSaved")');
    expect(component).toContain('t("admin.crawlerConfigSaveFailed")');
    expect(component).toContain('t(`admin.crawlerConfigField_${field}`)');
  });

  it("resolves both save-feedback placeholders instead of leaking them into the UI", () => {
    expect(component).toContain('.replace("{source}"');
    expect(component).toContain('.replace("{message}"');
  });

  it("keeps the numeric inputs inside the ranges the server validator enforces", () => {
    expect(component).toContain("min={1} max={200}");
    expect(component).toContain("min={0} max={60}");
    expect(component).toContain("min={5} max={60}");
  });

  it("is mounted per data source row in the admin page", () => {
    expect(page).toContain("CrawlerConfigPanel");
    expect(page).toContain("onSaved={replaceSource}");
  });
});
