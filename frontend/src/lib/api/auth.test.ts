import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changePassword, fetchAccountSubscription, updateAccountProfile } from "./auth";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("auth API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates the account profile", async () => {
    const body = {
      user: {
        id: "user_1",
        email: "buyer@example.com",
        displayName: "Buyer Two",
        role: "user",
        tier: "free",
        features: ["bid_search"],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAccountProfile({ displayName: "Buyer Two" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Buyer Two" }),
    });
  });

  it("changes the account password", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      changePassword({
        currentPassword: "strong-password",
        newPassword: "new-strong-password",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: "strong-password",
        newPassword: "new-strong-password",
      }),
    });
  });

  it("fetches the current account subscription", async () => {
    const body = {
      subscription: {
        userId: "user_1",
        tier: "pro",
        status: "active",
        source: "local_checkout",
        currentPeriodEnd: "2026-06-28T00:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
      plans: [
        { tier: "free", label: "Free", priceMonthlyUsd: 0 },
        { tier: "pro", label: "Pro", priceMonthlyUsd: 79 },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(fetchAccountSubscription()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/subscription");
  });
});
