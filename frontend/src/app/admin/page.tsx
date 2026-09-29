"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Database,
  Play,
  RefreshCw,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { UniversalState } from "@/components/universal-state";
import { useAuth } from "@/context/AuthContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  batchUpdateAdminDataSources,
  checkAdminDataSourceHealth,
  listAdminCrawlerLogs,
  listAdminDataSources,
  runStateCrawlersNow,
  updateAdminDataSource,
  type AdminCrawlerLog,
  type AdminDataSource,
  type AdminDataSourcesResponse,
} from "@/lib/api/admin";
import type { UserRole } from "@/server/auth/entitlements";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  compactErrorMessage,
  fallbackMessage,
  formatDate,
  statusTone,
} from "@/components/admin/admin-format";
import { AdminAccessState, AdminSectionStateCard, SummaryCard } from "@/components/admin/AdminStateCards";
import { JurisdictionBatchRunPanel } from "@/components/admin/JurisdictionBatchRunPanel";
import { CrawlerConfigPanel } from "@/components/admin/CrawlerConfigPanel";
import { SourcePrecheckPanel } from "@/components/admin/SourcePrecheckPanel";
import { isLocalJurisdictionSource } from "@/components/admin/ApproveLocalSourceDialog";
import { LedgeredApprovalPanel, providerFamiliesOf } from "@/components/admin/LedgeredApprovalPanel";
import { PlatformReviewsPanel } from "@/components/admin/PlatformReviewsPanel";
import type { RecommendedActionFilter } from "@/components/admin/sections/RiskCheckSection";
import { CrawlerLogRow } from "@/components/admin/sources/CrawlerLogList";
import { crawlerRunIdFor } from "@/components/admin/sources/crawler-run-id";
import { SourceComplianceCard } from "@/components/admin/sources/SourceComplianceCard";
import { SourceLiveHealthCard } from "@/components/admin/sources/SourceLiveHealthCard";
import {
  crawlerAdapterLabel,
  crawlerCapabilityLabel,
  crawlerMaturityLabel,
  crawlerTone,
  formatCrawlerBaseUrl,
  latestRunAt,
  liveSourceRecommendedActionLabel,
  sourceApprovalLabel,
  sourceApprovalTone,
  sourceAuthorityLabel,
  sourceEvidenceLabel,
  sourceHealthClassificationFor,
  sourceHealthClassificationLabel,
  sourceHealthTriageLabel,
  sourceHealthTriagePatchForAction,
  sourceHealthTriageStatus,
  sourceRequirementLabels,
  sourceTrustLabel,
  sourceTrustTone,
  type SourceHealthClassificationFilter,
  type SourceHealthTriageAction,
  type SourceHealthTriageFields,
  type SourceHealthTriageStatus,
} from "@/components/admin/sources/source-labels";

type SectionLoadStatus = "loading" | "error" | "ready";

export type AdminSectionState<T> = {
  status: SectionLoadStatus;
  data: T;
};

export type AdminDashboardSections = {
  dataSources: AdminSectionState<AdminDataSourcesResponse | null>;
  crawlerLogs: AdminSectionState<AdminCrawlerLog[]>;
};

export type AdminDashboardLoaders = {
  dataSources: () => Promise<AdminDataSourcesResponse>;
  crawlerLogs: () => Promise<{ logs: AdminCrawlerLog[] }>;
};

export type SourceHealthTriageStatusFilter = "all" | SourceHealthTriageStatus;

type SourceOpsFilters = {
  classification: SourceHealthClassificationFilter;
  triageStatus: SourceHealthTriageStatusFilter;
  recommendedAction: RecommendedActionFilter;
};

const ADMIN_CONSOLE_USER_ROLES: UserRole[] = ["admin", "operator", "support"];
export const SOURCE_HEALTH_CLASSIFICATION_FILTERS: SourceHealthClassificationFilter[] = [
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
];
export const SOURCE_HEALTH_TRIAGE_STATUS_FILTERS: SourceHealthTriageStatusFilter[] = [
  "all",
  "unassigned",
  "overdue",
  "scheduled",
  "reviewed",
];

function sectionLoading<T>(data: T): AdminSectionState<T> {
  return { status: "loading", data };
}

function sectionReady<T>(data: T): AdminSectionState<T> {
  return { status: "ready", data };
}

function sectionError<T>(data: T): AdminSectionState<T> {
  return { status: "error", data };
}

export function createInitialAdminSectionState(): AdminDashboardSections {
  return {
    dataSources: sectionLoading(null),
    crawlerLogs: sectionLoading([]),
  };
}

function createRefreshingAdminSectionState(current: AdminDashboardSections): AdminDashboardSections {
  return {
    dataSources: sectionLoading(current.dataSources.data),
    crawlerLogs: sectionLoading(current.crawlerLogs.data),
  };
}

function sectionFromSettled<TInput, TData>(
  result: PromiseSettledResult<TInput>,
  fallbackData: TData,
  mapData: (value: TInput) => TData,
): AdminSectionState<TData> {
  if (result.status === "fulfilled") {
    return sectionReady(mapData(result.value));
  }

  return sectionError(fallbackData);
}

export async function loadAdminDashboardSections(
  loaders: AdminDashboardLoaders,
  current: AdminDashboardSections,
): Promise<AdminDashboardSections> {
  const [
    dataSources,
    crawlerLogs,
  ] = await Promise.allSettled([
    loaders.dataSources(),
    loaders.crawlerLogs(),
  ]);

  return {
    dataSources: sectionFromSettled(dataSources, current.dataSources.data, (value) => value),
    crawlerLogs: sectionFromSettled(crawlerLogs, current.crawlerLogs.data, (value) => value.logs),
  };
}

function isAdminDashboardLoading(sections: AdminDashboardSections) {
  return Object.values(sections).some((section) => section.status === "loading");
}

export function isAdminDashboardFullyFailed(sections: AdminDashboardSections) {
  return Object.values(sections).every((section) => section.status === "error");
}

export function filterAdminDataSourcesByHealthClassification<
  TSource extends { latestLiveHealth?: { classification?: string | null } | null },
>(sources: TSource[], filter: SourceHealthClassificationFilter) {
  if (filter === "all") return sources;

  return sources.filter((source) => sourceHealthClassificationFor(source) === filter);
}

function recommendedActionFor(source: {
  latestLiveHealth?: { recommendedAction?: string | null } | null;
}) {
  return source.latestLiveHealth?.recommendedAction ?? "none";
}

export function filterAdminDataSourcesBySourceOps<
  TSource extends SourceHealthTriageFields & {
    latestLiveHealth?: { classification?: string | null; recommendedAction?: string | null } | null;
  },
>(sources: TSource[], filters: SourceOpsFilters, now: Date = new Date()) {
  return filterAdminDataSourcesByHealthClassification(sources, filters.classification).filter((source) => {
    const matchesTriage =
      filters.triageStatus === "all" || sourceHealthTriageStatus(source, now) === filters.triageStatus;
    const matchesRecommendedAction =
      filters.recommendedAction === "all" || recommendedActionFor(source) === filters.recommendedAction;

    return matchesTriage && matchesRecommendedAction;
  });
}

export function sourceRecommendedActionOptions<
  TSource extends { latestLiveHealth?: { recommendedAction?: string | null } | null },
>(sources: TSource[]) {
  return ["all", ...[...new Set(sources.map((source) => recommendedActionFor(source)))].sort()];
}

function sourceHealthTriageFilterLabel(t: (key: string) => string, status: SourceHealthTriageStatusFilter) {
  if (status === "all") return "All triage";

  return sourceHealthTriageLabel(t, status);
}

function filteredDataSourcesSummary(sources: AdminDataSource[]) {
  return {
    totalSources: sources.length,
    enabledSources: sources.filter((source) => source.isEnabled).length,
    healthySources: sources.filter((source) => {
      if (source.latestLog) return source.latestLog.status === "success";

      return source.consecutiveFailures === 0 && !source.lastFailureAt;
    }).length,
    failingSources: sources.filter((source) => {
      if (source.latestLog) return source.latestLog.status !== "success";

      return source.consecutiveFailures > 0 || Boolean(source.lastFailureAt);
    }).length,
  };
}

export default function AdminPage() {
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [state, setState] = useState<AdminDashboardSections>(() => createInitialAdminSectionState());
  const stateRef = useRef(state);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [sourceApprovalPendingId, setSourceApprovalPendingId] = useState<string | null>(null);
  const [sourceApprovalBatchPending, setSourceApprovalBatchPending] = useState(false);
  const [sourceHealthPendingId, setSourceHealthPendingId] = useState<string | null>(null);
  const [sourceTriagePendingId, setSourceTriagePendingId] = useState<string | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourceHealthClassificationFilter, setSourceHealthClassificationFilter] =
    useState<SourceHealthClassificationFilter>("all");
  const [sourceHealthTriageFilter, setSourceHealthTriageFilter] = useState<SourceHealthTriageStatusFilter>("all");
  const [sourceHealthRecommendedActionFilter, setSourceHealthRecommendedActionFilter] =
    useState<RecommendedActionFilter>("all");
  const [isRunning, setIsRunning] = useState(false);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  // Bumped when a platform review is saved so the ledgered approval panel re-reads its readiness.
  const [platformReviewRevision, setPlatformReviewRevision] = useState(0);
  const isAdmin = user?.role === "admin";
  const isOperator = user?.role === "operator";
  const canAccessAdminConsole = Boolean(user && ADMIN_CONSOLE_USER_ROLES.includes(user.role));
  const canManageUsers = isAdmin;
  const canRunOperations = isAdmin || isOperator;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const load = useCallback(() => {
    if (!canAccessAdminConsole) return;

    const current = stateRef.current;

    setState(createRefreshingAdminSectionState(current));
    void loadAdminDashboardSections(
      {
        dataSources: listAdminDataSources,
        crawlerLogs: listAdminCrawlerLogs,
      },
      current,
    ).then((sections) => {
      setState(sections);
    });
  }, [canAccessAdminConsole]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canAccessAdminConsole) return;

    queueMicrotask(load);
  }, [canAccessAdminConsole, isAuthLoading, load]);

  const isLoadingDashboard = isAdminDashboardLoading(state);
  const areMainSectionsFullyFailed = isAdminDashboardFullyFailed(state);
  const isFullyFailedDashboard = areMainSectionsFullyFailed;
  const allSources = state.dataSources.status === "ready" ? state.dataSources.data?.sources ?? [] : [];
  const sourceOpsFilters: SourceOpsFilters = {
    classification: sourceHealthClassificationFilter,
    triageStatus: sourceHealthTriageFilter,
    recommendedAction: sourceHealthRecommendedActionFilter,
  };
  const sources = filterAdminDataSourcesBySourceOps(allSources, sourceOpsFilters);
  const sourceHealthRecommendedActionOptions = sourceRecommendedActionOptions(allSources);
  const hasSourceOpsFilters =
    sourceHealthClassificationFilter !== "all" ||
    sourceHealthTriageFilter !== "all" ||
    sourceHealthRecommendedActionFilter !== "all";
  const summary =
    state.dataSources.status === "ready"
      ? !hasSourceOpsFilters
        ? state.dataSources.data?.summary ?? null
        : filteredDataSourcesSummary(sources)
      : null;
  const logs = state.crawlerLogs.status === "ready" ? state.crawlerLogs.data : [];
  const visibleSelectedSourceIds = selectedSourceIds.filter((id) => sources.some((source) => source.id === id));
  const allVisibleSourcesSelected = sources.length > 0 && sources.every((source) => selectedSourceIds.includes(source.id));

  const replaceSource = (updated: AdminDataSource) => {
    setState((current) => {
      if (!current.dataSources.data) return current;

      const sources = current.dataSources.data.sources.map((item) => (item.id === updated.id ? updated : item));

      return {
        ...current,
        dataSources: {
          status: "ready",
          data: {
            ...current.dataSources.data,
            sources,
            summary: {
              ...current.dataSources.data.summary,
              enabledSources: sources.filter((item) => item.isEnabled).length,
            },
          },
        },
      };
    });
  };

  const replaceSources = (updatedSources: AdminDataSource[]) => {
    const updates = new Map(updatedSources.map((source) => [source.id, source]));

    setState((current) => {
      if (!current.dataSources.data) return current;

      const sources = current.dataSources.data.sources.map((item) => updates.get(item.id) ?? item);

      return {
        ...current,
        dataSources: {
          status: "ready",
          data: {
            ...current.dataSources.data,
            sources,
            summary: {
              ...current.dataSources.data.summary,
              enabledSources: sources.filter((item) => item.isEnabled).length,
            },
          },
        },
      };
    });
  };

  const refreshDataSources = () => {
    setState((current) => ({
      ...current,
      dataSources: sectionLoading(current.dataSources.data),
    }));

    return listAdminDataSources()
      .then((dataSources) => {
        setState((current) => ({
          ...current,
          dataSources: sectionReady(dataSources),
        }));
        return dataSources;
      })
      .catch((error) => {
        setState((current) => ({
          ...current,
          dataSources: sectionError(current.dataSources.data),
        }));
        throw error;
      });
  };

  const refreshCrawlerLogs = () => {
    setState((current) => ({
      ...current,
      crawlerLogs: sectionLoading(current.crawlerLogs.data),
    }));

    return listAdminCrawlerLogs()
      .then((response) => {
        setState((current) => ({
          ...current,
          crawlerLogs: sectionReady(response.logs),
        }));
        return response;
      })
      .catch((error) => {
        setState((current) => ({
          ...current,
          crawlerLogs: sectionError(current.crawlerLogs.data),
        }));
        throw error;
      });
  };

  const toggleSource = (source: AdminDataSource) => {
    setPendingSourceId(source.id);
    updateAdminDataSource(source.id, { isEnabled: !source.isEnabled })
      .then(({ source: updated }) => {
        replaceSource(updated);
      })
      .catch(() => {
        setRunMessage(t("admin.updateFailed"));
      })
      .finally(() => {
        setPendingSourceId(null);
      });
  };

  const updateSourceApproval = (source: AdminDataSource, approvalStatus: "approved" | "needs_review") => {
    setSourceApprovalPendingId(source.id);
    setRunMessage(null);
    updateAdminDataSource(source.id, approvalStatus === "approved"
      ? {
          approvedForIngestion: true,
          approvalStatus: "approved",
          legalReviewStatus: "approved_public",
          approvalNotes: "Approved from Admin source approval workflow.",
        }
      : {
          approvedForIngestion: false,
          approvalStatus: "needs_review",
          legalReviewStatus: "not_reviewed",
          approvalNotes: "Held for source health or legal review.",
        })
      .then(({ source: updated }) => {
        replaceSource(updated);
        setRunMessage(t("admin.sourceApprovalUpdated"));
      })
      .catch(() => {
        setRunMessage(t("admin.sourceApprovalFailed"));
      })
      .finally(() => {
        setSourceApprovalPendingId(null);
      });
  };

  const toggleSelectedSourceId = (id: string) => {
    setSelectedSourceIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleAllVisibleSources = () => {
    setSelectedSourceIds((current) => {
      const visibleIds = sources.map((source) => source.id);
      if (visibleIds.length > 0 && visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      return [...new Set([...current, ...visibleIds])];
    });
  };

  const batchUpdateSourceApproval = (action: "approve" | "hold") => {
    if (visibleSelectedSourceIds.length === 0) return;

    setSourceApprovalBatchPending(true);
    setRunMessage(null);
    batchUpdateAdminDataSources({
      sourceIds: visibleSelectedSourceIds,
      action,
    })
      .then(({ sources: updatedSources, updatedCount, skippedCount, outcomes }) => {
        replaceSources(updatedSources);
        // A county/city/township source is approved only through the platform-review ledger, so an
        // `approve` can skip some of the selected ids. Those stay selected and the message counts them
        // instead of reporting a plain success.
        const skippedIds = new Set(
          (outcomes ?? []).filter((entry) => entry.outcome !== "approved").map((entry) => entry.sourceId),
        );
        setSelectedSourceIds((current) =>
          current.filter((id) => !visibleSelectedSourceIds.includes(id) || skippedIds.has(id)),
        );
        setRunMessage(
          (skippedCount ?? 0) > 0
            ? t("admin.ledgeredApprovalResult")
                .replace("{approved}", String(updatedCount))
                .replace("{skipped}", String(skippedCount))
            : t("admin.sourceBatchApprovalUpdated"),
        );
      })
      .catch(() => {
        setRunMessage(t("admin.sourceBatchApprovalFailed"));
      })
      .finally(() => {
        setSourceApprovalBatchPending(false);
      });
  };

  const recheckSourceHealth = (source: AdminDataSource) => {
    setSourceHealthPendingId(source.id);
    setRunMessage(null);
    checkAdminDataSourceHealth(source.id, { timeoutMs: 10_000 })
      .then(({ source: updated }) => {
        replaceSource(updated);
        setRunMessage(t("admin.sourceHealthRechecked"));
      })
      .catch(() => {
        setRunMessage(t("admin.sourceHealthRecheckFailed"));
      })
      .finally(() => {
        setSourceHealthPendingId(null);
      });
  };

  const runNow = () => {
    setIsRunning(true);
    setRunMessage(null);
    runStateCrawlersNow()
      .then(() => {
        setRunMessage(t("admin.runQueued"));
        load();
      })
      .catch(() => {
        setRunMessage(t("admin.runFailed"));
      })
      .finally(() => {
        setIsRunning(false);
      });
  };

  const updateSourceHealthTriage = (source: AdminDataSource, action: SourceHealthTriageAction) => {
    if (!user) return;

    setSourceTriagePendingId(source.id);
    setRunMessage(null);
    updateAdminDataSource(
      source.id,
      sourceHealthTriagePatchForAction(action, user.email || user.displayName || user.id),
    )
      .then(({ source: updated }) => {
        replaceSource(updated);
        setRunMessage(t("admin.sourceHealthTriageUpdated"));
      })
      .catch(() => {
        setRunMessage(t("admin.sourceHealthTriageFailed"));
      })
      .finally(() => {
        setSourceTriagePendingId(null);
      });
  };

  const runSourceNow = (source: AdminDataSource) => {
    const stateCrawlerSourceId = crawlerRunIdFor(source);
    if (!stateCrawlerSourceId) return;

    setRunningSourceId(source.id);
    setRunMessage(null);
    runStateCrawlersNow([stateCrawlerSourceId])
      .then(() => {
        setRunMessage(t("admin.runSourceQueued").replace("{source}", source.label));
        load();
      })
      .catch(() => {
        setRunMessage(t("admin.runSourceFailed").replace("{source}", source.label));
      })
      .finally(() => {
        setRunningSourceId(null);
      });
  };

  if (isAuthLoading) {
    return (
      <AdminAccessState
        code="loading"
        title={t("admin.authLoading")}
        description={t("admin.authLoadingDescription")}
      />
    );
  }

  if (!user) {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.loginRequiredTitle")}
        description={t("admin.loginRequiredDescription")}
        action={{ href: "/login", label: t("admin.loginAction") }}
      />
    );
  }

  if (!canAccessAdminConsole) {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.forbiddenTitle")}
        description={t("admin.forbiddenDescription")}
        action={{ href: "/", label: t("admin.returnToDashboard") }}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">{t("admin.title")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("admin.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={load}
            disabled={isLoadingDashboard}
            className="h-10 rounded-lg border-slate-200"
          >
            <RefreshCw size={16} />
            {t("admin.refresh")}
          </Button>
          {canRunOperations && (
            <Button
              onClick={runNow}
              disabled={isRunning || runningSourceId !== null}
              className="h-10 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            >
              <Play size={16} />
              {isRunning ? t("admin.running") : t("admin.runStateCrawlers")}
            </Button>
          )}
        </div>
      </div>

      {runMessage && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
          {runMessage}
        </div>
      )}

      {state.dataSources.status === "loading" && !summary && !isFullyFailedDashboard && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-7 w-12" />
            </div>
          ))}
        </div>
      )}

      {isFullyFailedDashboard && (
        <UniversalState
          actions={[{ label: t("admin.refresh"), onClick: load }]}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.errorTitle")}
        />
      )}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label={t("admin.totalSources")} value={summary.totalSources} icon={Database} />
          <SummaryCard label={t("admin.enabledSources")} value={summary.enabledSources} icon={ShieldCheck} />
          <SummaryCard label={t("admin.healthySources")} value={summary.healthySources} icon={Activity} />
          <SummaryCard label={t("admin.failingSources")} value={summary.failingSources} icon={AlertTriangle} />
        </div>
      )}

      {!isFullyFailedDashboard && state.dataSources.status === "error" && (
        <AdminSectionStateCard
          action={() => void refreshDataSources().catch(() => undefined)}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.sources")}
        />
      )}

      {!isFullyFailedDashboard && state.dataSources.status === "loading" && !state.dataSources.data && (
        <AdminSectionStateCard
          actionLabel={t("admin.refresh")}
          code="loading"
          message={t("admin.loading")}
          title={t("admin.sources")}
        />
      )}

      {!isFullyFailedDashboard && state.dataSources.status === "ready" && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <ServerCog size={18} />
              {t("admin.sources")}
            </div>
          </div>
          {/* Platform review + ledgered batch approval (spec 2026-09-24 §7.1/§7.3). Like the batch
              run panel below, neither reloads the dashboard sections on completion (that would
              unmount them and wipe the result the admin is reading); the sources table refreshes
              via the header Refresh button. */}
          <PlatformReviewsPanel
            canManage={isAdmin}
            reviewerEmail={user?.email ?? null}
            disabled={isRunning}
            onSaved={() => setPlatformReviewRevision((revision) => revision + 1)}
          />
          <LedgeredApprovalPanel
            providerFamilies={providerFamiliesOf(allSources)}
            canApprove={isAdmin}
            canRequestPrechecks={canRunOperations}
            disabled={isRunning || runningSourceId !== null}
            refreshKey={platformReviewRevision}
          />
          {/* No onCompleted → load(): a full section refresh flips dataSources to "loading",
              unmounting this panel and wiping the per-source batch report the admin is reading.
              The sources table refreshes via the header Refresh button instead. */}
          {canRunOperations && (
            <JurisdictionBatchRunPanel
              sources={allSources}
              crawlerSourceIdFor={crawlerRunIdFor}
              disabled={isRunning || runningSourceId !== null}
            />
          )}
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-600">{t("admin.sourceHealthClassificationFilter")}</span>
              {SOURCE_HEALTH_CLASSIFICATION_FILTERS.map((filter) => {
                const count =
                  filter === "all"
                    ? allSources.length
                    : filterAdminDataSourcesByHealthClassification(allSources, filter).length;
                const isActive = sourceHealthClassificationFilter === filter;

                return (
                  <Button
                    key={filter}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSourceHealthClassificationFilter(filter)}
                    className={
                      isActive
                        ? "h-8 rounded-lg px-2 text-xs"
                        : "h-8 rounded-lg border-slate-200 px-2 text-xs text-slate-600"
                    }
                  >
                    {sourceHealthClassificationLabel(t, filter)}
                    <span className="ml-1 text-xs opacity-75">{count}</span>
                  </Button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-600">{t("admin.sourceHealthTriage")}</span>
                {SOURCE_HEALTH_TRIAGE_STATUS_FILTERS.map((filter) => {
                  const count = filterAdminDataSourcesBySourceOps(
                    allSources,
                    { ...sourceOpsFilters, triageStatus: filter },
                  ).length;
                  const isActive = sourceHealthTriageFilter === filter;

                  return (
                    <Button
                      key={filter}
                      type="button"
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSourceHealthTriageFilter(filter)}
                      className={
                        isActive
                          ? "h-8 rounded-lg px-2 text-xs"
                          : "h-8 rounded-lg border-slate-200 px-2 text-xs text-slate-600"
                      }
                    >
                      {sourceHealthTriageFilterLabel(t, filter)}
                      <span className="ml-1 text-xs opacity-75">{count}</span>
                    </Button>
                  );
                })}
              </div>
              <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
                {t("admin.liveSourceRecommendedAction")}
                <select
                  value={sourceHealthRecommendedActionFilter}
                  onChange={(event) => setSourceHealthRecommendedActionFilter(event.target.value)}
                  className="h-8 max-w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none"
                >
                  {sourceHealthRecommendedActionOptions.map((action) => (
                    <option key={action} value={action}>
                      {action === "all"
                        ? "All recommended actions"
                        : liveSourceRecommendedActionLabel(t, action)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {t("admin.sourceHealthClassificationFilteredSummary")
                .replace("{shown}", String(sources.length))
                .replace("{total}", String(allSources.length))}
            </div>
          </div>
          {canManageUsers && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-medium text-slate-600">
                {t("admin.selectedSources").replace("{count}", String(visibleSelectedSourceIds.length))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sourceApprovalBatchPending || visibleSelectedSourceIds.length === 0}
                  onClick={() => batchUpdateSourceApproval("approve")}
                  className="h-8 rounded-lg border-emerald-200 px-2 text-emerald-700"
                >
                  {t("admin.batchApproveSources")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sourceApprovalBatchPending || visibleSelectedSourceIds.length === 0}
                  onClick={() => batchUpdateSourceApproval("hold")}
                  className="h-8 rounded-lg border-amber-200 px-2 text-amber-700"
                >
                  {t("admin.batchHoldSources")}
                </Button>
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {canManageUsers && (
                  <TableHead>
                    <input
                      type="checkbox"
                      checked={allVisibleSourcesSelected}
                      onChange={toggleAllVisibleSources}
                      aria-label={t("admin.selectAllSources")}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </TableHead>
                )}
                <TableHead>{t("admin.source")}</TableHead>
                <TableHead>{t("admin.type")}</TableHead>
                <TableHead>{t("admin.crawler")}</TableHead>
                <TableHead>{t("admin.cadence")}</TableHead>
                <TableHead>{t("admin.lastRun")}</TableHead>
                <TableHead>{t("admin.status")}</TableHead>
                <TableHead>{t("admin.counts")}</TableHead>
                {canRunOperations && <TableHead className="text-right">{t("admin.run")}</TableHead>}
                <TableHead className="text-right">{canRunOperations ? t("admin.enabled") : t("admin.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8 + (canManageUsers ? 1 : 0) + (canRunOperations ? 1 : 0)}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    {t("admin.sourceHealthClassificationEmpty")}
                  </TableCell>
                </TableRow>
              )}
              {sources.map((source) => (
                <TableRow key={source.id}>
                  {canManageUsers && (
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.includes(source.id)}
                        onChange={() => toggleSelectedSourceId(source.id)}
                        aria-label={t("admin.selectSource").replace("{name}", source.label)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-medium text-slate-900">
                      <Link href={`/admin/sources/${encodeURIComponent(source.id)}`} className="hover:underline">
                        {source.label}
                      </Link>
                    </div>
                    <div className="text-xs text-slate-500">{source.stateCode}</div>
                  </TableCell>
                  <TableCell className="capitalize">{source.issuerType}</TableCell>
                  <TableCell>
                    <div className="flex max-w-64 flex-wrap gap-1">
                      <Badge variant="outline" className={crawlerTone(source.crawlerAdapterKind)}>
                        {crawlerAdapterLabel(t, source.crawlerAdapterKind)}
                      </Badge>
                      <Badge variant="outline" className={crawlerTone(source.crawlerMaturity)}>
                        {crawlerMaturityLabel(t, source.crawlerMaturity)}
                      </Badge>
                      {source.crawlerCapabilities.slice(0, 3).map((capability) => (
                        <Badge key={capability} variant="outline" className="border-slate-200 bg-white text-slate-600">
                          {crawlerCapabilityLabel(t, capability)}
                        </Badge>
                      ))}
                    </div>
                    {source.crawlerBaseUrl && (
                      <div className="mt-1 max-w-64 truncate text-xs text-slate-500" title={source.crawlerBaseUrl}>
                        {source.crawlerSourceId} - {formatCrawlerBaseUrl(source.crawlerBaseUrl)}
                      </div>
                    )}
                    <div className="mt-2 flex max-w-64 flex-wrap gap-1">
                      {source.sourceAuthority && (
                        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                          {sourceAuthorityLabel(t, source.sourceAuthority)}
                        </Badge>
                      )}
                      {source.trustStatus && (
                        <Badge variant="outline" className={sourceTrustTone(source.trustStatus)}>
                          {sourceTrustLabel(t, source.trustStatus)}
                        </Badge>
                      )}
                      {source.evidenceMode && (
                        <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                          {sourceEvidenceLabel(t, source.evidenceMode)}
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                        {source.sourceConfidence}
                      </Badge>
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                        {source.accessMode}
                      </Badge>
                      <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                        {source.activationStatus}
                      </Badge>
                      <Badge variant="outline" className={sourceApprovalTone(source.approvalStatus)}>
                        {sourceApprovalLabel(t, source)}
                      </Badge>
                      {!source.approvedForIngestion && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          {t("admin.sourceApprovalRequired")}
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                        {source.accessPattern}
                      </Badge>
                      {source.supportsAttachmentMetadata && (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                          {t("admin.sourceSupportsArchive")}
                        </Badge>
                      )}
                      {sourceRequirementLabels(t, source).map((label) => (
                        <Badge key={label} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                          {label}
                        </Badge>
                      ))}
                    </div>
                    {source.fallbackNotes && (
                      <div className="mt-1 max-w-64 truncate text-xs text-amber-700" title={source.fallbackNotes}>
                        {source.fallbackNotes}
                      </div>
                    )}
                    {source.validityNotes && (
                      <div className="mt-1 max-w-64 truncate text-xs text-indigo-700" title={source.validityNotes}>
                        {source.validityNotes}
                      </div>
                    )}
                    {source.approvalNotes && (
                      <div className="mt-1 max-w-64 truncate text-xs text-slate-500" title={source.approvalNotes}>
                        {source.approvalNotes}
                      </div>
                    )}
                    <div className="mt-2 max-w-64">
                      <SourceComplianceCard source={source} />
                    </div>
                    {canRunOperations && (
                      <SourcePrecheckPanel
                        source={source}
                        reviewerEmail={user?.email ?? null}
                        disabled={isRunning || runningSourceId !== null}
                        onSourceUpdated={replaceSource}
                      />
                    )}
                    {canManageUsers && (
                      <div className="mt-2 flex max-w-64 flex-wrap gap-2">
                        {/* This approve writes no compliance ledger, so it is offered for federal/state rows
                            only. A county/city/township row is approved through the ledgered batch panel above
                            or the "approve county/city source" form in its pre-check card (spec §7.3). */}
                        {!isLocalJurisdictionSource(source) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateSourceApproval(source, "approved")}
                            disabled={sourceApprovalPendingId === source.id || source.approvalStatus === "approved"}
                            className="h-8 rounded-lg border-emerald-200 px-2 text-xs text-emerald-700"
                          >
                            {t("admin.approveSource")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => updateSourceApproval(source, "needs_review")}
                          disabled={sourceApprovalPendingId === source.id || source.approvalStatus === "needs_review"}
                          className="h-8 rounded-lg border-amber-200 px-2 text-xs text-amber-700"
                        >
                          {t("admin.holdSource")}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{source.cadence}</TableCell>
                  <TableCell>{formatDate(latestRunAt(source))}</TableCell>
                  <TableCell>
                    <div className="max-w-56">
                      <Badge variant="outline" className={statusTone(source.latestLog?.status)}>
                        {source.latestLog?.status ?? t("admin.notRun")}
                      </Badge>
                      {source.latestLog?.errorMessage && (
                        <div className="mt-1 text-xs leading-5 text-rose-700">
                          <span className="font-medium">{t("admin.errorReason")}:</span>{" "}
                          {compactErrorMessage(source.latestLog.errorMessage)}
                        </div>
                      )}
                      {source.latestLog?.fallbackSource && (
                        <div className="mt-1 text-xs leading-5 text-amber-700">
                          <span className="font-medium">{t("admin.fallbackUsed")}</span>
                          {fallbackMessage(source.latestLog) ? `: ${fallbackMessage(source.latestLog)}` : null}
                        </div>
                      )}
                      <SourceLiveHealthCard
                        source={source}
                        canRunOperations={canRunOperations}
                        pending={sourceHealthPendingId === source.id ? "recheck" : sourceTriagePendingId === source.id ? "triage" : null}
                        onRecheck={() => recheckSourceHealth(source)}
                        onTriage={(action) => updateSourceHealthTriage(source, action)}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    {source.latestLog
                      ? `${source.latestLog.fetchedCount}/${source.latestLog.insertedCount}/${source.latestLog.updatedCount}/${source.latestLog.failedCount}`
                      : "-"}
                  </TableCell>
                  {canRunOperations && (
                    <TableCell className="text-right">
                      {crawlerRunIdFor(source) ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => runSourceNow(source)}
                          disabled={isRunning || runningSourceId !== null}
                          aria-label={t("admin.runSource").replace("{source}", source.label)}
                          className="h-8 rounded-lg border-slate-200 px-2"
                        >
                          <Play size={14} />
                          <span className="sr-only">{t("admin.runSource").replace("{source}", source.label)}</span>
                        </Button>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                      <div className="mt-2 flex justify-end">
                        <CrawlerConfigPanel
                          source={source}
                          disabled={isRunning || runningSourceId !== null}
                          onSaved={replaceSource}
                        />
                      </div>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    {canRunOperations ? (
                      <div className="flex items-center justify-end gap-3">
                        <Label htmlFor={`source-${source.id}`} className="text-xs font-medium text-slate-500">
                          {source.isEnabled ? t("admin.on") : t("admin.off")}
                        </Label>
                        <Switch
                          id={`source-${source.id}`}
                          checked={source.isEnabled}
                          disabled={pendingSourceId === source.id}
                          onCheckedChange={() => toggleSource(source)}
                          className="data-checked:bg-slate-900"
                        />
                      </div>
                    ) : (
                      <Badge variant="outline" className={statusTone(source.isEnabled ? "success" : "disabled")}>
                        {source.isEnabled ? t("admin.on") : t("admin.off")}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {!isFullyFailedDashboard && state.crawlerLogs.status === "error" && (
        <AdminSectionStateCard
          action={() => void refreshCrawlerLogs().catch(() => undefined)}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.recentLogs")}
        />
      )}

      {!isFullyFailedDashboard && state.crawlerLogs.status === "loading" && state.crawlerLogs.data.length === 0 && (
        <AdminSectionStateCard
          actionLabel={t("admin.refresh")}
          code="loading"
          message={t("admin.loading")}
          title={t("admin.recentLogs")}
        />
      )}

      {!isFullyFailedDashboard && state.crawlerLogs.status === "ready" && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold text-slate-950">
            <Activity size={18} />
            {t("admin.recentLogs")}
          </div>
          <div className="divide-y divide-slate-100">
            {logs.length === 0 && <div className="px-4 py-5 text-sm text-slate-500">{t("admin.noLogs")}</div>}
            {logs.map((log) => (
              <CrawlerLogRow key={log.id} log={log} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
