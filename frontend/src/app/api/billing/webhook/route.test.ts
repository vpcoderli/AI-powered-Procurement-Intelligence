import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
