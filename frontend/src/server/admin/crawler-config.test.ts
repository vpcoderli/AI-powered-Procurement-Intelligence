import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENRICHMENT_CONFIG,
  DEFAULT_LIST_EXTRACTION_CONFIG,
  parseEnrichmentConfig,
  parseListExtractionConfig,
  serializeEnrichmentConfig,
  serializeListExtractionConfig,
  validateCrawlerConfigInput,
} from "./crawler-config";

describe("parseEnrichmentConfig", () => {
  it("returns disabled defaults for a fetch_config without an enrichment block", () => {
    expect(parseEnrichmentConfig({ base_url: "https://x" })).toEqual(DEFAULT_ENRICHMENT_CONFIG);
    expect(DEFAULT_ENRICHMENT_CONFIG).toEqual({
      enabled: false,
      fields: ["description", "attachments", "category", "contact", "published_date"],
      maxDetailsPerRun: 25,
      minIntervalSeconds: 3,
      timeoutSeconds: 20,
      detailSelectors: {},
      attachmentUrlTemplate: null,
    });
  });

  it("reads snake_case values and drops unknown fields/selectors", () => {
    expect(
      parseEnrichmentConfig({
        enrichment: {
          enabled: true,
          fields: ["description", "bogus"],
          max_details_per_run: 10,
          min_interval_seconds: 1,
          timeout_seconds: 30,
          detail_selectors: { description: "div.x", bogus: "p" },
          attachment_url_template: "https://x/{id}",
        },
      }),
    ).toEqual({
      enabled: true,
      fields: ["description"],
      maxDetailsPerRun: 10,
      minIntervalSeconds: 1,
      timeoutSeconds: 30,
      detailSelectors: { description: "div.x" },
      attachmentUrlTemplate: "https://x/{id}",
    });
  });

  it("clamps out-of-range numbers and falls back for non-numeric values", () => {
    expect(
      parseEnrichmentConfig({
        enrichment: { max_details_per_run: 500, min_interval_seconds: -5, timeout_seconds: "20" },
      }),
    ).toMatchObject({
      maxDetailsPerRun: 200,
      minIntervalSeconds: 0,
      timeoutSeconds: DEFAULT_ENRICHMENT_CONFIG.timeoutSeconds,
    });
  });

  it("round-trips through serializeEnrichmentConfig", () => {
    const config = { ...DEFAULT_ENRICHMENT_CONFIG, enabled: true, detailSelectors: { attachments: "a.doc" } };
    expect(parseEnrichmentConfig({ enrichment: serializeEnrichmentConfig(config) })).toEqual(config);
  });
});

describe("validateCrawlerConfigInput", () => {
  it("accepts a valid fetchConfig, cadence and baseUrl", () => {
    const result = validateCrawlerConfigInput({
      fetchConfig: {
        base_url: "https://x",
        enrichment: {
          enabled: true,
          fields: ["description"],
          max_details_per_run: 5,
          min_interval_seconds: 2,
          timeout_seconds: 10,
          detail_selectors: {},
          attachment_url_template: null,
        },
      },
      cadence: "weekly",
      baseUrl: "https://portal.example.gov/bids",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        fetchConfig: {
          base_url: "https://x",
          enrichment: {
            enabled: true,
            fields: ["description"],
            max_details_per_run: 5,
            min_interval_seconds: 2,
            timeout_seconds: 10,
            detail_selectors: {},
            attachment_url_template: null,
          },
        },
        cadence: "weekly",
        baseUrl: "https://portal.example.gov/bids",
      },
    });
  });

  it("rejects out-of-range numbers, unknown fields, bad cadence, non-http base URL and oversized JSON", () => {
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { max_details_per_run: 500 } } })).toEqual({
      ok: false,
      message: "enrichment.max_details_per_run must be between 1 and 200.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { min_interval_seconds: 61 } } })).toEqual({
      ok: false,
      message: "enrichment.min_interval_seconds must be between 0 and 60.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { timeout_seconds: 2 } } })).toEqual({
      ok: false,
      message: "enrichment.timeout_seconds must be between 5 and 60.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { fields: ["price"] } } })).toEqual({
      ok: false,
      message: "enrichment.fields contains an unsupported field: price.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { detail_selectors: { description: "" } } } })).toEqual({
      ok: false,
      message: "enrichment.detail_selectors.description must be a non-empty string.",
    });
    expect(
      validateCrawlerConfigInput({ fetchConfig: { enrichment: { attachment_url_template: "ftp://x/{id}" } } }),
    ).toEqual({
      ok: false,
      message: "enrichment.attachment_url_template must be an absolute http(s) URL.",
    });
    expect(validateCrawlerConfigInput({ cadence: "yearly" })).toEqual({
      ok: false,
      message: "cadence must be one of hourly, daily, weekly, manual.",
    });
    expect(validateCrawlerConfigInput({ baseUrl: "javascript:alert(1)" })).toEqual({
      ok: false,
      message: "baseUrl must be an absolute http(s) URL or null.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { note: "x".repeat(9000) } })).toEqual({
      ok: false,
      message: "fetchConfig must serialize to at most 8192 bytes.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: [] })).toEqual({
      ok: false,
      message: "fetchConfig must be a JSON object.",
    });
  });

  it("rejects malformed enrichment containers and a non-boolean enabled flag", () => {
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: "on" } })).toEqual({
      ok: false,
      message: "enrichment must be a JSON object.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { enabled: "yes" } } })).toEqual({
      ok: false,
      message: "enrichment.enabled must be a boolean.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { fields: "description" } } })).toEqual({
      ok: false,
      message: "enrichment.fields must be an array.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { detail_selectors: [] } } })).toEqual({
      ok: false,
      message: "enrichment.detail_selectors must be a JSON object.",
    });
    expect(validateCrawlerConfigInput({ fetchConfig: { enrichment: { detail_selectors: { price: "div" } } } })).toEqual({
      ok: false,
      message: "enrichment.detail_selectors has an unsupported field: price.",
    });
  });

  it("accepts a null baseUrl and a null attachment template", () => {
    expect(
      validateCrawlerConfigInput({ baseUrl: null, fetchConfig: { enrichment: { attachment_url_template: null } } }),
    ).toEqual({
      ok: true,
      value: { fetchConfig: { enrichment: { attachment_url_template: null } }, baseUrl: null },
    });
  });

  it("returns an empty value when nothing crawler-related is present", () => {
    expect(validateCrawlerConfigInput({})).toEqual({ ok: true, value: {} });
  });
});

describe("validateCrawlerConfigInput attachments block", () => {
  // The per-source attachment policy rules live in `@/server/attachments/policy`
  // (shared contract C3 of docs/superpowers/plans/2026-09-16-attachment-repair.md); this
  // suite only asserts that the admin validator delegates to them and surfaces the
  // rejection message verbatim, not the ranges themselves.
  it("accepts a complete attachments policy alongside enrichment", () => {
    const fetchConfig = {
      base_url: "https://www.bidbuy.illinois.gov",
      enrichment: { enabled: true },
      attachments: {
        archive: true,
        mode: "browser",
        max_per_run: 25,
        min_interval_seconds: 3,
        timeout_seconds: 30,
        max_bytes: 52428800,
        browser_link_selector: "a.download",
      },
    };

    expect(validateCrawlerConfigInput({ fetchConfig })).toEqual({ ok: true, value: { fetchConfig } });
  });

  it("accepts a fetch_config with no attachments block at all", () => {
    expect(validateCrawlerConfigInput({ fetchConfig: { base_url: "https://x.gov" } })).toEqual({
      ok: true,
      value: { fetchConfig: { base_url: "https://x.gov" } },
    });
  });

  it("rejects an out-of-range per-run limit", () => {
    const result = validateCrawlerConfigInput({ fetchConfig: { attachments: { max_per_run: 500 } } });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("attachments.max_per_run");
  });

  it("rejects an unsupported download mode", () => {
    const result = validateCrawlerConfigInput({ fetchConfig: { attachments: { mode: "torrent" } } });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("attachments.mode");
  });

  it("rejects a non-object attachments block", () => {
    const result = validateCrawlerConfigInput({ fetchConfig: { attachments: "on" } });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("attachments");
  });
});

describe("list extraction config (contract C1)", () => {
  it("returns scrapling-first defaults for a fetch_config without a list_extraction block", () => {
    expect(parseListExtractionConfig({ base_url: "https://x" })).toEqual(DEFAULT_LIST_EXTRACTION_CONFIG);
    expect(DEFAULT_LIST_EXTRACTION_CONFIG).toEqual({
      mode: "scrapling",
      render: false,
      itemSelector: null,
      maxItems: 200,
      selectors: {},
    });
  });

  it("reads snake_case values, drops unknown/blank selectors and clamps max_items", () => {
    expect(
      parseListExtractionConfig({
        list_extraction: {
          mode: "adapter",
          render: true,
          item_selector: "tr.mets-table-row",
          max_items: 9_999,
          selectors: { title: "a.title", url: "a.title", nickname: "span", issuer_name: "   ", deadline_date: "td.due" },
        },
      }),
    ).toEqual({
      mode: "adapter",
      render: true,
      itemSelector: "tr.mets-table-row",
      maxItems: 500,
      selectors: { title: "a.title", url: "a.title", deadline_date: "td.due" },
    });
  });

  it("falls back to defaults for unusable values", () => {
    expect(
      parseListExtractionConfig({
        list_extraction: { mode: "magic", render: "yes", item_selector: "  ", max_items: "many", selectors: "all" },
      }),
    ).toEqual(DEFAULT_LIST_EXTRACTION_CONFIG);
  });

  it("round-trips through serializeListExtractionConfig", () => {
    const config = parseListExtractionConfig({
      list_extraction: { mode: "adapter", render: true, item_selector: "li.card", max_items: 25, selectors: { title: "h3" } },
    });

    expect(serializeListExtractionConfig(config)).toEqual({
      mode: "adapter",
      render: true,
      item_selector: "li.card",
      max_items: 25,
      selectors: { title: "h3" },
    });
    expect(parseListExtractionConfig({ list_extraction: serializeListExtractionConfig(config) })).toEqual(config);
  });

  it("accepts a fully specified block, null selectors and a null item selector", () => {
    const result = validateCrawlerConfigInput({
      fetchConfig: {
        list_extraction: {
          mode: "scrapling",
          render: false,
          item_selector: null,
          max_items: 200,
          selectors: {
            title: "a",
            url: "a",
            published_date: null,
            deadline_date: "td.due",
            source_bid_id: "td.id",
            issuer_name: "td.agency",
          },
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported mode, a non-boolean render flag and a blank item selector", () => {
    for (const [block, expected] of [
      [{ mode: "browser" }, "list_extraction.mode"],
      [{ render: "true" }, "list_extraction.render"],
      [{ item_selector: "   " }, "list_extraction.item_selector"],
      [{ item_selector: 12 }, "list_extraction.item_selector"],
    ] as const) {
      const result = validateCrawlerConfigInput({ fetchConfig: { list_extraction: block } });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toContain(expected);
    }
  });

  it("rejects out-of-range or fractional max_items", () => {
    for (const maxItems of [0, 501, 12.5, "200"]) {
      const result = validateCrawlerConfigInput({ fetchConfig: { list_extraction: { max_items: maxItems } } });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toContain("list_extraction.max_items");
    }
  });

  it("rejects unsupported selector fields, blank selectors and non-object containers", () => {
    const unsupported = validateCrawlerConfigInput({
      fetchConfig: { list_extraction: { selectors: { nickname: "span" } } },
    });
    expect(unsupported.ok === false && unsupported.message).toContain("unsupported field: nickname");

    const blank = validateCrawlerConfigInput({ fetchConfig: { list_extraction: { selectors: { title: "  " } } } });
    expect(blank.ok === false && blank.message).toContain("list_extraction.selectors.title");

    const container = validateCrawlerConfigInput({ fetchConfig: { list_extraction: { selectors: [] } } });
    expect(container.ok === false && container.message).toContain("list_extraction.selectors");

    const block = validateCrawlerConfigInput({ fetchConfig: { list_extraction: "scrapling" } });
    expect(block.ok === false && block.message).toContain("list_extraction must be a JSON object.");
  });
});
