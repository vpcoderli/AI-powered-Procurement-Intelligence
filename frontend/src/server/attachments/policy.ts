/**
 * Per-source attachment archiving policy, stored on `data_sources.fetch_config.attachments`.
 *
 * Pure functions only (no server/database imports) so the admin console editor can import the
 * same validation rules the API and the repair worker enforce. Mirrors the shape the Python
 * `archive-attachments` CLI receives in its request `source` block.
 */

export const ATTACHMENT_MODES = ["direct", "browser"] as const;
export type AttachmentMode = (typeof ATTACHMENT_MODES)[number];

export interface AttachmentPolicy {
  archive: boolean;
  mode: AttachmentMode;
  maxPerRun: number;
  minIntervalSeconds: number;
  timeoutSeconds: number;
  maxBytes: number;
  browserLinkSelector: string | null;
}

export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy = {
  archive: true,
  mode: "direct",
  maxPerRun: 50,
  minIntervalSeconds: 3,
  timeoutSeconds: 30,
  maxBytes: 52_428_800,
  browserLinkSelector: null,
};

const RANGES = {
  max_per_run: [1, 200],
  min_interval_seconds: [0, 60],
  timeout_seconds: [5, 120],
  max_bytes: [1_048_576, 209_715_200],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value: unknown, [low, high]: readonly [number, number], fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.trunc(value))) : fallback;
}

function isAttachmentMode(value: unknown): value is AttachmentMode {
  return typeof value === "string" && (ATTACHMENT_MODES as readonly string[]).includes(value);
}

/** Lenient reader: unknown/invalid values fall back to the default, numbers are clamped. */
export function parseAttachmentPolicy(fetchConfig: Record<string, unknown>): AttachmentPolicy {
  const raw = isRecord(fetchConfig?.attachments) ? fetchConfig.attachments : {};
  const browserLinkSelector = raw.browser_link_selector;

  return {
    archive: raw.archive === undefined ? DEFAULT_ATTACHMENT_POLICY.archive : raw.archive === true,
    mode: isAttachmentMode(raw.mode) ? raw.mode : DEFAULT_ATTACHMENT_POLICY.mode,
    maxPerRun: clampNumber(raw.max_per_run, RANGES.max_per_run, DEFAULT_ATTACHMENT_POLICY.maxPerRun),
    minIntervalSeconds: clampNumber(
      raw.min_interval_seconds,
      RANGES.min_interval_seconds,
      DEFAULT_ATTACHMENT_POLICY.minIntervalSeconds,
    ),
    timeoutSeconds: clampNumber(raw.timeout_seconds, RANGES.timeout_seconds, DEFAULT_ATTACHMENT_POLICY.timeoutSeconds),
    maxBytes: clampNumber(raw.max_bytes, RANGES.max_bytes, DEFAULT_ATTACHMENT_POLICY.maxBytes),
    browserLinkSelector:
      typeof browserLinkSelector === "string" && browserLinkSelector.trim() ? browserLinkSelector : null,
  };
}

/** Writes the snake_case `attachments` block stored on `fetch_config`. */
export function serializeAttachmentPolicy(policy: AttachmentPolicy): Record<string, unknown> {
  return {
    attachments: {
      archive: policy.archive,
      mode: policy.mode,
      max_per_run: policy.maxPerRun,
      min_interval_seconds: policy.minIntervalSeconds,
      timeout_seconds: policy.timeoutSeconds,
      max_bytes: policy.maxBytes,
      browser_link_selector: policy.browserLinkSelector,
    },
  };
}

/** Strict validator for admin edits: rejects bad values instead of clamping them. */
export function validateAttachmentPolicyInput(value: unknown): string | null {
  if (!isRecord(value)) return "attachments must be a JSON object.";

  for (const [key, [low, high]] of Object.entries(RANGES)) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < low || entry > high) {
      return `attachments.${key} must be between ${low} and ${high}.`;
    }
  }

  if (value.archive !== undefined && typeof value.archive !== "boolean") {
    return "attachments.archive must be a boolean.";
  }

  if (value.mode !== undefined && !isAttachmentMode(value.mode)) {
    return `attachments.mode must be one of ${ATTACHMENT_MODES.join(", ")}.`;
  }

  const selector = value.browser_link_selector;
  if (selector !== undefined && selector !== null && (typeof selector !== "string" || !selector.trim())) {
    return "attachments.browser_link_selector must be a non-empty string or null.";
  }

  return null;
}
