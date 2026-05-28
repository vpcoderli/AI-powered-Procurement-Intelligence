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
    createCustomerPortalSession: vi.fn(),
  };
});

describe("POST /api/account/billing/portal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a billing customer portal session for the authenticated user", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "pro",
      features: ["bid_search", "submission_guidance"],
    });
    vi.mocked(billingService.createCustomerPortalSession).mockReturnValueOnce({
      portalSession: {
        userId: "user_1",
        provider: "billing_provider",
        portalUrl: "https://billing.example.test/portal?customer=cus_123",
        returnUrl: "http://localhost/settings",
        createdAt: "2026-05-28T00:00:00.000Z",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/account/billing/portal", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.portalSession).toMatchObject({ provider: "billing_provider" });
    expect(billingService.createCustomerPortalSession).toHaveBeenCalledWith(expect.anything(), "user_1", {
      origin: "http://localhost",
    });
  });

  it("requires authentication", async () => {
    const response = await POST(new Request("http://localhost/api/account/billing/portal", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
