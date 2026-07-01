import {
  DETERMINISTIC_AI_MODEL,
  DETERMINISTIC_AI_RULES_VERSION,
  type AiConfidence,
  type AiFallbackReason,
  type AiModel,
  type AiProviderId,
  type AiRunMetadata,
  createAiRunMetadata,
} from "./run-metadata";

type Awaitable<T> = T | Promise<T>;

export interface AiProviderTextInput {
  action: string;
  prompt: string;
  promptVersion: string;
  confidence: AiConfidence;
}

export interface AiProviderEmbedInput {
  text: string;
}

export interface AiProviderTextOutput {
  text: string;
  estimatedCostUsd?: number;
  estimatedCredits?: number;
}

export interface AiProvider {
  id: AiProviderId;
  model: AiModel;
  timeoutMs?: number;
  estimatedCostUsd?: number;
  estimatedCredits?: number;
  successFallbackReason?: AiFallbackReason;
  generateText(input: AiProviderTextInput): Awaitable<string | AiProviderTextOutput>;
  embedText?(input: AiProviderEmbedInput): Awaitable<number[]>;
}

export interface AiGenerateTextInput extends AiProviderTextInput {
  providerId: AiProviderId;
  fallbackProviderId?: AiProviderId;
  timeoutMs?: number;
}

export interface AiEmbedTextInput extends AiProviderEmbedInput {
  providerId: AiProviderId;
  timeoutMs?: number;
}

export interface AiTextRunResult {
  text: string;
  aiRun: AiRunMetadata;
}

export interface AiEmbeddingResult {
  embedding: number[];
  provider: AiProviderId;
  model: AiModel;
}

export interface AiProviderRegistryOptions {
  timeoutMs?: number;
  now?: () => Date;
}

interface ExecutedTextResult {
  text: string;
  estimatedCostUsd?: number;
  estimatedCredits?: number;
}

export class AiProviderExecutionError extends Error {
  readonly providerId: AiProviderId;
  readonly reason: Extract<AiFallbackReason, "provider_error" | "provider_timeout">;

  constructor(
    providerId: AiProviderId,
    reason: Extract<AiFallbackReason, "provider_error" | "provider_timeout">,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "AiProviderExecutionError";
    this.providerId = providerId;
    this.reason = reason;
    this.cause = options?.cause;
  }
}

export class AiProviderRegistry {
  private readonly providers = new Map<AiProviderId, AiProvider>();
  private readonly timeoutMs: number;
  private readonly now?: () => Date;

  constructor(options: AiProviderRegistryOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now;
  }

  register(provider: AiProvider) {
    this.providers.set(provider.id, provider);
    return this;
  }

  async generateText(input: AiGenerateTextInput): Promise<AiTextRunResult> {
    const provider = this.requireProvider(input.providerId);

    try {
      const output = await this.executeTextProvider(provider, input);
      return this.toTextRunResult(provider, input, output, {
        used: false,
        reason: provider.successFallbackReason ?? "none",
      });
    } catch (error) {
      const executionError = normalizeExecutionError(provider.id, error);

      if (!input.fallbackProviderId) {
        throw executionError;
      }

      const fallbackProvider = this.requireProvider(input.fallbackProviderId);
      const fallbackOutput = await this.executeTextProvider(fallbackProvider, input);

      return this.toTextRunResult(fallbackProvider, input, fallbackOutput, {
        used: true,
        fromProvider: provider.id,
        reason: executionError.reason,
      });
    }
  }

  async embedText(input: AiEmbedTextInput): Promise<AiEmbeddingResult> {
    const provider = this.requireProvider(input.providerId);

    if (!provider.embedText) {
      throw new AiProviderExecutionError(
        provider.id,
        "provider_error",
        `AI provider ${provider.id} does not implement embedText.`,
      );
    }

    const embedding = await withTimeout(
      Promise.resolve().then(() => provider.embedText?.({ text: input.text })),
      input.timeoutMs ?? provider.timeoutMs ?? this.timeoutMs,
      provider.id,
    );

    return {
      embedding: embedding ?? [],
      provider: provider.id,
      model: provider.model,
    };
  }

  private requireProvider(providerId: AiProviderId) {
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new AiProviderExecutionError(
        providerId,
        "provider_error",
        `AI provider ${providerId} is not registered.`,
      );
    }

    return provider;
  }

  private async executeTextProvider(provider: AiProvider, input: AiGenerateTextInput): Promise<ExecutedTextResult> {
    const raw = await withTimeout(
      Promise.resolve().then(() => provider.generateText({
        action: input.action,
        prompt: input.prompt,
        promptVersion: input.promptVersion,
        confidence: input.confidence,
      })),
      input.timeoutMs ?? provider.timeoutMs ?? this.timeoutMs,
      provider.id,
    );

    if (typeof raw === "string") {
      return { text: raw };
    }

    return raw;
  }

  private toTextRunResult(
    provider: AiProvider,
    input: AiGenerateTextInput,
    output: ExecutedTextResult,
    fallback: { used: boolean; reason: AiFallbackReason; fromProvider?: AiProviderId },
  ): AiTextRunResult {
    return {
      text: output.text,
      aiRun: createAiRunMetadata({
        action: input.action,
        provider: provider.id,
        model: provider.model,
        rulesVersion: provider.id === "deterministic" ? DETERMINISTIC_AI_RULES_VERSION : undefined,
        promptVersion: input.promptVersion,
        confidence: input.confidence,
        fallbackReason: fallback.reason,
        fallback,
        estimatedCostUsd: output.estimatedCostUsd ?? provider.estimatedCostUsd,
        estimatedCredits: output.estimatedCredits ?? provider.estimatedCredits,
        now: this.now,
      }),
    };
  }
}

function normalizeExecutionError(providerId: AiProviderId, error: unknown) {
  if (error instanceof AiProviderExecutionError) {
    return error;
  }

  return new AiProviderExecutionError(
    providerId,
    "provider_error",
    `AI provider ${providerId} failed.`,
    { cause: error },
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, providerId: AiProviderId): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new AiProviderExecutionError(
            providerId,
            "provider_timeout",
            `AI provider ${providerId} timed out after ${timeoutMs}ms.`,
          ));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function createAiProviderRegistry(options?: AiProviderRegistryOptions) {
  return new AiProviderRegistry(options);
}

export function createDeterministicProvider(
  options: Partial<AiProvider> & Pick<AiProvider, "generateText">,
): AiProvider {
  return {
    id: options.id ?? "deterministic",
    model: options.model ?? DETERMINISTIC_AI_MODEL,
    timeoutMs: options.timeoutMs,
    estimatedCostUsd: options.estimatedCostUsd ?? 0,
    estimatedCredits: options.estimatedCredits,
    successFallbackReason: options.successFallbackReason ?? "deterministic_rules_selected",
    generateText: options.generateText,
    embedText: options.embedText,
  };
}

export function createMockProvider(options: Partial<AiProvider> = {}): AiProvider {
  return {
    id: options.id ?? "mock",
    model: options.model ?? "mock://local/deterministic",
    timeoutMs: options.timeoutMs,
    estimatedCostUsd: options.estimatedCostUsd,
    estimatedCredits: options.estimatedCredits,
    successFallbackReason: options.successFallbackReason,
    generateText: options.generateText ?? (() => "mock response"),
    embedText: options.embedText,
  };
}
