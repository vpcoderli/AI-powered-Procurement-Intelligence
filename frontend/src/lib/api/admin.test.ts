import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  batchUpdateAdminBidQaItems,
  createAdminUser,
  deliverAdminNotifications,
  getAdminRiskChecklist,
  getAdminBidQaCorrections,
  listAdminUserFeatureOverrides,
  listAdminNotifications,
  listAdminCrawlerLogs,
  listAdminBidQaItems,
  listAdminDataSources,
  listAdminUserAuditLogs,
  listAdminUsers,
  runSamGovCrawlerNow,
  runStateCrawlersNow,
  scheduleAdminBillingDunning,
  reconcileAdminSubscriptions,
  updateAdminUserFeatureOverride,
  updateAdminDataSource,
  updateAdminBidQaReview,
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

  it("gets admin risk checklist report", async () => {
    const body = {
      report: {
        ok: true,
        checkedAt: "2026-06-01T00:00:00.000Z",
        checks: [{ id: "state-coverage", label: "50 state data coverage", ok: true, summary: "50/50 states" }],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(getAdminRiskChecklist()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/risk-check");
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

    await expect(
      listAdminUserAuditLogs({
        limit: 10,
        actorKind: "admin",
        action: "user_access_updated",
        target: "buyer",
        featureKey: "compliance_manifest",
      }),
    ).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/users/audit-logs?limit=10&actorKind=admin&action=user_access_updated&target=buyer&featureKey=compliance_manifest",
    );
  });

  it("lists admin user feature overrides", async () => {
    const body = {
      organizationId: "org_1",
      organizationName: "Buyer Workspace",
      overrides: [{
        featureKey: "compliance_manifest",
        isEnabled: true,
        reason: "Pilot",
        expiresAt: "2026-06-28T00:00:00.000Z",
        isExpired: false,
      }],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminUserFeatureOverrides("user 1")).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users/user%201/feature-overrides");
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

  it("updates admin user feature overrides", async () => {
    const body = {
      organizationId: "org_1",
      organizationName: "Buyer Workspace",
      overrides: [{
        featureKey: "compliance_manifest",
        isEnabled: false,
        reason: "Enterprise exception",
        expiresAt: "2026-06-28T00:00:00.000Z",
        isExpired: false,
      }],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminUserFeatureOverride("user 1", {
      featureKey: "compliance_manifest",
      isEnabled: false,
      reason: "Enterprise exception",
      expiresAt: "2026-06-28T00:00:00.000Z",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/users/user%201/feature-overrides", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        featureKey: "compliance_manifest",
        isEnabled: false,
        reason: "Enterprise exception",
        expiresAt: "2026-06-28T00:00:00.000Z",
      }),
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

  it("lists admin bid QA items with filters", async () => {
    const body = {
      summary: { total: 1, needsReview: 1, archiveIssues: 1, lowQuality: 1 },
      items: [{ id: "bid_1", title: "QA bid" }],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(
      listAdminBidQaItems({
        limit: 10,
        q: "cloud",
        stateCode: "CA",
        reviewStatus: "needs_review",
        archiveStatus: "failed",
        displayStatus: "suppressed",
        sourceConfidence: "low",
        minQualityScore: 30,
        maxQualityScore: 80,
        reviewerId: "operator-1",
        reviewedFrom: "2026-05-30T00:00:00.000Z",
        reviewedTo: "2026-05-31T00:00:00.000Z",
      }),
    ).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/bids/qa?limit=10&q=cloud&stateCode=CA&reviewStatus=needs_review&archiveStatus=failed&displayStatus=suppressed&sourceConfidence=low&minQualityScore=30&maxQualityScore=80&reviewerId=operator-1&reviewedFrom=2026-05-30T00%3A00%3A00.000Z&reviewedTo=2026-05-31T00%3A00%3A00.000Z",
    );
  });

  it("gets admin bid QA correction history", async () => {
    const body = { corrections: [{ id: "correction_1", fieldName: "title" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(getAdminBidQaCorrections("bid 1")).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/bids/qa/bid%201");
  });

  it("batch updates admin bid QA items", async () => {
    const body = { updatedCount: 2, items: [{ id: "bid_1" }, { id: "bid_2" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(batchUpdateAdminBidQaItems({
      bidIds: ["bid_1", "bid_2"],
      reviewStatus: "reviewed",
      note: "Batch reviewed",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/bids/qa/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidIds: ["bid_1", "bid_2"], reviewStatus: "reviewed", note: "Batch reviewed" }),
    });
  });

  it("updates admin bid QA review status", async () => {
    const body = { item: { id: "bid_1", adminReviewStatus: "reviewed" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminBidQaReview("bid 1", {
      reviewStatus: "reviewed",
      note: "Verified",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/bids/qa/bid%201", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewStatus: "reviewed", note: "Verified" }),
    });
  });

  it("updates admin bid QA display status", async () => {
    const body = { item: { id: "bid_1", displayStatus: "suppressed" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminBidQaReview("bid 1", {
      displayStatus: "suppressed",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/bids/qa/bid%201", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayStatus: "suppressed" }),
    });
  });

  it("updates admin bid QA corrections", async () => {
    const body = { item: { id: "bid_1", title: "Corrected title" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminBidQaReview("bid 1", {
      corrections: { title: "Corrected title", deadlineDate: "2026-08-01" },
      note: "QA correction",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/bids/qa/bid%201", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        corrections: { title: "Corrected title", deadlineDate: "2026-08-01" },
        note: "QA correction",
      }),
    });
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

  it("schedules billing dunning reminders from the admin console", async () => {
    const body = {
      checkedInvoices: 2,
      queued: 1,
      skippedAlreadyQueued: 0,
      skippedNotDue: 1,
      skippedResolved: 0,
      skippedNoRecipient: 0,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(scheduleAdminBillingDunning({ limit: 50 })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/billing/dunning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
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
