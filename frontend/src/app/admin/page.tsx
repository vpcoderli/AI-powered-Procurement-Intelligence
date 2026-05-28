"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
  createAdminUser,
  deliverAdminNotifications,
  listAdminCrawlerLogs,
  listAdminDataSources,
  listAdminNotifications,
  listAdminUserAuditLogs,
  listAdminUsers,
  reconcileAdminSubscriptions,
  runStateCrawlersNow,
  updateAdminDataSource,
  updateAdminUser as updateAdminUserAccess,
  type AdminCrawlerLog,
  type AdminDataSource,
  type AdminDataSourcesResponse,
  type AdminNotificationsResponse,
  type AdminUserAuditLog,
  type AdminUserFilterStatus,
  type AdminUser,
  type UpdateAdminUserInput,
} from "@/lib/api/admin";
import type { AccountTier, UserRole } from "@/server/auth/entitlements";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      data: AdminDataSourcesResponse;
      logs: AdminCrawlerLog[];
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

type InvitationDraft = {
  email: string;
  displayName: string;
  role: UserRole;
  tier: AccountTier;
};

const USER_ROLES: UserRole[] = ["user", "admin"];
const ACCOUNT_TIERS: AccountTier[] = ["free", "pro", "business", "enterprise"];
const DEFAULT_INVITATION_DRAFT: InvitationDraft = {
  email: "",
  displayName: "",
  role: "user",
  tier: "free",
};

function stateCrawlerSourceIdFor(source: AdminDataSource) {
  return stateCrawlerSourceIdForAdminSource(source);
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

function latestRunAt(source: AdminDataSource) {
  return source.latestLog?.finishedAt ?? source.latestLog?.startedAt ?? source.lastSuccessAt ?? source.lastFailureAt;
}

function statusTone(status: string | null | undefined) {
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "running" || status === "locked") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
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
    .map((change) => `${change.field}: ${String(change.before)} -> ${String(change.after)}`)
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

function AdminAccessState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  action?: {
    href: string;
    label: string;
  };
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-8">
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
          <Icon size={22} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-normal text-slate-950">{title}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
        {action ? (
          <Link
            href={action.href}
            className={buttonVariants({
              className: "mt-5 h-10 rounded-lg bg-slate-900 px-4 text-white hover:bg-slate-800",
            })}
          >
            {action.label}
          </Link>
        ) : null}
      </section>
    </main>
  );
}

export default function AdminPage() {
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [userFilters, setUserFilters] = useState<UserFilters>({});
  const [isRunning, setIsRunning] = useState(false);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [invitationDraft, setInvitationDraft] = useState<InvitationDraft>(DEFAULT_INVITATION_DRAFT);
  const [invitedTemporaryPassword, setInvitedTemporaryPassword] = useState<string | null>(null);
  const [isInvitingUser, setIsInvitingUser] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isDeliveringNotifications, setIsDeliveringNotifications] = useState(false);
  const [isReconcilingSubscriptions, setIsReconcilingSubscriptions] = useState(false);
  const isAdmin = user?.role === "admin";

  const load = useCallback(() => {
    if (!isAdmin) return;

    setState({ status: "loading" });
    Promise.all([
      listAdminDataSources(),
      listAdminCrawlerLogs(),
      listAdminUsers(userFilters),
      listAdminUserAuditLogs({ limit: 10 }),
      listAdminNotifications({ limit: 10 }),
    ])
      .then(([data, logsResponse, usersResponse, userAuditLogsResponse, notificationsResponse]) => {
        setState({
          status: "ready",
          data,
          logs: logsResponse.logs,
          users: usersResponse.users,
          userAuditLogs: userAuditLogsResponse.logs,
          notifications: notificationsResponse.notifications,
        });
      })
      .catch(() => {
        setState({ status: "error" });
      });
  }, [isAdmin, userFilters]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (!isAdmin) return;

    queueMicrotask(load);
  }, [isAdmin, isAuthLoading, load]);

  const summary = state.status === "ready" ? state.data.summary : null;
  const sources = state.status === "ready" ? state.data.sources : [];
  const logs = state.status === "ready" ? state.logs : [];
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
        return listAdminUserAuditLogs({ limit: 10 });
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
        return listAdminUserAuditLogs({ limit: 10 });
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
        icon={ShieldCheck}
        title={t("admin.authLoading")}
        description={t("admin.authLoadingDescription")}
      />
    );
  }

  if (!user) {
    return (
      <AdminAccessState
        icon={ShieldCheck}
        title={t("admin.loginRequiredTitle")}
        description={t("admin.loginRequiredDescription")}
        action={{ href: "/login", label: t("admin.loginAction") }}
      />
    );
  }

  if (!isAdmin) {
    return (
      <AdminAccessState
        icon={ShieldCheck}
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
          <Button
            onClick={runNow}
            disabled={isRunning || runningSourceId !== null}
            className="h-10 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
          >
            <Play size={16} />
            {isRunning ? t("admin.running") : t("admin.runStateCrawlers")}
          </Button>
          <Button
            variant="outline"
            onClick={reconcileSubscriptions}
            disabled={isReconcilingSubscriptions}
            className="h-10 rounded-lg border-slate-200"
          >
            <RefreshCw size={16} />
            {isReconcilingSubscriptions ? t("admin.reconcilingSubscriptions") : t("admin.reconcileSubscriptions")}
          </Button>
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
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-rose-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={18} />
            {t("admin.errorTitle")}
          </div>
          <p className="mt-1 text-sm">{t("admin.errorDescription")}</p>
        </div>
      )}

      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label={t("admin.totalSources")} value={summary.totalSources} icon={Database} />
          <SummaryCard label={t("admin.enabledSources")} value={summary.enabledSources} icon={ShieldCheck} />
          <SummaryCard label={t("admin.healthySources")} value={summary.healthySources} icon={Activity} />
          <SummaryCard label={t("admin.failingSources")} value={summary.failingSources} icon={AlertTriangle} />
        </div>
      )}

      {state.status === "ready" && (
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
                <TableHead className="text-right">{t("admin.enabled")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-slate-500">
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
        </section>
      )}

      {state.status === "ready" && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <Bell size={18} />
              {t("admin.notificationDelivery")}
            </div>
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

      {state.status === "ready" && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold text-slate-950">
            <History size={18} />
            {t("admin.userAuditLogs")}
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
                <TableHead>{t("admin.cadence")}</TableHead>
                <TableHead>{t("admin.lastRun")}</TableHead>
                <TableHead>{t("admin.status")}</TableHead>
                <TableHead>{t("admin.counts")}</TableHead>
                <TableHead className="text-right">{t("admin.run")}</TableHead>
                <TableHead className="text-right">{t("admin.enabled")}</TableHead>
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
                  <TableCell className="text-right">
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
