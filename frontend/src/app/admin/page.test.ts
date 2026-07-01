import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createInitialAdminSectionState,
  filterAdminDataSourcesByHealthClassification,
  SOURCE_HEALTH_CLASSIFICATION_FILTERS,
  sourceHealthTriagePatchForAction,
  sourceHealthTriageStatus,
  sourceHealthClassificationLabel,
  isAdminDashboardFullyFailed,
  loadAdminDashboardSections,
} from "./page";

describe("admin page", () => {
  it("renders user access controls alongside crawler operations", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("listAdminUsers");
    expect(page).toContain("createAdminUser");
    expect(page).toContain("listAdminUserAuditLogs");
    expect(page).toContain("listAdminUserFeatureOverrides");
    expect(page).toContain("listAdminNotifications");
    expect(page).toContain("getAdminMarketingFunnel");
    expect(page).toContain("Marketing Funnel");
    expect(page).toContain("requestDemoSubmitted");
    expect(page).toContain("latestRequestDemoLeads");
    expect(page).toContain("/api/admin/marketing/leads/export");
    expect(page).toContain("Export leads CSV");
    expect(page).toContain("getAdminRiskChecklist");
    expect(page).toContain("listAdminBidQaItems");
    expect(page).toContain("getAdminBidQaCorrections");
    expect(page).toContain("batchUpdateAdminBidQaItems");
    expect(page).toContain("batchUpdateAdminDataSources");
    expect(page).toContain("deliverAdminNotifications");
    expect(page).toContain("reconcileAdminSubscriptions");
    expect(page).toContain("updateAdminUserAccess");
    expect(page).toContain("updateAdminUserFeatureOverride");
    expect(page).toContain("updateAdminBidQaReview");
    expect(page).toContain("StateDataQualityMatrix");
    expect(page).toContain("stateDataQuality");
    expect(page).toContain("stateQualityRiskFilter");
    expect(page).toContain("stateQualityReasonFilter");
    expect(page).toContain("STATE_DATA_QUALITY_RISK_FILTERS");
    expect(page).toContain("filterStateDataQualityRows");
    expect(page).toContain("stateAttachmentRealRatio");
    expect(page).toContain("State data quality action queue");
    expect(page).toContain("report.actions");
    expect(page).toContain("recommendedAction");
    expect(page).toContain("CA/FL/IL/NY/TX P0 blockers are state data quality blockers");
    expect(page).toContain("not live source-health failures");
    expect(page).not.toContain("CA/FL/IL/NY/TX source-health production risk");
    expect(page).toContain("useAuth");
    expect(page).toContain("isAdmin");
    expect(page).toContain("isOperator");
    expect(page).toContain("canAccessAdminConsole");
    expect(page).toContain("canRunOperations");
    expect(page).toContain('t("admin.authLoading")');
    expect(page).toContain('t("admin.loginRequiredTitle")');
    expect(page).toContain('t("admin.forbiddenTitle")');
    expect(page).toContain("if (!canAccessAdminConsole) return");
    expect(page).toContain('t("admin.users")');
    expect(page).toContain('t("admin.crawler")');
    expect(page).toContain('t("admin.bidQa")');
    expect(page).toContain('t("admin.riskCheck")');
    expect(page).toContain('t("admin.riskCheckGlobalUrlTitle")');
    expect(page).toContain('t("admin.riskCheckGlobalUrlDescription")');
    expect(page).toContain('t("admin.riskCheckMoreIssues")');
    expect(page).toContain('check.id === "global-url-validity"');
    expect(page).toContain('t("admin.refreshRiskCheck")');
    expect(page).toContain('t("admin.exportRiskCheck")');
    expect(page).toContain("refreshRiskReport");
    expect(page).toContain("exportRiskReport");
    expect(page).toContain("URL.createObjectURL");
    expect(page).toContain("risk-check-report");
    expect(page).toContain("riskDetailBidHref");
    expect(page).toContain("bidDetailPath");
    expect(page).toContain("RiskDetailItem");
    expect(page).toContain('t("admin.riskCheckHistory")');
    expect(page).toContain('t("admin.riskCheckHistoryEmpty")');
    expect(page).toContain('t("admin.riskCheckTrend")');
    expect(page).toContain('t("admin.riskTrendGlobalUrlStable")');
    expect(page).toContain('t("admin.riskTrendStateCoverageDeclined")');
    expect(page).toContain('t("admin.riskTrendAttachmentChanged")');
    expect(page).toContain("riskHistory");
    expect(page).toContain("riskTrend");
    expect(page).toContain("riskReport");
    expect(page).toContain("RiskCheck");
    expect(page).toContain('t("admin.qualityScore")');
    expect(page).toContain('t("admin.archiveIssues")');
    expect(page).toContain('t("admin.markReviewed")');
    expect(page).toContain('t("admin.displayStatus")');
    expect(page).toContain('t("admin.publishBid")');
    expect(page).toContain('t("admin.suppressBid")');
    expect(page).toContain('t("admin.saveCorrections")');
    expect(page).toContain('t("admin.batchReview")');
    expect(page).toContain('t("admin.qaFilters")');
    expect(page).toContain('t("admin.reviewedTo")');
    expect(page).toContain('t("admin.correctionHistory")');
    expect(page).toContain("bidQaFilters");
    expect(page).toContain("selectedBidQaIds");
    expect(page).toContain("visibleSelectedBidQaIds");
    expect(page).toContain("setSelectedBidQaIds([])");
    expect(page).toContain("correctionHistoryBidId");
    expect(page).toContain("correctionDrafts");
    expect(page).toContain("displayStatus");
    expect(page).toContain("correctionCount");
    expect(page).toContain('t("admin.crawlerAdapter_dedicated")');
    expect(page).toContain('t("admin.crawlerMaturity_verified")');
    expect(page).toContain("source.crawlerCapabilities");
    expect(page).toContain("source.crawlerBaseUrl");
    expect(page).toContain("source.sourceAuthority");
    expect(page).toContain("source.trustStatus");
    expect(page).toContain("source.evidenceMode");
    expect(page).toContain("source.validityNotes");
    expect(page).toContain('t("admin.sourceAuthority_official")');
    expect(page).toContain('t("admin.sourceTrust_fallback")');
    expect(page).toContain('t("admin.sourceEvidence_aggregator_page")');
    expect(page).toContain('t("admin.liveSourceHealth")');
    expect(page).toContain('t("admin.liveSourceHealth_healthy")');
    expect(page).toContain("source.latestLiveHealth");
    expect(page).toContain("const liveHealth = source.latestLiveHealth");
    expect(page).toContain("SOURCE_HEALTH_CLASSIFICATION_FILTERS");
    expect(page).toContain("sourceHealthClassificationFilter");
    expect(page).toContain("filterAdminDataSourcesByHealthClassification");
    expect(page).toContain("sourceHealthClassificationLabel");
    expect(page).toContain('t("admin.sourceHealthClassificationFilter")');
    expect(page).toContain('t("admin.sourceHealthClassificationEmpty")');
    expect(page).toContain("liveHealth.reason");
    expect(page).toContain("liveHealth.evidenceSnippets");
    expect(page).toContain('t("admin.liveSourceHealthNoCheck")');
    expect(page).toContain("liveHealth?.statusCode");
    expect(page).toContain("liveHealth?.latencyMs");
    expect(page).toContain("liveHealth?.error");
    expect(page).toContain("liveHealth?.recommendedAction");
    expect(page).toContain("liveHealth?.operationalSeverity");
    expect(page).toContain("source.sourceHealthTrend");
    expect(page).toContain("const healthTrend = source.sourceHealthTrend");
    expect(page).toContain('t("admin.liveSourceRecommendedAction")');
    expect(page).toContain('t("admin.liveSourceHealthTrend")');
    expect(page).toContain('t("admin.liveSourceHealthTrendSummary")');
    expect(page).toContain('t("admin.liveSourceHealthCurrentStreak")');
    expect(page).toContain('t("admin.liveSourceHealthLastUnhealthy")');
    expect(page).toContain('t("admin.sourceHealthAction_update_registry_url")');
    expect(page).toContain("checkAdminDataSourceHealth");
    expect(page).toContain("updateSourceApproval");
    expect(page).toContain('t("admin.approveSource")');
    expect(page).toContain('t("admin.holdSource")');
    expect(page).toContain('t("admin.recheckSource")');
    expect(page).toContain("sourceApprovalPendingId");
    expect(page).toContain("sourceApprovalBatchPending");
    expect(page).toContain("selectedSourceIds");
    expect(page).toContain("visibleSelectedSourceIds");
    expect(page).toContain("batchUpdateSourceApproval");
    expect(page).toContain('t("admin.selectedSources")');
    expect(page).toContain('t("admin.batchApproveSources")');
    expect(page).toContain('t("admin.batchHoldSources")');
    expect(page).toContain('t("admin.selectAllSources")');
    expect(page).toContain('t("admin.selectSource")');
    expect(page).toContain("sourceHealthPendingId");
    expect(page).toContain("source.approvalHistory");
    expect(page).toContain('t("admin.sourceApprovalHistory")');
    expect(page).toContain('t("admin.sourceApprovalActor")');
    expect(page).toContain('t("admin.inviteUser")');
    expect(page).toContain('t("admin.temporaryPassword")');
    expect(page).toContain("invitationDraft");
    expect(page).toContain("handleCreateAdminUser");
    expect(page).toContain('t("admin.userAuditLogs")');
    expect(page).toContain('t("admin.auditFilterTarget")');
    expect(page).toContain('t("admin.auditFilterFeature")');
    expect(page).toContain('t("admin.allAuditActors")');
    expect(page).toContain('t("admin.allAuditActions")');
    expect(page).toContain("userAuditFilters");
    expect(page).toContain('t("admin.featureOverrides")');
    expect(page).toContain('t("admin.overrideReason")');
    expect(page).toContain('t("admin.overrideExpiresAt")');
    expect(page).toContain('t("admin.overrideExpired")');
    expect(page).toContain("featureOverrideReason");
    expect(page).toContain("featureOverrideExpiresAt");
    expect(page).toContain("userFilters");
    expect(page).toContain("featureOverrideUser");
    expect(page).toContain("USER_ROLES");
    expect(page).toContain("ACCOUNT_TIERS");
    expect(page).toContain('t("admin.notificationDelivery")');
    expect(page).toContain('t("admin.deliverNotifications")');
    expect(page).toContain('t("admin.reconcileSubscriptions")');
  });

  it("surfaces marketing content CMS copy-library scope and safe-claim guard cues in the config matrix", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("Marketing Content CMS");
    expect(page).toContain("Copy Library");
    expect(page).toContain("homepage/resources scope");
    expect(page).toContain("ux_state.copy_library");
    expect(page).toContain("safe validation");
    expect(page).toContain("unsafe claim guard");
    expect(page).toContain("Unsafe outcome, compliance, or submission claims are rejected");
    expect(page).toContain("falls back to default marketing copy");
  });

  it("keeps successful admin sections ready when one admin API rejects", async () => {
    const sections = await loadAdminDashboardSections(
      {
        dataSources: async () => ({
          summary: { totalSources: 1, enabledSources: 1, healthySources: 1, failingSources: 0 },
          sources: [],
        }),
        risk: async () => ({
          report: { ok: true, checkedAt: "2026-06-10T00:00:00.000Z", checks: [] },
          history: [],
          trend: {
            globalUrlAllPassing: true,
            stateCoverageDeclined: false,
            attachmentDownloadCountChanged: false,
          },
          stateDataQuality: {
            ok: false,
            checkedAt: "2026-06-10T00:00:00.000Z",
            summary: {
              totalStates: 50,
              p0BlockerStates: 5,
              p1WarningStates: 0,
              p2WarningStates: 0,
            },
            rows: [],
          },
        }),
        crawlerLogs: async () => {
          throw new Error("crawler logs failed");
        },
        bidQa: async () => ({
          summary: { needsReview: 1, archiveIssues: 0, lowQuality: 0 },
          items: [],
        }),
        users: async () => ({ users: [{ id: "admin-user" }] }),
        userAuditLogs: async () => ({ logs: [] }),
        notifications: async () => ({
          notifications: [{ id: "notification-1", recipient: "ops@example.com" }],
        }),
        marketingFunnel: async () => ({
          summary: {
            counts: {
              requestDemoSubmitted: 1,
              startSignup: 0,
              completeSignup: 1,
              startSupplierProfile: 1,
              completeSupplierProfile: 0,
              firstMatchedBidViewed: 0,
            },
            latestRequestDemoLeads: [],
          },
        }),
      },
      createInitialAdminSectionState(),
    );

    expect(sections.crawlerLogs.status).toBe("error");
    expect(sections.dataSources.status).toBe("ready");
    expect(sections.risk.status).toBe("ready");
    expect(sections.risk.data?.stateDataQuality?.summary).toMatchObject({
      totalStates: 50,
      p0BlockerStates: 5,
    });
    expect(sections.bidQa.status).toBe("ready");
    expect(sections.users.status).toBe("ready");
    expect(sections.notifications.status).toBe("ready");
    expect(sections.notifications.data).toHaveLength(1);
    expect(sections.marketingFunnel.status).toBe("ready");
    expect(sections.marketingFunnel.data?.counts.requestDemoSubmitted).toBe(1);
    expect(isAdminDashboardFullyFailed(sections)).toBe(false);
  });

  it("recognizes a fully failed admin load as an understandable whole-page state", async () => {
    const fail = async () => {
      throw new Error("admin API unavailable");
    };

    const sections = await loadAdminDashboardSections(
      {
        dataSources: fail,
        risk: fail,
        crawlerLogs: fail,
        bidQa: fail,
        users: fail,
        userAuditLogs: fail,
        notifications: fail,
        marketingFunnel: fail,
      },
      createInitialAdminSectionState(),
    );

    expect(isAdminDashboardFullyFailed(sections)).toBe(true);
    expect(sections.dataSources.status).toBe("error");
    expect(sections.risk.status).toBe("error");
    expect(sections.crawlerLogs.status).toBe("error");
    expect(sections.bidQa.status).toBe("error");
    expect(sections.users.status).toBe("error");
    expect(sections.userAuditLogs.status).toBe("error");
    expect(sections.notifications.status).toBe("error");
    expect(sections.marketingFunnel.status).toBe("error");
  });

  it("defines source health classification filter options and readable labels", () => {
    expect(SOURCE_HEALTH_CLASSIFICATION_FILTERS).toEqual([
      "all",
      "ok",
      "forbidden",
      "timeout",
      "bot_check",
      "login_required",
      "empty_or_placeholder",
      "tls_or_network_error",
      "http_error",
      "unknown",
    ]);

    const labels: Record<string, string> = {
      "admin.sourceHealthClassification_all": "All",
      "admin.sourceHealthClassification_ok": "OK",
      "admin.sourceHealthClassification_forbidden": "Forbidden",
      "admin.sourceHealthClassification_timeout": "Timeout",
      "admin.sourceHealthClassification_bot_check": "Bot check",
      "admin.sourceHealthClassification_login_required": "Login required",
      "admin.sourceHealthClassification_empty_or_placeholder": "Empty/placeholder",
      "admin.sourceHealthClassification_tls_or_network_error": "Network/TLS",
      "admin.sourceHealthClassification_http_error": "HTTP error",
      "admin.sourceHealthClassification_unknown": "Unknown",
    };

    expect(sourceHealthClassificationLabel((key) => labels[key] ?? key, "empty_or_placeholder")).toBe(
      "Empty/placeholder",
    );
    expect(sourceHealthClassificationLabel((key) => labels[key] ?? key, "tls_or_network_error")).toBe("Network/TLS");
  });

  it("filters admin data sources by source health classification", () => {
    const sources = [
      { id: "sam", latestLiveHealth: { classification: "ok" } },
      { id: "portal", latestLiveHealth: { classification: "forbidden" } },
      { id: "legacy", latestLiveHealth: { classification: "timeout" } },
      { id: "unchecked", latestLiveHealth: null },
    ];

    expect(filterAdminDataSourcesByHealthClassification(sources, "all").map((source) => source.id)).toEqual([
      "sam",
      "portal",
      "legacy",
      "unchecked",
    ]);
    expect(filterAdminDataSourcesByHealthClassification(sources, "forbidden").map((source) => source.id)).toEqual([
      "portal",
    ]);
    expect(filterAdminDataSourcesByHealthClassification(sources, "unknown").map((source) => source.id)).toEqual([
      "unchecked",
    ]);
  });

  it("filters admin source ops rows by triage status and recommended action while preserving classification filters", async () => {
    const pageModule = await import("./page") as Record<string, unknown>;

    expect(typeof pageModule.filterAdminDataSourcesBySourceOps).toBe("function");

    const filterSources = pageModule.filterAdminDataSourcesBySourceOps as (
      sources: Array<{
        id: string;
        latestLiveHealth?: { classification?: string | null; recommendedAction?: string | null } | null;
        liveHealthOwner?: string | null;
        liveHealthDisposition?: string | null;
        liveHealthNextReviewAt?: string | null;
        liveHealthReviewedAt?: string | null;
      }>,
      filters: {
        classification: string;
        triageStatus: string;
        recommendedAction: string;
      },
      now: Date,
    ) => Array<{ id: string }>;
    const now = new Date("2026-06-12T00:00:00.000Z");
    const sources = [
      {
        id: "ca-overdue-browser",
        latestLiveHealth: { classification: "forbidden", recommendedAction: "browser_or_access_review" },
        liveHealthOwner: "ops@example.com",
        liveHealthNextReviewAt: "2026-06-11T00:00:00.000Z",
      },
      {
        id: "tx-scheduled-timeout",
        latestLiveHealth: { classification: "timeout", recommendedAction: "retry_or_increase_timeout" },
        liveHealthOwner: "ops@example.com",
        liveHealthNextReviewAt: "2026-06-13T00:00:00.000Z",
      },
      {
        id: "ny-reviewed-browser",
        latestLiveHealth: { classification: "forbidden", recommendedAction: "browser_or_access_review" },
        liveHealthDisposition: "manual",
        liveHealthReviewedAt: "2026-06-10T00:00:00.000Z",
      },
      {
        id: "fl-unassigned-none",
        latestLiveHealth: { classification: "forbidden", recommendedAction: "none" },
      },
    ];

    expect(
      filterSources(
        sources,
        { classification: "all", triageStatus: "overdue", recommendedAction: "all" },
        now,
      ).map((source) => source.id),
    ).toEqual(["ca-overdue-browser"]);
    expect(
      filterSources(
        sources,
        { classification: "forbidden", triageStatus: "all", recommendedAction: "browser_or_access_review" },
        now,
      ).map((source) => source.id),
    ).toEqual(["ca-overdue-browser", "ny-reviewed-browser"]);
    expect(
      filterSources(
        sources,
        { classification: "forbidden", triageStatus: "unassigned", recommendedAction: "none" },
        now,
      ).map((source) => source.id),
    ).toEqual(["fl-unassigned-none"]);
  });

  it("filters state data quality action rows by recommended action", async () => {
    const pageModule = await import("./page") as Record<string, unknown>;

    expect(typeof pageModule.filterStateDataQualityActionsByRecommendedAction).toBe("function");

    const filterActions = pageModule.filterStateDataQualityActionsByRecommendedAction as (
      actions: Array<{ id: string; recommendedAction: string }>,
      recommendedAction: string,
    ) => Array<{ id: string }>;
    const actions = [
      {
        id: "ca:crawler",
        recommendedAction: "Run or repair the state crawler, then verify at least one active state bid is imported.",
      },
      {
        id: "tx:archive",
        recommendedAction: "Re-archive the failed attachment and verify the stored file and checksum.",
      },
      {
        id: "ny:crawler",
        recommendedAction: "Run or repair the state crawler, then verify at least one active state bid is imported.",
      },
    ];

    expect(filterActions(actions, "all").map((action) => action.id)).toEqual([
      "ca:crawler",
      "tx:archive",
      "ny:crawler",
    ]);
    expect(
      filterActions(
        actions,
        "Run or repair the state crawler, then verify at least one active state bid is imported.",
      ).map((action) => action.id),
    ).toEqual(["ca:crawler", "ny:crawler"]);
  });

  it("filters state data quality matrix rows by P0/P1/P2 and reason code", async () => {
    const pageModule = await import("./page") as Record<string, unknown>;

    expect(pageModule.STATE_DATA_QUALITY_RISK_FILTERS).toEqual(["all", "P0", "P1", "P2"]);
    expect(typeof pageModule.filterStateDataQualityRows).toBe("function");

    const filterRows = pageModule.filterStateDataQualityRows as (
      rows: Array<{
        stateCode: string;
        riskLevel: string;
        reasons: Array<{ code: string; severity: string; message: string }>;
      }>,
      filters: { riskLevel: string; reasonCode: string },
    ) => Array<{ stateCode: string }>;
    const rows = [
      {
        stateCode: "CA",
        riskLevel: "P0",
        reasons: [{ code: "missing_state_bid", severity: "P0", message: "missing" }],
      },
      {
        stateCode: "FL",
        riskLevel: "P1",
        reasons: [{ code: "fixture_fallback", severity: "P1", message: "fallback" }],
      },
      {
        stateCode: "IL",
        riskLevel: "P2",
        reasons: [{ code: "risk_check_stale_or_missing", severity: "P2", message: "stale" }],
      },
      {
        stateCode: "TX",
        riskLevel: "P0",
        reasons: [{ code: "attachment_archive_invalid", severity: "P0", message: "archive" }],
      },
    ];

    expect(filterRows(rows, { riskLevel: "P0", reasonCode: "all" }).map((row) => row.stateCode)).toEqual(["CA", "TX"]);
    expect(filterRows(rows, { riskLevel: "all", reasonCode: "fixture_fallback" }).map((row) => row.stateCode)).toEqual([
      "FL",
    ]);
    expect(filterRows(rows, { riskLevel: "P0", reasonCode: "missing_state_bid" }).map((row) => row.stateCode)).toEqual([
      "CA",
    ]);
  });

  it("describes CA FL IL NY TX P0 blockers as state data quality blockers, not source health production risk", async () => {
    const pageModule = await import("./page") as Record<string, unknown>;

    expect(typeof pageModule.stateDataQualityP0BlockerNotice).toBe("function");

    const noticeFor = pageModule.stateDataQualityP0BlockerNotice as (
      rows: Array<{ stateCode: string; riskLevel: string }>,
    ) => string | null;
    const notice = noticeFor(
      ["CA", "FL", "IL", "NY", "TX"].map((stateCode) => ({
        stateCode,
        riskLevel: "P0",
      })),
    );

    expect(notice).toContain("CA/FL/IL/NY/TX P0 blockers are state data quality blockers");
    expect(notice).toContain("not live source-health failures");
    expect(notice).not.toContain("source-health production risk");
  });

  it("derives source health triage queue status from live review fields", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");

    expect(sourceHealthTriageStatus({ liveHealthOwner: null, liveHealthNextReviewAt: null })).toBe("unassigned");
    expect(
      sourceHealthTriageStatus({
        liveHealthOwner: "ops@example.com",
        liveHealthNextReviewAt: "2026-06-11T00:00:00.000Z",
      }, now),
    ).toBe("overdue");
    expect(
      sourceHealthTriageStatus({
        liveHealthOwner: "ops@example.com",
        liveHealthNextReviewAt: "2026-06-13T00:00:00.000Z",
      }, now),
    ).toBe("scheduled");
    expect(
      sourceHealthTriageStatus({
        liveHealthOwner: "ops@example.com",
        liveHealthDisposition: "accepted_fallback",
        liveHealthNextReviewAt: null,
        liveHealthReviewedAt: "2026-06-10T00:00:00.000Z",
      }),
    ).toBe("reviewed");
  });

  it("creates source health triage patch payloads for quick actions", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");

    expect(sourceHealthTriagePatchForAction("assign", "ops@example.com", now)).toMatchObject({
      liveHealthOwner: "ops@example.com",
      liveHealthDisposition: null,
      liveHealthNextReviewAt: "2026-06-13T00:00:00.000Z",
      liveHealthReviewedAt: null,
    });
    expect(sourceHealthTriagePatchForAction("vendor_account", "ops@example.com", now)).toMatchObject({
      liveHealthOwner: "ops@example.com",
      liveHealthDisposition: "vendor_account",
      liveHealthNextReviewAt: null,
      liveHealthReviewedAt: "2026-06-12T00:00:00.000Z",
    });
    expect(sourceHealthTriagePatchForAction("clear", "ops@example.com", now)).toEqual({
      liveHealthOwner: null,
      liveHealthDisposition: null,
      liveHealthNextReviewAt: null,
      liveHealthNotes: null,
      liveHealthReviewedAt: null,
    });
  });
});
