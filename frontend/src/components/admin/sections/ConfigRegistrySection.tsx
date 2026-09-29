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
import { useAdminResource } from "../use-admin-resource";

type ConfigEditDraft = {
  configValueJson: string;
  status: AdminConfigRegistryEntry["status"];
  changeReason: string;
};

const MARKETING_CONTENT_CONFIG_MODULE = "ux_state";
const MARKETING_CONTENT_CONFIG_KEY = "copy_library";
const MARKETING_CONTENT_CONFIG_ID = "ux_state.copy_library";
const MARKETING_CONTENT_SAFE_VALIDATION_COPY =
  "Unsafe outcome, compliance, or submission claims are rejected before publish and the site falls back to default marketing copy.";

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
  const [savingConfigEntryId, setSavingConfigEntryId] = useState<string | null>(null);
  const configEntries = registry.data ?? [];
  const isLoading = registry.status === "loading";
  const onRefresh = () => void registry.reload();

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
      setNotice("Config JSON is invalid.");
      return;
    }

    if (draft.changeReason.trim().length === 0) {
      setNotice("Change reason is required.");
      return;
    }

    setSavingConfigEntryId(entry.id);
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
        setNotice("Config saved.");
      })
      .catch(() => {
        setNotice("Config update failed.");
      })
      .finally(() => {
        setSavingConfigEntryId(null);
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
        title="Config Registry"
      />
    );
  }
  if (registry.status === "loading" && registry.data === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title="Config Registry" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminNotice message={notice} />
      {registry.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
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
    </div>
  );
}
