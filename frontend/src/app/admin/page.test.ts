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

    expect(page).toContain("batchUpdateAdminDataSources");
    expect(page).toContain("useAuth");
    expect(page).toContain("isAdmin");
    expect(page).toContain("isOperator");
    expect(page).toContain("canAccessAdminConsole");
    expect(page).toContain("canRunOperations");
    expect(page).toContain('t("admin.authLoading")');
    expect(page).toContain('t("admin.loginRequiredTitle")');
    expect(page).toContain('t("admin.forbiddenTitle")');
    expect(page).toContain("if (!canAccessAdminConsole) return");
    expect(page).toContain('t("admin.crawler")');
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
  });

  it("keeps successful admin sections ready when one admin API rejects", async () => {
    const sections = await loadAdminDashboardSections(
      {
        dataSources: async () => ({
          summary: { totalSources: 1, enabledSources: 1, healthySources: 1, failingSources: 0 },
          sources: [],
        }),
        crawlerLogs: async () => {
          throw new Error("crawler logs failed");
        },
      },
      createInitialAdminSectionState(),
    );

    expect(sections.crawlerLogs.status).toBe("error");
    expect(sections.dataSources.status).toBe("ready");
    expect(isAdminDashboardFullyFailed(sections)).toBe(false);
  });

  it("recognizes a fully failed admin load as an understandable whole-page state", async () => {
    const fail = async () => {
      throw new Error("admin API unavailable");
    };

    const sections = await loadAdminDashboardSections(
      {
        dataSources: fail,
        crawlerLogs: fail,
      },
      createInitialAdminSectionState(),
    );

    expect(isAdminDashboardFullyFailed(sections)).toBe(true);
    expect(sections.dataSources.status).toBe("error");
    expect(sections.crawlerLogs.status).toBe("error");
  });

  it("no longer loads or renders the risk check and bid QA sections", async () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    // They live on /admin/quality and /admin/quality/bids now.
    expect(Object.keys(createInitialAdminSectionState())).toEqual(["dataSources", "crawlerLogs"]);
    for (const moved of [
      "getAdminRiskChecklist",
      "listAdminBidQaItems",
      "updateAdminBidQaReview",
      "StateDataQualityMatrix",
      "<RiskCheck",
      "bidQaFilters",
      "selectedBidQaIds",
      "refreshRiskReport",
    ]) {
      expect(page).not.toContain(moved);
    }
    // The sources section still filters by recommended action, with the type now owned by the risk section.
    expect(page).toContain('import type { RecommendedActionFilter } from "@/components/admin/sections/RiskCheckSection"');
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
