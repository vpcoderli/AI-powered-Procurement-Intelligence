import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENRICHMENT_CONFIG,
  parseEnrichmentConfig,
  serializeEnrichmentConfig,
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
