"use client";

import { useState } from "react";
import { RefreshCw, ServerCog, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAdminConfigEntries, updateAdminConfigEntry, type AdminConfigRegistryEntry } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useBusyIds } from "../busy-reporting";
import { useAdminResource } from "../use-admin-resource";

type ConfigEditDraft = {
  configValueJson: string;
  status: AdminConfigRegistryEntry["status"];
  changeReason: string;
};

const MARKETING_CONTENT_CONFIG_MODULE = "ux_state";
const MARKETING_CONTENT_CONFIG_KEY = "copy_library";
const MARKETING_CONTENT_CONFIG_ID = "ux_state.copy_library";
const CONFIG_STATUSES: AdminConfigRegistryEntry["status"][] = ["active", "draft", "inactive"];

const loadConfigEntries = () => listAdminConfigEntries().then((response) => response.entries);

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

export function ConfigRegistrySection() {
  const { t } = useLanguage();
  const registry = useAdminResource(loadConfigEntries);
  const [notice, setNotice] = useState<string | null>(null);
  const [configEditDrafts, setConfigEditDrafts] = useState<Record<string, ConfigEditDraft>>({});
  const { busyIds: savingConfigEntryIds, setBusy: setConfigBusy } = useBusyIds<string>();
  const configEntries = registry.data ?? [];
  const isLoading = registry.status === "loading";
  const onRefresh = () => void registry.reload();
  const statusLabel = (status: AdminConfigRegistryEntry["status"]) =>
    CONFIG_STATUSES.includes(status) ? t(`admin.configRegistryStatus_${status}`) : status;

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
      setNotice(t("admin.configRegistryInvalidJson"));
      return;
    }

    if (draft.changeReason.trim().length === 0) {
      setNotice(t("admin.configRegistryReasonRequired"));
      return;
    }

    setConfigBusy(entry.id, true);
    setNotice(null);
    updateAdminConfigEntry(entry.id, {
      configValue,
      status: draft.status,
      changeReason: draft.changeReason.trim(),
    })
      .then(({ entry: updated }) => {
        registry.setData((current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
        setConfigEditDrafts((current) => {
          const next = { ...current };
          delete next[entry.id];
          return next;
        });
        setNotice(t("admin.configRegistrySaved"));
      })
      .catch(() => {
        setNotice(t("admin.configRegistrySaveFailed"));
      })
      .finally(() => {
        setConfigBusy(entry.id, false);
      });
  };

  const onDraftChange = updateConfigEditDraft;
  const onSave = handleConfigRegistrySave;

  if (registry.status === "error" && registry.data === null) {
    return (
      <AdminSectionStateCard
        action={onRefresh}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.configRegistryTitle")}
      />
    );
  }
  if (registry.status === "loading" && registry.data === null) {
    return (
      <AdminSectionStateCard
        actionLabel={t("admin.refresh")}
        code="loading"
        message={t("admin.loading")}
        title={t("admin.configRegistryTitle")}
      />
    );
  }

  // The description names the CMS entry as an inline <code> chip, so it is split at its {key} placeholder.
  const [cmsBefore, cmsAfter = ""] = t("admin.configRegistryCmsDescription").split("{key}");

  return (
    <div className="flex flex-col gap-6">
      <AdminNotice message={notice} />
      {registry.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      <section id="configuration" className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold text-slate-950">
              <ServerCog size={18} />
              {t("admin.configRegistryTitle")}
            </div>
            <div className="mt-1 text-xs font-medium text-slate-500">{t("admin.configRegistrySubtitle")}</div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-8 rounded-lg border-slate-200 px-2 text-xs"
          >
            <RefreshCw size={14} />
            {isLoading ? t("admin.configRegistryRefreshing") : t("admin.refresh")}
          </Button>
        </div>
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck size={16} className="text-emerald-600" />
                {t("admin.configRegistryCmsTitle")}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-600">
                {cmsBefore}
                <code className="rounded bg-white px-1">{MARKETING_CONTENT_CONFIG_ID}</code>
                {cmsAfter}
              </div>
            </div>
            <div className="max-w-xl rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
              <span className="font-semibold text-emerald-700">{t("admin.configRegistrySafeValidationLabel")}</span>{" "}
              {t("admin.configRegistrySafeValidationText")}
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
          <div className="px-4 py-5 text-sm text-slate-500">{t("admin.configRegistryEmpty")}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.configRegistryModule")}</TableHead>
                <TableHead>{t("admin.configRegistryKey")}</TableHead>
                <TableHead>{t("admin.status")}</TableHead>
                <TableHead>{t("admin.configRegistryScope")}</TableHead>
                <TableHead>{t("admin.configRegistryConfigJson")}</TableHead>
                <TableHead>{t("admin.configRegistryChangeReason")}</TableHead>
                <TableHead>{t("admin.configRegistryUpdated")}</TableHead>
                <TableHead className="text-right">{t("admin.configRegistryAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configEntries.map((entry) => {
                const draft = configDraftFor(entry, configEditDrafts);
                const isSaving = savingConfigEntryIds.has(entry.id);

                return (
                  <TableRow key={entry.id} className="align-top">
                    <TableCell className="font-medium text-slate-900">{entry.module}</TableCell>
                    <TableCell>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                        {entry.configKey}
                      </code>
                      {isMarketingContentConfigEntry(entry) && (
                        <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs leading-5 text-emerald-800">
                          {t("admin.configRegistryCopyLibraryNote")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        <Badge variant="outline" className={configStatusTone(draft.status)}>
                          {statusLabel(draft.status)}
                        </Badge>
                        <select
                          value={draft.status}
                          disabled={isSaving}
                          onChange={(event) =>
                            onDraftChange(entry.id, (current) => ({
                              ...current,
                              status: event.target.value as AdminConfigRegistryEntry["status"],
                            }))
                          }
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none"
                        >
                          {CONFIG_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {statusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-slate-700">{formatConfigScope(entry)}</div>
                      <div className="text-xs text-slate-500">v{entry.schemaVersion}</div>
                    </TableCell>
                    <TableCell>
                      <textarea
                        aria-label={`${entry.module}.${entry.configKey} ${t("admin.configRegistryConfigJson")}`}
                        value={draft.configValueJson}
                        disabled={isSaving}
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
                        aria-label={`${entry.module}.${entry.configKey} ${t("admin.configRegistryChangeReason")}`}
                        value={draft.changeReason}
                        disabled={isSaving}
                        onChange={(event) =>
                          onDraftChange(entry.id, (current) => ({
                            ...current,
                            changeReason: event.target.value,
                          }))
                        }
                        placeholder={t("admin.configRegistryChangeReason")}
                        className="h-9 min-w-56 rounded-lg border-slate-200 text-sm"
                      />
                      <div className="mt-2 max-w-56 truncate text-xs text-slate-500" title={entry.changeReason}>
                        {t("admin.configRegistryLastReason").replace("{reason}", () => entry.changeReason || "-")}
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
                        {isSaving ? t("admin.configRegistrySaving") : t("admin.configRegistrySave")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
