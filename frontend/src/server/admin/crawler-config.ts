/**
 * Crawler configuration helpers shared by the admin console UI and the admin API.
 *
 * Pure functions only (no server/database imports) so the editor components can import
 * the same validation rules the API enforces. `@/server/attachments/policy` is held to the
 * same rule (pure, no server imports) so importing its validator here keeps this module
 * client-safe.
 */

import { validateAttachmentPolicyInput } from "@/server/attachments/policy";

export const CADENCES = ["hourly", "daily", "weekly", "manual"] as const;
export type Cadence = (typeof CADENCES)[number];

export const ENRICHMENT_FIELDS = ["description", "attachments", "category", "contact", "published_date"] as const;
export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export interface EnrichmentConfig {
  enabled: boolean;
  fields: EnrichmentField[];
  maxDetailsPerRun: number;
  minIntervalSeconds: number;
  timeoutSeconds: number;
  detailSelectors: Partial<Record<EnrichmentField, string>>;
  attachmentUrlTemplate: string | null;
}

export const DEFAULT_ENRICHMENT_CONFIG: EnrichmentConfig = {
  enabled: false,
  fields: [...ENRICHMENT_FIELDS],
  maxDetailsPerRun: 25,
  minIntervalSeconds: 3,
  timeoutSeconds: 20,
  detailSelectors: {},
  attachmentUrlTemplate: null,
};

const MAX_FETCH_CONFIG_BYTES = 8192;

const RANGES = {
  max_details_per_run: [1, 200],
  min_interval_seconds: [0, 60],
  timeout_seconds: [5, 60],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isEnrichmentField(value: unknown): value is EnrichmentField {
  return typeof value === "string" && (ENRICHMENT_FIELDS as readonly string[]).includes(value);
}

function clampNumber(value: unknown, [low, high]: readonly [number, number], fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}

/** Lenient reader (mirrors `parse_enrichment_config` in `crawler/apsi_crawler/enrichment.py`). */
export function parseEnrichmentConfig(fetchConfig: Record<string, unknown>): EnrichmentConfig {
  const raw = isRecord(fetchConfig.enrichment) ? fetchConfig.enrichment : {};
  const fields = Array.isArray(raw.fields) ? raw.fields.filter(isEnrichmentField) : [...ENRICHMENT_FIELDS];
  const detailSelectors: Partial<Record<EnrichmentField, string>> = {};

  if (isRecord(raw.detail_selectors)) {
    for (const [key, value] of Object.entries(raw.detail_selectors)) {
      if (isEnrichmentField(key) && typeof value === "string" && value.trim()) {
        detailSelectors[key] = value;
      }
    }
  }

  const attachmentUrlTemplate = raw.attachment_url_template;

  return {
    enabled: raw.enabled === true,
    fields,
    maxDetailsPerRun: clampNumber(
      raw.max_details_per_run,
      RANGES.max_details_per_run,
      DEFAULT_ENRICHMENT_CONFIG.maxDetailsPerRun,
    ),
    minIntervalSeconds: clampNumber(
      raw.min_interval_seconds,
      RANGES.min_interval_seconds,
      DEFAULT_ENRICHMENT_CONFIG.minIntervalSeconds,
    ),
    timeoutSeconds: clampNumber(raw.timeout_seconds, RANGES.timeout_seconds, DEFAULT_ENRICHMENT_CONFIG.timeoutSeconds),
    detailSelectors,
    attachmentUrlTemplate:
      typeof attachmentUrlTemplate === "string" && attachmentUrlTemplate.trim() ? attachmentUrlTemplate : null,
  };
}

/** Writes the snake_case `enrichment` block the crawler reads off `fetch_config`. */
export function serializeEnrichmentConfig(config: EnrichmentConfig): Record<string, unknown> {
  return {
    enabled: config.enabled,
    fields: config.fields,
    max_details_per_run: config.maxDetailsPerRun,
    min_interval_seconds: config.minIntervalSeconds,
    timeout_seconds: config.timeoutSeconds,
    detail_selectors: config.detailSelectors,
    attachment_url_template: config.attachmentUrlTemplate,
  };
}

/**
 * Contract C1 — `fetch_config.list_extraction`: how a source's *list* page is turned into bid
 * rows. `mode: "scrapling"` sends the list HTML to the extractor sidecar (the main path);
 * `"adapter"` keeps the dedicated Python parser. The crawler falls back to the adapter on its
 * own when the sidecar is unreachable or returns nothing usable.
 */
export const LIST_EXTRACTION_MODES = ["scrapling", "adapter"] as const;
export type ListExtractionMode = (typeof LIST_EXTRACTION_MODES)[number];

export const LIST_EXTRACTION_FIELDS = [
  "title",
  "url",
  "published_date",
  "deadline_date",
  "source_bid_id",
  "issuer_name",
] as const;
export type ListExtractionField = (typeof LIST_EXTRACTION_FIELDS)[number];

export interface ListExtractionConfig {
  mode: ListExtractionMode;
  render: boolean;
  itemSelector: string | null;
  maxItems: number;
  selectors: Partial<Record<ListExtractionField, string>>;
}

const LIST_EXTRACTION_MAX_ITEMS_RANGE = [1, 500] as const;

export const DEFAULT_LIST_EXTRACTION_CONFIG: ListExtractionConfig = {
  mode: "scrapling",
  render: false,
  itemSelector: null,
  maxItems: 200,
  selectors: {},
};

function isListExtractionField(value: unknown): value is ListExtractionField {
  return typeof value === "string" && (LIST_EXTRACTION_FIELDS as readonly string[]).includes(value);
}

/** Lenient reader for the admin editor — mirrors the crawler's own defaulting. */
export function parseListExtractionConfig(fetchConfig: Record<string, unknown>): ListExtractionConfig {
  const raw = isRecord(fetchConfig.list_extraction) ? fetchConfig.list_extraction : {};
  const selectors: Partial<Record<ListExtractionField, string>> = {};

  if (isRecord(raw.selectors)) {
    for (const [key, value] of Object.entries(raw.selectors)) {
      if (isListExtractionField(key) && typeof value === "string" && value.trim()) {
        selectors[key] = value;
      }
    }
  }

  const itemSelector = raw.item_selector;

  return {
    mode: raw.mode === "adapter" ? "adapter" : DEFAULT_LIST_EXTRACTION_CONFIG.mode,
    render: raw.render === true,
    itemSelector: typeof itemSelector === "string" && itemSelector.trim() ? itemSelector : null,
    maxItems: Math.round(
      clampNumber(raw.max_items, LIST_EXTRACTION_MAX_ITEMS_RANGE, DEFAULT_LIST_EXTRACTION_CONFIG.maxItems),
    ),
    selectors,
  };
}

/** Writes the snake_case `list_extraction` block the crawler reads off `fetch_config`. */
export function serializeListExtractionConfig(config: ListExtractionConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    render: config.render,
    item_selector: config.itemSelector,
    max_items: config.maxItems,
    selectors: config.selectors,
  };
}

function validateListExtraction(listExtraction: unknown): string | null {
  if (!isRecord(listExtraction)) return "list_extraction must be a JSON object.";

  if (
    listExtraction.mode !== undefined &&
    (typeof listExtraction.mode !== "string" ||
      !(LIST_EXTRACTION_MODES as readonly string[]).includes(listExtraction.mode))
  ) {
    return `list_extraction.mode must be one of ${LIST_EXTRACTION_MODES.join(", ")}.`;
  }

  if (listExtraction.render !== undefined && typeof listExtraction.render !== "boolean") {
    return "list_extraction.render must be a boolean.";
  }

  if (listExtraction.item_selector !== undefined && listExtraction.item_selector !== null) {
    if (typeof listExtraction.item_selector !== "string" || !listExtraction.item_selector.trim()) {
      return "list_extraction.item_selector must be a non-empty string or null.";
    }
  }

  if (listExtraction.max_items !== undefined) {
    const [low, high] = LIST_EXTRACTION_MAX_ITEMS_RANGE;
    const value = listExtraction.max_items;
    if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) {
      return `list_extraction.max_items must be an integer between ${low} and ${high}.`;
    }
  }

  if (listExtraction.selectors !== undefined) {
    if (!isRecord(listExtraction.selectors)) return "list_extraction.selectors must be a JSON object.";
    for (const [key, selector] of Object.entries(listExtraction.selectors)) {
      if (!isListExtractionField(key)) return `list_extraction.selectors has an unsupported field: ${key}.`;
      if (selector === null) continue;
      if (typeof selector !== "string" || !selector.trim()) {
        return `list_extraction.selectors.${key} must be a non-empty string.`;
      }
    }
  }

  return null;
}

export interface CrawlerConfigValue {
  fetchConfig?: Record<string, unknown>;
  cadence?: Cadence;
  baseUrl?: string | null;
}

export type CrawlerConfigValidation = { ok: true; value: CrawlerConfigValue } | { ok: false; message: string };

function validateEnrichment(enrichment: unknown): string | null {
  if (!isRecord(enrichment)) return "enrichment must be a JSON object.";

  for (const [key, [low, high]] of Object.entries(RANGES)) {
    const value = enrichment[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high)) {
      return `enrichment.${key} must be between ${low} and ${high}.`;
    }
  }

  if (enrichment.fields !== undefined) {
    if (!Array.isArray(enrichment.fields)) return "enrichment.fields must be an array.";
    const unsupported = enrichment.fields.find((field) => !isEnrichmentField(field));
    if (unsupported !== undefined) {
      return `enrichment.fields contains an unsupported field: ${String(unsupported)}.`;
    }
  }

  if (enrichment.detail_selectors !== undefined) {
    if (!isRecord(enrichment.detail_selectors)) return "enrichment.detail_selectors must be a JSON object.";
    for (const [key, selector] of Object.entries(enrichment.detail_selectors)) {
      if (!isEnrichmentField(key)) return `enrichment.detail_selectors has an unsupported field: ${key}.`;
      if (typeof selector !== "string" || !selector.trim()) {
        return `enrichment.detail_selectors.${key} must be a non-empty string.`;
      }
    }
  }

  const template = enrichment.attachment_url_template;
  if (template !== undefined && template !== null && (typeof template !== "string" || !isHttpUrl(template))) {
    return "enrichment.attachment_url_template must be an absolute http(s) URL.";
  }

  if (enrichment.enabled !== undefined && typeof enrichment.enabled !== "boolean") {
    return "enrichment.enabled must be a boolean.";
  }

  return null;
}

/** Strict validator for admin edits: rejects bad values instead of clamping them. */
export function validateCrawlerConfigInput(input: {
  fetchConfig?: unknown;
  cadence?: unknown;
  baseUrl?: unknown;
}): CrawlerConfigValidation {
  const value: CrawlerConfigValue = {};

  if (input.fetchConfig !== undefined) {
    if (!isRecord(input.fetchConfig)) return { ok: false, message: "fetchConfig must be a JSON object." };

    const serialized = JSON.stringify(input.fetchConfig);
    if (new TextEncoder().encode(serialized).length > MAX_FETCH_CONFIG_BYTES) {
      return { ok: false, message: `fetchConfig must serialize to at most ${MAX_FETCH_CONFIG_BYTES} bytes.` };
    }

    if (input.fetchConfig.enrichment !== undefined) {
      const message = validateEnrichment(input.fetchConfig.enrichment);
      if (message) return { ok: false, message };
    }

    // Per-source attachment archiving policy (`fetch_config.attachments`), consumed by the
    // attachment repair worker. The rules live with the policy module so the worker, the
    // Python `archive-attachments` request builder and this admin editor cannot drift apart.
    if (input.fetchConfig.attachments !== undefined) {
      const message = validateAttachmentPolicyInput(input.fetchConfig.attachments);
      if (message) return { ok: false, message };
    }

    // Per-source list parsing (`fetch_config.list_extraction`), contract C1.
    if (input.fetchConfig.list_extraction !== undefined) {
      const message = validateListExtraction(input.fetchConfig.list_extraction);
      if (message) return { ok: false, message };
    }

    value.fetchConfig = input.fetchConfig;
  }

  if (input.cadence !== undefined) {
    if (typeof input.cadence !== "string" || !(CADENCES as readonly string[]).includes(input.cadence)) {
      return { ok: false, message: `cadence must be one of ${CADENCES.join(", ")}.` };
    }
    value.cadence = input.cadence as Cadence;
  }

  if (input.baseUrl !== undefined) {
    if (input.baseUrl !== null && (typeof input.baseUrl !== "string" || !isHttpUrl(input.baseUrl))) {
      return { ok: false, message: "baseUrl must be an absolute http(s) URL or null." };
    }
    value.baseUrl = input.baseUrl as string | null;
  }

  return { ok: true, value };
}
