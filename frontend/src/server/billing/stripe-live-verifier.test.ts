import { describe, expect, it } from "vitest";
import {
  STRIPE_LIVE_CONFIRM_FLAG,
  assertStripeLiveConfirmed,
  extractStripeLiveSessionCookie,
  formatStripeLiveConfigSummary,
  isStripeLiveSubscriptionReady,
  isStripeLiveTierSyncReady,
  parseStripeLiveArgs,
  validateStripeLiveConfig,
} from "./stripe-live-verifier";

const validEnv = {
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_secret_123",
  STRIPE_WEBHOOK_SECRET: "whsec_secret_123",
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_monthly",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_business_monthly",
};

describe("Stripe live verifier helpers", () => {
  it("rejects missing required Stripe live environment variables", () => {
    expect(() => validateStripeLiveConfig({}, { tier: "pro" })).toThrow(
      /BILLING_PROVIDER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_BUSINESS_MONTHLY/,
    );
  });

  it("rejects Stripe test mode secret keys (refuses to run live smoke test with sk_test_)", () => {
    expect(() =>
      validateStripeLiveConfig(
        {
          ...validEnv,
          STRIPE_SECRET_KEY: "sk_test_fake_secret",
        },
        { tier: "pro" },
      ),
    ).toThrow(/is a Stripe test mode key; refusing to run the live smoke test with sk_test_/);
  });

  it("rejects secret keys that are neither sk_test_ nor sk_live_", () => {
    expect(() =>
      validateStripeLiveConfig(
        {
          ...validEnv,
          STRIPE_SECRET_KEY: "sk_totally_unknown_prefix",
        },
        { tier: "pro" },
      ),
    ).toThrow(/STRIPE_SECRET_KEY must be a Stripe live mode secret key \(sk_live_\.\.\.\)/);
  });

  it("accepts a well-formed live secret key", () => {
    expect(validateStripeLiveConfig(validEnv, { tier: "pro" })).toMatchObject({
      tier: "pro",
      priceIds: {
        pro: "price_pro_monthly",
        business: "price_business_monthly",
      },
    });
  });

  it("rejects invalid tier arguments and missing price ids", () => {
    expect(() => validateStripeLiveConfig({ ...validEnv, STRIPE_PRICE_BUSINESS_MONTHLY: "" }, { tier: "business" }))
      .toThrow(/STRIPE_PRICE_BUSINESS_MONTHLY/);
    expect(() => validateStripeLiveConfig(validEnv, { tier: "enterprise" })).toThrow(/tier must be pro or business/);
  });

  it("rejects placeholder live credentials and price ids", () => {
    expect(() =>
      validateStripeLiveConfig({
        ...validEnv,
        STRIPE_SECRET_KEY: "sk_live_REPLACE_ME",
        STRIPE_WEBHOOK_SECRET: "whsec_REPLACE_ME",
        STRIPE_PRICE_PRO_MONTHLY: "price_REPLACE_ME",
      }, { tier: "pro" }),
    ).toThrow(
      /STRIPE_SECRET_KEY must not use a placeholder value; STRIPE_WEBHOOK_SECRET must not use a placeholder value; STRIPE_PRICE_PRO_MONTHLY must not use a placeholder value/,
    );
  });

  it("rejects malformed origins and timeout arguments", () => {
    expect(() => validateStripeLiveConfig(validEnv, { origin: "ftp://example.test" }))
      .toThrow(/origin must be an http or https URL/);
    expect(() => validateStripeLiveConfig(validEnv, { timeoutMs: Number.NaN }))
      .toThrow(/timeout-ms must be a positive integer/);
  });

  it("parses CLI options including the required real-charge confirmation flag", () => {
    expect(parseStripeLiveArgs([])).toEqual({
      tier: "pro",
      origin: "http://localhost:3000",
      timeoutMs: 300000,
      confirmed: false,
    });

    expect(parseStripeLiveArgs([
      "--tier=business",
      "--origin=https://staging.example.test",
      STRIPE_LIVE_CONFIRM_FLAG,
      "--timeout-ms=120000",
    ])).toEqual({
      tier: "business",
      origin: "https://staging.example.test",
      timeoutMs: 120000,
      confirmed: true,
    });
  });

  it("refuses to proceed without explicit human confirmation", () => {
    expect(() => assertStripeLiveConfirmed(false, false)).toThrow(
      /Refusing to run: this script charges and refunds a real card/,
    );
    expect(() => assertStripeLiveConfirmed(true, false)).not.toThrow();
    expect(() => assertStripeLiveConfirmed(false, true)).not.toThrow();
  });

  it("recognizes paid provider subscription states and excludes canceled subscriptions", () => {
    for (const status of ["active", "trialing", "past_due"]) {
      expect(isStripeLiveSubscriptionReady({
        tier: "pro",
        status,
        source: "billing_provider",
      }, "pro")).toBe(true);
    }

    expect(isStripeLiveSubscriptionReady({
      tier: "pro",
      status: "canceled",
      source: "billing_provider",
    }, "pro")).toBe(false);
    expect(isStripeLiveSubscriptionReady({
      tier: "business",
      status: "active",
      source: "billing_provider",
    }, "pro")).toBe(false);
  });

  it("recognizes user and organization tier sync from API session payloads", () => {
    expect(isStripeLiveTierSyncReady({
      tier: "pro",
      workspace: { tier: "pro" },
    }, "pro")).toBe(true);

    expect(isStripeLiveTierSyncReady({
      tier: "pro",
      workspace: { tier: "business" },
    }, "pro")).toBe(false);

    expect(isStripeLiveTierSyncReady(null, "pro")).toBe(false);
  });

  it("extracts the live session cookie without leaking the whole Set-Cookie value", () => {
    expect(extractStripeLiveSessionCookie([
      "apsi_session=token_123; Path=/; HttpOnly; SameSite=Lax",
      "wb_anonymous=; Path=/; Max-Age=0",
    ])).toBe("apsi_session=token_123");

    expect(() => extractStripeLiveSessionCookie(["wb_anonymous=anon; Path=/"]))
      .toThrow(/register response did not include a session cookie/);
  });

  it("does not expose secret values in validation messages or summaries", () => {
    const config = validateStripeLiveConfig(validEnv, { tier: "pro" });
    const summary = formatStripeLiveConfigSummary(config);

    expect(summary).not.toContain("sk_live_secret_123");
    expect(summary).not.toContain("whsec_secret_123");
    expect(summary).toContain("STRIPE_SECRET_KEY=configured(live)");
    expect(summary).toContain("STRIPE_WEBHOOK_SECRET=configured");

    try {
      validateStripeLiveConfig(
        {
          ...validEnv,
          BILLING_PROVIDER: "local",
          STRIPE_SECRET_KEY: "sk_test_fake_secret",
        },
        { tier: "pro" },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("sk_test_fake_secret");
      expect(message).not.toContain("whsec_secret_123");
      return;
    }

    throw new Error("Expected validation to fail");
  });
});
