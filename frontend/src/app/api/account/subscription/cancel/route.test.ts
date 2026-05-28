import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as billingService from "@/server/billing/subscriptions";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});
vi.mock("@/server/billing/subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/subscriptions")>();

  return {
    ...actual,
    cancelAccountSubscription: vi.fn(),
  };
});

describe("POST /api/account/subscription/cancel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("schedules cancellation for the authenticated user's subscription", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "pro",
      features: ["bid_search", "submission_guidance"],
    });
    vi.mocked(billingService.cancelAccountSubscription).mockReturnValueOnce({
      subscription: {
        userId: "user_1",
        tier: "pro",
        status: "active",
        source: "local_checkout",
        currentPeriodEnd: "2026-06-28T00:00:00.000Z",
        cancelAtPeriodEnd: true,
      },
      plans: billingService.listSubscriptionPlans(),
    });

    const response = await POST(
      new Request("http://localhost/api/account/subscription/cancel", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subscription).toMatchObject({ tier: "pro", cancelAtPeriodEnd: true });
    expect(billingService.cancelAccountSubscription).toHaveBeenCalledWith(expect.anything(), "user_1");
  });
});
