import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as billingService from "@/server/billing/subscriptions";
import { GET } from "./route";

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
    getAccountSubscription: vi.fn(),
  };
});

describe("GET /api/account/subscription", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current authenticated user's subscription view", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "pro",
      features: ["bid_search", "submission_guidance"],
    });
    vi.mocked(billingService.getAccountSubscription).mockReturnValueOnce({
      subscription: {
        userId: "user_1",
        tier: "pro",
        status: "active",
        source: "local_checkout",
        currentPeriodEnd: "2026-06-28T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
      plans: billingService.listSubscriptionPlans(),
    });

    const response = await GET(
      new Request("http://localhost/api/account/subscription", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subscription).toMatchObject({ tier: "pro", status: "active" });
    expect(body.plans).toHaveLength(4);
    expect(billingService.getAccountSubscription).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("requires an authenticated session", async () => {
    const response = await GET(new Request("http://localhost/api/account/subscription"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
