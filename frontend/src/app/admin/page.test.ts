import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createInitialAdminSectionState,
  filterAdminDataSourcesByHealthClassification,
  SOURCE_HEALTH_CLASSIFICATION_FILTERS,
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
    expect(page).toContain("source.crawlerCapabilities");
    expect(page).toContain("source.crawlerBaseUrl");
    expect(page).toContain("source.sourceAuthority");
    expect(page).toContain("source.trustStatus");
    expect(page).toContain("source.evidenceMode");
    expect(page).toContain("source.validityNotes");
    expect(page).toContain("source.latestLiveHealth");
    expect(page).toContain("SOURCE_HEALTH_CLASSIFICATION_FILTERS");
    expect(page).toContain("sourceHealthClassificationFilter");
    expect(page).toContain("filterAdminDataSourcesByHealthClassification");
    expect(page).toContain("sourceHealthClassificationLabel");
    expect(page).toContain('t("admin.sourceHealthClassificationFilter")');
    expect(page).toContain('t("admin.sourceHealthClassificationEmpty")');
    expect(page).toContain('t("admin.liveSourceRecommendedAction")');
    expect(page).toContain("checkAdminDataSourceHealth");
    expect(page).toContain("updateSourceApproval");
    expect(page).toContain('t("admin.approveSource")');
    expect(page).toContain('t("admin.holdSource")');
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
  });

  it("renders the shared source cards and links each row to its detail page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    // The live-health box and the compliance boxes moved to components/admin/sources and are imported here until
    // the old table is retired; the row-cell helpers and the run-id resolver moved with them.
    expect(page).toContain("<SourceLiveHealthCard");
    expect(page).toContain('pending={sourceHealthPendingId === source.id ? "recheck" : sourceTriagePendingId === source.id ? "triage" : null}');
    expect(page).toContain("onRecheck={() => recheckSourceHealth(source)}");
    expect(page).toContain("onTriage={(action) => updateSourceHealthTriage(source, action)}");
    expect(page).toContain("<SourceComplianceCard source={source} />");
    expect(page).toContain("crawlerRunIdFor(source)");
    expect(page).toContain("`/admin/sources/${encodeURIComponent(source.id)}`");
    expect(page).toContain('from "@/components/admin/sources/source-labels"');
    expect(page).toContain('from "@/components/admin/sources/crawler-run-id"');
    for (const moved of [
      "function stateCrawlerSourceIdFor(",
      "function liveSourceHealthTone(",
      "function sourceHealthTriageStatus(",
      "function sourceHealthTriagePatchForAction(",
      "function crawlerTone(",
      "function formatCrawlerBaseUrl(",
      "const liveHealth = source.latestLiveHealth",
      'className="mt-2 max-w-64 rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-600"',
    ]) {
      expect(page).not.toContain(moved);
    }
  });

  it("keeps the last loaded sources when a refresh of the admin sources API rejects", async () => {
    const loaded = await loadAdminDashboardSections(
      {
        dataSources: async () => ({
          summary: { totalSources: 1, enabledSources: 1, healthySources: 1, failingSources: 0 },
          sources: [],
        }),
      },
      createInitialAdminSectionState(),
    );

    expect(loaded.dataSources.status).toBe("ready");
    expect(isAdminDashboardFullyFailed(loaded)).toBe(false);

    const refreshed = await loadAdminDashboardSections(
      {
        dataSources: async () => {
          throw new Error("data sources failed");
        },
      },
      loaded,
    );

    expect(refreshed.dataSources.status).toBe("error");
    expect(refreshed.dataSources.data).toBe(loaded.dataSources.data);
  });

  it("recognizes a fully failed admin load as an understandable whole-page state", async () => {
    const sections = await loadAdminDashboardSections(
      {
        dataSources: async () => {
          throw new Error("admin API unavailable");
        },
      },
      createInitialAdminSectionState(),
    );

    expect(isAdminDashboardFullyFailed(sections)).toBe(true);
    expect(sections.dataSources.status).toBe("error");
  });

  it("no longer loads or renders the risk check and bid QA sections", async () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    // They live on /admin/quality and /admin/quality/bids now.
    expect(Object.keys(createInitialAdminSectionState())).toEqual(["dataSources"]);
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

  it("no longer mounts the onboarding panels, the batch run, the run-all button or the crawler log list", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    // They live on /admin/sources/onboarding and /admin/sources/runs now.
    for (const moved of [
      "PlatformReviewsPanel",
      "LedgeredApprovalPanel",
      "providerFamiliesOf",
      "platformReviewRevision",
      "JurisdictionBatchRunPanel",
      "runNow",
      "isRunning",
      "admin.runStateCrawlers",
      "AdminCrawlerLog",
      "crawlerLogs",
      "listAdminCrawlerLogs",
      "refreshCrawlerLogs",
      "CrawlerLogRow",
      "admin.recentLogs",
    ]) {
      expect(page).not.toContain(moved);
    }
    // What is left of the old run state: one source's Run button locks the row-level panels while it runs.
    expect(page).toContain("disabled={runningSourceId !== null}");
  });

  it("defines source health classification filter options", () => {
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
});
