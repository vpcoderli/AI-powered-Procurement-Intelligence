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
    createCheckoutSession: vi.fn(),
  };
});

describe("POST /api/account/subscription/checkout", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a checkout session for the authenticated user", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(billingService.createCheckoutSession).mockReturnValueOnce({
      checkoutSession: {
        id: "checkout_1",
        userId: "user_1",
        tier: "pro",
        status: "open",
        provider: "local_checkout",
        providerSessionId: "local_cs_1",
        checkoutUrl: "/settings?checkoutSession=checkout_1",
        expiresAt: "2026-05-28T01:00:00.000Z",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/account/subscription/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=sess_valid`,
        },
        body: JSON.stringify({ tier: "pro" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checkoutSession).toMatchObject({ tier: "pro", status: "open" });
    expect(billingService.createCheckoutSession).toHaveBeenCalledWith(expect.anything(), "user_1", {
      tier: "pro",
      origin: "http://localhost",
    });
  });

  it("allows Business checkout for authenticated users", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(billingService.createCheckoutSession).mockReturnValueOnce({
      checkoutSession: {
        id: "checkout_business",
        userId: "user_1",
        tier: "business",
        status: "open",
        provider: "billing_provider",
        providerSessionId: "cs_test_business",
        checkoutUrl: "https://checkout.stripe.test/session",
        expiresAt: "2026-05-28T01:00:00.000Z",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/account/subscription/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=sess_valid`,
        },
        body: JSON.stringify({ tier: "business" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checkoutSession).toMatchObject({ tier: "business", provider: "billing_provider" });
    expect(billingService.createCheckoutSession).toHaveBeenCalledWith(expect.anything(), "user_1", {
      tier: "business",
      origin: "http://localhost",
    });
  });

  it("rejects Free and Enterprise checkout requests through the billing service boundary", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValue({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(billingService.createCheckoutSession).mockImplementation(() => {
      throw new billingService.InvalidSubscriptionInputError("Only Pro and Business plans support self-service checkout");
    });

    for (const tier of ["free", "enterprise"]) {
      const response = await POST(
        new Request("http://localhost/api/account/subscription/checkout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: `${SESSION_COOKIE_NAME}=sess_valid`,
          },
          body: JSON.stringify({ tier }),
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.message).toContain("Only Pro and Business");
    }
  });

  it("requires authentication", async () => {
    const response = await POST(new Request("http://localhost/api/account/subscription/checkout"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects unauthenticated sessions even when a stale cookie is present", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/account/subscription/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=sess_stale`,
        },
        body: JSON.stringify({ tier: "pro" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(billingService.createCheckoutSession).not.toHaveBeenCalled();
  });
});
