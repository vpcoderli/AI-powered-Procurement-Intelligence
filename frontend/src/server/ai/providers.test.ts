import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_AI_MODEL,
  DETERMINISTIC_AI_RULES_VERSION,
} from "./run-metadata";
import {
  AiProviderExecutionError,
  createAiProviderRegistry,
  createDeterministicProvider,
  createMockProvider,
} from "./providers";

describe("AI provider seam", () => {
  it("registers a deterministic provider for local text and optional embeddings without API keys", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const registry = createAiProviderRegistry({
        now: () => new Date("2026-06-10T00:00:00.000Z"),
      });
      registry.register(createDeterministicProvider({
        generateText: ({ prompt }) => `rules:${prompt}`,
        embedText: ({ text }) => [text.length, 1],
      }));

      const result = await registry.generateText({
        providerId: "deterministic",
        action: "intent_brief",
        prompt: "Summarize opportunity",
        promptVersion: "intent-brief-lite@2026-06-10",
        confidence: "high",
      });
      const embedding = await registry.embedText({
        providerId: "deterministic",
        text: "abc",
      });

      expect(result.text).toBe("rules:Summarize opportunity");
      expect(result.aiRun).toMatchObject({
        id: "ai_run_intent_brief_2026-06-10T00:00:00.000Z",
        provider: "deterministic",
        model: DETERMINISTIC_AI_MODEL,
        rulesVersion: DETERMINISTIC_AI_RULES_VERSION,
        promptVersion: "intent-brief-lite@2026-06-10",
        confidence: "high",
        cost: { currency: "USD", total: 0, estimatedUsd: 0 },
        credits: { estimated: 1, charged: 0, mode: "dry_run" },
        fallback: { used: false, reason: "deterministic_rules_selected" },
        fallbackReason: "deterministic_rules_selected",
      });
      expect(embedding).toEqual({
        embedding: [3, 1],
        provider: "deterministic",
        model: DETERMINISTIC_AI_MODEL,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("registers a mock provider and records estimated provider cost and credits", async () => {
    const registry = createAiProviderRegistry({
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });
    registry.register(createMockProvider({
      id: "mock",
      model: "mock://unit/success",
      generateText: () => "mocked response",
      estimatedCostUsd: 0.0125,
      estimatedCredits: 2,
    }));

    const result = await registry.generateText({
      providerId: "mock",
      action: "enterprise_ai",
      prompt: "Draft response",
      promptVersion: "enterprise-ai@unit",
      confidence: "medium",
    });

    expect(result).toMatchObject({
      text: "mocked response",
      aiRun: {
        provider: "mock",
        model: "mock://unit/success",
        cost: { currency: "USD", total: 0, estimatedUsd: 0.0125 },
        credits: { estimated: 2, charged: 0, mode: "dry_run" },
        fallback: { used: false, reason: "none" },
        fallbackReason: "none",
      },
    });
  });

  it("surfaces provider failures when no fallback provider is configured", async () => {
    const registry = createAiProviderRegistry();
    registry.register(createMockProvider({
      id: "mock",
      model: "mock://unit/failure",
      generateText: () => {
        throw new Error("upstream unavailable");
      },
    }));

    await expect(registry.generateText({
      providerId: "mock",
      action: "enterprise_ai",
      prompt: "Draft response",
      promptVersion: "enterprise-ai@unit",
      confidence: "medium",
    })).rejects.toMatchObject({
      name: "AiProviderExecutionError",
      providerId: "mock",
      reason: "provider_error",
    });
    await expect(registry.generateText({
      providerId: "mock",
      action: "enterprise_ai",
      prompt: "Draft response",
      promptVersion: "enterprise-ai@unit",
      confidence: "medium",
    })).rejects.toBeInstanceOf(AiProviderExecutionError);
  });

  it("falls back to deterministic provider when the primary provider fails", async () => {
    const registry = createAiProviderRegistry({
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });
    registry.register(createMockProvider({
      id: "mock",
      model: "mock://unit/failure",
      generateText: () => {
        throw new Error("upstream unavailable");
      },
    }));
    registry.register(createDeterministicProvider({
      generateText: ({ prompt }) => `fallback:${prompt}`,
    }));

    const result = await registry.generateText({
      providerId: "mock",
      fallbackProviderId: "deterministic",
      action: "qualification_qa",
      prompt: "What is the deadline?",
      promptVersion: "qualification-qa-lite@2026-06-10",
      confidence: "medium",
    });

    expect(result).toMatchObject({
      text: "fallback:What is the deadline?",
      aiRun: {
        provider: "deterministic",
        model: DETERMINISTIC_AI_MODEL,
        fallback: {
          used: true,
          fromProvider: "mock",
          reason: "provider_error",
        },
        fallbackReason: "provider_error",
      },
    });
  });

  it("falls back when the primary provider times out", async () => {
    const registry = createAiProviderRegistry({
      now: () => new Date("2026-06-10T00:00:00.000Z"),
      timeoutMs: 5,
    });
    registry.register(createMockProvider({
      id: "slow",
      model: "mock://unit/slow",
      generateText: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return "too late";
      },
    }));
    registry.register(createMockProvider({
      id: "fallback",
      model: "mock://unit/fallback",
      generateText: () => "fallback response",
    }));

    const result = await registry.generateText({
      providerId: "slow",
      fallbackProviderId: "fallback",
      action: "enterprise_ai",
      prompt: "Draft response",
      promptVersion: "enterprise-ai@unit",
      confidence: "medium",
    });

    expect(result).toMatchObject({
      text: "fallback response",
      aiRun: {
        provider: "fallback",
        model: "mock://unit/fallback",
        fallback: {
          used: true,
          fromProvider: "slow",
          reason: "provider_timeout",
        },
        fallbackReason: "provider_timeout",
      },
    });
  });
});
