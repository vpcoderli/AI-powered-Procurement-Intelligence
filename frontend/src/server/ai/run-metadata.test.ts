import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_AI_MODEL,
  DETERMINISTIC_AI_RULES_VERSION,
  createDeterministicAiRunMetadata,
} from "./run-metadata";

describe("deterministic AI run metadata", () => {
  it("records deterministic provider, model, prompt, confidence, zero cost, and fallback reason", () => {
    const metadata = createDeterministicAiRunMetadata({
      action: "qualification_qa",
      promptVersion: "qualification-qa-lite@2026-06-10",
      confidence: "medium",
      fallbackReason: "no_llm_provider_configured",
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });

    expect(metadata).toEqual({
      id: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
      provider: "deterministic",
      model: DETERMINISTIC_AI_MODEL,
      rulesVersion: DETERMINISTIC_AI_RULES_VERSION,
      promptVersion: "qualification-qa-lite@2026-06-10",
      confidence: "medium",
      cost: { currency: "USD", total: 0, estimatedUsd: 0 },
      credits: { estimated: 1, charged: 0, mode: "dry_run" },
      fallback: { used: false, reason: "no_llm_provider_configured" },
      fallbackReason: "no_llm_provider_configured",
      generatedAt: "2026-06-10T00:00:00.000Z",
    });
  });

  it("normalizes unknown confidence to medium and does not require OPENAI_API_KEY", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const metadata = createDeterministicAiRunMetadata({
        action: "intent_brief",
        promptVersion: "intent-brief-lite@2026-06-10",
        confidence: "unexpected",
        fallbackReason: "no_llm_provider_configured",
        now: () => new Date("2026-06-10T00:00:00.000Z"),
      });

      expect(metadata.confidence).toBe("medium");
      expect(metadata.cost.total).toBe(0);
      expect(metadata.cost.estimatedUsd).toBe(0);
      expect(metadata.credits).toEqual({ estimated: 1, charged: 0, mode: "dry_run" });
      expect(metadata.fallback).toEqual({ used: false, reason: "no_llm_provider_configured" });
      expect(metadata.provider).toBe("deterministic");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});
