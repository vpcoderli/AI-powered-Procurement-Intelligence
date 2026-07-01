/**
 * Shared confidence-tiering helper for AI-generated content.
 *
 * The codebase already has a de-facto three-tier confidence convention:
 *   - `AiConfidence = "low" | "medium" | "high"` in `run-metadata.ts`, stamped
 *     onto every `AiRunMetadata.confidence` field.
 *   - `BidMatchResult.confidence` (`server/match/types.ts`), computed by
 *     `server/match/service.ts` from a 0-100 score via inline thresholds
 *     (`>=75 high`, `>=50 medium`, else low`).
 *   - `QualificationCitation.confidence`, consumed by `server/qualification/qa.ts`.
 *   - Rendered in the UI via `t(\`intentsPage.confidence.${value}\`)` in
 *     `frontend/src/app/intents/[id]/page.tsx` and `frontend/src/app/bids/[id]/page.tsx`.
 *
 * There is exactly one *column* in the schema with "confidence" in its name —
 * `bids.sourceConfidence` — but that is a crawler data-quality label, not an
 * AI-output confidence value, and is out of scope here.
 *
 * This module does not introduce a new confidence vocabulary. It centralizes
 * the score -> tier thresholds (previously only inlined in
 * `match/service.ts`) so every AI call site classifies confidence the same
 * documented way, and adds a numeric-score variant for callers (like cost
 * tracking or future real-LLM providers) that want to reason about a raw
 * 0-100 confidence score rather than just the three-tier label.
 */

export const AI_CONFIDENCE_TIERS = ["low", "medium", "high"] as const;

export type AiConfidenceTier = (typeof AI_CONFIDENCE_TIERS)[number];

/**
 * Inclusive lower bounds on a normalized 0-100 confidence score for each
 * tier. Mirrors the thresholds already used by
 * `server/match/service.ts` (`confidence()`, score >= 75 => "high", score >=
 * 50 => "medium", else "low"). Documented here as the single source of truth
 * so future call sites do not re-invent slightly different cutoffs.
 */
export const CONFIDENCE_TIER_THRESHOLDS: Record<AiConfidenceTier, number> = {
  high: 75,
  medium: 50,
  low: 0,
};

export interface ConfidenceScore {
  /** Normalized 0-100 confidence score. */
  score: number;
  /** Tier derived from `score` using CONFIDENCE_TIER_THRESHOLDS. */
  tier: AiConfidenceTier;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Classifies a normalized 0-100 numeric score into a confidence tier using
 * the documented thresholds above.
 */
export function tierForScore(score: number): AiConfidenceTier {
  const clamped = clampScore(score);

  if (clamped >= CONFIDENCE_TIER_THRESHOLDS.high) return "high";
  if (clamped >= CONFIDENCE_TIER_THRESHOLDS.medium) return "medium";

  return "low";
}

/**
 * Builds a `ConfidenceScore` (score + derived tier) from a raw numeric score.
 * Prefer this over calling `tierForScore` directly when both the underlying
 * score and the tier need to be persisted/displayed together.
 */
export function scoreConfidence(score: number): ConfidenceScore {
  const clamped = clampScore(score);

  return { score: clamped, tier: tierForScore(clamped) };
}

/**
 * Normalizes an arbitrary/untrusted value into a known confidence tier,
 * defaulting to "medium" for anything unrecognized. This mirrors the
 * defensive `normalizeConfidence()` helper already private to
 * `server/ai/run-metadata.ts` — exported here so other modules (cost
 * tracking, new call sites) can reuse the same normalization instead of
 * redefining it.
 */
export function normalizeConfidenceTier(value: unknown): AiConfidenceTier {
  return value === "low" || value === "high" ? value : "medium";
}

export function isAiConfidenceTier(value: unknown): value is AiConfidenceTier {
  return value === "low" || value === "medium" || value === "high";
}

/**
 * Merges multiple confidence tiers into a single overall tier by taking the
 * weakest (lowest) tier present. Useful when an AI run result is composed
 * from several sub-signals (e.g. a brief's confidence should not be reported
 * as "high" if any of its citations are only "low" confidence).
 */
export function weakestConfidenceTier(tiers: readonly AiConfidenceTier[]): AiConfidenceTier {
  if (tiers.length === 0) {
    return "low";
  }

  const rank: Record<AiConfidenceTier, number> = { low: 0, medium: 1, high: 2 };

  return tiers.reduce((weakest, tier) => (rank[tier] < rank[weakest] ? tier : weakest), tiers[0]);
}
