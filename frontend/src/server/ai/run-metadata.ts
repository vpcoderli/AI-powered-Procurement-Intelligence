export const DETERMINISTIC_AI_MODEL = "rules://winbids/deterministic-ai-enterprise-depth-lite" as const;
export const DETERMINISTIC_AI_RULES_VERSION = "ai-enterprise-depth-lite-rules@2026-06-10" as const;

export const AI_FALLBACK_REASONS = [
  "none",
  "no_llm_provider_configured",
  "deterministic_rules_selected",
  "provider_error",
  "provider_timeout",
  "workspace_not_available",
] as const;

export type AiProviderId = "deterministic" | "mock" | (string & Record<never, never>);
export type AiProvider = AiProviderId;
export type AiModel = typeof DETERMINISTIC_AI_MODEL | (string & Record<never, never>);
export type AiConfidence = "low" | "medium" | "high";
export type AiFallbackReason = (typeof AI_FALLBACK_REASONS)[number];

export interface AiCostMetadata {
  currency: "USD";
  total: number;
  estimatedUsd?: number;
}

export interface AiCreditMetadata {
  estimated: number;
  charged: 0;
  mode: "dry_run";
}

export interface AiFallbackMetadata {
  used: boolean;
  reason: AiFallbackReason;
  fromProvider?: AiProviderId;
}

export interface AiRunMetadata {
  id: string;
  provider: AiProviderId;
  model: AiModel;
  rulesVersion?: typeof DETERMINISTIC_AI_RULES_VERSION;
  promptVersion: string;
  confidence: AiConfidence;
  cost: AiCostMetadata;
  credits?: AiCreditMetadata;
  fallback?: AiFallbackMetadata;
  fallbackReason: AiFallbackReason;
  generatedAt: string;
}

export interface CreateAiRunMetadataInput {
  action: string;
  provider: AiProviderId;
  model: AiModel;
  promptVersion: string;
  confidence: unknown;
  fallbackReason: AiFallbackReason;
  fallback?: AiFallbackMetadata;
  rulesVersion?: typeof DETERMINISTIC_AI_RULES_VERSION;
  estimatedCostUsd?: number;
  estimatedCredits?: number;
  now?: () => Date;
}

export interface CreateDeterministicAiRunMetadataInput {
  action: string;
  promptVersion: string;
  confidence: unknown;
  fallbackReason: AiFallbackReason;
  fallback?: AiFallbackMetadata;
  estimatedCostUsd?: number;
  estimatedCredits?: number;
  now?: () => Date;
}

function normalizeConfidence(value: unknown): AiConfidence {
  return value === "low" || value === "high" ? value : "medium";
}

function normalizeAction(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function normalizeNonNegativeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function estimatedCreditsForAction(action: string) {
  const normalized = normalizeAction(action);

  if (normalized === "intent_brief" || normalized === "qualification_qa") {
    return 1;
  }

  return 0;
}

export function createAiRunMetadata(input: CreateAiRunMetadataInput): AiRunMetadata {
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();
  const fallback = input.fallback ?? { used: false, reason: input.fallbackReason };
  const estimatedCostUsd = normalizeNonNegativeNumber(input.estimatedCostUsd, 0);
  const estimatedCredits = normalizeNonNegativeNumber(
    input.estimatedCredits,
    estimatedCreditsForAction(input.action),
  );

  return {
    id: `ai_run_${normalizeAction(input.action)}_${generatedAt}`,
    provider: input.provider,
    model: input.model,
    ...(input.rulesVersion ? { rulesVersion: input.rulesVersion } : {}),
    promptVersion: input.promptVersion,
    confidence: normalizeConfidence(input.confidence),
    cost: { currency: "USD", total: 0, estimatedUsd: estimatedCostUsd },
    credits: { estimated: estimatedCredits, charged: 0, mode: "dry_run" },
    fallback,
    fallbackReason: input.fallbackReason,
    generatedAt,
  };
}

export function createDeterministicAiRunMetadata(
  input: CreateDeterministicAiRunMetadataInput,
): AiRunMetadata {
  return createAiRunMetadata({
    action: input.action,
    provider: "deterministic",
    model: DETERMINISTIC_AI_MODEL,
    rulesVersion: DETERMINISTIC_AI_RULES_VERSION,
    promptVersion: input.promptVersion,
    confidence: input.confidence,
    fallbackReason: input.fallbackReason,
    fallback: input.fallback,
    estimatedCostUsd: input.estimatedCostUsd,
    estimatedCredits: input.estimatedCredits,
    now: input.now,
  });
}
