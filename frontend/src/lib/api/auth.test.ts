import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptWorkspaceInvitation,
  changePassword,
  confirmPasswordReset,
  cancelAccountSubscription,
  createBillingPortalSession,
  createCheckoutSession,
  deleteAccount,
  exportAccountData,
  fetchAccountNotificationPreferences,
  fetchBillingInvoices,
  fetchAccountSubscription,
  fetchAccountUsage,
  fetchAccountWorkspace,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  requestPasswordReset,
  revokeWorkspaceInvitation,
  setWorkspaceMemberStatus,
  transferWorkspaceOwnership,
  updateAccountWorkspace,
  updateAccountNotificationPreferences,
  updateAccountProfile,
  updateWorkspaceMemberRole,
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

  it("exports account data", async () => {
    const body = {
      generatedAt: "2026-05-28T00:00:00.000Z",
      account: {
        id: "user_1",
        email: "buyer@example.com",
        displayName: "Buyer",
        role: "user",
        tier: "free",
        isDisabled: false,
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
        lastLoginAt: null,
      },
      workspace: null,
      subscription: null,
      billingCheckoutSessions: [],
      billingInvoices: [],
      subscriptionEvents: [],
      savedBids: [],
      supplierProfile: null,
      intents: [],
      submissionPaths: [],
      submissionConfirmations: [],
      complianceManifestItems: [],
      pursuitDecisions: [],
      searchAlerts: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(exportAccountData()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/export");
  });

  it("deletes the current account", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(deleteAccount()).resolves.toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith("/api/account", {
      method: "DELETE",
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

  it("fetches account usage limits", async () => {
    const body = {
      tier: "free",
      workspaceUserIds: ["user_1"],
      items: [
        {
          feature: "saved_bids",
          used: 2,
          limit: 5,
          remaining: 3,
          isLimited: false,
          requiredTier: "pro",
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(fetchAccountUsage()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/usage");
  });

  it("fetches account notification preferences", async () => {
    const body = {
      userId: "user_1",
      savedSearchAlertsEnabled: true,
      defaultAlertFrequency: "daily",
      marketingUpdatesEnabled: false,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(fetchAccountNotificationPreferences()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/notification-preferences");
  });

  it("updates account notification preferences", async () => {
    const body = {
      userId: "user_1",
      savedSearchAlertsEnabled: false,
      defaultAlertFrequency: "weekly",
      marketingUpdatesEnabled: true,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T01:00:00.000Z",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(
      updateAccountNotificationPreferences({
        savedSearchAlertsEnabled: false,
        defaultAlertFrequency: "weekly",
        marketingUpdatesEnabled: true,
      }),
    ).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        savedSearchAlertsEnabled: false,
        defaultAlertFrequency: "weekly",
        marketingUpdatesEnabled: true,
      }),
    });
  });

  it("creates a checkout session for a paid account tier", async () => {
    const body = {
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
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(createCheckoutSession({ tier: "pro" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/subscription/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "pro" }),
    });
  });

  it("cancels the current account subscription", async () => {
    const body = {
      subscription: {
        userId: "user_1",
        tier: "pro",
        status: "active",
        source: "local_checkout",
        currentPeriodEnd: "2026-06-28T00:00:00.000Z",
        cancelAtPeriodEnd: true,
      },
      plans: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(cancelAccountSubscription()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/subscription/cancel", {
      method: "POST",
    });
  });

  it("fetches account billing invoice history", async () => {
    const body = {
      invoices: [
        {
          id: "invoice_1",
          userId: "user_1",
          provider: "stripe",
          providerInvoiceId: "in_1",
          invoiceNumber: "WIN-1001",
          status: "paid",
          currency: "USD",
          amountDueCents: 7900,
          amountPaidCents: 7900,
          invoiceUrl: "https://billing.example.test/invoices/in_1",
          invoicePdfUrl: null,
          dueAt: "2026-05-28T00:00:00.000Z",
          paidAt: "2026-05-28T00:00:00.000Z",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      ],
      summary: {
        totalInvoices: 1,
        paidCount: 1,
        failedCount: 0,
        openCount: 0,
        totalPaidCents: 7900,
        totalDueCents: 0,
        downloadablePdfCount: 0,
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(fetchBillingInvoices()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/billing/invoices");

    mockFetch.mockResolvedValueOnce(jsonResponse(body));
    await expect(fetchBillingInvoices({ status: "paid" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenLastCalledWith("/api/account/billing/invoices?status=paid");
  });

  it("creates a billing customer portal session", async () => {
    const body = {
      portalSession: {
        userId: "user_1",
        provider: "billing_provider",
        portalUrl: "https://billing.example.test/portal?customer=cus_123",
        returnUrl: "http://localhost:3000/settings",
        createdAt: "2026-05-28T00:00:00.000Z",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(createBillingPortalSession()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/billing/portal", {
      method: "POST",
    });
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

  it("fetches the current account workspace", async () => {
    const body = {
      organization: {
        id: "org_1",
        name: "Acme Federal Team",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      currentUserRole: "owner",
      members: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(fetchAccountWorkspace()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace");
  });

  it("updates the current account workspace", async () => {
    const body = {
      organization: {
        id: "org_1",
        name: "Acme Federal Team",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      currentUserRole: "owner",
      members: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAccountWorkspace({ name: "Acme Federal Team" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Acme Federal Team" }),
    });
  });

  it("invites a workspace member", async () => {
    const body = {
      member: {
        userId: "user_2",
        email: "member@example.com",
          displayName: "Member One",
          workspaceRole: "member",
          status: "invited",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      inviteToken: "invite_secret",
      inviteUrl: "/accept-invite?token=invite_secret",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    await expect(
      inviteWorkspaceMember({
        email: "member@example.com",
        displayName: "Member One",
        role: "member",
      }),
    ).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "member@example.com",
        displayName: "Member One",
        role: "member",
      }),
    });
  });

  it("accepts a workspace invitation", async () => {
    const body = {
      user: {
        id: "user_2",
        email: "member@example.com",
        displayName: "Member One",
        role: "user",
        tier: "free",
        features: ["bid_search"],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(
      acceptWorkspaceInvitation({
        token: "invite_secret",
        password: "member-strong-password",
        displayName: "Member One",
      }),
    ).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "invite_secret",
        password: "member-strong-password",
        displayName: "Member One",
      }),
    });
  });

  it("updates a workspace member role", async () => {
    const body = {
      organization: {
        id: "org_1",
        name: "Acme Federal Team",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      currentUserRole: "owner",
      members: [
        {
          userId: "user_2",
          email: "member@example.com",
          displayName: "Member One",
          workspaceRole: "owner",
          status: "active",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateWorkspaceMemberRole("user_2", { role: "owner" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/members/user_2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    });
  });

  it("sets a workspace member status", async () => {
    const body = {
      organization: {
        id: "org_1",
        name: "Acme Federal Team",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      currentUserRole: "owner",
      members: [
        {
          userId: "user_2",
          email: "member@example.com",
          displayName: "Member One",
          workspaceRole: "member",
          status: "disabled",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(setWorkspaceMemberStatus("user_2", { status: "disabled" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/members/user_2", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    });
  });

  it("resends a workspace invitation", async () => {
    const body = {
      member: {
        userId: "user_2",
        email: "member@example.com",
        displayName: "Member One",
        workspaceRole: "member",
        status: "invited",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      inviteToken: "invite_new",
      inviteUrl: "/accept-invite?token=invite_new",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(resendWorkspaceInvitation("user_2")).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/invitations/user_2/resend", {
      method: "POST",
    });
  });

  it("revokes a workspace invitation", async () => {
    const body = {
      organization: {
        id: "org_1",
        name: "Acme Federal Team",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      currentUserRole: "owner",
      members: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(revokeWorkspaceInvitation("user_2")).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/invitations/user_2", {
      method: "DELETE",
    });
  });

  it("transfers workspace ownership", async () => {
    const body = {
      organization: {
        id: "org_1",
        name: "Acme Federal Team",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      currentUserRole: "member",
      members: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(transferWorkspaceOwnership("user_2")).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/ownership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: "user_2" }),
    });
  });

  it("removes a workspace member", async () => {
    const body = {
      organization: {
        id: "org_1",
        name: "Acme Federal Team",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      currentUserRole: "owner",
      members: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(removeWorkspaceMember("user_2")).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/account/workspace/members/user_2", {
      method: "DELETE",
    });
  });
});
