"use client";

import { useCallback, useState } from "react";
import { History, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listAdminUserAuditLogs,
  type AdminUserAuditAction,
  type AdminUserAuditActorKind,
  type AdminUserAuditLog,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { FeatureKey } from "@/server/auth/entitlements";
import { formatBidDate, formatDate } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { OVERRIDABLE_FEATURES } from "./user-access-constants";

const AUDIT_ACTOR_KINDS: AdminUserAuditActorKind[] = ["admin", "local-bypass", "self-service"];
const AUDIT_ACTIONS: AdminUserAuditAction[] = ["user_access_updated", "user_invited", "user_self_deleted"];

type UserAuditFilters = {
  actorKind?: AdminUserAuditActorKind;
  action?: AdminUserAuditAction;
  target?: string;
  featureKey?: FeatureKey;
};

/** The old page's auditLogRequest callback, as a pure function. */
export function auditLogRequestFor(filters: UserAuditFilters) {
  return {
    limit: 10,
    actorKind: filters.actorKind,
    action: filters.action,
    target: filters.target?.trim() || undefined,
    featureKey: filters.featureKey,
  };
}

export function formatAuditChanges(log: AdminUserAuditLog) {
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
        // An override expires at the end (23:59:59 UTC) of the day an admin picked: print that day, not the local moment.
        if (value.expiresAt) parts.push(`expires=${formatBidDate(value.expiresAt)}`);

        return parts.join(" ");
      };

      return `${change.featureKey}: ${formatOverrideState(change.before)} -> ${formatOverrideState(change.after)}`;
    })
    .join(", ");
}

export function UserAuditSection() {
  const { t } = useLanguage();
  const [userAuditFilters, setUserAuditFilters] = useState<UserAuditFilters>({});
  const loadLogs = useCallback(
    () => listAdminUserAuditLogs(auditLogRequestFor(userAuditFilters)).then((response) => response.logs),
    [userAuditFilters],
  );
  const logs = useAdminResource(loadLogs);
  const userAuditLogs = logs.data ?? [];

  if (logs.status === "error" && logs.data === null) {
    return (
      <AdminSectionStateCard
        action={() => void logs.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.userAuditLogs")}
      />
    );
  }
  if (logs.status === "loading" && logs.data === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.userAuditLogs")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {logs.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
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
    </div>
  );
}
