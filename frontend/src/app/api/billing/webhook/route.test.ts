import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as billingProviders from "@/server/billing/providers";
import * as billingService from "@/server/billing/subscriptions";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/billing/subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/subscriptions")>();

  return {
    ...actual,
    applyBillingProviderEvent: vi.fn(),
  };
});
vi.mock("@/server/billing/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/providers")>();

  return {
    ...actual,
    constructStripeWebhookEvent: vi.fn(),
    normalizeStripeWebhookEvent: vi.fn(),
  };
});

describe("POST /api/billing/webhook", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("applies a provider subscription event", async () => {
    vi.mocked(billingService.applyBillingProviderEvent).mockReturnValueOnce({
      subscription: {
        userId: "user_1",
        tier: "pro",
        status: "active",
        source: "billing_provider",
        currentPeriodEnd: "2026-06-28T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
      plans: billingService.listSubscriptionPlans(),
    });

    const event = {
      id: "evt_1",
      type: "subscription.updated",
      provider: "stripe",
      userId: "user_1",
      providerSubscriptionId: "sub_1",
      tier: "pro",
      status: "active",
    };
    const response = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subscription).toMatchObject({ tier: "pro", status: "active" });
    expect(billingService.applyBillingProviderEvent).toHaveBeenCalledWith(expect.anything(), event);
  });

  it("rejects malformed provider events", async () => {
    const response = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "subscription.updated" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("requires a valid webhook signature when a billing secret is configured", async () => {
    vi.stubEnv("BILLING_WEBHOOK_SECRET", "whsec_test");
    const body = JSON.stringify({
      id: "evt_signed_1",
      type: "subscription.updated",
      userId: "user_1",
      tier: "pro",
      status: "active",
    });

    const unsignedResponse = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    const unsignedBody = await unsignedResponse.json();

    expect(unsignedResponse.status).toBe(401);
    expect(unsignedBody.error.code).toBe("INVALID_SIGNATURE");

    vi.mocked(billingService.applyBillingProviderEvent).mockReturnValueOnce({
      subscription: {
        userId: "user_1",
        tier: "pro",
        status: "active",
        source: "billing_provider",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      plans: billingService.listSubscriptionPlans(),
    });

    const signature = createHmac("sha256", "whsec_test").update(body).digest("hex");
    const signedResponse = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-billing-signature": signature,
        },
        body,
      }),
    );

    expect(signedResponse.status).toBe(200);
    expect(billingService.applyBillingProviderEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects unsigned generic billing events in production when no generic webhook secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const event = {
      id: "evt_prod_unsigned_1",
      type: "subscription.updated",
      provider: "manual",
      userId: "user_1",
      tier: "pro",
      status: "active",
    };

    const response = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("INVALID_SIGNATURE");
    expect(billingService.applyBillingProviderEvent).not.toHaveBeenCalled();
  });

  it("does not allow generic billing events to bypass Stripe signature verification in production Stripe mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_stripe_test");
    vi.stubEnv("BILLING_WEBHOOK_SECRET", "whsec_generic_test");
    const event = {
      id: "evt_generic_bypass_1",
      type: "subscription.updated",
      provider: "stripe",
      userId: "user_1",
      providerSubscriptionId: "sub_1",
      tier: "pro",
      status: "active",
    };
    const rawBody = JSON.stringify(event);
    const signature = createHmac("sha256", "whsec_generic_test").update(rawBody).digest("hex");

    const response = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-billing-signature": signature,
        },
        body: rawBody,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("INVALID_SIGNATURE");
    expect(billingProviders.constructStripeWebhookEvent).not.toHaveBeenCalled();
    expect(billingService.applyBillingProviderEvent).not.toHaveBeenCalled();
  });

  it("accepts Stripe-signed webhooks and maps them into internal provider events", async () => {
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_stripe_test");
    const rawBody = JSON.stringify({ id: "evt_stripe_raw" });
    const stripeEvent = { id: "evt_stripe_raw", type: "checkout.session.completed" };
    const providerEvent = {
      id: "evt_stripe_raw",
      type: "checkout.completed" as const,
      provider: "stripe",
      userId: "user_1",
      tier: "pro" as const,
      status: "active" as const,
    };

    vi.mocked(billingProviders.constructStripeWebhookEvent).mockReturnValueOnce(stripeEvent as never);
    vi.mocked(billingProviders.normalizeStripeWebhookEvent).mockReturnValueOnce(providerEvent);
    vi.mocked(billingService.applyBillingProviderEvent).mockReturnValueOnce({
      subscription: {
        userId: "user_1",
        tier: "pro",
        status: "active",
        source: "billing_provider",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      plans: billingService.listSubscriptionPlans(),
    });

    const response = await POST(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "t=123,v1=test",
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(billingProviders.constructStripeWebhookEvent).toHaveBeenCalledWith(
      rawBody,
      "t=123,v1=test",
      "whsec_stripe_test",
    );
    expect(billingProviders.normalizeStripeWebhookEvent).toHaveBeenCalledWith(stripeEvent);
    expect(billingService.applyBillingProviderEvent).toHaveBeenCalledWith(expect.anything(), providerEvent);
  });
});
