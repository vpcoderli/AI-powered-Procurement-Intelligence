import { describe, expect, it } from "vitest";
import {
  formatStripeSandboxConfigSummary,
  isStripeSandboxCancelReady,
  isStripeSandboxSubscriptionReady,
  parseStripeSandboxArgs,
  validateStripeSandboxConfig,
} from "./stripe-sandbox-verifier";

const validEnv = {
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_secret_123",
  STRIPE_WEBHOOK_SECRET: "whsec_secret_123",
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_business_monthly",
};

describe("Stripe sandbox verifier helpers", () => {
  it("rejects missing required Stripe sandbox environment variables", () => {
    expect(() => validateStripeSandboxConfig({}, { tier: "pro" })).toThrow(
      /BILLING_PROVIDER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_BUSINESS_MONTHLY/,
    );
  });

  it("rejects production Stripe secret keys", () => {
    expect(() =>
      validateStripeSandboxConfig(
        {
          ...validEnv,
          STRIPE_SECRET_KEY: "sk_live_real_secret",
        },
        { tier: "pro" },
      ),
    ).toThrow(/STRIPE_SECRET_KEY must be a Stripe test mode secret key/);
  });

  it("rejects invalid tier arguments and missing price ids", () => {
    expect(() => validateStripeSandboxConfig({ ...validEnv, STRIPE_PRICE_BUSINESS_MONTHLY: "" }, { tier: "business" }))
      .toThrow(/STRIPE_PRICE_BUSINESS_MONTHLY/);
    expect(() => validateStripeSandboxConfig(validEnv, { tier: "enterprise" })).toThrow(/tier must be pro or business/);
  });

  it("parses CLI options with sandbox-safe defaults", () => {
    expect(parseStripeSandboxArgs([])).toEqual({
      tier: "pro",
      origin: "http://localhost:3000",
      skipCancel: false,
      timeoutMs: 300000,
    });

    expect(parseStripeSandboxArgs([
      "--tier=business",
      "--origin=http://localhost:4000",
      "--skip-cancel",
      "--timeout-ms=120000",
    ])).toEqual({
      tier: "business",
      origin: "http://localhost:4000",
      skipCancel: true,
      timeoutMs: 120000,
    });
  });

  it("recognizes paid provider subscription states and excludes canceled subscriptions", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      expect(isStripeSandboxSubscriptionReady({
        tier: "pro",
        status,
        source: "billing_provider",
      }, "pro")).toBe(true);
    }

    expect(isStripeSandboxSubscriptionReady({
      tier: "pro",
      status: "canceled",
      source: "billing_provider",
    }, "pro")).toBe(false);
    expect(isStripeSandboxSubscriptionReady({
      tier: "business",
      status: "active",
      source: "billing_provider",
    }, "pro")).toBe(false);
  });

  it("recognizes sandbox cancellation cleanup states", () => {
    expect(isStripeSandboxCancelReady({ status: "active", cancelAtPeriodEnd: true })).toBe(true);
    expect(isStripeSandboxCancelReady({ status: "canceled", cancelAtPeriodEnd: false })).toBe(true);
    expect(isStripeSandboxCancelReady({ status: "active", cancelAtPeriodEnd: false })).toBe(false);
  });

  it("does not expose secret values in validation messages or summaries", () => {
    const config = validateStripeSandboxConfig(validEnv, { tier: "business" });
    const summary = formatStripeSandboxConfigSummary(config);

    expect(summary).not.toContain("sk_test_secret_123");
    expect(summary).not.toContain("whsec_secret_123");
    expect(summary).toContain("STRIPE_SECRET_KEY=configured");
    expect(summary).toContain("STRIPE_WEBHOOK_SECRET=configured");

    try {
      validateStripeSandboxConfig(
        {
          ...validEnv,
          BILLING_PROVIDER: "local",
          STRIPE_SECRET_KEY: "sk_live_real_secret",
        },
        { tier: "pro" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("sk_live_real_secret");
      expect(message).not.toContain("whsec_secret_123");
      return;
    }

    throw new Error("Expected validation to fail");
  });
});
