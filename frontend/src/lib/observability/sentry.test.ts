import { afterEach, describe, expect, it, vi } from "vitest";

describe("sentry integration (guarded by SENTRY_DSN)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isSentryConfigured is false when SENTRY_DSN is unset", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { isSentryConfigured } = await import("./sentry");

    expect(isSentryConfigured()).toBe(false);
  });

  it("isSentryConfigured is true when SENTRY_DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://example.invalid/1");
    const { isSentryConfigured } = await import("./sentry");

    expect(isSentryConfigured()).toBe(true);
  });

  it("initSentry no-ops without throwing when @sentry/nextjs is not installed", async () => {
    vi.stubEnv("SENTRY_DSN", "https://example.invalid/1");
    const { initSentry } = await import("./sentry");

    expect(() => initSentry("server")).not.toThrow();
  });

  it("initSentry no-ops when SENTRY_DSN is unset, without attempting to load the SDK", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { initSentry } = await import("./sentry");

    expect(() => initSentry("server")).not.toThrow();
  });

  it("captureObservabilityError no-ops cleanly when Sentry is not configured", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { captureObservabilityError } = await import("./sentry");

    expect(() =>
      captureObservabilityError({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "boom",
        service: "test",
      }),
    ).not.toThrow();
  });

  it("captureException no-ops cleanly when Sentry is not configured", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { captureException } = await import("./sentry");

    expect(() => captureException(new Error("boom"), { context: "test" })).not.toThrow();
  });
});
