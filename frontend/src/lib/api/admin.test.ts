import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  type AdminApprovalReadinessSummary,
  batchUpdateAdminDataSources,
  batchUpdateAdminBidQaItems,
  createAdminUser,
  deliverAdminNotifications,
  getAdminApprovalReadiness,
  getAdminRiskChecklist,
  getAdminBidQaCorrections,
  getAdminMarketingFunnel,
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
  checkAdminDataSourceHealth,
  createAdminPlatformReview,
  listAdminPlatformReviews,
  precheckAdminDataSource,
  reconcileAdminSubscriptions,
  requestAdminSourcePrechecks,
  updateAdminConfigEntry,
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

  it("gets admin marketing funnel metrics", async () => {
    const body = {
      summary: {
        counts: {
          requestDemoSubmitted: 1,
          startSignup: 0,
          completeSignup: 1,
          startSupplierProfile: 1,
          completeSupplierProfile: 1,
          firstMatchedBidViewed: 0,
        },
        latestRequestDemoLeads: [{ eventId: "event_1", email: "buyer@example.com" }],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(getAdminMarketingFunnel()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/marketing/funnel");
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

  it("updates admin config registry entries", async () => {
    const body = {
      entry: {
        id: "cfg 1",
        module: "notification",
        configKey: "deadline_reminders",
        configValue: { enabled: false },
        status: "inactive",
        changeReason: "Disable reminder policy for sandbox.",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminConfigEntry("cfg 1", {
      configValue: { enabled: false },
      status: "inactive",
      changeReason: "Disable reminder policy for sandbox.",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/config/cfg%201", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        configValue: { enabled: false },
        status: "inactive",
        changeReason: "Disable reminder policy for sandbox.",
      }),
    });
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

  it("updates data source approval governance", async () => {
    const body = {
      source: {
        id: "ca source",
        approvalStatus: "approved",
        approvedForIngestion: true,
        legalReviewStatus: "approved_public",
        approvalNotes: "Approved after live source review.",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminDataSource("ca source", {
      approvalStatus: "approved",
      approvedForIngestion: true,
      legalReviewStatus: "approved_public",
      approvalNotes: "Approved after live source review.",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/ca%20source", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvalStatus: "approved",
        approvedForIngestion: true,
        legalReviewStatus: "approved_public",
        approvalNotes: "Approved after live source review.",
      }),
    });
  });

  it("updates data source live health triage fields", async () => {
    const body = {
      source: {
        id: "ca source",
        liveHealthOwner: "ops@example.com",
        liveHealthDisposition: "vendor_account",
        liveHealthNextReviewAt: null,
        liveHealthNotes: "Admin triage.",
        liveHealthReviewedAt: "2026-06-12T00:00:00.000Z",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminDataSource("ca source", {
      liveHealthOwner: "ops@example.com",
      liveHealthDisposition: "vendor_account",
      liveHealthNextReviewAt: null,
      liveHealthNotes: "Admin triage.",
      liveHealthReviewedAt: "2026-06-12T00:00:00.000Z",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/ca%20source", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        liveHealthOwner: "ops@example.com",
        liveHealthDisposition: "vendor_account",
        liveHealthNextReviewAt: null,
        liveHealthNotes: "Admin triage.",
        liveHealthReviewedAt: "2026-06-12T00:00:00.000Z",
      }),
    });
  });

  it("runs an admin source health check", async () => {
    const body = {
      report: { ok: true, summary: { total: 1, healthy: 1, unhealthy: 0, skipped: 0 }, results: [] },
      source: { id: "ca source", latestLiveHealth: { status: "healthy" } },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(checkAdminDataSourceHealth("ca source", { timeoutMs: 5000 })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/ca%20source/health-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeoutMs: 5000 }),
    });
  });

  it("runs the approval pre-check for one data source", async () => {
    const body = {
      sourceId: "bidnet_ny_erie",
      checkedAt: "2026-09-16T00:00:00.000Z",
      verdict: "empty",
      reasons: ["Portal reports no open bids."],
      robots: { status: "clear", flagged: false, flagReason: null },
      fetch: {
        status: "empty_verified",
        items: 0,
        sample: [],
        listMethod: "adapter",
        errorCode: null,
        errorMessage: null,
        httpStatus: 200,
        wafChallenge: false,
      },
      suggestedBaseUrl: null,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(precheckAdminDataSource("bidnet ny erie", { limit: 5 })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/bidnet%20ny%20erie/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 5 }),
    });
  });

  it("surfaces the pre-check route's own error codes and messages verbatim", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "PRECHECK_FAILED", message: "Crawler runtime unavailable." } }, { status: 502 }),
    );

    // The message names which leg failed, so it must reach the panel unparaphrased.
    await expect(precheckAdminDataSource("bidnet_ny_erie")).rejects.toMatchObject({
      name: "AdminApiError",
      status: 502,
      code: "PRECHECK_FAILED",
      message: "Crawler runtime unavailable.",
    });
  });

  it("maps the pre-check route's 404 onto SOURCE_NOT_FOUND", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "SOURCE_NOT_FOUND", message: "Data source was not found." } }, { status: 404 }),
    );

    await expect(precheckAdminDataSource("nope")).rejects.toBeInstanceOf(AdminApiError);
  });

  it("queues a platform's pending sources for the worker's precheck loop", async () => {
    const body = { requestedCount: 2, sourceIds: ["bidnet_mi_a", "bidnet_mi_b"] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(requestAdminSourcePrechecks({ providerFamily: "bidnet", pending: true })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/precheck-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerFamily: "bidnet", pending: true }),
    });
  });

  it("surfaces the precheck-requests route's INVALID_REQUEST message verbatim", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "pass sourceIds, or providerFamily together with pending: true" } },
        { status: 400 },
      ),
    );

    await expect(requestAdminSourcePrechecks({})).rejects.toMatchObject({
      name: "AdminApiError",
      status: 400,
      code: "INVALID_REQUEST",
      message: "pass sourceIds, or providerFamily together with pending: true",
    });
  });

  it("lists platform reviews together with the effective review per platform", async () => {
    const review = {
      id: "prv_1",
      providerFamily: "bidnet",
      tosUrl: "https://www.bidnetdirect.com/tsandcs",
      tosReviewedAt: "2026-09-29",
      robotsUrl: "https://www.bidnetdirect.com/robots.txt",
      robotsCheckedAt: "2026-09-29T07:00:00.000Z",
      robotsSummary: "list and detail paths allowed",
      accessBoundary: "只读公开列表与详情页；不登录、不取会员内容、不绕 WAF",
      reviewer: "apsi.lily@gmail.com",
      legalOpinionReference: null,
      reviewedAt: "2026-09-29T08:00:00.000Z",
      nextReviewAt: "2027-09-29",
      notes: null,
      createdBy: "admin_1",
      createdAt: "2026-09-29T08:00:00.000Z",
    };
    const body = { reviews: [review], effective: { bidnet: { status: "valid", review } } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminPlatformReviews()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/platform-reviews");
  });

  it("records a platform review", async () => {
    const input = {
      providerFamily: "bidnet",
      tosUrl: "https://www.bidnetdirect.com/tsandcs",
      tosReviewedAt: "2026-09-29",
      robotsUrl: "https://www.bidnetdirect.com/robots.txt",
      robotsCheckedAt: "2026-09-29T07:00:00.000Z",
      robotsSummary: "list and detail paths allowed",
      reviewer: "apsi.lily@gmail.com",
      nextReviewAt: "2027-09-29",
    };
    const body = { review: { id: "prv_1", ...input } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    await expect(createAdminPlatformReview(input)).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/platform-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("surfaces every platform review validation issue verbatim", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "tosUrl must be an http(s) URL; reviewer is required" } },
        { status: 400 },
      ),
    );

    // The form shows error.message as-is, so the joined issue list must not be paraphrased.
    await expect(
      createAdminPlatformReview({
        providerFamily: "bidnet",
        tosUrl: "nope",
        tosReviewedAt: "2026-09-29",
        robotsUrl: "https://www.bidnetdirect.com/robots.txt",
        robotsCheckedAt: "2026-09-29T07:00:00.000Z",
        robotsSummary: "ok",
        reviewer: "",
        nextReviewAt: "2027-09-29",
      }),
    ).rejects.toMatchObject({
      name: "AdminApiError",
      status: 400,
      code: "INVALID_REQUEST",
      message: "tosUrl must be an http(s) URL; reviewer is required",
    });
  });

  it("batch updates admin data source approvals", async () => {
    const body = { updatedCount: 2, sources: [{ id: "ca_caleprocure" }, { id: "tx_esbd" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(batchUpdateAdminDataSources({
      sourceIds: ["ca_caleprocure", "tx_esbd"],
      action: "approve",
    })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceIds: ["ca_caleprocure", "tx_esbd"], action: "approve" }),
    });
  });

  it("returns the ledgered outcomes the batch route adds for an approve", async () => {
    const body = {
      updatedCount: 1,
      skippedCount: 1,
      outcomes: [
        { sourceId: "bidnet_mi_a", outcome: "approved", reason: null },
        { sourceId: "bidnet_mi_b", outcome: "skipped", reason: "precheck_needs_fix" },
      ],
      sources: [{ id: "bidnet_mi_a" }],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await batchUpdateAdminDataSources({ sourceIds: ["bidnet_mi_a", "bidnet_mi_b"], action: "approve" });

    expect(result).toEqual(body);
    expect(result.skippedCount).toBe(1);
    expect(result.outcomes?.[1]).toEqual({ sourceId: "bidnet_mi_b", outcome: "skipped", reason: "precheck_needs_fix" });
  });

  it("surfaces the CSRF and approval-requirement rejections verbatim instead of a generic failure", async () => {
    // Codes the client did not list used to collapse to INTERNAL_ERROR / "Request failed", hiding the
    // sentence the admin needs (retry from the app, or which ledger field a login-gated source lacks).
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "CSRF_VALIDATION_FAILED", message: "Request origin could not be verified. Please retry from the application." } },
        { status: 403 },
      ),
    );
    await expect(batchUpdateAdminDataSources({ sourceIds: ["bidnet_mi_a"], action: "approve" })).rejects.toMatchObject({
      name: "AdminApiError",
      status: 403,
      code: "CSRF_VALIDATION_FAILED",
      message: "Request origin could not be verified. Please retry from the application.",
    });

    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "APPROVAL_REQUIREMENTS_UNMET", message: "Approving a login-gated source requires complianceReviewer to be recorded in the compliance ledger." } },
        { status: 400 },
      ),
    );
    await expect(batchUpdateAdminDataSources({ sourceIds: ["nj_login_gated"], action: "approve" })).rejects.toMatchObject({
      name: "AdminApiError",
      status: 400,
      code: "APPROVAL_REQUIREMENTS_UNMET",
      message: "Approving a login-gated source requires complianceReviewer to be recorded in the compliance ledger.",
    });
  });

  it("reads the approval readiness of one platform", async () => {
    const body = {
      providerFamily: "bidnet",
      platformReview: { status: "missing", review: null },
      counts: { approvable: 0, awaiting_precheck: 2, needs_fix: 0, missing_platform_review: 0, approved: 0, blocked: 0 },
      sources: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(getAdminApprovalReadiness("bidnet")).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/approval-readiness?providerFamily=bidnet");
  });

  it("hands the console each source's current base_url and the tenant probe's suggestion", async () => {
    // Typed as the client's own summary type: a field the server entry carries but the client type lacks
    // (or the reverse) is a type error here, not a silent runtime drop.
    const body: AdminApprovalReadinessSummary = {
      providerFamily: "bidnet",
      platformReview: { status: "valid", review: null },
      counts: { approvable: 0, awaiting_precheck: 0, needs_fix: 1, missing_platform_review: 0, approved: 0, blocked: 0 },
      sources: [
        {
          id: "bidnet_wy_laramie",
          label: "Laramie County",
          providerFamily: "bidnet",
          jurisdictionLevel: "county",
          baseUrl: "https://www.bidnetdirect.com/wyoming/laramie-county/solicitations/open-bids",
          suggestedBaseUrl: "https://www.bidnetdirect.com/colorado/laramiecountywyominggovernment",
          bucket: "needs_fix",
          reason: "precheck_needs_fix",
          precheckRequestedAt: null,
          liveHealthDisposition: "needs_fix",
          liveHealthReviewedAt: "2026-09-25T00:00:00.000Z",
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await getAdminApprovalReadiness("bidnet");

    expect(result.sources[0].baseUrl).toBe("https://www.bidnetdirect.com/wyoming/laramie-county/solicitations/open-bids");
    expect(result.sources[0].suggestedBaseUrl).toBe("https://www.bidnetdirect.com/colorado/laramiecountywyominggovernment");
  });

  it("reads the approval readiness of every local source when no platform is named", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ providerFamily: null, platformReview: null, counts: {}, sources: [] }),
    );

    await getAdminApprovalReadiness();

    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/approval-readiness");
  });

  it("surfaces a refused approval readiness read as an AdminApiError", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "FORBIDDEN", message: "Admin access is required." } }, { status: 403 }),
    );

    await expect(getAdminApprovalReadiness("bidnet")).rejects.toMatchObject({
      name: "AdminApiError",
      status: 403,
      code: "FORBIDDEN",
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

  it("surfaces INVALID_CRAWLER_CONFIG validation messages from the data source PATCH route", async () => {
    // The crawler config panel shows error.message verbatim, so the code must survive the
    // isAdminErrorResponse guard — otherwise every range violation degrades to "Request failed".
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "INVALID_CRAWLER_CONFIG",
            message: "enrichment.max_details_per_run must be between 1 and 200.",
          },
        },
        { status: 400 },
      ),
    );

    const promise = updateAdminDataSource("il_bidbuy", { cadence: "daily" });

    await expect(promise).rejects.toMatchObject({
      name: "AdminApiError",
      status: 400,
      code: "INVALID_CRAWLER_CONFIG",
      message: "enrichment.max_details_per_run must be between 1 and 200.",
    });
    await expect(promise).rejects.toBeInstanceOf(AdminApiError);
  });
});
