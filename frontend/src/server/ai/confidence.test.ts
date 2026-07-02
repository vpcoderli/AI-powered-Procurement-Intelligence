import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_TIER_THRESHOLDS,
  isAiConfidenceTier,
  normalizeConfidenceTier,
  scoreConfidence,
  tierForScore,
  weakestConfidenceTier,
} from "./confidence";

describe("confidence tiering", () => {
  it("classifies scores using the documented thresholds", () => {
    expect(tierForScore(100)).toBe("high");
    expect(tierForScore(CONFIDENCE_TIER_THRESHOLDS.high)).toBe("high");
    expect(tierForScore(CONFIDENCE_TIER_THRESHOLDS.high - 1)).toBe("medium");
    expect(tierForScore(CONFIDENCE_TIER_THRESHOLDS.medium)).toBe("medium");
    expect(tierForScore(CONFIDENCE_TIER_THRESHOLDS.medium - 1)).toBe("low");
    expect(tierForScore(0)).toBe("low");
  });

  it("clamps out-of-range and non-finite scores before classifying", () => {
    expect(tierForScore(150)).toBe("high");
    expect(tierForScore(-20)).toBe("low");
    expect(tierForScore(Number.NaN)).toBe("low");
    expect(tierForScore(Number.POSITIVE_INFINITY)).toBe("high");
  });

  it("builds a ConfidenceScore with the clamped score and derived tier", () => {
    expect(scoreConfidence(82)).toEqual({ score: 82, tier: "high" });
    expect(scoreConfidence(-5)).toEqual({ score: 0, tier: "low" });
    expect(scoreConfidence(140)).toEqual({ score: 100, tier: "high" });
  });

  it("normalizes unknown/untrusted values to medium, matching run-metadata.ts semantics", () => {
    expect(normalizeConfidenceTier("high")).toBe("high");
    expect(normalizeConfidenceTier("low")).toBe("low");
    expect(normalizeConfidenceTier("medium")).toBe("medium");
    expect(normalizeConfidenceTier("unexpected")).toBe("medium");
    expect(normalizeConfidenceTier(undefined)).toBe("medium");
    expect(normalizeConfidenceTier(42)).toBe("medium");
  });

  it("narrows known confidence tier values with the type guard", () => {
    expect(isAiConfidenceTier("low")).toBe(true);
    expect(isAiConfidenceTier("medium")).toBe(true);
    expect(isAiConfidenceTier("high")).toBe(true);
    expect(isAiConfidenceTier("unknown")).toBe(false);
    expect(isAiConfidenceTier(null)).toBe(false);
  });

  it("merges multiple tiers by taking the weakest one present", () => {
    expect(weakestConfidenceTier(["high", "high"])).toBe("high");
    expect(weakestConfidenceTier(["high", "medium", "low"])).toBe("low");
    expect(weakestConfidenceTier(["high", "medium"])).toBe("medium");
    expect(weakestConfidenceTier([])).toBe("low");
  });
});
