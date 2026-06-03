import { describe, expect, it } from "vitest";
import {
  formatProductionBillingPreflightSummary,
  validateProductionBillingPreflight,
} from "./production-preflight";

const validEnv = {
  NODE_ENV: "production",
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_secret_123",
  STRIPE_WEBHOOK_SECRET: "whsec_live_123",
  STRIPE_PRICE_PRO_MONTHLY: "price_live_pro",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_live_business",
  DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
};

describe("production billing preflight", () => {
  it("accepts production Stripe live credentials with a MySQL runtime target", () => {
    expect(validateProductionBillingPreflight(validEnv)).toMatchObject({
      ok: true,
      provider: "stripe",
      database: "mysql",
      stripeMode: "live",
      configured: {
        STRIPE_SECRET_KEY: true,
        STRIPE_WEBHOOK_SECRET: true,
        STRIPE_PRICE_PRO_MONTHLY: true,
        STRIPE_PRICE_BUSINESS_MONTHLY: true,
      },
    });
  });

  it("rejects test-mode Stripe keys and missing MySQL runtime configuration", () => {
    expect(() => validateProductionBillingPreflight({
      ...validEnv,
      STRIPE_SECRET_KEY: "sk_test_secret_123",
      DATABASE_URL: "",
    })).toThrow(/STRIPE_SECRET_KEY must be a Stripe live mode secret key; DATABASE_URL or MYSQL_DATABASE_URL must be a MySQL URL/);
  });

  it("rejects placeholders and malformed webhook or price ids", () => {
    expect(() => validateProductionBillingPreflight({
      ...validEnv,
      STRIPE_WEBHOOK_SECRET: "whsec_REPLACE_ME",
      STRIPE_PRICE_PRO_MONTHLY: "pro_monthly",
    })).toThrow(/STRIPE_WEBHOOK_SECRET must not use a placeholder value; STRIPE_PRICE_PRO_MONTHLY must be a Stripe price id/);
  });

  it("does not expose secret values in summaries or error messages", () => {
    const summary = formatProductionBillingPreflightSummary(validateProductionBillingPreflight(validEnv));
    expect(summary).toContain("STRIPE_SECRET_KEY=configured");
    expect(summary).toContain("STRIPE_WEBHOOK_SECRET=configured");
    expect(summary).not.toContain("sk_live_secret_123");
    expect(summary).not.toContain("whsec_live_123");

    try {
      validateProductionBillingPreflight({
        ...validEnv,
        BILLING_PROVIDER: "local",
        STRIPE_SECRET_KEY: "sk_test_secret_123",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("sk_test_secret_123");
      expect(message).not.toContain("whsec_live_123");
      return;
    }

    throw new Error("Expected production preflight validation to fail");
  });
});
