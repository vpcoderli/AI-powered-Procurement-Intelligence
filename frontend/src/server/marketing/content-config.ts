import type { AppDatabase } from "@/server/db/client";
import { getEffectiveConfigValue } from "@/server/config/registry";
import {
  hasUnsafeMarketingClaim,
  type MarketingContentOverride,
  type MarketingHomepageContent,
  type MarketingHomepageContentOverrides,
  type MarketingHomepageLanguage,
} from "@/lib/marketing/homepage-content";
import type {
  GlossaryContent,
  MarketingResourceContentOverrides,
  MarketingResourceLanguage,
  ResourceHubContent,
  SupplierWorkflowContent,
} from "@/lib/marketing/resource-content";

export interface MarketingContentConfig {
  homepage?: MarketingHomepageContentOverrides;
  resources?: MarketingResourceContentOverrides;
}

export interface GetMarketingContentConfigOptions {
  organizationId?: string | null;
  now?: string;
}

export class MarketingContentConfigValidationError extends Error {
  code = "INVALID_MARKETING_CONTENT_CONFIG" as const;

  constructor(message: string) {
    super(message);
    this.name = "MarketingContentConfigValidationError";
  }
}

const marketingLanguages = ["en", "zh"] as const satisfies readonly MarketingHomepageLanguage[] &
  readonly MarketingResourceLanguage[];
const marketingLanguageSet = new Set<string>(marketingLanguages);
const blockedKeys = new Set(["__proto__", "constructor", "prototype"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeMarketingOverride(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMarketingOverride(item));
  }

  if (!isPlainRecord(value)) {
    throw new MarketingContentConfigValidationError("Marketing content config must contain JSON-compatible values.");
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (blockedKeys.has(key)) continue;
    sanitized[key] = sanitizeMarketingOverride(item);
  }

  return sanitized;
}

function resolveLanguageOverrides<T>(value: unknown): Partial<Record<MarketingHomepageLanguage, MarketingContentOverride<T>>> {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) {
    throw new MarketingContentConfigValidationError("Marketing content language overrides must be an object.");
  }

  const overrides: Partial<Record<MarketingHomepageLanguage, MarketingContentOverride<T>>> = {};
  for (const [language, override] of Object.entries(value)) {
    if (!marketingLanguageSet.has(language)) continue;
    if (!isPlainRecord(override)) {
      throw new MarketingContentConfigValidationError("Marketing content language override must be an object.");
    }
    overrides[language as MarketingHomepageLanguage] = sanitizeMarketingOverride(
      override,
    ) as MarketingContentOverride<T>;
  }

  return overrides;
}

function resolveMarketingRoot(configValue: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(configValue)) return null;

  const root = isPlainRecord(configValue.marketing) ? configValue.marketing : configValue;
  return root;
}

function assertSafeMarketingConfig(root: Record<string, unknown>) {
  if (hasUnsafeMarketingClaim(root)) {
    throw new MarketingContentConfigValidationError(
      "Marketing content config contains unsafe outcome, compliance, or submission claims.",
    );
  }
}

export function resolveMarketingContentConfig(configValue: unknown): MarketingContentConfig | null {
  const root = resolveMarketingRoot(configValue);
  if (!root) return null;
  assertSafeMarketingConfig(root);

  const config: MarketingContentConfig = {};

  if (root.homepage !== undefined) {
    config.homepage = resolveLanguageOverrides<MarketingHomepageContent>(root.homepage);
  }

  if (root.resources !== undefined) {
    if (!isPlainRecord(root.resources)) {
      throw new MarketingContentConfigValidationError("Marketing resource overrides must be an object.");
    }

    config.resources = {};

    if (root.resources.hub !== undefined) {
      config.resources.hub = resolveLanguageOverrides<ResourceHubContent>(root.resources.hub);
    }

    if (root.resources.glossary !== undefined) {
      config.resources.glossary = resolveLanguageOverrides<GlossaryContent>(root.resources.glossary);
    }

    if (root.resources.workflow !== undefined) {
      config.resources.workflow = resolveLanguageOverrides<SupplierWorkflowContent>(root.resources.workflow);
    }
  }

  return config;
}

export function getMarketingContentConfig(
  db: AppDatabase,
  options: GetMarketingContentConfigOptions = {},
): MarketingContentConfig | null {
  const entry = getEffectiveConfigValue(db, {
    module: "ux_state",
    configKey: "copy_library",
    organizationId: options.organizationId,
    now: options.now,
  });

  if (!entry) return null;
  return resolveMarketingContentConfig(entry.configValue);
}
