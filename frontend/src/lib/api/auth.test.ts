import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changePassword,
  confirmPasswordReset,
  fetchAccountSubscription,
  requestPasswordReset,
  updateAccountProfile,
} from "./auth";

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

  it("requests a password reset token", async () => {
    const body = {
      ok: true,
      resetToken: "reset_local",
      expiresAt: "2026-05-28T12:00:00.000Z",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(requestPasswordReset({ email: "buyer@example.com" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "buyer@example.com" }),
    });
  });

  it("confirms a password reset token", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(
      confirmPasswordReset({
        token: "reset_local",
        password: "new-strong-password",
      }),
    ).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "reset_local",
        password: "new-strong-password",
      }),
    });
  });
});
