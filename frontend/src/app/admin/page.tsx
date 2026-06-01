"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Database,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  batchUpdateAdminBidQaItems,
  createAdminUser,
  deliverAdminNotifications,
  getAdminRiskChecklist,
  getAdminBidQaCorrections,
  listAdminBidQaItems,
  listAdminCrawlerLogs,
  listAdminDataSources,
  listAdminNotifications,
  listAdminUserFeatureOverrides,
  listAdminUserAuditLogs,
  listAdminUsers,
  reconcileAdminSubscriptions,
  runStateCrawlersNow,
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
  type AdminDataSource,
  type AdminDataSourcesResponse,
  type AdminUserFeatureOverridesResponse,
  type AdminNotificationsResponse,
  type AdminRiskChecklistResponse,
  type AdminUserAuditLog,
  type AdminUserAuditAction,
  type AdminUserAuditActorKind,
  type AdminUserFilterStatus,
  type AdminUser,
  type UpdateAdminUserInput,
} from "@/lib/api/admin";
import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      data: AdminDataSourcesResponse;
      logs: AdminCrawlerLog[];
      bidQa: AdminBidQaResponse;
      riskReport: AdminRiskChecklistResponse["report"];
      users: AdminUser[];
      userAuditLogs: AdminUserAuditLog[];
      notifications: AdminNotificationsResponse["notifications"];
    };

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
const DEFAULT_INVITATION_DRAFT: InvitationDraft = {
  email: "",
  displayName: "",
  role: "user",
  tier: "free",
};

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
  return source.crawlerSourceId ?? stateCrawlerSourceIdForAdminSource(source);
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

function sourceApprovalTone(value: AdminDataSource["approvalStatus"]) {
  if (value === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
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

function riskCheckTone(ok: boolean) {
  return ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700";
}

function RiskCheck({
  report,
  t,
}: {
  report: AdminRiskChecklistResponse["report"];
  t: (key: string) => string;
}) {
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
        </div>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-5">
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
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-xs leading-5 text-slate-500">{t("admin.riskCheckNoIssues")}</div>
            )}
          </div>
        ))}
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

export default function AdminPage() {
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingBidQaId, setPendingBidQaId] = useState<string | null>(null);
  const [pendingBidQaBatch, setPendingBidQaBatch] = useState(false);
  const [bidQaFilters, setBidQaFilters] = useState<BidQaFilters>(DEFAULT_BID_QA_FILTERS);
  const [selectedBidQaIds, setSelectedBidQaIds] = useState<string[]>([]);
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
  const canRunOperations = isAdmin || isOperator;

  const auditLogRequest = useCallback(() => ({
    limit: 10,
    actorKind: userAuditFilters.actorKind,
    action: userAuditFilters.action,
    target: userAuditFilters.target?.trim() || undefined,
    featureKey: userAuditFilters.featureKey,
  }), [userAuditFilters]);

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

    setState({ status: "loading" });
    Promise.all([
      listAdminDataSources(),
      getAdminRiskChecklist(),
      listAdminCrawlerLogs(),
      listAdminBidQaItems(bidQaRequest()),
      canManageUsers ? listAdminUsers(userFilters) : Promise.resolve({ users: [] }),
      canManageUsers ? listAdminUserAuditLogs(auditLogRequest()) : Promise.resolve({ logs: [] }),
      listAdminNotifications({ limit: 10 }),
    ])
      .then(([data, riskResponse, logsResponse, bidQa, usersResponse, userAuditLogsResponse, notificationsResponse]) => {
        setState({
          status: "ready",
          data,
          riskReport: riskResponse.report,
          logs: logsResponse.logs,
          bidQa,
          users: usersResponse.users,
          userAuditLogs: userAuditLogsResponse.logs,
          notifications: notificationsResponse.notifications,
        });
      })
      .catch(() => {
        setState({ status: "error" });
      });
  }, [auditLogRequest, bidQaRequest, canAccessAdminConsole, canManageUsers, userFilters]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!canAccessAdminConsole) return;

    queueMicrotask(load);
  }, [canAccessAdminConsole, isAuthLoading, load]);

  const summary = state.status === "ready" ? state.data.summary : null;
  const riskReport = state.status === "ready" ? state.riskReport : null;
  const sources = state.status === "ready" ? state.data.sources : [];
  const logs = state.status === "ready" ? state.logs : [];
  const bidQa = state.status === "ready" ? state.bidQa : null;
  const bidQaItems = bidQa?.items ?? [];
  const visibleSelectedBidQaIds = selectedBidQaIds.filter((id) => bidQaItems.some((item) => item.id === id));
  const allVisibleBidQaSelected = bidQaItems.length > 0 && bidQaItems.every((item) => selectedBidQaIds.includes(item.id));
  const users = state.status === "ready" ? state.users : [];
  const userAuditLogs = state.status === "ready" ? state.userAuditLogs : [];
  const notifications = state.status === "ready" ? state.notifications : [];

  const toggleSource = (source: AdminDataSource) => {
    setPendingSourceId(source.id);
    updateAdminDataSource(source.id, { isEnabled: !source.isEnabled })
      .then(({ source: updated }) => {
        setState((current) => {
          if (current.status !== "ready") return current;

          return {
            ...current,
            data: {
              ...current.data,
              sources: current.data.sources.map((item) =>
                item.id === updated.id ? { ...item, isEnabled: updated.isEnabled, updatedAt: updated.updatedAt } : item,
              ),
              summary: {
                ...current.data.summary,
                enabledSources:
                  current.data.summary.enabledSources + (updated.isEnabled === source.isEnabled ? 0 : updated.isEnabled ? 1 : -1),
              },
            },
          };
        });
      })
      .catch(() => {
        setRunMessage(t("admin.updateFailed"));
      })
      .finally(() => {
        setPendingSourceId(null);
      });
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

  const refreshBidQa = () =>
    listAdminBidQaItems(bidQaRequest()).then((bidQa) => {
      setState((current) => {
        if (current.status !== "ready") return current;

        return {
          ...current,
          bidQa,
        };
      });
      setSelectedBidQaIds((current) => current.filter((id) => bidQa.items.some((item) => item.id === id)));
      return bidQa;
    });

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
          if (current.status !== "ready") return current;

          return {
            ...current,
            users: current.users.map((item) => (item.id === updated.id ? updated : item)),
          };
        });
        return listAdminUserAuditLogs(auditLogRequest());
      })
      .then((response) => {
        if (!response) return;

        setState((current) => {
          if (current.status !== "ready") return current;

          return {
            ...current,
            userAuditLogs: response.logs,
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
          if (current.status !== "ready") return current;

          return {
            ...current,
            userAuditLogs: response.logs,
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
          if (current.status !== "ready") return current;

          return {
            ...current,
            users: [...current.users, response.user],
          };
        });
        return listAdminUserAuditLogs(auditLogRequest());
      })
      .then((response) => {
        if (!response) return;

        setState((current) => {
          if (current.status !== "ready") return current;

          return {
            ...current,
            userAuditLogs: response.logs,
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
          if (current.status !== "ready") return current;

          return {
            ...current,
            notifications: response.notifications,
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
          if (current.status !== "ready") return current;

          return {
            ...current,
            users: response.users,
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
            disabled={state.status === "loading"}
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

      {state.status === "loading" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-7 w-12" />
            </div>
          ))}
        </div>
      )}

      {state.status === "error" && (
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

      {riskReport && <RiskCheck report={riskReport} t={t} />}

      {state.status === "ready" && bidQa && (
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

      {state.status === "ready" && canManageUsers && (
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

      {state.status === "ready" && (
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

      {state.status === "ready" && canManageUsers && (
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

      {state.status === "ready" && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <ServerCog size={18} />
              {t("admin.sources")}
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
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
              {sources.map((source) => (
                <TableRow key={source.id}>
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
                    {source.approvalNotes && (
                      <div className="mt-1 max-w-64 truncate text-xs text-slate-500" title={source.approvalNotes}>
                        {source.approvalNotes}
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
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {state.status === "ready" && (
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
