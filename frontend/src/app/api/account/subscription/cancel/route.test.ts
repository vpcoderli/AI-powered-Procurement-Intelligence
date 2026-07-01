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

  it("schedules provider-backed cancellation for active billing provider subscriptions", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "business",
      features: ["bid_search", "response.workspace.create"],
    });
    vi.mocked(billingService.cancelAccountSubscription).mockReturnValueOnce({
      subscription: {
        userId: "user_1",
        tier: "business",
        status: "active",
        source: "billing_provider",
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
    expect(body.subscription).toMatchObject({
      tier: "business",
      source: "billing_provider",
      cancelAtPeriodEnd: true,
    });
  });

  it("rejects cancellation when there is no active subscription", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(billingService.cancelAccountSubscription).mockImplementationOnce(() => {
      throw new billingService.InvalidSubscriptionInputError("No active subscription to cancel");
    });

    const response = await POST(
      new Request("http://localhost/api/account/subscription/cancel", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain("No active subscription");
  });

  it("requires authentication", async () => {
    const response = await POST(new Request("http://localhost/api/account/subscription/cancel", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects stale session cookies", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/account/subscription/cancel", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_stale` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(billingService.cancelAccountSubscription).not.toHaveBeenCalled();
  });

  it("rejects requests from a cross-site Origin before checking the session", async () => {
    const response = await POST(
      new Request("http://localhost/api/account/subscription/cancel", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=sess_valid`,
          origin: "https://evil.example.com",
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("CSRF_VALIDATION_FAILED");
    expect(authService.getSessionUser).not.toHaveBeenCalled();
    expect(billingService.cancelAccountSubscription).not.toHaveBeenCalled();
  });

  it("allows requests with a same-origin Origin header", async () => {
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
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=sess_valid`,
          origin: "http://localhost",
        },
      }),
    );

    expect(response.status).toBe(200);
  });
});
