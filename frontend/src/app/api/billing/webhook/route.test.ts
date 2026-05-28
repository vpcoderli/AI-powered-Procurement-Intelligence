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
});
