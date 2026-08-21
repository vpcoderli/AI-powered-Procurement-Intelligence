"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Database,
  Download,
  History,
  Play,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { UniversalState } from "@/components/universal-state";
import { useAuth } from "@/context/AuthContext";
import { bidDetailPath } from "@/lib/bid-routes";
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
  batchUpdateAdminBidQaItems,
  checkAdminDataSourceHealth,
  createAdminUser,
  deliverAdminNotifications,
  getAdminMarketingFunnel,
  getAdminRiskChecklist,
  getAdminBidQaCorrections,
  listAdminConfigEntries,
  listAdminBidQaItems,
  listAdminCrawlerLogs,
  listAdminDataSources,
  listAdminNotifications,
  listAdminUserFeatureOverrides,
  listAdminUserAuditLogs,
  listAdminUsers,
  reconcileAdminSubscriptions,
  runStateCrawlersNow,
  updateAdminConfigEntry,
  updateAdminDataSource,
  updateAdminBidQaReview,
  updateAdminUserFeatureOverride,
  updateAdminUser as updateAdminUserAccess,
  type AdminBidQaItem,
  type AdminBidQaResponse,
  type AdminBidQaCorrectionHistoryItem,
  type AdminBidQaDisplayStatus,
  type AdminBidQaReviewStatus,
  type AdminCrawlerLog,
  type AdminConfigRegistryEntry,
  type AdminDataSource,
  type AdminDataSourcesResponse,
  type AdminUserFeatureOverridesResponse,
  type AdminNotificationsResponse,
  type AdminMarketingFunnelResponse,
  type AdminRiskChecklistResponse,
  type AdminUserAuditLog,
  type AdminUserAuditAction,
  type AdminUserAuditActorKind,
  type AdminUserFilterStatus,
  type AdminUser,
  type StateDataQualityReasonCode,
  type StateDataQualityReport,
  type StateDataQualityRiskLevel,
  type StateDataQualityRow,
  type UpdateAdminDataSourceInput,
  type UpdateAdminUserInput,
} from "@/lib/api/admin";
import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { JurisdictionBatchRunPanel } from "@/components/admin/JurisdictionBatchRunPanel";
import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";

type SectionLoadStatus = "loading" | "error" | "ready";

export type AdminSectionState<T> = {
  status: SectionLoadStatus;
  data: T;
};

type AdminRiskSectionData = {
  report: AdminRiskChecklistResponse["report"];
  history: AdminRiskChecklistResponse["history"];
  trend: AdminRiskChecklistResponse["trend"];
  stateDataQuality: AdminRiskChecklistResponse["stateDataQuality"];
};

export type AdminDashboardSections = {
  dataSources: AdminSectionState<AdminDataSourcesResponse | null>;
  risk: AdminSectionState<AdminRiskSectionData | null>;
  crawlerLogs: AdminSectionState<AdminCrawlerLog[]>;
  bidQa: AdminSectionState<AdminBidQaResponse | null>;
  users: AdminSectionState<AdminUser[]>;
  userAuditLogs: AdminSectionState<AdminUserAuditLog[]>;
  notifications: AdminSectionState<AdminNotificationsResponse["notifications"]>;
  marketingFunnel: AdminSectionState<AdminMarketingFunnelResponse["summary"] | null>;
};

export type AdminDashboardLoaders = {
  dataSources: () => Promise<AdminDataSourcesResponse>;
  risk: () => Promise<AdminRiskChecklistResponse>;
  crawlerLogs: () => Promise<{ logs: AdminCrawlerLog[] }>;
  bidQa: () => Promise<AdminBidQaResponse>;
  users: () => Promise<{ users: AdminUser[] }>;
  userAuditLogs: () => Promise<{ logs: AdminUserAuditLog[] }>;
  notifications: () => Promise<AdminNotificationsResponse>;
  marketingFunnel: () => Promise<AdminMarketingFunnelResponse>;
};

type ConfigRegistryStatus =
  | { status: "loading"; configEntries: AdminConfigRegistryEntry[] }
  | { status: "error"; configEntries: AdminConfigRegistryEntry[] }
  | { status: "ready"; configEntries: AdminConfigRegistryEntry[] };

type UserFilters = {
  q?: string;
  role?: UserRole;
  tier?: AccountTier;
  status?: AdminUserFilterStatus;
};

type UserAuditFilters = {
  actorKind?: AdminUserAuditActorKind;
  action?: AdminUserAuditAction;
  target?: string;
  featureKey?: FeatureKey;
};

type InvitationDraft = {
  email: string;
  displayName: string;
  role: UserRole;
  tier: AccountTier;
};

type BidQaCorrectionDraft = {
  title: string;
  deadlineDate: string;
};

type BidQaFilters = {
  q: string;
  stateCode: string;
  reviewStatus: AdminBidQaReviewStatus | "all";
  displayStatus: AdminBidQaDisplayStatus | "all";
  sourceConfidence: string;
  minQualityScore: string;
  maxQualityScore: string;
  reviewerId: string;
  reviewedFrom: string;
  reviewedTo: string;
};

export type SourceHealthClassificationFilter =
  | "all"
  | "ok"
  | "forbidden"
  | "timeout"
  | "bot_check"
  | "login_required"
  | "empty_or_placeholder"
  | "tls_or_network_error"
  | "http_error"
  | "unknown";

export type SourceHealthTriageStatus = "unassigned" | "overdue" | "scheduled" | "reviewed";
export type SourceHealthTriageStatusFilter = "all" | SourceHealthTriageStatus;
export type SourceHealthTriageAction = "assign" | "accepted_fallback" | "manual" | "vendor_account" | "clear";
export type RecommendedActionFilter = "all" | string;
export type StateDataQualityRiskFilter = "all" | Extract<StateDataQualityRiskLevel, "P0" | "P1" | "P2">;
export type StateDataQualityReasonFilter = "all" | StateDataQualityReasonCode | string;

type StateDataQualityFilters = {
  riskLevel: StateDataQualityRiskFilter | string;
  reasonCode: StateDataQualityReasonFilter;
};

type SourceHealthTriageFields = {
  liveHealthOwner?: string | null;
  liveHealthDisposition?: string | null;
  liveHealthNextReviewAt?: string | null;
  liveHealthNotes?: string | null;
  liveHealthReviewedAt?: string | null;
};

type SourceOpsFilters = {
  classification: SourceHealthClassificationFilter;
  triageStatus: SourceHealthTriageStatusFilter;
  recommendedAction: RecommendedActionFilter;
};

type ConfigEditDraft = {
  configValueJson: string;
  status: AdminConfigRegistryEntry["status"];
  changeReason: string;
};

const DEFAULT_BID_QA_FILTERS: BidQaFilters = {
  q: "",
  stateCode: "",
  reviewStatus: "all",
  displayStatus: "all",
  sourceConfidence: "all",
  minQualityScore: "",
  maxQualityScore: "",
  reviewerId: "",
  reviewedFrom: "",
  reviewedTo: "",
};

const USER_ROLES: UserRole[] = ["user", "admin", "operator", "support"];
const ADMIN_CONSOLE_USER_ROLES: UserRole[] = ["admin", "operator", "support"];
const ACCOUNT_TIERS: AccountTier[] = ["free", "pro", "business", "enterprise"];
const AUDIT_ACTOR_KINDS: AdminUserAuditActorKind[] = ["admin", "local-bypass", "self-service"];
const AUDIT_ACTIONS: AdminUserAuditAction[] = ["user_access_updated", "user_invited", "user_self_deleted"];
const OVERRIDABLE_FEATURES: FeatureKey[] = [
  "submission_guidance",
  "compliance_manifest",
  "pursue_no_bid",
  "quote_workflow",
  "knowledge_station",
];
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
export const STATE_DATA_QUALITY_RISK_FILTERS: StateDataQualityRiskFilter[] = ["all", "P0", "P1", "P2"];
const STATE_DATA_QUALITY_P0_BLOCKER_STATES = ["CA", "FL", "IL", "NY", "TX"] as const;
const STATE_DATA_QUALITY_P0_BLOCKER_COPY =
  "CA/FL/IL/NY/TX P0 blockers are state data quality blockers";
const MARKETING_CONTENT_CONFIG_MODULE = "ux_state";
const MARKETING_CONTENT_CONFIG_KEY = "copy_library";
const MARKETING_CONTENT_CONFIG_ID = "ux_state.copy_library";
const MARKETING_CONTENT_SAFE_VALIDATION_COPY =
  "Unsafe outcome, compliance, or submission claims are rejected before publish and the site falls back to default marketing copy.";
const DEFAULT_INVITATION_DRAFT: InvitationDraft = {
  email: "",
  displayName: "",
  role: "user",
  tier: "free",
};

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
    risk: sectionLoading(null),
    crawlerLogs: sectionLoading([]),
    bidQa: sectionLoading(null),
    users: sectionLoading([]),
    userAuditLogs: sectionLoading([]),
    notifications: sectionLoading([]),
    marketingFunnel: sectionLoading(null),
  };
}

function createRefreshingAdminSectionState(current: AdminDashboardSections): AdminDashboardSections {
  return {
    dataSources: sectionLoading(current.dataSources.data),
    risk: sectionLoading(current.risk.data),
    crawlerLogs: sectionLoading(current.crawlerLogs.data),
    bidQa: sectionLoading(current.bidQa.data),
    users: sectionLoading(current.users.data),
    userAuditLogs: sectionLoading(current.userAuditLogs.data),
    notifications: sectionLoading(current.notifications.data),
    marketingFunnel: sectionLoading(current.marketingFunnel.data),
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
    risk,
    crawlerLogs,
    bidQa,
    users,
    userAuditLogs,
    notifications,
    marketingFunnel,
  ] = await Promise.allSettled([
    loaders.dataSources(),
    loaders.risk(),
    loaders.crawlerLogs(),
    loaders.bidQa(),
    loaders.users(),
    loaders.userAuditLogs(),
    loaders.notifications(),
    loaders.marketingFunnel(),
  ]);

  return {
    dataSources: sectionFromSettled(dataSources, current.dataSources.data, (value) => value),
    risk: sectionFromSettled(risk, current.risk.data, (value) => ({
      report: value.report,
      history: value.history,
      trend: value.trend,
      stateDataQuality: value.stateDataQuality ?? null,
    })),
    crawlerLogs: sectionFromSettled(crawlerLogs, current.crawlerLogs.data, (value) => value.logs),
    bidQa: sectionFromSettled(bidQa, current.bidQa.data, (value) => value),
    users: sectionFromSettled(users, current.users.data, (value) => value.users),
    userAuditLogs: sectionFromSettled(userAuditLogs, current.userAuditLogs.data, (value) => value.logs),
    notifications: sectionFromSettled(notifications, current.notifications.data, (value) => value.notifications),
    marketingFunnel: sectionFromSettled(marketingFunnel, current.marketingFunnel.data, (value) => value.summary),
  };
}

function isAdminDashboardLoading(sections: AdminDashboardSections) {
  return Object.values(sections).some((section) => section.status === "loading");
}

export function isAdminDashboardFullyFailed(sections: AdminDashboardSections) {
  return Object.values(sections).every((section) => section.status === "error");
}

function reviewStatusLabel(t: (key: string) => string, status: AdminBidQaReviewStatus) {
  return t(`admin.reviewStatus_${status}`);
}

function displayStatusLabel(t: (key: string) => string, status: AdminBidQaDisplayStatus) {
  return t(`admin.displayStatus_${status}`);
}

function displayStatusTone(status: AdminBidQaDisplayStatus) {
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "suppressed") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function stateCrawlerSourceIdFor(source: AdminDataSource) {
  // County/city/special-district registry rows have no legacy per-state crawler metadata;
  // since the data_sources migration they run through /api/crawler/state/run by their own row
  // id (the route resolves every non-federal data_sources id — see listAllSources).
  const subStateSourceId =
    source.issuerType !== "state" && source.issuerType !== "federal" ? source.id : null;
  return source.crawlerSourceId ?? stateCrawlerSourceIdForAdminSource(source) ?? subStateSourceId;
}

function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateInputValue(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

function expiresAtFromDateInput(value: string) {
  if (!value) return null;

  const date = new Date(`${value}T23:59:59.000Z`);
  if (!Number.isFinite(date.getTime())) return null;

  return date.toISOString();
}

function deadlineFromDateInput(value: string) {
  if (!value) return null;

  const date = new Date(`${value}T23:59:59.000Z`);
  if (!Number.isFinite(date.getTime())) return null;

  return date.toISOString();
}

function bidQaCorrectionDraftFor(item: AdminBidQaItem, drafts: Record<string, BidQaCorrectionDraft>) {
  return drafts[item.id] ?? {
    title: item.title,
    deadlineDate: formatDateInputValue(item.deadlineDate),
  };
}

function featureOverrideFormValues(
  data: AdminUserFeatureOverridesResponse | null,
  feature: FeatureKey,
) {
  const override = data?.overrides.find((item) => item.featureKey === feature);

  return {
    reason: override?.reason ?? "",
    expiresAt: formatDateInputValue(override?.expiresAt ?? null),
  };
}

function latestRunAt(source: AdminDataSource) {
  return source.latestLog?.finishedAt ?? source.latestLog?.startedAt ?? source.lastSuccessAt ?? source.lastFailureAt;
}

function statusTone(status: string | null | undefined) {
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "running" || status === "locked") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function liveSourceHealthTone(status: string | null | undefined) {
  if (status === "healthy") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "skipped") return "border-slate-200 bg-slate-50 text-slate-600";
  if (status === "unhealthy") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-white text-slate-500";
}

function liveSourceHealthLabel(t: (key: string) => string, status: string | null | undefined) {
  if (status === "healthy") return t("admin.liveSourceHealth_healthy");
  if (status === "unhealthy") return t("admin.liveSourceHealth_unhealthy");
  if (status === "skipped") return t("admin.liveSourceHealth_skipped");
  return t("admin.liveSourceHealthNoCheck");
}

function sourceHealthClassificationFor(source: {
  latestLiveHealth?: { classification?: string | null } | null;
}) {
  return source.latestLiveHealth?.classification ?? "unknown";
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

export function sourceHealthClassificationLabel(
  t: (key: string) => string,
  classification: SourceHealthClassificationFilter | string | null | undefined,
) {
  if (classification === "ok") return t("admin.sourceHealthClassification_ok");
  if (classification === "forbidden") return t("admin.sourceHealthClassification_forbidden");
  if (classification === "timeout") return t("admin.sourceHealthClassification_timeout");
  if (classification === "bot_check") return t("admin.sourceHealthClassification_bot_check");
  if (classification === "login_required") return t("admin.sourceHealthClassification_login_required");
  if (classification === "empty_or_placeholder") return t("admin.sourceHealthClassification_empty_or_placeholder");
  if (classification === "tls_or_network_error") return t("admin.sourceHealthClassification_tls_or_network_error");
  if (classification === "http_error") return t("admin.sourceHealthClassification_http_error");
  if (classification === "all") return t("admin.sourceHealthClassification_all");
  return t("admin.sourceHealthClassification_unknown");
}

export function filterStateDataQualityRows<
  TRow extends { riskLevel: string; reasons: Array<{ code: string }> },
>(rows: TRow[], filters: StateDataQualityFilters) {
  return rows.filter((row) => {
    const matchesRisk = filters.riskLevel === "all" || row.riskLevel === filters.riskLevel;
    const matchesReason =
      filters.reasonCode === "all" || row.reasons.some((reason) => reason.code === filters.reasonCode);

    return matchesRisk && matchesReason;
  });
}

export function stateDataQualityReasonOptions<
  TRow extends { reasons: Array<{ code: string }> },
>(rows: TRow[]) {
  return ["all", ...[...new Set(rows.flatMap((row) => row.reasons.map((reason) => reason.code)))].sort()];
}

export function filterStateDataQualityActionsByRecommendedAction<
  TAction extends { recommendedAction: string },
>(actions: TAction[], recommendedAction: RecommendedActionFilter) {
  if (recommendedAction === "all") return actions;

  return actions.filter((action) => action.recommendedAction === recommendedAction);
}

export function stateDataQualityActionRecommendedActionOptions<
  TAction extends { recommendedAction: string },
>(actions: TAction[]) {
  return ["all", ...[...new Set(actions.map((action) => action.recommendedAction))].sort()];
}

export function stateAttachmentRealRatio(row: Pick<StateDataQualityRow, "attachmentSummary">) {
  const real = row.attachmentSummary.realFileOpenable;
  const total = row.attachmentSummary.total;
  const percent = total > 0 ? Math.round((real / total) * 100) : 0;

  return `${real}/${total} (${percent}%)`;
}

export function stateDataQualityP0BlockerNotice(rows: Array<{ stateCode: string; riskLevel: string }>) {
  const blockerStates = STATE_DATA_QUALITY_P0_BLOCKER_STATES.filter((stateCode) =>
    rows.some((row) => row.stateCode === stateCode && row.riskLevel === "P0"),
  );

  if (blockerStates.length === 0) return null;

  return `${STATE_DATA_QUALITY_P0_BLOCKER_COPY}; currently blocked: ${blockerStates.join(
    "/",
  )}. These are not live source-health failures.`;
}

export function sourceHealthTriageStatus(
  source: SourceHealthTriageFields,
  now: Date = new Date(),
): SourceHealthTriageStatus {
  if (source.liveHealthReviewedAt || source.liveHealthDisposition) return "reviewed";
  if (!source.liveHealthOwner) return "unassigned";
  if (!source.liveHealthNextReviewAt) return "unassigned";

  const nextReviewAt = new Date(source.liveHealthNextReviewAt);
  if (!Number.isFinite(nextReviewAt.getTime())) return "unassigned";

  return nextReviewAt.getTime() < now.getTime() ? "overdue" : "scheduled";
}

function sourceHealthTriageTone(status: SourceHealthTriageStatus) {
  if (status === "overdue") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "scheduled") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "reviewed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function sourceHealthTriageLabel(t: (key: string) => string, status: SourceHealthTriageStatus) {
  if (status === "overdue") return t("admin.sourceHealthTriage_overdue");
  if (status === "scheduled") return t("admin.sourceHealthTriage_scheduled");
  if (status === "reviewed") return t("admin.sourceHealthTriage_reviewed");
  return t("admin.sourceHealthTriage_unassigned");
}

function sourceHealthTriageFilterLabel(t: (key: string) => string, status: SourceHealthTriageStatusFilter) {
  if (status === "all") return "All triage";

  return sourceHealthTriageLabel(t, status);
}

function sourceHealthDispositionLabel(t: (key: string) => string, disposition: string | null | undefined) {
  if (disposition === "accepted_fallback") return t("admin.sourceHealthDisposition_accepted_fallback");
  if (disposition === "manual") return t("admin.sourceHealthDisposition_manual");
  if (disposition === "vendor_account") return t("admin.sourceHealthDisposition_vendor_account");
  if (disposition) return disposition;
  return t("admin.sourceHealthDisposition_pending");
}

function isoDaysFrom(now: Date, days: number) {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

export function sourceHealthTriagePatchForAction(
  action: SourceHealthTriageAction,
  owner: string,
  now: Date = new Date(),
): UpdateAdminDataSourceInput {
  if (action === "clear") {
    return {
      liveHealthOwner: null,
      liveHealthDisposition: null,
      liveHealthNextReviewAt: null,
      liveHealthNotes: null,
      liveHealthReviewedAt: null,
    };
  }

  if (action === "assign") {
    return {
      liveHealthOwner: owner,
      liveHealthDisposition: null,
      liveHealthNextReviewAt: isoDaysFrom(now, 1),
      liveHealthNotes: "Scheduled for operator review from Admin source health triage.",
      liveHealthReviewedAt: null,
    };
  }

  return {
    liveHealthOwner: owner,
    liveHealthDisposition: action,
    liveHealthNextReviewAt: null,
    liveHealthNotes: `Admin source health triage disposition: ${action}.`,
    liveHealthReviewedAt: now.toISOString(),
  };
}

function liveSourceOperationalSeverityTone(value: string | null | undefined) {
  if (value === "critical") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "info") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function liveSourceRecommendedActionLabel(t: (key: string) => string, action: string | null | undefined) {
  if (action === "update_registry_url") return t("admin.sourceHealthAction_update_registry_url");
  if (action === "browser_or_access_review") return t("admin.sourceHealthAction_browser_or_access_review");
  if (action === "retry_or_increase_timeout") return t("admin.sourceHealthAction_retry_or_increase_timeout");
  if (action === "network_or_tls_review") return t("admin.sourceHealthAction_network_or_tls_review");
  if (action === "add_base_url") return t("admin.sourceHealthAction_add_base_url");
  if (action && action !== "none") return action;
  return t("admin.sourceHealthAction_none");
}

function liveSourceTrendStatusLabel(t: (key: string) => string, status: string | null | undefined) {
  if (status === "healthy") return t("admin.liveSourceHealth_healthy");
  if (status === "unhealthy") return t("admin.liveSourceHealth_unhealthy");
  if (status === "skipped") return t("admin.liveSourceHealth_skipped");
  return t("admin.liveSourceHealthNoCheck");
}

function qualityTone(score: number) {
  if (score >= 85) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 70) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function reviewTone(status: string | null | undefined) {
  if (status === "reviewed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "suppressed") return "border-slate-300 bg-slate-100 text-slate-700";
  if (status === "needs_review") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function crawlerTone(value: string | null | undefined) {
  if (value === "dedicated" || value === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "generic") return "border-slate-200 bg-slate-50 text-slate-600";
  if (value === "beta") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-white text-slate-500";
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

function sourceApprovalTone(value: AdminDataSource["approvalStatus"]) {
  if (value === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function robotsTxtTone(value: AdminDataSource["robotsTxtStatus"]) {
  if (value === "clear" || value === "not_found") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "disallow_all" || value === "disallow_crawled_paths") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "unreachable") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function robotsTxtStatusLabel(t: (key: string) => string, value: AdminDataSource["robotsTxtStatus"]) {
  if (value === "clear") return t("admin.robotsTxt_clear");
  if (value === "disallow_all") return t("admin.robotsTxt_disallow_all");
  if (value === "disallow_crawled_paths") return t("admin.robotsTxt_disallow_crawled_paths");
  if (value === "not_found") return t("admin.robotsTxt_not_found");
  if (value === "unreachable") return t("admin.robotsTxt_unreachable");
  return t("admin.robotsTxt_unknown");
}

function tosReviewedTone(value: AdminDataSource["tosReviewed"]) {
  if (value === true) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function sourceTrustTone(value: AdminDataSource["trustStatus"]) {
  if (value === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "fallback" || value === "beta") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function crawlerAdapterLabel(t: (key: string) => string, adapterKind: AdminDataSource["crawlerAdapterKind"]) {
  if (adapterKind === "dedicated") return t("admin.crawlerAdapter_dedicated");
  if (adapterKind === "generic") return t("admin.crawlerAdapter_generic");
  return t("admin.crawlerAdapter_none");
}

function crawlerMaturityLabel(t: (key: string) => string, maturity: AdminDataSource["crawlerMaturity"]) {
  if (maturity === "verified") return t("admin.crawlerMaturity_verified");
  if (maturity === "beta") return t("admin.crawlerMaturity_beta");
  if (maturity === "generic") return t("admin.crawlerMaturity_generic");
  return t("admin.crawlerMaturity_none");
}

function crawlerCapabilityLabel(t: (key: string) => string, capability: AdminDataSource["crawlerCapabilities"][number]) {
  if (capability === "attachments") return t("admin.crawlerCapability_attachments");
  if (capability === "detail_pages") return t("admin.crawlerCapability_detail_pages");
  if (capability === "pagination") return t("admin.crawlerCapability_pagination");
  return t("admin.crawlerCapability_query");
}

function sourceApprovalLabel(t: (key: string) => string, source: AdminDataSource) {
  if (source.approvalStatus === "approved") return t("admin.sourceApproval_approved");
  if (source.approvalStatus === "blocked") return t("admin.sourceApproval_blocked");
  return t("admin.sourceApproval_needs_review");
}

function sourceApprovalActionLabel(t: (key: string) => string, action: string) {
  if (action === "approved") return t("admin.sourceApprovalAction_approved");
  if (action === "blocked") return t("admin.sourceApprovalAction_blocked");
  if (action === "held") return t("admin.sourceApprovalAction_held");
  return t("admin.sourceApprovalAction_updated");
}

function sourceAuthorityLabel(t: (key: string) => string, value: AdminDataSource["sourceAuthority"]) {
  if (value === "official_aggregator") return t("admin.sourceAuthority_official_aggregator");
  if (value === "public_aggregator") return t("admin.sourceAuthority_public_aggregator");
  return t("admin.sourceAuthority_official");
}

function sourceTrustLabel(t: (key: string) => string, value: AdminDataSource["trustStatus"]) {
  if (value === "verified") return t("admin.sourceTrust_verified");
  if (value === "fallback") return t("admin.sourceTrust_fallback");
  if (value === "blocked") return t("admin.sourceTrust_blocked");
  if (value === "needs_review") return t("admin.sourceTrust_needs_review");
  return t("admin.sourceTrust_beta");
}

function sourceEvidenceLabel(t: (key: string) => string, value: AdminDataSource["evidenceMode"]) {
  if (value === "api") return t("admin.sourceEvidence_api");
  if (value === "aggregator_page") return t("admin.sourceEvidence_aggregator_page");
  if (value === "fixture_fallback") return t("admin.sourceEvidence_fixture_fallback");
  return t("admin.sourceEvidence_direct_portal");
}

function sourceRequirementLabels(t: (key: string) => string, source: AdminDataSource) {
  return [
    source.requiresBrowser ? t("admin.sourceRequiresBrowser") : null,
    source.requiresLogin ? t("admin.sourceRequiresLogin") : null,
    source.requiresManual ? t("admin.sourceRequiresManual") : null,
  ].filter((value): value is string => Boolean(value));
}

function formatCrawlerBaseUrl(value: string | null) {
  if (!value) return null;

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function compactErrorMessage(message: string) {
  return message.length > 96 ? `${message.slice(0, 93)}...` : message;
}

function fallbackMessage(log: AdminCrawlerLog | null | undefined) {
  if (!log?.fallbackSource) return null;

  return log.fallbackReason ? compactErrorMessage(log.fallbackReason) : null;
}

function formatAuditChanges(log: AdminUserAuditLog) {
  if (log.changes.length === 0) return "-";

  return log.changes
    .map((change) => {
      if (change.field !== "featureOverride") {
        return `${change.field}: ${String(change.before)} -> ${String(change.after)}`;
      }

      const formatOverrideState = (value: typeof change.before) => {
        if (!value) return "default";

        const parts = [value.isEnabled ? "enabled" : "disabled"];
        if (value.reason) parts.push(`reason=${value.reason}`);
        if (value.expiresAt) parts.push(`expires=${formatDate(value.expiresAt)}`);

        return parts.join(" ");
      };

      return `${change.featureKey}: ${formatOverrideState(change.before)} -> ${formatOverrideState(change.after)}`;
    })
    .join(", ");
}

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Database;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <Icon size={18} className="text-slate-400" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">{value}</div>
    </div>
  );
}

function formatConfigScope(entry: AdminConfigRegistryEntry) {
  return entry.scopeId ? `${entry.scopeType}: ${entry.scopeId}` : entry.scopeType;
}

function configStatusTone(status: AdminConfigRegistryEntry["status"]) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "draft") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatConfigValueJson(entry: AdminConfigRegistryEntry) {
  return JSON.stringify(entry.configValue, null, 2);
}

function isMarketingContentConfigEntry(entry: AdminConfigRegistryEntry) {
  return entry.module === MARKETING_CONTENT_CONFIG_MODULE && entry.configKey === MARKETING_CONTENT_CONFIG_KEY;
}

function configDraftFor(entry: AdminConfigRegistryEntry, drafts: Record<string, ConfigEditDraft>) {
  return drafts[entry.id] ?? {
    configValueJson: formatConfigValueJson(entry),
    status: entry.status,
    changeReason: "",
  };
}

function ConfigRegistrySection({
  configEntries,
  configEditDrafts,
  isLoading,
  isError,
  savingConfigEntryId,
  onDraftChange,
  onRefresh,
  onSave,
}: {
  configEntries: AdminConfigRegistryEntry[];
  configEditDrafts: Record<string, ConfigEditDraft>;
  isLoading: boolean;
  isError: boolean;
  savingConfigEntryId: string | null;
  onDraftChange: (id: string, updater: (draft: ConfigEditDraft) => ConfigEditDraft) => void;
  onRefresh: () => void;
  onSave: (entry: AdminConfigRegistryEntry) => void;
}) {
  return (
    <section id="configuration" className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold text-slate-950">
            <ServerCog size={18} />
            Config Registry
          </div>
          <div className="mt-1 text-xs font-medium text-slate-500">Config Matrix</div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRefresh}
          disabled={isLoading}
          className="h-8 rounded-lg border-slate-200 px-2 text-xs"
        >
          <RefreshCw size={14} />
          {isLoading ? "Refreshing" : "Refresh"}
        </Button>
      </div>
      {isError && (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          Config registry could not be loaded.
        </div>
      )}
      <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldCheck size={16} className="text-emerald-600" />
              Marketing Content CMS
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-600">
              Copy Library edits live in <code className="rounded bg-white px-1">{MARKETING_CONTENT_CONFIG_ID}</code>{" "}
              and cover homepage/resources scope. Keep local JSON copy-only; no external CMS or rich text editor is
              connected here.
            </div>
          </div>
          <div className="max-w-xl rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
            <span className="font-semibold text-emerald-700">safe validation</span>
            {": "}
            unsafe claim guard is enforced by the marketing content resolver. {MARKETING_CONTENT_SAFE_VALIDATION_COPY}
          </div>
        </div>
      </div>
      {isLoading && configEntries.length === 0 ? (
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-4 w-20" />
              <Skeleton className="mt-3 h-4 w-full" />
            </div>
          ))}
        </div>
      ) : configEntries.length === 0 ? (
        <div className="px-4 py-5 text-sm text-slate-500">No config registry entries found.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Module</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Config JSON</TableHead>
              <TableHead>Change reason</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configEntries.map((entry) => {
              const draft = configDraftFor(entry, configEditDrafts);
              const isSaving = savingConfigEntryId === entry.id;

              return (
                <TableRow key={entry.id} className="align-top">
                  <TableCell className="font-medium text-slate-900">{entry.module}</TableCell>
                  <TableCell>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                      {entry.configKey}
                    </code>
                    {isMarketingContentConfigEntry(entry) && (
                      <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs leading-5 text-emerald-800">
                        Copy Library: homepage/resources scope uses safe validation and the unsafe claim guard before
                        marketing overrides are applied.
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <Badge variant="outline" className={configStatusTone(draft.status)}>
                        {draft.status}
                      </Badge>
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          onDraftChange(entry.id, (current) => ({
                            ...current,
                            status: event.target.value as AdminConfigRegistryEntry["status"],
                          }))
                        }
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none"
                      >
                        <option value="active">active</option>
                        <option value="draft">draft</option>
                        <option value="inactive">inactive</option>
                      </select>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-slate-700">{formatConfigScope(entry)}</div>
                    <div className="text-xs text-slate-500">v{entry.schemaVersion}</div>
                  </TableCell>
                  <TableCell>
                    <textarea
                      aria-label={`${entry.module}.${entry.configKey} Config JSON`}
                      value={draft.configValueJson}
                      onChange={(event) =>
                        onDraftChange(entry.id, (current) => ({
                          ...current,
                          configValueJson: event.target.value,
                        }))
                      }
                      spellCheck={false}
                      className="min-h-28 w-80 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-700 outline-none focus:border-slate-400"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${entry.module}.${entry.configKey} Change reason`}
                      value={draft.changeReason}
                      onChange={(event) =>
                        onDraftChange(entry.id, (current) => ({
                          ...current,
                          changeReason: event.target.value,
                        }))
                      }
                      placeholder="Change reason"
                      className="h-9 min-w-56 rounded-lg border-slate-200 text-sm"
                    />
                    <div className="mt-2 max-w-56 truncate text-xs text-slate-500" title={entry.changeReason}>
                      Last: {entry.changeReason || "-"}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">{formatDate(entry.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onSave(entry)}
                      disabled={isSaving || draft.changeReason.trim().length === 0}
                      className="h-8 rounded-lg border-slate-200 px-2 text-xs"
                    >
                      {isSaving ? "Saving" : "Save config"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function riskCheckTone(ok: boolean) {
  return ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700";
}

function riskReportFilename(report: AdminRiskChecklistResponse["report"]) {
  const stamp = report.checkedAt.replace(/[^0-9A-Za-z]/g, "").slice(0, 15);
  return `risk-check-report-${stamp || "latest"}.json`;
}

function riskDetailBidHref(detail: string) {
  const markers = [
    ": sourceUrl ",
    ": attachment ",
    " fails route encode/decode round trip",
    " cannot be found by detail lookup",
    " has empty required content",
  ];
  const match = markers
    .map((marker) => ({ marker, index: detail.indexOf(marker) }))
    .filter((entry) => entry.index > 0)
    .sort((a, b) => a.index - b.index)[0];

  if (!match) return null;

  return bidDetailPath(detail.slice(0, match.index));
}

function RiskDetailItem({ detail }: { detail: string }) {
  const href = riskDetailBidHref(detail);

  if (!href) return <li>{detail}</li>;

  return (
    <li>
      <a href={href} className="break-words underline decoration-rose-300 underline-offset-2 hover:text-rose-900">
        {detail}
      </a>
    </li>
  );
}

function stateDataQualityRiskTone(riskLevel: StateDataQualityRiskLevel | string) {
  if (riskLevel === "PASS") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (riskLevel === "P0") return "border-rose-200 bg-rose-50 text-rose-700";
  if (riskLevel === "P1") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function stateDataQualityRiskFilterLabel(filter: StateDataQualityRiskFilter) {
  return filter === "all" ? "All" : filter;
}

function StateDataQualityMatrix({ report }: { report: StateDataQualityReport }) {
  const [stateQualityRiskFilter, setStateQualityRiskFilter] = useState<StateDataQualityRiskFilter>("all");
  const [stateQualityReasonFilter, setStateQualityReasonFilter] = useState<StateDataQualityReasonFilter>("all");
  const [stateQualityActionRecommendedFilter, setStateQualityActionRecommendedFilter] =
    useState<RecommendedActionFilter>("all");
  const reasonOptions = stateDataQualityReasonOptions(report.rows);
  const actionRecommendedOptions = stateDataQualityActionRecommendedActionOptions(report.actions);
  const filteredRows = filterStateDataQualityRows(report.rows, {
    riskLevel: stateQualityRiskFilter,
    reasonCode: stateQualityReasonFilter,
  });
  const filteredActions = filterStateDataQualityActionsByRecommendedAction(
    report.actions,
    stateQualityActionRecommendedFilter,
  );
  const p0BlockerNotice = stateDataQualityP0BlockerNotice(report.rows);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-950">
            <Database size={15} />
            50-state data quality matrix
            <Badge variant="outline" className={riskCheckTone(report.ok)}>
              {report.ok ? "PASS" : "P0 blocker review"}
            </Badge>
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            50-state data quality matrix summary: total states, P0/P1/P2 counts, source enablement, bids, attachment real ratio, and reason code.
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
            total states: {report.summary.totalStates}
          </Badge>
          <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
            P0: {report.summary.p0BlockerStates}
          </Badge>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
            P1: {report.summary.p1WarningStates}
          </Badge>
          <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
            P2: {report.summary.p2WarningStates}
          </Badge>
        </div>
      </div>
      {p0BlockerNotice && (
        <div className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-medium leading-5 text-rose-800">
          {p0BlockerNotice}
        </div>
      )}
      <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-black uppercase text-slate-700">State data quality action queue</div>
          <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
            {filteredActions.length}/{report.actions.length} actions
          </Badge>
        </div>
        <label className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          Recommended action
          <select
            value={stateQualityActionRecommendedFilter}
            onChange={(event) => setStateQualityActionRecommendedFilter(event.target.value)}
            className="h-8 max-w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium normal-case text-slate-700 outline-none"
          >
            {actionRecommendedOptions.map((action) => (
              <option key={action} value={action}>
                {action === "all" ? "all recommended actions" : action}
              </option>
            ))}
          </select>
        </label>
        {filteredActions.length === 0 ? (
          <div className="mt-2 text-xs font-medium text-slate-500">No state data quality actions are open.</div>
        ) : (
          <div className="mt-2 grid gap-2">
            {filteredActions.slice(0, 6).map((action) => (
              <div
                key={action.id}
                className="grid gap-2 rounded-md border border-white bg-white px-3 py-2 text-xs md:grid-cols-[auto_1fr_auto]"
              >
                <Badge variant="outline" className={stateDataQualityRiskTone(action.priority)}>
                  {action.priority}
                </Badge>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900">
                    {action.stateCode} · {action.reasonCode}
                  </div>
                  <div className="mt-1 text-slate-600">{action.recommendedAction}</div>
                  <div className="mt-1 truncate text-slate-400" title={action.evidence}>
                    {action.evidence}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 md:justify-end">
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                    {action.ownerHint}
                  </Badge>
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                    {action.dueInHours}h
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2 border-y border-slate-100 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-slate-500">Risk filter</span>
          {STATE_DATA_QUALITY_RISK_FILTERS.map((filter) => (
            <Button
              key={filter}
              type="button"
              variant={stateQualityRiskFilter === filter ? "default" : "outline"}
              size="sm"
              onClick={() => setStateQualityRiskFilter(filter)}
              className={
                stateQualityRiskFilter === filter
                  ? "h-8 rounded-lg px-2 text-xs"
                  : "h-8 rounded-lg border-slate-200 px-2 text-xs text-slate-600"
              }
            >
              {stateDataQualityRiskFilterLabel(filter)}
            </Button>
          ))}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          Reason code
          <select
            value={stateQualityReasonFilter}
            onChange={(event) => setStateQualityReasonFilter(event.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium normal-case text-slate-700 outline-none"
          >
            {reasonOptions.map((reasonCode) => (
              <option key={reasonCode} value={reasonCode}>
                {reasonCode === "all" ? "all reason codes" : reasonCode}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>state</TableHead>
              <TableHead>risk</TableHead>
              <TableHead>bids</TableHead>
              <TableHead>enabled source</TableHead>
              <TableHead>attachment real ratio</TableHead>
              <TableHead>reason code</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-5 text-center text-sm text-slate-500">
                  No state data quality rows match this filter.
                </TableCell>
              </TableRow>
            )}
            {filteredRows.map((row) => {
              const reasonCodes = row.reasons.map((reason) => reason.code);

              return (
                <TableRow key={row.stateCode}>
                  <TableCell className="font-semibold text-slate-900">{row.stateCode}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={stateDataQualityRiskTone(row.riskLevel)}>
                      {row.riskLevel}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.bidCount}</TableCell>
                  <TableCell>{row.enabledSourceCount}</TableCell>
                  <TableCell>{stateAttachmentRealRatio(row)}</TableCell>
                  <TableCell>
                    <div className="flex max-w-xl flex-wrap gap-1">
                      {reasonCodes.length === 0 ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          none
                        </Badge>
                      ) : (
                        reasonCodes.map((reasonCode, reasonIndex) => (
                          // A state can report the same reason code from several sources, so the
                          // code alone is not a unique key.
                          <Badge key={`${row.stateCode}-${reasonCode}-${reasonIndex}`} variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                            {reasonCode}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RiskCheck({
  history,
  isRefreshing,
  onExport,
  onRefresh,
  report,
  stateDataQuality,
  t,
  trend,
}: {
  history: AdminRiskChecklistResponse["history"];
  isRefreshing: boolean;
  onExport: () => void;
  onRefresh: () => void;
  report: AdminRiskChecklistResponse["report"];
  stateDataQuality: AdminRiskChecklistResponse["stateDataQuality"];
  t: (key: string) => string;
  trend: AdminRiskChecklistResponse["trend"];
}) {
  const globalUrlCheck = report.checks.find((check) => check.id === "global-url-validity");
  const globalUrlSummary = (snapshotReport: AdminRiskChecklistResponse["report"]) =>
    snapshotReport.checks.find((check) => check.id === "global-url-validity")?.summary ?? "-";

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 font-semibold text-slate-950">
          {report.ok ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
          {t("admin.riskCheck")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={riskCheckTone(report.ok)}>
            {report.ok ? t("admin.riskCheckPassed") : t("admin.riskCheckFailed")}
          </Badge>
          <span className="text-xs font-medium text-slate-500">
            {t("admin.riskCheckCheckedAt").replace("{time}", formatDate(report.checkedAt))}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-8 rounded-lg border-slate-200 px-2 text-xs"
          >
            <RefreshCw size={14} />
            {isRefreshing ? t("admin.refreshingRiskCheck") : t("admin.refreshRiskCheck")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onExport}
            className="h-8 rounded-lg border-slate-200 px-2 text-xs"
          >
            <Download size={14} />
            {t("admin.exportRiskCheck")}
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Activity size={15} />
            {t("admin.riskCheckTrend")}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2">
              <div className="text-xs font-semibold text-slate-700">{t("admin.riskTrendGlobalUrlStable")}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{trend.latestGlobalUrlSummary ?? "-"}</div>
              <Badge variant="outline" className={riskCheckTone(trend.globalUrlAllPassing !== false)}>
                {trend.globalUrlAllPassing === false ? t("admin.riskCheckIssue") : t("admin.riskCheckOk")}
              </Badge>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2">
              <div className="text-xs font-semibold text-slate-700">{t("admin.riskTrendStateCoverageDeclined")}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{trend.latestStateCoverageSummary ?? "-"}</div>
              <Badge variant="outline" className={riskCheckTone(trend.stateCoverageDeclined !== true)}>
                {trend.stateCoverageDeclined ? t("admin.riskCheckIssue") : t("admin.riskCheckOk")}
              </Badge>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2">
              <div className="text-xs font-semibold text-slate-700">{t("admin.riskTrendAttachmentChanged")}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{trend.latestAttachmentSummary ?? "-"}</div>
              <Badge variant="outline" className={riskCheckTone(trend.attachmentDownloadCountChanged !== true)}>
                {trend.attachmentDownloadCountChanged ? t("admin.riskCheckIssue") : t("admin.riskCheckOk")}
              </Badge>
            </div>
          </div>
        </div>
        {globalUrlCheck && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-950">{t("admin.riskCheckGlobalUrlTitle")}</span>
                  <Badge variant="outline" className={riskCheckTone(globalUrlCheck.ok)}>
                    {globalUrlCheck.ok ? t("admin.riskCheckOk") : t("admin.riskCheckIssue")}
                  </Badge>
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-600">
                  {t("admin.riskCheckGlobalUrlDescription")}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{globalUrlCheck.summary}</div>
              </div>
            </div>
            {globalUrlCheck.details && globalUrlCheck.details.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs leading-5 text-rose-700">
                {globalUrlCheck.details.slice(0, 5).map((detail) => (
                  <RiskDetailItem key={detail} detail={detail} />
                ))}
                {globalUrlCheck.details.length > 5 && (
                  <li>{t("admin.riskCheckMoreIssues").replace("{count}", String(globalUrlCheck.details.length - 5))}</li>
                )}
              </ul>
            ) : (
              <div className="mt-2 text-xs leading-5 text-slate-500">{t("admin.riskCheckNoIssues")}</div>
            )}
          </div>
        )}
        {stateDataQuality && <StateDataQualityMatrix report={stateDataQuality} />}
        <div className="grid gap-3 lg:grid-cols-5">
          {report.checks.map((check) => (
            <div key={check.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold text-slate-950">{check.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-600">{check.summary}</div>
                </div>
                <Badge variant="outline" className={riskCheckTone(check.ok)}>
                  {check.ok ? t("admin.riskCheckOk") : t("admin.riskCheckIssue")}
                </Badge>
              </div>
              {check.details && check.details.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs leading-5 text-rose-700">
                  {check.details.slice(0, 3).map((detail) => (
                    <RiskDetailItem key={detail} detail={detail} />
                  ))}
                </ul>
              ) : (
                <div className="mt-2 text-xs leading-5 text-slate-500">{t("admin.riskCheckNoIssues")}</div>
              )}
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <History size={15} />
            {t("admin.riskCheckHistory")}
          </div>
          {history.length === 0 ? (
            <div className="mt-2 text-xs leading-5 text-slate-500">{t("admin.riskCheckHistoryEmpty")}</div>
          ) : (
            <div className="mt-2 divide-y divide-slate-100">
              {history.slice(0, 5).map((snapshot) => (
                <div key={snapshot.id} className="grid gap-2 py-2 md:grid-cols-[auto_1fr] md:items-start">
                  <Badge variant="outline" className={riskCheckTone(snapshot.ok)}>
                    {snapshot.ok ? t("admin.riskCheckOk") : t("admin.riskCheckIssue")}
                  </Badge>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-600">
                      {t("admin.riskCheckCheckedAt").replace("{time}", formatDate(snapshot.checkedAt))}
                    </div>
                    <div className="mt-1 break-words text-xs leading-5 text-slate-500">
                      {globalUrlSummary(snapshot.report)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminAccessState({
  code,
  title,
  description,
  action,
}: {
  code: "loading" | "permission_denied";
  title: string;
  description: string;
  action?: {
    href: string;
    label: string;
  };
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-8">
      <UniversalState
        actions={action ? [{ href: action.href, label: action.label }] : undefined}
        className="bg-white p-6"
        code={code}
        message={description}
        title={title}
      />
    </main>
  );
}

function AdminSectionStateCard({
  action,
  actionLabel,
  code,
  message,
  title,
}: {
  action?: () => void;
  actionLabel: string;
  code: "error" | "loading";
  message: string;
  title: string;
}) {
  return (
    <UniversalState
      actions={action ? [{ label: actionLabel, onClick: action }] : undefined}
      className="bg-white"
      code={code}
      message={message}
      title={title}
    />
  );
}

export default function AdminPage() {
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [state, setState] = useState<AdminDashboardSections>(() => createInitialAdminSectionState());
  const stateRef = useRef(state);
  const [configRegistryStatus, setConfigRegistryStatus] = useState<ConfigRegistryStatus>({
    status: "loading",
    configEntries: [],
  });
  const [configEditDrafts, setConfigEditDrafts] = useState<Record<string, ConfigEditDraft>>({});
  const [savingConfigEntryId, setSavingConfigEntryId] = useState<string | null>(null);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [sourceApprovalPendingId, setSourceApprovalPendingId] = useState<string | null>(null);
  const [sourceApprovalBatchPending, setSourceApprovalBatchPending] = useState(false);
  const [sourceHealthPendingId, setSourceHealthPendingId] = useState<string | null>(null);
  const [sourceTriagePendingId, setSourceTriagePendingId] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingBidQaId, setPendingBidQaId] = useState<string | null>(null);
  const [pendingBidQaBatch, setPendingBidQaBatch] = useState(false);
  const [bidQaFilters, setBidQaFilters] = useState<BidQaFilters>(DEFAULT_BID_QA_FILTERS);
  const [selectedBidQaIds, setSelectedBidQaIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [sourceHealthClassificationFilter, setSourceHealthClassificationFilter] =
    useState<SourceHealthClassificationFilter>("all");
  const [sourceHealthTriageFilter, setSourceHealthTriageFilter] = useState<SourceHealthTriageStatusFilter>("all");
  const [sourceHealthRecommendedActionFilter, setSourceHealthRecommendedActionFilter] =
    useState<RecommendedActionFilter>("all");
  const [correctionHistoryBidId, setCorrectionHistoryBidId] = useState<string | null>(null);
  const [correctionHistoryItems, setCorrectionHistoryItems] = useState<AdminBidQaCorrectionHistoryItem[]>([]);
  const [isLoadingCorrectionHistory, setIsLoadingCorrectionHistory] = useState(false);
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, BidQaCorrectionDraft>>({});
  const [userFilters, setUserFilters] = useState<UserFilters>({});
  const [userAuditFilters, setUserAuditFilters] = useState<UserAuditFilters>({});
  const [isRunning, setIsRunning] = useState(false);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [invitationDraft, setInvitationDraft] = useState<InvitationDraft>(DEFAULT_INVITATION_DRAFT);
  const [invitedTemporaryPassword, setInvitedTemporaryPassword] = useState<string | null>(null);
  const [isInvitingUser, setIsInvitingUser] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isRefreshingRiskReport, setIsRefreshingRiskReport] = useState(false);
  const [isDeliveringNotifications, setIsDeliveringNotifications] = useState(false);
  const [isReconcilingSubscriptions, setIsReconcilingSubscriptions] = useState(false);
  const [featureOverrideUser, setFeatureOverrideUser] = useState<AdminUser | null>(null);
  const [featureOverrideData, setFeatureOverrideData] = useState<AdminUserFeatureOverridesResponse | null>(null);
  const [featureOverrideFeature, setFeatureOverrideFeature] = useState<FeatureKey>("submission_guidance");
  const [featureOverrideReason, setFeatureOverrideReason] = useState("");
  const [featureOverrideExpiresAt, setFeatureOverrideExpiresAt] = useState("");
  const [isLoadingFeatureOverrides, setIsLoadingFeatureOverrides] = useState(false);
  const [isUpdatingFeatureOverride, setIsUpdatingFeatureOverride] = useState(false);
  const isAdmin = user?.role === "admin";
  const isOperator = user?.role === "operator";
  const canAccessAdminConsole = Boolean(user && ADMIN_CONSOLE_USER_ROLES.includes(user.role));
  const canManageUsers = isAdmin;
  const canManageConfig = isAdmin;
  const canRunOperations = isAdmin || isOperator;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const auditLogRequest = useCallback(() => ({
    limit: 10,
    actorKind: userAuditFilters.actorKind,
    action: userAuditFilters.action,
    target: userAuditFilters.target?.trim() || undefined,
    featureKey: userAuditFilters.featureKey,
  }), [userAuditFilters]);

  const refreshConfigRegistry = useCallback(() => {
    if (!canManageConfig) return Promise.resolve();

    setConfigRegistryStatus((current) => ({ status: "loading", configEntries: current.configEntries }));
    return listAdminConfigEntries()
      .then((response) => {
        setConfigRegistryStatus({ status: "ready", configEntries: response.entries });
      })
      .catch(() => {
        setConfigRegistryStatus((current) => ({ status: "error", configEntries: current.configEntries }));
      });
  }, [canManageConfig]);

  const bidQaRequest = useCallback(() => ({
    limit: 10,
    q: bidQaFilters.q.trim() || undefined,
    stateCode: bidQaFilters.stateCode.trim().toUpperCase() || undefined,
    reviewStatus: bidQaFilters.reviewStatus === "all" ? undefined : bidQaFilters.reviewStatus,
    displayStatus: bidQaFilters.displayStatus === "all" ? undefined : bidQaFilters.displayStatus,
    sourceConfidence: bidQaFilters.sourceConfidence === "all" ? undefined : bidQaFilters.sourceConfidence,
    minQualityScore: bidQaFilters.minQualityScore ? Number(bidQaFilters.minQualityScore) : undefined,
    maxQualityScore: bidQaFilters.maxQualityScore ? Number(bidQaFilters.maxQualityScore) : undefined,
    reviewerId: bidQaFilters.reviewerId.trim() || undefined,
    reviewedFrom: bidQaFilters.reviewedFrom ? `${bidQaFilters.reviewedFrom}T00:00:00.000Z` : undefined,
    reviewedTo: bidQaFilters.reviewedTo ? `${bidQaFilters.reviewedTo}T23:59:59.999Z` : undefined,
  }), [bidQaFilters]);

  const load = useCallback(() => {
    if (!canAccessAdminConsole) return;

    const current = stateRef.current;

    setState(createRefreshingAdminSectionState(current));
    void refreshConfigRegistry();
    void loadAdminDashboardSections(
      {
        dataSources: listAdminDataSources,
        risk: getAdminRiskChecklist,
        crawlerLogs: listAdminCrawlerLogs,
        bidQa: () => listAdminBidQaItems(bidQaRequest()),
        users: () => (canManageUsers ? listAdminUsers(userFilters) : Promise.resolve({ users: [] })),
        userAuditLogs: () =>
          canManageUsers ? listAdminUserAuditLogs(auditLogRequest()) : Promise.resolve({ logs: [] }),
        notifications: () => listAdminNotifications({ limit: 10 }),
        marketingFunnel: getAdminMarketingFunnel,
      },
      current,
    ).then((sections) => {
      setState(sections);
    });
  }, [auditLogRequest, bidQaRequest, canAccessAdminConsole, canManageUsers, refreshConfigRegistry, userFilters]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canAccessAdminConsole) return;

    queueMicrotask(load);
  }, [canAccessAdminConsole, isAuthLoading, load]);

  const isLoadingDashboard = isAdminDashboardLoading(state);
  const areMainSectionsFullyFailed = isAdminDashboardFullyFailed(state);
  const isFullyFailedDashboard =
    areMainSectionsFullyFailed && (!canManageConfig || configRegistryStatus.status === "error");
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
  const riskReport = state.risk.status === "ready" ? state.risk.data?.report ?? null : null;
  const riskHistory = state.risk.status === "ready" ? state.risk.data?.history ?? [] : [];
  const riskTrend = state.risk.status === "ready" ? state.risk.data?.trend ?? null : null;
  const stateDataQuality = state.risk.status === "ready" ? state.risk.data?.stateDataQuality ?? null : null;
  const logs = state.crawlerLogs.status === "ready" ? state.crawlerLogs.data : [];
  const bidQa = state.bidQa.status === "ready" ? state.bidQa.data : null;
  const bidQaItems = bidQa?.items ?? [];
  const visibleSelectedBidQaIds = selectedBidQaIds.filter((id) => bidQaItems.some((item) => item.id === id));
  const allVisibleBidQaSelected = bidQaItems.length > 0 && bidQaItems.every((item) => selectedBidQaIds.includes(item.id));
  const visibleSelectedSourceIds = selectedSourceIds.filter((id) => sources.some((source) => source.id === id));
  const allVisibleSourcesSelected = sources.length > 0 && sources.every((source) => selectedSourceIds.includes(source.id));
  const users = state.users.status === "ready" ? state.users.data : [];
  const userAuditLogs = state.userAuditLogs.status === "ready" ? state.userAuditLogs.data : [];
  const notifications = state.notifications.status === "ready" ? state.notifications.data : [];
  const marketingFunnel = state.marketingFunnel.status === "ready" ? state.marketingFunnel.data : null;
  const configEntries = configRegistryStatus.configEntries;

  const updateConfigEditDraft = (id: string, updater: (draft: ConfigEditDraft) => ConfigEditDraft) => {
    const entry = configEntries.find((item) => item.id === id);
    if (!entry) return;

    setConfigEditDrafts((current) => ({
      ...current,
      [id]: updater(configDraftFor(entry, current)),
    }));
  };

  const handleConfigRegistrySave = (entry: AdminConfigRegistryEntry) => {
    const draft = configDraftFor(entry, configEditDrafts);
    let configValue: unknown;

    try {
      configValue = JSON.parse(draft.configValueJson);
    } catch {
      setRunMessage("Config JSON is invalid.");
      return;
    }

    if (draft.changeReason.trim().length === 0) {
      setRunMessage("Change reason is required.");
      return;
    }

    setSavingConfigEntryId(entry.id);
    setRunMessage(null);
    updateAdminConfigEntry(entry.id, {
      configValue,
      status: draft.status,
      changeReason: draft.changeReason.trim(),
    })
      .then(({ entry: updated }) => {
        setConfigRegistryStatus((current) => ({
          ...current,
          configEntries: current.configEntries.map((item) => (item.id === updated.id ? updated : item)),
        }));
        setConfigEditDrafts((current) => {
          const next = { ...current };
          delete next[entry.id];
          return next;
        });
        setRunMessage("Config saved.");
      })
      .catch(() => {
        setRunMessage("Config update failed.");
      })
      .finally(() => {
        setSavingConfigEntryId(null);
      });
  };

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
      .then(({ sources: updatedSources }) => {
        replaceSources(updatedSources);
        setSelectedSourceIds((current) => current.filter((id) => !visibleSelectedSourceIds.includes(id)));
        setRunMessage(t("admin.sourceBatchApprovalUpdated"));
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

  const refreshRiskReport = () => {
    setIsRefreshingRiskReport(true);
    setState((current) => ({
      ...current,
      risk: sectionLoading(current.risk.data),
    }));
    getAdminRiskChecklist()
      .then((response) => {
        setState((current) => ({
          ...current,
          risk: sectionReady({
            report: response.report,
            history: response.history,
            trend: response.trend,
            stateDataQuality: response.stateDataQuality ?? null,
          }),
        }));
      })
      .catch(() => {
        setState((current) => ({
          ...current,
          risk: sectionError(current.risk.data),
        }));
        setRunMessage(t("admin.riskCheckRefreshFailed"));
      })
      .finally(() => {
        setIsRefreshingRiskReport(false);
      });
  };

  const exportRiskReport = () => {
    if (!riskReport) return;

    const blob = new Blob([JSON.stringify(riskReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = riskReportFilename(riskReport);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const updateBidQaFilters = (updater: (current: BidQaFilters) => BidQaFilters) => {
    setSelectedBidQaIds([]);
    setBidQaFilters(updater);
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
    const stateCrawlerSourceId = stateCrawlerSourceIdFor(source);
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

  const refreshBidQa = () => {
    setState((current) => ({
      ...current,
      bidQa: sectionLoading(current.bidQa.data),
    }));

    return listAdminBidQaItems(bidQaRequest())
      .then((bidQa) => {
        setState((current) => ({
          ...current,
          bidQa: sectionReady(bidQa),
        }));
        setSelectedBidQaIds((current) => current.filter((id) => bidQa.items.some((item) => item.id === id)));
        return bidQa;
      })
      .catch((error) => {
        setState((current) => ({
          ...current,
          bidQa: sectionError(current.bidQa.data),
        }));
        throw error;
      });
  };

  const updateBidQaStatus = (item: AdminBidQaItem, reviewStatus: AdminBidQaReviewStatus) => {
    setPendingBidQaId(item.id);
    updateAdminBidQaReview(item.id, { reviewStatus })
      .then(refreshBidQa)
      .then(() => {
        setRunMessage(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setRunMessage(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaId(null);
      });
  };

  const updateBidQaDisplayStatus = (item: AdminBidQaItem, displayStatus: AdminBidQaDisplayStatus) => {
    setPendingBidQaId(item.id);
    updateAdminBidQaReview(item.id, { displayStatus })
      .then(refreshBidQa)
      .then(() => {
        setRunMessage(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setRunMessage(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaId(null);
      });
  };

  const saveBidQaCorrections = (item: AdminBidQaItem) => {
    const draft = bidQaCorrectionDraftFor(item, correctionDrafts);

    setPendingBidQaId(item.id);
    updateAdminBidQaReview(item.id, {
      corrections: {
        title: draft.title.trim(),
        deadlineDate: deadlineFromDateInput(draft.deadlineDate),
      },
      note: "Admin QA correction",
    })
      .then(refreshBidQa)
      .then(() => {
        setCorrectionDrafts((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        setRunMessage(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setRunMessage(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaId(null);
      });
  };

  const toggleSelectedBidQaId = (id: string) => {
    setSelectedBidQaIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleAllVisibleBidQa = () => {
    setSelectedBidQaIds((current) => {
      const visibleIds = bidQaItems.map((item) => item.id);
      if (visibleIds.length > 0 && visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      return [...new Set([...current, ...visibleIds])];
    });
  };

  const batchReviewBidQa = (reviewStatus: AdminBidQaReviewStatus) => {
    if (visibleSelectedBidQaIds.length === 0) return;

    setPendingBidQaBatch(true);
    batchUpdateAdminBidQaItems({
      bidIds: visibleSelectedBidQaIds,
      reviewStatus,
      note: "Admin QA batch action",
    })
      .then(refreshBidQa)
      .then(() => {
        setRunMessage(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setRunMessage(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaBatch(false);
      });
  };

  const batchDisplayBidQa = (displayStatus: AdminBidQaDisplayStatus) => {
    if (visibleSelectedBidQaIds.length === 0) return;

    setPendingBidQaBatch(true);
    batchUpdateAdminBidQaItems({
      bidIds: visibleSelectedBidQaIds,
      displayStatus,
    })
      .then(refreshBidQa)
      .then(() => {
        setRunMessage(t("admin.bidQaUpdated"));
      })
      .catch(() => {
        setRunMessage(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setPendingBidQaBatch(false);
      });
  };

  const loadCorrectionHistory = (item: AdminBidQaItem) => {
    setCorrectionHistoryBidId(item.id);
    setIsLoadingCorrectionHistory(true);
    getAdminBidQaCorrections(item.id)
      .then((response) => {
        setCorrectionHistoryItems(response.corrections);
      })
      .catch(() => {
        setCorrectionHistoryItems([]);
        setRunMessage(t("admin.bidQaUpdateFailed"));
      })
      .finally(() => {
        setIsLoadingCorrectionHistory(false);
      });
  };

  const updateUserAccess = (user: AdminUser, input: UpdateAdminUserInput) => {
    setPendingUserId(user.id);
    updateAdminUserAccess(user.id, input)
      .then(({ user: updated }) => {
        setState((current) => {
          return {
            ...current,
            users: sectionReady(current.users.data.map((item) => (item.id === updated.id ? updated : item))),
          };
        });
        return listAdminUserAuditLogs(auditLogRequest());
      })
      .then((response) => {
        if (!response) return;

        setState((current) => {
          return {
            ...current,
            userAuditLogs: sectionReady(response.logs),
          };
        });
      })
      .catch(() => {
        setRunMessage(t("admin.userUpdateFailed"));
      })
      .finally(() => {
        setPendingUserId(null);
      });
  };

  const syncFeatureOverrideForm = (data: AdminUserFeatureOverridesResponse | null, feature: FeatureKey) => {
    const form = featureOverrideFormValues(data, feature);

    setFeatureOverrideReason(form.reason);
    setFeatureOverrideExpiresAt(form.expiresAt);
  };

  const openFeatureOverrides = (targetUser: AdminUser) => {
    setFeatureOverrideUser(targetUser);
    setFeatureOverrideData(null);
    syncFeatureOverrideForm(null, featureOverrideFeature);
    setIsLoadingFeatureOverrides(true);
    listAdminUserFeatureOverrides(targetUser.id)
      .then((response) => {
        setFeatureOverrideData(response);
        syncFeatureOverrideForm(response, featureOverrideFeature);
      })
      .catch(() => {
        setRunMessage(t("admin.featureOverrideLoadFailed"));
      })
      .finally(() => {
        setIsLoadingFeatureOverrides(false);
      });
  };

  const selectedFeatureOverride = featureOverrideData?.overrides.find(
    (override) => override.featureKey === featureOverrideFeature,
  );

  const saveFeatureOverride = (isEnabled: boolean | null) => {
    if (!featureOverrideUser) return;

    const reason = featureOverrideReason.trim();

    setIsUpdatingFeatureOverride(true);
    updateAdminUserFeatureOverride(featureOverrideUser.id, {
      featureKey: featureOverrideFeature,
      isEnabled,
      reason: isEnabled === null ? null : reason || null,
      expiresAt: isEnabled === null ? null : expiresAtFromDateInput(featureOverrideExpiresAt),
    })
      .then((response) => {
        setFeatureOverrideData(response);
        syncFeatureOverrideForm(response, featureOverrideFeature);
        setRunMessage(t("admin.featureOverrideUpdated"));
        return listAdminUserAuditLogs(auditLogRequest());
      })
      .then((response) => {
        setState((current) => {
          return {
            ...current,
            userAuditLogs: sectionReady(response.logs),
          };
        });
      })
      .catch(() => {
        setRunMessage(t("admin.featureOverrideUpdateFailed"));
      })
      .finally(() => {
        setIsUpdatingFeatureOverride(false);
      });
  };

  const refreshUsers = () => {
    if (!canManageUsers) return Promise.resolve();

    setState((current) => ({
      ...current,
      users: sectionLoading(current.users.data),
    }));

    return listAdminUsers(userFilters)
      .then((response) => {
        setState((current) => ({
          ...current,
          users: sectionReady(response.users),
        }));
        return response;
      })
      .catch((error) => {
        setState((current) => ({
          ...current,
          users: sectionError(current.users.data),
        }));
        throw error;
      });
  };

  const refreshUserAuditLogs = () => {
    if (!canManageUsers) return Promise.resolve();

    setState((current) => ({
      ...current,
      userAuditLogs: sectionLoading(current.userAuditLogs.data),
    }));

    return listAdminUserAuditLogs(auditLogRequest())
      .then((response) => {
        setState((current) => ({
          ...current,
          userAuditLogs: sectionReady(response.logs),
        }));
        return response;
      })
      .catch((error) => {
        setState((current) => ({
          ...current,
          userAuditLogs: sectionError(current.userAuditLogs.data),
        }));
        throw error;
      });
  };

  const refreshNotifications = () => {
    setState((current) => ({
      ...current,
      notifications: sectionLoading(current.notifications.data),
    }));

    return listAdminNotifications({ limit: 10 })
      .then((response) => {
        setState((current) => ({
          ...current,
          notifications: sectionReady(response.notifications),
        }));
        return response;
      })
      .catch((error) => {
        setState((current) => ({
          ...current,
          notifications: sectionError(current.notifications.data),
        }));
        throw error;
      });
  };

  const handleCreateAdminUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const email = invitationDraft.email.trim();
    if (!email || isInvitingUser) return;

    setIsInvitingUser(true);
    setInviteError(null);
    setInvitedTemporaryPassword(null);

    createAdminUser({
      email,
      displayName: invitationDraft.displayName.trim() || undefined,
      role: invitationDraft.role,
      tier: invitationDraft.tier,
    })
      .then((response) => {
        setInvitationDraft(DEFAULT_INVITATION_DRAFT);
        setInvitedTemporaryPassword(response.temporaryPassword);
        setRunMessage(t("admin.inviteCreated").replace("{email}", response.user.email ?? response.user.id));
        setState((current) => {
          return {
            ...current,
            users: sectionReady([...current.users.data, response.user]),
          };
        });
        return listAdminUserAuditLogs(auditLogRequest());
      })
      .then((response) => {
        if (!response) return;

        setState((current) => {
          return {
            ...current,
            userAuditLogs: sectionReady(response.logs),
          };
        });
      })
      .catch(() => {
        setInviteError(t("admin.inviteError"));
      })
      .finally(() => {
        setIsInvitingUser(false);
      });
  };

  const deliverNotifications = () => {
    setIsDeliveringNotifications(true);
    setRunMessage(null);
    deliverAdminNotifications({ limit: 25, maxAttempts: 3 })
      .then((result) => {
        setRunMessage(
          t("admin.notificationDeliveryResult")
            .replace("{sent}", String(result.sent))
            .replace("{failed}", String(result.failed))
            .replace("{skipped}", String(result.skipped)),
        );
        return listAdminNotifications({ limit: 10 });
      })
      .then((response) => {
        setState((current) => {
          return {
            ...current,
            notifications: sectionReady(response.notifications),
          };
        });
      })
      .catch(() => {
        setRunMessage(t("admin.notificationDeliveryFailed"));
      })
      .finally(() => {
        setIsDeliveringNotifications(false);
      });
  };

  const reconcileSubscriptions = () => {
    setIsReconcilingSubscriptions(true);
    setRunMessage(null);
    reconcileAdminSubscriptions({ pastDueGraceDays: 7 })
      .then((result) => {
        setRunMessage(
          t("admin.subscriptionReconcileResult")
            .replace("{checked}", String(result.checked))
            .replace("{pastDue}", String(result.markedPastDue))
            .replace("{downgraded}", String(result.downgradedPastDue + result.canceledAtPeriodEnd + result.expiredTrials)),
        );
        return listAdminUsers(userFilters);
      })
      .then((response) => {
        setState((current) => {
          return {
            ...current,
            users: sectionReady(response.users),
          };
        });
      })
      .catch(() => {
        setRunMessage(t("admin.subscriptionReconcileFailed"));
      })
      .finally(() => {
        setIsReconcilingSubscriptions(false);
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
          {canManageUsers && (
            <Button
              variant="outline"
              onClick={reconcileSubscriptions}
              disabled={isReconcilingSubscriptions}
              className="h-10 rounded-lg border-slate-200"
            >
              <RefreshCw size={16} />
              {isReconcilingSubscriptions ? t("admin.reconcilingSubscriptions") : t("admin.reconcileSubscriptions")}
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

      {!isFullyFailedDashboard && state.marketingFunnel.status === "error" && (
        <AdminSectionStateCard
          action={load}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title="Marketing Funnel"
        />
      )}

      {!isFullyFailedDashboard && state.marketingFunnel.status === "loading" && !marketingFunnel && (
        <AdminSectionStateCard
          actionLabel={t("admin.refresh")}
          code="loading"
          message={t("admin.loading")}
          title="Marketing Funnel"
        />
      )}

      {!isFullyFailedDashboard && marketingFunnel && (
        <section id="data-sources" className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <Bell size={18} />
              Marketing Funnel
            </div>
            <a
              href="/api/admin/marketing/leads/export"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Download size={16} />
              Export leads CSV
            </a>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Request Demo" value={marketingFunnel.counts.requestDemoSubmitted} icon={Bell} />
            <SummaryCard label="Signup complete" value={marketingFunnel.counts.completeSignup} icon={UserCog} />
            <SummaryCard label="Profile started" value={marketingFunnel.counts.startSupplierProfile} icon={Activity} />
            <SummaryCard label="Profile complete" value={marketingFunnel.counts.completeSupplierProfile} icon={ShieldCheck} />
            <SummaryCard label="First matched bid" value={marketingFunnel.counts.firstMatchedBidViewed} icon={Search} />
          </div>
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="text-sm font-black text-slate-950">Latest request-demo leads</div>
            {marketingFunnel.latestRequestDemoLeads.length === 0 ? (
              <div className="mt-2 text-sm font-medium text-slate-500">No request-demo leads recorded yet.</div>
            ) : (
              <div className="mt-3 grid gap-2">
                {marketingFunnel.latestRequestDemoLeads.map((lead) => (
                  <div
                    key={lead.eventId}
                    className="grid gap-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm md:grid-cols-[1fr_auto]"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{lead.companyName ?? lead.email ?? lead.eventId}</div>
                      <div className="text-slate-500">{lead.email ?? "-"}</div>
                    </div>
                    <div className="text-xs font-medium text-slate-500">{formatDate(lead.occurredAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {!isFullyFailedDashboard && state.risk.status === "error" && (
        <AdminSectionStateCard
          action={() => refreshRiskReport()}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.riskCheck")}
        />
      )}

      {!isFullyFailedDashboard && state.risk.status === "loading" && !state.risk.data && (
        <AdminSectionStateCard
          actionLabel={t("admin.refresh")}
          code="loading"
          message={t("admin.loading")}
          title={t("admin.riskCheck")}
        />
      )}

      {!isFullyFailedDashboard && riskReport && riskTrend && (
        <RiskCheck
          history={riskHistory}
          isRefreshing={isRefreshingRiskReport}
          onExport={exportRiskReport}
          onRefresh={refreshRiskReport}
          report={riskReport}
          stateDataQuality={stateDataQuality}
          t={t}
          trend={riskTrend}
        />
      )}

      {canManageConfig && !isFullyFailedDashboard && (
        <ConfigRegistrySection
          configEntries={configEntries}
          configEditDrafts={configEditDrafts}
          isError={configRegistryStatus.status === "error"}
          isLoading={configRegistryStatus.status === "loading"}
          savingConfigEntryId={savingConfigEntryId}
          onDraftChange={updateConfigEditDraft}
          onRefresh={refreshConfigRegistry}
          onSave={handleConfigRegistrySave}
        />
      )}

      {!isFullyFailedDashboard && state.bidQa.status === "error" && (
        <AdminSectionStateCard
          action={() => void refreshBidQa().catch(() => undefined)}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.bidQa")}
        />
      )}

      {!isFullyFailedDashboard && state.bidQa.status === "loading" && !state.bidQa.data && (
        <AdminSectionStateCard
          actionLabel={t("admin.refresh")}
          code="loading"
          message={t("admin.loading")}
          title={t("admin.bidQa")}
        />
      )}

      {!isFullyFailedDashboard && bidQa && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <Database size={18} />
              {t("admin.bidQa")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                {t("admin.needsReview")}: {bidQa.summary.needsReview}
              </Badge>
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                {t("admin.archiveIssues")}: {bidQa.summary.archiveIssues}
              </Badge>
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                {t("admin.lowQuality")}: {bidQa.summary.lowQuality}
              </Badge>
            </div>
          </div>
          <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3 lg:grid-cols-[minmax(180px,1fr)_90px_150px_150px_130px_100px_100px_140px_140px_auto]">
            <div className="lg:col-span-10 text-xs font-semibold uppercase text-slate-500">{t("admin.qaFilters")}</div>
            <Input
              value={bidQaFilters.q}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder={t("admin.searchBidQa")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              value={bidQaFilters.stateCode}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, stateCode: event.target.value }))}
              placeholder={t("admin.state")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <select
              value={bidQaFilters.reviewStatus}
              onChange={(event) =>
                updateBidQaFilters((current) => ({ ...current, reviewStatus: event.target.value as BidQaFilters["reviewStatus"] }))
              }
              aria-label={t("admin.status")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allReviewStatuses")}</option>
              {(["unreviewed", "needs_review", "reviewed", "suppressed"] as AdminBidQaReviewStatus[]).map((status) => (
                <option key={status} value={status}>{reviewStatusLabel(t, status)}</option>
              ))}
            </select>
            <select
              value={bidQaFilters.displayStatus}
              onChange={(event) =>
                updateBidQaFilters((current) => ({ ...current, displayStatus: event.target.value as BidQaFilters["displayStatus"] }))
              }
              aria-label={t("admin.displayStatus")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allDisplayStatuses")}</option>
              {(["pending_qa", "published", "suppressed"] as AdminBidQaDisplayStatus[]).map((status) => (
                <option key={status} value={status}>{displayStatusLabel(t, status)}</option>
              ))}
            </select>
            <select
              value={bidQaFilters.sourceConfidence}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, sourceConfidence: event.target.value }))}
              aria-label={t("admin.sourceConfidence")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allConfidence")}</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <Input
              type="number"
              min="0"
              max="100"
              value={bidQaFilters.minQualityScore}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, minQualityScore: event.target.value }))}
              placeholder={t("admin.minScore")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              type="number"
              min="0"
              max="100"
              value={bidQaFilters.maxQualityScore}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, maxQualityScore: event.target.value }))}
              placeholder={t("admin.maxScore")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              value={bidQaFilters.reviewerId}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, reviewerId: event.target.value }))}
              placeholder={t("admin.reviewer")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              type="date"
              value={bidQaFilters.reviewedFrom}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, reviewedFrom: event.target.value }))}
              aria-label={t("admin.reviewedFrom")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Input
              type="date"
              value={bidQaFilters.reviewedTo}
              onChange={(event) => updateBidQaFilters((current) => ({ ...current, reviewedTo: event.target.value }))}
              aria-label={t("admin.reviewedTo")}
              className="h-9 rounded-lg border-slate-200 bg-white"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => updateBidQaFilters(() => DEFAULT_BID_QA_FILTERS)}
              className="h-9 rounded-lg px-3 text-slate-600"
            >
              {t("admin.clearAuditFilters")}
            </Button>
          </div>
          {canRunOperations && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="text-sm font-medium text-slate-600">
                {t("admin.selectedQaItems").replace("{count}", String(visibleSelectedBidQaIds.length))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchReviewBidQa("reviewed")} className="h-8 rounded-lg border-slate-200 px-2">
                  {t("admin.batchReview")}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchReviewBidQa("needs_review")} className="h-8 rounded-lg border-slate-200 px-2">
                  {t("admin.batchNeedsReview")}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchDisplayBidQa("published")} className="h-8 rounded-lg border-slate-200 px-2">
                  {t("admin.batchPublish")}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={pendingBidQaBatch || visibleSelectedBidQaIds.length === 0} onClick={() => batchDisplayBidQa("suppressed")} className="h-8 rounded-lg px-2 text-slate-600">
                  {t("admin.batchSuppress")}
                </Button>
              </div>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {canRunOperations && (
                  <TableHead>
                    <input
                      type="checkbox"
                      checked={allVisibleBidQaSelected}
                      onChange={toggleAllVisibleBidQa}
                      aria-label={t("admin.selectAllQaItems")}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </TableHead>
                )}
                <TableHead>{t("admin.bid")}</TableHead>
                <TableHead>{t("admin.source")}</TableHead>
                <TableHead>{t("admin.qualityScore")}</TableHead>
                <TableHead>{t("admin.archiveIssues")}</TableHead>
                <TableHead>{t("admin.correctionCount")}</TableHead>
                <TableHead>{t("admin.status")}</TableHead>
                <TableHead>{t("admin.displayStatus")}</TableHead>
                <TableHead>{t("bid.deadline")}</TableHead>
                {canRunOperations && <TableHead className="text-right">{t("admin.review")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bidQaItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canRunOperations ? 10 : 8} className="py-6 text-center text-sm text-slate-500">
                    {t("admin.noBidQaItems")}
                  </TableCell>
                </TableRow>
              )}
              {bidQaItems.map((item) => {
                const correctionDraft = bidQaCorrectionDraftFor(item, correctionDrafts);
                const isPending = pendingBidQaId === item.id;

                return (
                  <TableRow key={item.id}>
                    {canRunOperations && (
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedBidQaIds.includes(item.id)}
                          onChange={() => toggleSelectedBidQaId(item.id)}
                          aria-label={t("admin.selectQaItem").replace("{title}", item.title)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="max-w-80 truncate font-medium text-slate-900" title={item.title}>
                        {item.title}
                      </div>
                      {canRunOperations && (
                        <div className="mt-2 grid max-w-80 gap-2">
                          <Input
                            value={correctionDraft.title}
                            onChange={(event) =>
                              setCorrectionDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...bidQaCorrectionDraftFor(item, current),
                                  title: event.target.value,
                                },
                              }))
                            }
                            aria-label={`${t("admin.bid")} ${t("admin.saveCorrections")}`}
                            className="h-8 rounded-lg border-slate-200 bg-white text-xs"
                          />
                          <Input
                            type="date"
                            value={correctionDraft.deadlineDate}
                            onChange={(event) =>
                              setCorrectionDrafts((current) => ({
                                ...current,
                                [item.id]: {
                                  ...bidQaCorrectionDraftFor(item, current),
                                  deadlineDate: event.target.value,
                                },
                              }))
                            }
                            aria-label={`${t("bid.deadline")} ${t("admin.saveCorrections")}`}
                            className="h-8 rounded-lg border-slate-200 bg-white text-xs"
                          />
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.qualityFlags.slice(0, 3).map((flag) => (
                          <Badge key={flag} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-slate-700">{item.source}</div>
                      <div className="text-xs text-slate-500">{item.stateCode}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={qualityTone(item.qualityScore)}>
                        {item.qualityScore}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className={item.archiveIssueCount > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                          {item.archiveIssueCount}
                        </Badge>
                        {item.detailArchiveError && (
                          <span className="max-w-44 truncate text-xs text-rose-700" title={item.detailArchiveError}>
                            {compactErrorMessage(item.detailArchiveError)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={item.correctionCount > 0 ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-50 text-slate-600"}>
                        {item.correctionCount}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={reviewTone(item.adminReviewStatus)}>
                        {reviewStatusLabel(t, item.adminReviewStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={displayStatusTone(item.displayStatus)}>
                        {displayStatusLabel(t, item.displayStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(item.deadlineDate)}</TableCell>
                    {canRunOperations && (
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => loadCorrectionHistory(item)}
                            disabled={isLoadingCorrectionHistory && correctionHistoryBidId === item.id}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.correctionHistory")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => saveBidQaCorrections(item)}
                            disabled={isPending || correctionDraft.title.trim().length === 0}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.saveCorrections")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateBidQaDisplayStatus(item, "published")}
                            disabled={isPending || item.displayStatus === "published"}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.publishBid")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateBidQaDisplayStatus(item, "suppressed")}
                            disabled={isPending || item.displayStatus === "suppressed"}
                            className="h-8 rounded-lg px-2 text-slate-600"
                          >
                            {t("admin.suppressBid")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateBidQaStatus(item, "reviewed")}
                            disabled={isPending}
                            className="h-8 rounded-lg border-slate-200 px-2"
                          >
                            {t("admin.markReviewed")}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateBidQaStatus(item, "needs_review")}
                            disabled={isPending}
                            className="h-8 rounded-lg px-2 text-slate-600"
                          >
                            {t("admin.markNeedsReview")}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {correctionHistoryBidId && (
            <div className="border-t border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-950">{t("admin.correctionHistory")}</div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCorrectionHistoryBidId(null)} className="h-8 rounded-lg px-2 text-slate-600">
                  {t("admin.close")}
                </Button>
              </div>
              {isLoadingCorrectionHistory ? (
                <div className="mt-3 text-sm text-slate-500">{t("admin.loading")}</div>
              ) : correctionHistoryItems.length === 0 ? (
                <div className="mt-3 text-sm text-slate-500">{t("admin.noCorrectionHistory")}</div>
              ) : (
                <div className="mt-3 grid gap-2">
                  {correctionHistoryItems.map((correction) => (
                    <div key={correction.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{correction.fieldName}</span>
                        <span className="text-xs text-slate-500">{formatDate(correction.correctedAt)}</span>
                        <span className="text-xs text-slate-500">{correction.correctedBy}</span>
                      </div>
                      <div className="mt-1 grid gap-1 text-xs text-slate-600 md:grid-cols-2">
                        <div>{t("admin.originalValue")}: {correction.originalValue ?? "-"}</div>
                        <div>{t("admin.correctedValue")}: {correction.correctedValue ?? "-"}</div>
                      </div>
                      {correction.note && <div className="mt-1 text-xs text-slate-500">{correction.note}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {!isFullyFailedDashboard && canManageUsers && state.users.status === "error" && (
        <AdminSectionStateCard
          action={() => void refreshUsers().catch(() => undefined)}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.users")}
        />
      )}

      {!isFullyFailedDashboard && canManageUsers && state.users.status === "loading" && state.users.data.length === 0 && (
        <AdminSectionStateCard
          actionLabel={t("admin.refresh")}
          code="loading"
          message={t("admin.loading")}
          title={t("admin.users")}
        />
      )}

      {!isFullyFailedDashboard && state.users.status === "ready" && canManageUsers && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <UserCog size={18} />
              {t("admin.users")}
            </div>
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
              {users.length}
            </Badge>
          </div>
          <form
            onSubmit={handleCreateAdminUser}
            className="grid gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-4 lg:grid-cols-[minmax(180px,1.2fr)_minmax(160px,1fr)_140px_150px_auto]"
          >
            <div className="lg:col-span-5">
              <p className="text-sm font-semibold text-slate-950">{t("admin.inviteUser")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{t("admin.inviteDescription")}</p>
            </div>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              {t("admin.email")}
              <Input
                type="email"
                value={invitationDraft.email}
                onChange={(event) =>
                  setInvitationDraft((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="buyer@example.com"
                className="h-9 rounded-lg border-slate-200 bg-white"
                required
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              {t("admin.displayName")}
              <Input
                value={invitationDraft.displayName}
                onChange={(event) =>
                  setInvitationDraft((current) => ({ ...current, displayName: event.target.value }))
                }
                className="h-9 rounded-lg border-slate-200 bg-white"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              {t("admin.role")}
              <select
                value={invitationDraft.role}
                onChange={(event) =>
                  setInvitationDraft((current) => ({ ...current, role: event.target.value as UserRole }))
                }
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
              >
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`admin.role_${role}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
              {t("admin.tier")}
              <select
                value={invitationDraft.tier}
                onChange={(event) =>
                  setInvitationDraft((current) => ({ ...current, tier: event.target.value as AccountTier }))
                }
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
              >
                {ACCOUNT_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {t(`admin.tier_${tier}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={isInvitingUser || invitationDraft.email.trim().length === 0}
                className="h-9 rounded-lg bg-slate-900 px-3 text-white hover:bg-slate-800"
              >
                {isInvitingUser ? t("admin.creatingInvite") : t("admin.createInvite")}
              </Button>
            </div>
            {(invitedTemporaryPassword || inviteError) && (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm lg:col-span-5">
                {invitedTemporaryPassword ? (
                  <div>
                    <span className="font-semibold text-slate-950">{t("admin.temporaryPassword")}:</span>{" "}
                    <code className="rounded-md bg-slate-100 px-2 py-1 font-mono text-slate-800">
                      {invitedTemporaryPassword}
                    </code>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{t("admin.temporaryPasswordHelp")}</p>
                  </div>
                ) : (
                  <span className="font-medium text-rose-700">{inviteError}</span>
                )}
              </div>
            )}
          </form>
          <div className="grid gap-3 border-b border-slate-100 px-4 py-3 md:grid-cols-[minmax(220px,1fr)_160px_160px_160px]">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={userFilters.q ?? ""}
                onChange={(event) => setUserFilters((current) => ({ ...current, q: event.target.value || undefined }))}
                placeholder={t("admin.searchUsers")}
                className="h-9 rounded-lg border-slate-200 pl-9"
              />
            </div>
            <select
              value={userFilters.role ?? "all"}
              onChange={(event) =>
                setUserFilters((current) => ({
                  ...current,
                  role: event.target.value === "all" ? undefined : event.target.value as UserRole,
                }))
              }
              aria-label={t("admin.role")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allRoles")}</option>
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`admin.role_${role}`)}
                </option>
              ))}
            </select>
            <select
              value={userFilters.tier ?? "all"}
              onChange={(event) =>
                setUserFilters((current) => ({
                  ...current,
                  tier: event.target.value === "all" ? undefined : event.target.value as AccountTier,
                }))
              }
              aria-label={t("admin.tier")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allTiers")}</option>
              {ACCOUNT_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {t(`admin.tier_${tier}`)}
                </option>
              ))}
            </select>
            <select
              value={userFilters.status ?? "all"}
              onChange={(event) =>
                setUserFilters((current) => ({
                  ...current,
                  status: event.target.value === "all" ? undefined : event.target.value as AdminUserFilterStatus,
                }))
              }
              aria-label={t("admin.status")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allStatuses")}</option>
              <option value="enabled">{t("admin.enabled")}</option>
              <option value="disabled">{t("admin.disabled")}</option>
            </select>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.account")}</TableHead>
                <TableHead>{t("admin.role")}</TableHead>
                <TableHead>{t("admin.tier")}</TableHead>
                <TableHead>{t("admin.lastLogin")}</TableHead>
                <TableHead>{t("admin.featureOverrides")}</TableHead>
                <TableHead className="text-right">{t("admin.enabled")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-slate-500">
                    {t("admin.noUsers")}
                  </TableCell>
                </TableRow>
              )}
              {users.map((user) => {
                const isPending = pendingUserId === user.id;

                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{user.displayName || user.email || user.id}</div>
                      <div className="text-xs text-slate-500">{user.email ?? user.id}</div>
                    </TableCell>
                    <TableCell>
                      <select
                        value={user.role}
                        disabled={isPending}
                        onChange={(event) => updateUserAccess(user, { role: event.target.value as UserRole })}
                        aria-label={t("admin.role")}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      >
                        {USER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t(`admin.role_${role}`)}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <select
                        value={user.tier}
                        disabled={isPending}
                        onChange={(event) => updateUserAccess(user, { tier: event.target.value as AccountTier })}
                        aria-label={t("admin.tier")}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      >
                        {ACCOUNT_TIERS.map((tier) => (
                          <option key={tier} value={tier}>
                            {t(`admin.tier_${tier}`)}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>{formatDate(user.lastLoginAt)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openFeatureOverrides(user)}
                        disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride}
                        className="h-8 rounded-lg border-slate-200 px-2"
                      >
                        {t("admin.manageFeatureOverrides")}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Label htmlFor={`user-${user.id}`} className="text-xs font-medium text-slate-500">
                          {user.isDisabled ? t("admin.disabled") : t("admin.enabled")}
                        </Label>
                        <Switch
                          id={`user-${user.id}`}
                          checked={!user.isDisabled}
                          disabled={isPending}
                          onCheckedChange={(checked) => updateUserAccess(user, { isDisabled: !checked })}
                          className="data-checked:bg-slate-900"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {featureOverrideUser && (
            <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-4 lg:grid-cols-[minmax(220px,1fr)_220px_180px_180px_auto] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-slate-950">{t("admin.featureOverrides")}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {t("admin.featureOverrideDescription").replace(
                    "{account}",
                    featureOverrideUser.email ?? featureOverrideUser.id,
                  )}
                </p>
                {featureOverrideData && (
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {t("admin.organization")}: {featureOverrideData.organizationName}
                  </p>
                )}
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
                {t("admin.feature")}
                <select
                  value={featureOverrideFeature}
                  onChange={(event) => {
                    const feature = event.target.value as FeatureKey;

                    setFeatureOverrideFeature(feature);
                    syncFeatureOverrideForm(featureOverrideData, feature);
                  }}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
                >
                  {OVERRIDABLE_FEATURES.map((feature) => (
                    <option key={feature} value={feature}>
                      {t(`admin.feature_${feature}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                  {selectedFeatureOverride
                    ? selectedFeatureOverride.isEnabled
                      ? t("admin.overrideEnabled")
                      : t("admin.overrideDisabled")
                    : t("admin.overrideDefault")}
                </Badge>
                {selectedFeatureOverride?.isExpired && (
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                    {t("admin.overrideExpired")}
                  </Badge>
                )}
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
                {t("admin.overrideReason")}
                <Input
                  value={featureOverrideReason}
                  onChange={(event) => setFeatureOverrideReason(event.target.value)}
                  placeholder={t("admin.overrideReasonPlaceholder")}
                  className="h-9 rounded-lg border-slate-200 bg-white"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
                {t("admin.overrideExpiresAt")}
                <Input
                  type="date"
                  value={featureOverrideExpiresAt}
                  onChange={(event) => setFeatureOverrideExpiresAt(event.target.value)}
                  className="h-9 rounded-lg border-slate-200 bg-white"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveFeatureOverride(true)}
                  disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride}
                  className="h-9 rounded-lg border-slate-200 px-3"
                >
                  {t("admin.enableOverride")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveFeatureOverride(false)}
                  disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride}
                  className="h-9 rounded-lg border-slate-200 px-3"
                >
                  {t("admin.disableOverride")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => saveFeatureOverride(null)}
                  disabled={isLoadingFeatureOverrides || isUpdatingFeatureOverride}
                  className="h-9 rounded-lg px-3 text-slate-600"
                >
                  {t("admin.clearOverride")}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {!isFullyFailedDashboard && state.notifications.status === "error" && (
        <AdminSectionStateCard
          action={() => void refreshNotifications().catch(() => undefined)}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.notificationDelivery")}
        />
      )}

      {!isFullyFailedDashboard && state.notifications.status === "loading" && state.notifications.data.length === 0 && (
        <AdminSectionStateCard
          actionLabel={t("admin.refresh")}
          code="loading"
          message={t("admin.loading")}
          title={t("admin.notificationDelivery")}
        />
      )}

      {!isFullyFailedDashboard && state.notifications.status === "ready" && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <Bell size={18} />
              {t("admin.notificationDelivery")}
            </div>
            {canRunOperations && (
              <Button
                type="button"
                variant="outline"
                onClick={deliverNotifications}
                disabled={isDeliveringNotifications}
                className="h-9 rounded-lg border-slate-200 px-3"
              >
                <Play size={14} />
                {isDeliveringNotifications ? t("admin.deliveringNotifications") : t("admin.deliverNotifications")}
              </Button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {notifications.length === 0 && (
              <div className="px-4 py-5 text-sm text-slate-500">{t("admin.noNotifications")}</div>
            )}
            {notifications.map((notification) => (
              <div key={notification.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{notification.recipient}</span>
                    <Badge variant="outline" className={statusTone(notification.status)}>
                      {t(`admin.notificationStatus_${notification.status}`)}
                    </Badge>
                    <span className="text-xs text-slate-500">{formatDate(notification.sentAt ?? notification.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{notification.subject}</div>
                  {notification.lastError && (
                    <div className="mt-1 text-sm text-rose-700">{compactErrorMessage(notification.lastError)}</div>
                  )}
                </div>
                <div className="text-xs font-medium text-slate-500">
                  {t("admin.notificationAttempts").replace("{count}", String(notification.attemptCount))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isFullyFailedDashboard && canManageUsers && state.userAuditLogs.status === "error" && (
        <AdminSectionStateCard
          action={() => void refreshUserAuditLogs().catch(() => undefined)}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.userAuditLogs")}
        />
      )}

      {!isFullyFailedDashboard &&
        canManageUsers &&
        state.userAuditLogs.status === "loading" &&
        state.userAuditLogs.data.length === 0 && (
          <AdminSectionStateCard
            actionLabel={t("admin.refresh")}
            code="loading"
            message={t("admin.loading")}
            title={t("admin.userAuditLogs")}
          />
        )}

      {!isFullyFailedDashboard && state.userAuditLogs.status === "ready" && canManageUsers && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold text-slate-950">
            <History size={18} />
            {t("admin.userAuditLogs")}
          </div>
          <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_160px_180px_190px_auto]">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={userAuditFilters.target ?? ""}
                onChange={(event) =>
                  setUserAuditFilters((current) => ({ ...current, target: event.target.value || undefined }))
                }
                placeholder={t("admin.auditFilterTarget")}
                className="h-9 rounded-lg border-slate-200 pl-9"
              />
            </div>
            <select
              value={userAuditFilters.actorKind ?? "all"}
              onChange={(event) =>
                setUserAuditFilters((current) => ({
                  ...current,
                  actorKind: event.target.value === "all" ? undefined : event.target.value as AdminUserAuditActorKind,
                }))
              }
              aria-label={t("admin.allAuditActors")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allAuditActors")}</option>
              {AUDIT_ACTOR_KINDS.map((actorKind) => (
                <option key={actorKind} value={actorKind}>
                  {t(`admin.auditActor_${actorKind.replace("-", "_")}`)}
                </option>
              ))}
            </select>
            <select
              value={userAuditFilters.action ?? "all"}
              onChange={(event) =>
                setUserAuditFilters((current) => ({
                  ...current,
                  action: event.target.value === "all" ? undefined : event.target.value as AdminUserAuditAction,
                }))
              }
              aria-label={t("admin.allAuditActions")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allAuditActions")}</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(`admin.auditAction_${action}`)}
                </option>
              ))}
            </select>
            <select
              value={userAuditFilters.featureKey ?? "all"}
              onChange={(event) =>
                setUserAuditFilters((current) => ({
                  ...current,
                  featureKey: event.target.value === "all" ? undefined : event.target.value as FeatureKey,
                }))
              }
              aria-label={t("admin.auditFilterFeature")}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="all">{t("admin.allAuditFeatures")}</option>
              {OVERRIDABLE_FEATURES.map((feature) => (
                <option key={feature} value={feature}>
                  {t(`admin.feature_${feature}`)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setUserAuditFilters({})}
              className="h-9 rounded-lg px-3 text-slate-600"
            >
              {t("admin.clearAuditFilters")}
            </Button>
          </div>
          <div className="divide-y divide-slate-100">
            {userAuditLogs.length === 0 && (
              <div className="px-4 py-5 text-sm text-slate-500">{t("admin.noUserAuditLogs")}</div>
            )}
            {userAuditLogs.map((log) => (
              <div key={log.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{log.targetEmail ?? log.targetUserId}</span>
                    <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                      {log.actorKind}
                    </Badge>
                    <span className="text-xs text-slate-500">{formatDate(log.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{formatAuditChanges(log)}</div>
                </div>
                <div className="text-xs font-medium text-slate-500">{log.action}</div>
              </div>
            ))}
          </div>
        </section>
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
          {/* No onCompleted → load(): a full section refresh flips dataSources to "loading",
              unmounting this panel and wiping the per-source batch report the admin is reading.
              The sources table refreshes via the header Refresh button instead. */}
          {canRunOperations && (
            <JurisdictionBatchRunPanel
              sources={allSources}
              crawlerSourceIdFor={stateCrawlerSourceIdFor}
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
              {sources.map((source) => {
                const liveHealth = source.latestLiveHealth;
                const healthTrend = source.sourceHealthTrend;
                const liveHealthTriage = source as SourceHealthTriageFields;
                const triageStatus = sourceHealthTriageStatus(liveHealthTriage);
                const liveHealthCode = liveHealth?.statusCode ?? liveHealth?.httpStatus ?? null;
                const liveHealthErrorMessage = liveHealth?.error ?? liveHealth?.errorMessage ?? null;

                return (
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
                    <div className="font-medium text-slate-900">{source.label}</div>
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
                    <div className="mt-2 max-w-64 rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-600">
                      <div className="font-semibold text-slate-700">{t("admin.complianceLedger")}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className={robotsTxtTone(source.robotsTxtStatus)}>
                          {robotsTxtStatusLabel(t, source.robotsTxtStatus)}
                        </Badge>
                        <Badge variant="outline" className={tosReviewedTone(source.tosReviewed)}>
                          {source.tosReviewed ? t("admin.tosReviewed_yes") : t("admin.tosReviewed_no")}
                        </Badge>
                      </div>
                      {source.robotsTxtFlagReason && (
                        <div className="mt-1 truncate text-amber-700" title={source.robotsTxtFlagReason}>
                          {source.robotsTxtFlagReason}
                        </div>
                      )}
                      {source.complianceReviewer && (
                        <div className="mt-1 truncate" title={source.complianceReviewer}>
                          {t("admin.complianceReviewer")}: {source.complianceReviewer}
                        </div>
                      )}
                      {source.legalOpinionReference && (
                        <div className="mt-1 truncate" title={source.legalOpinionReference}>
                          {t("admin.legalOpinionReference")}: {source.legalOpinionReference}
                        </div>
                      )}
                      {source.complianceReviewDueAt && (
                        <div className="mt-1">
                          {t("admin.complianceReviewDue")}: {formatDate(source.complianceReviewDueAt)}
                        </div>
                      )}
                    </div>
                    {source.approvalHistory.length > 0 && (
                      <div className="mt-2 max-w-64 rounded-md border border-slate-200 bg-slate-50/70 p-2 text-xs leading-5 text-slate-600">
                        <div className="font-semibold text-slate-700">{t("admin.sourceApprovalHistory")}</div>
                        {source.approvalHistory.slice(0, 2).map((event) => (
                          <div key={event.id} className="mt-1">
                            <span className="font-medium">{sourceApprovalActionLabel(t, event.action)}</span>
                            {" · "}
                            <span>{formatDate(event.createdAt)}</span>
                            {event.actorUserId ? (
                              <>
                                {" · "}
                                <span>{t("admin.sourceApprovalActor").replace("{actor}", event.actorUserId)}</span>
                              </>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                    {canManageUsers && (
                      <div className="mt-2 flex max-w-64 flex-wrap gap-2">
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
                      <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-600">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-700">{t("admin.liveSourceHealth")}</span>
                          <Badge variant="outline" className={liveSourceHealthTone(liveHealth?.status)}>
                            {liveSourceHealthLabel(t, liveHealth?.status)}
                          </Badge>
                          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                            {sourceHealthClassificationLabel(t, sourceHealthClassificationFor(source))}
                          </Badge>
                        </div>
                        {liveHealth ? (
                          <>
                            <div className="mt-1 text-slate-500">
                              {t("admin.liveSourceCheckedAt").replace("{time}", formatDate(liveHealth.checkedAt))}
                              {liveHealthCode ? ` · HTTP ${liveHealthCode}` : ""}
                              {liveHealth?.latencyMs !== null && liveHealth?.latencyMs !== undefined
                                ? ` · ${liveHealth.latencyMs} ms`
                                : ""}
                            </div>
                            {liveHealthErrorMessage && (
                              <div className="mt-1 text-rose-700">
                                {compactErrorMessage(liveHealthErrorMessage)}
                              </div>
                            )}
                            {liveHealth.reason && (
                              <div className="mt-1 text-slate-600">
                                {compactErrorMessage(liveHealth.reason)}
                              </div>
                            )}
                            {liveHealth.evidenceSnippets.length > 0 && (
                              <div className="mt-1 text-slate-500">
                                {liveHealth.evidenceSnippets.slice(0, 2).map((snippet) => (
                                  <div key={snippet}>{compactErrorMessage(snippet)}</div>
                                ))}
                              </div>
                            )}
                            {liveHealth?.recommendedAction && liveHealth.recommendedAction !== "none" && (
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-slate-600">
                                <span className="font-medium">{t("admin.liveSourceRecommendedAction")}:</span>
                                <span>{liveSourceRecommendedActionLabel(t, liveHealth?.recommendedAction)}</span>
                                <Badge
                                  variant="outline"
                                  className={liveSourceOperationalSeverityTone(liveHealth?.operationalSeverity)}
                                >
                                  {liveHealth?.operationalSeverity}
                                </Badge>
                              </div>
                            )}
                            {healthTrend && (
                              <div className="mt-2 rounded border border-slate-100 bg-slate-50 px-2 py-1">
                                <div className="font-medium text-slate-700">{t("admin.liveSourceHealthTrend")}</div>
                                <div className="mt-1 text-slate-500">
                                  {t("admin.liveSourceHealthTrendSummary")
                                    .replace("{sampleSize}", String(healthTrend.sampleSize))
                                    .replace("{healthyPercent}", String(healthTrend.healthyPercent))}
                                </div>
                                <div className="mt-1 text-slate-500">
                                  {t("admin.liveSourceHealthCurrentStreak")
                                    .replace("{status}", liveSourceTrendStatusLabel(t, healthTrend.currentStatus))
                                    .replace("{count}", String(healthTrend.currentStreak))}
                                </div>
                                {healthTrend.lastUnhealthyAt && (
                                  <div className="mt-1 text-rose-700">
                                    {t("admin.liveSourceHealthLastUnhealthy").replace(
                                      "{time}",
                                      formatDate(healthTrend.lastUnhealthyAt),
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="mt-1 text-slate-500">{t("admin.liveSourceHealthNoCheck")}</div>
                        )}
                        <div className="mt-2 rounded border border-slate-100 bg-slate-50 px-2 py-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-slate-700">{t("admin.sourceHealthTriage")}</span>
                            <Badge variant="outline" className={sourceHealthTriageTone(triageStatus)}>
                              {sourceHealthTriageLabel(t, triageStatus)}
                            </Badge>
                          </div>
                          <div className="mt-1 grid gap-1 text-slate-500">
                            <div>
                              <span className="font-medium text-slate-600">{t("admin.sourceHealthOwner")}:</span>{" "}
                              {liveHealthTriage.liveHealthOwner ?? t("admin.sourceHealthTriage_unassigned")}
                            </div>
                            <div>
                              <span className="font-medium text-slate-600">{t("admin.sourceHealthDisposition")}:</span>{" "}
                              {sourceHealthDispositionLabel(t, liveHealthTriage.liveHealthDisposition)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-600">{t("admin.sourceHealthNextReview")}:</span>{" "}
                              {formatDate(liveHealthTriage.liveHealthNextReviewAt ?? null)}
                            </div>
                            {liveHealthTriage.liveHealthReviewedAt && (
                              <div>
                                <span className="font-medium text-slate-600">
                                  {t("admin.sourceHealthReviewedAt")}:
                                </span>{" "}
                                {formatDate(liveHealthTriage.liveHealthReviewedAt)}
                              </div>
                            )}
                            {liveHealthTriage.liveHealthNotes && (
                              <div className="text-slate-600">
                                <span className="font-medium">{t("admin.sourceHealthNotes")}:</span>{" "}
                                {compactErrorMessage(liveHealthTriage.liveHealthNotes)}
                              </div>
                            )}
                          </div>
                          {canRunOperations && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(
                                [
                                  ["assign", "sourceHealthTriageAssign"],
                                  ["accepted_fallback", "sourceHealthTriageAcceptFallback"],
                                  ["manual", "sourceHealthTriageManual"],
                                  ["vendor_account", "sourceHealthTriageVendorAccount"],
                                  ["clear", "sourceHealthTriageClear"],
                                ] satisfies [SourceHealthTriageAction, string][]
                              ).map(([action, labelKey]) => (
                                <Button
                                  key={action}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => updateSourceHealthTriage(source, action)}
                                  disabled={sourceTriagePendingId === source.id}
                                  className="h-7 rounded-lg border-slate-200 px-2 text-xs"
                                >
                                  {sourceTriagePendingId === source.id ? t("common.saving") : t(`admin.${labelKey}`)}
                                </Button>
                              ))}
                            </div>
                          )}
                        </div>
                        {canRunOperations && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => recheckSourceHealth(source)}
                            disabled={sourceHealthPendingId === source.id}
                            className="mt-2 h-7 rounded-lg border-slate-200 px-2 text-xs"
                          >
                            {sourceHealthPendingId === source.id ? t("admin.recheckingSource") : t("admin.recheckSource")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {source.latestLog
                      ? `${source.latestLog.fetchedCount}/${source.latestLog.insertedCount}/${source.latestLog.updatedCount}/${source.latestLog.failedCount}`
                      : "-"}
                  </TableCell>
                  {canRunOperations && (
                    <TableCell className="text-right">
                      {stateCrawlerSourceIdFor(source) ? (
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
                );
              })}
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
              <div key={log.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{log.source}</span>
                    <Badge variant="outline" className={statusTone(log.status)}>
                      {log.status}
                    </Badge>
                    <span className="text-xs text-slate-500">{formatDate(log.finishedAt ?? log.startedAt)}</span>
                  </div>
                  {log.errorMessage && <div className="mt-1 text-sm text-rose-700">{log.errorMessage}</div>}
                  {log.fallbackSource && (
                    <div className="mt-1 text-sm text-amber-700">
                      <span className="font-medium">{t("admin.fallbackUsed")}</span>
                      {fallbackMessage(log) ? `: ${fallbackMessage(log)}` : null}
                    </div>
                  )}
                </div>
                <div className="text-sm text-slate-500">
                  {log.fetchedCount}/{log.insertedCount}/{log.updatedCount}/{log.failedCount}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
