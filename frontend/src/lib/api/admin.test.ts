import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  createAdminUser,
  deliverAdminNotifications,
  listAdminNotifications,
  listAdminCrawlerLogs,
  listAdminDataSources,
  listAdminUserAuditLogs,
  listAdminUsers,
  runSamGovCrawlerNow,
  runStateCrawlersNow,
  reconcileAdminSubscriptions,
  updateAdminDataSource,
  updateAdminUser,
} from "./admin";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("admin API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists admin data sources", async () => {
    const body = {
      summary: { totalSources: 1, enabledSources: 1, healthySources: 0, failingSources: 0 },
      sources: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminDataSources()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources");
  });

  it("lists admin users", async () => {
    const body = {
      users: [
        {
          id: "user_1",
          email: "buyer@example.com",
          displayName: "Buyer",
          role: "user",
          tier: "free",
          isDisabled: false,
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
          lastLoginAt: null,
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminUsers()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users");
  });

  it("lists admin users with filters", async () => {
    const body = { users: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(
      listAdminUsers({ q: "buyer", role: "user", tier: "pro", status: "enabled" }),
    ).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users?q=buyer&role=user&tier=pro&status=enabled");
  });

  it("lists admin user audit logs", async () => {
    const body = { logs: [{ id: "audit_1", targetEmail: "buyer@example.com" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminUserAuditLogs({ limit: 10 })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users/audit-logs?limit=10");
  });

  it("updates admin user access", async () => {
    const body = {
      user: {
        id: "user 1",
        email: "buyer@example.com",
        displayName: "Buyer",
        role: "admin",
        tier: "business",
        isDisabled: false,
        createdAt: "2026-05-20T00:00:00.000Z",
        updatedAt: "2026-05-21T00:00:00.000Z",
        lastLoginAt: null,
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminUser("user 1", { role: "admin", tier: "business" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users/user%201", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin", tier: "business" }),
    });
  });

  it("creates invited admin users", async () => {
    const body = {
      temporaryPassword: "temp-password-123",
      user: {
        id: "user_2",
        email: "newbuyer@example.com",
        displayName: "New Buyer",
        role: "user",
        tier: "pro",
        isDisabled: false,
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
        lastLoginAt: null,
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(
      createAdminUser({
        email: "newbuyer@example.com",
        displayName: "New Buyer",
        role: "user",
        tier: "pro",
      }),
    ).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "newbuyer@example.com",
        displayName: "New Buyer",
        role: "user",
        tier: "pro",
      }),
    });
  });

  it("updates data source enablement", async () => {
    const body = { source: { id: "sam_gov", isEnabled: false } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminDataSource("sam gov", { isEnabled: false })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/sam%20gov", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: false }),
    });
  });

  it("lists crawler logs", async () => {
    const body = { logs: [{ id: "log_1" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminCrawlerLogs()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/crawler-logs");
  });

  it("lists admin notification outbox rows", async () => {
    const body = {
      notifications: [{ id: "notification_1", status: "failed" }],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminNotifications({ limit: 10, status: "failed" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/notifications?limit=10&status=failed");
  });

  it("triggers admin notification delivery", async () => {
    const body = { attempted: 2, sent: 1, failed: 1, skipped: 0 };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(deliverAdminNotifications({ limit: 25, maxAttempts: 3 })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/notifications/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 25, maxAttempts: 3 }),
    });
  });

  it("reconciles subscription lifecycle from the admin console", async () => {
    const body = {
      checked: 4,
      canceledAtPeriodEnd: 1,
      markedPastDue: 1,
      downgradedPastDue: 1,
      expiredTrials: 1,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(reconcileAdminSubscriptions({ pastDueGraceDays: 10 })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/subscriptions/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pastDueGraceDays: 10 }),
    });
  });

  it("runs SAM.gov crawler now", async () => {
    const body = { status: "success", source: "SAM.gov" };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(runSamGovCrawlerNow()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/crawler/sam-gov/run", { method: "POST" });
  });

  it("runs state crawlers now", async () => {
    const body = { status: "completed", results: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(runStateCrawlersNow()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/crawler/state/run", { method: "POST" });
  });

  it("runs a selected state crawler now", async () => {
    const body = { status: "completed", results: [{ source: "il_bidbuy" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(runStateCrawlersNow(["il_bidbuy"])).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/crawler/state/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: ["il_bidbuy"] }),
    });
  });

  it("throws sanitized API errors", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "FORBIDDEN", message: "Admin access is required." } }, { status: 403 }),
    );

    const promise = listAdminDataSources();

    await expect(promise).rejects.toMatchObject({
      name: "AdminApiError",
      status: 403,
      code: "FORBIDDEN",
      message: "Admin access is required.",
    });
    await expect(promise).rejects.toBeInstanceOf(AdminApiError);
  });
});
