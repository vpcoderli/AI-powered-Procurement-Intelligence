"use client";

import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BATCH_JURISDICTION_LEVELS,
  BATCH_WINDOW_PRESETS,
  batchSuccessKind,
  blockedReasonHintKey,
  buildBatchRunEntries,
  countBatchEntriesByLevel,
  deferredThrottleSourceId,
  filterBatchEntries,
  resolveBatchWindow,
  runManualCrawl,
  type BatchJurisdictionLevel,
  type BatchRunEntryStatus,
  type BatchRunSource,
  type BatchWindowPreset,
} from "@/lib/manual-crawl";
import { useLanguage } from "@/lib/i18n/LanguageContext";

// Preserve helper imports used by existing admin consumers; execution lives in manual-crawl.
export {
  BATCH_JURISDICTION_LEVELS,
  BATCH_RUN_CHUNK_SIZE,
  BATCH_WINDOW_PRESETS,
  SAM_GOV_ENTRY_KEY,
  batchJurisdictionLevelOf,
  batchStatusFromRunResult,
  batchSuccessKind,
  blockedReasonHintKey,
  buildBatchRunEntries,
  chunkBatchKeys,
  countBatchEntriesByLevel,
  deferredThrottleSourceId,
  filterBatchEntries,
  resolveBatchWindow,
  samGovDateFromIso,
  type BatchJurisdictionLevel,
  type BatchRunEntry,
  type BatchRunEntryStatus,
  type BatchRunSource,
  type BatchSuccessKind,
  type BatchWindow,
  type BatchWindowPreset,
} from "@/lib/manual-crawl";

export interface JurisdictionBatchRunPanelProps {
  sources: BatchRunSource[];
  crawlerSourceIdFor: (source: BatchRunSource) => string | null;
  disabled?: boolean;
  onCompleted?: () => void;
}

export function JurisdictionBatchRunPanel({
  sources,
  crawlerSourceIdFor,
  disabled = false,
  onCompleted,
}: JurisdictionBatchRunPanelProps) {
  const { t } = useLanguage();
  const [levelFilter, setLevelFilter] = useState<BatchJurisdictionLevel | "all">("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [windowPreset, setWindowPreset] = useState<BatchWindowPreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [entryStatuses, setEntryStatuses] = useState<Record<string, BatchRunEntryStatus>>({});
  const [completedCount, setCompletedCount] = useState(0);
  const [runTotal, setRunTotal] = useState(0);

  const entries = useMemo(() => buildBatchRunEntries(sources, crawlerSourceIdFor), [sources, crawlerSourceIdFor]);
  const levelCounts = useMemo(() => countBatchEntriesByLevel(entries), [entries]);
  const stateOptions = useMemo(
    () => [...new Set(entries.map((entry) => entry.stateCode).filter((code): code is string => Boolean(code)))].sort(),
    [entries],
  );
  const visibleEntries = useMemo(
    () => filterBatchEntries(entries, levelFilter, stateFilter),
    [entries, levelFilter, stateFilter],
  );

  const batchWindow = resolveBatchWindow(windowPreset, { from: customFrom, to: customTo }, new Date());
  const windowInvalid = batchWindow === "invalid";

  const visibleKeys = visibleEntries.map((entry) => entry.key);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));

  const toggleEntry = (key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const key of visibleKeys) next.delete(key);
      } else {
        for (const key of visibleKeys) next.add(key);
      }
      return next;
    });
  };

  const runBatch = async () => {
    if (windowInvalid || selectedKeys.size === 0 || isBatchRunning) return;
    const selectedEntries = entries.filter((entry) => selectedKeys.has(entry.key));
    setIsBatchRunning(true);
    try {
      await runManualCrawl({ entries: selectedEntries }, {
        transportFailure: "continue",
        window: batchWindow,
        onProgress: (progress) => {
          setEntryStatuses(progress.statuses);
          setCompletedCount(progress.completedCount);
          setRunTotal(progress.total);
        },
      });
    } finally {
      setIsBatchRunning(false);
      onCompleted?.();
    }
  };

  const levelLabel = (level: BatchJurisdictionLevel) => t(`admin.batchRunLevel_${level}`);

  const statusBadge = (status: BatchRunEntryStatus | undefined) => {
    if (!status) return null;
    if (status.phase === "pending") {
      return <Badge variant="outline" className="border-slate-200 text-slate-500">{t("admin.batchRunStatusPending")}</Badge>;
    }
    if (status.phase === "running") {
      return <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">{t("admin.batchRunStatusRunning")}</Badge>;
    }
    const successKind = batchSuccessKind(status);
    const tone =
      status.status === "success"
        ? successKind === "verified_empty"
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
        : status.status === "failure" || status.status === "unknown"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-amber-200 bg-amber-50 text-amber-700";
    const blockedHintKey = status.status === "blocked" ? blockedReasonHintKey(status.reason) : null;
    const throttledBy = status.status === "deferred" ? deferredThrottleSourceId(status.reason) : null;
    return (
      <span className="flex flex-wrap items-center justify-end gap-1">
        <Badge variant="outline" className={tone}>
          {status.status === "success" && successKind === "verified_empty"
            ? t("admin.batchRunEmptyState")
            : t(`admin.batchRunStatus_${status.status}`)}
        </Badge>
        {status.status === "success" && successKind === "verified_empty" && (
          <span className="text-xs text-slate-500" title={status.emptyState?.marker ?? undefined}>
            {t("admin.batchRunEmptyStateHint")}
          </span>
        )}
        {status.status === "success" && successKind === "zero" && (
          <span className="text-xs text-slate-500">{t("admin.batchRunZeroRows")}</span>
        )}
        {status.status === "success" && successKind === "rows" && typeof status.fetchedCount === "number" && (
          <span className="text-xs text-slate-500">
            {t("admin.batchRunFetched").replace("{count}", String(status.fetchedCount))}
            {status.dateFilter
              ? ` · ${t("admin.batchRunWindowKept")
                  .replace("{kept}", String(status.dateFilter.kept ?? 0))
                  .replace("{dropped}", String(status.dateFilter.dropped ?? 0))}`
              : ""}
          </span>
        )}
        {status.status === "blocked" && (
          <span className="text-xs text-slate-500">
            {blockedHintKey ? t(blockedHintKey) : status.reason ?? ""}
          </span>
        )}
        {status.status === "deferred" && (
          <span className="text-xs text-slate-500">
            {throttledBy
              ? t("admin.batchRunDeferredHint").replace("{source}", throttledBy)
              : status.reason ?? t("admin.batchRunDeferredHintUnknown")}
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="border-b border-slate-100 px-4 py-3" data-testid="jurisdiction-batch-run">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-950">{t("admin.batchRunTitle")}</div>
          <div className="text-xs text-slate-500">{t("admin.batchRunDescription")}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">
            {t("admin.batchRunSelectedCount").replace("{count}", String(selectedKeys.size))}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => void runBatch()}
            disabled={disabled || isBatchRunning || selectedKeys.size === 0 || windowInvalid}
            className="h-8 rounded-lg px-3"
          >
            <Play size={14} />
            {isBatchRunning ? t("admin.batchRunRunning") : t("admin.batchRunRun")}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-slate-500">{t("admin.batchRunLevelFilter")}</span>
        <button
          type="button"
          onClick={() => setLevelFilter("all")}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            levelFilter === "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
          }`}
        >
          {t("admin.batchRunLevelAll")} ({entries.length})
        </button>
        {BATCH_JURISDICTION_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setLevelFilter(level)}
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              levelFilter === level ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            {levelLabel(level)} ({levelCounts[level]})
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
          {t("admin.batchRunStateFilter")}
          <select
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
            className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none"
          >
            <option value="all">{t("admin.batchRunAllStates")}</option>
            {stateOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-slate-500">{t("admin.batchRunWindow")}</span>
        <select
          aria-label={t("admin.batchRunWindow")}
          value={windowPreset}
          onChange={(event) => setWindowPreset(event.target.value as BatchWindowPreset)}
          className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 outline-none"
        >
          {BATCH_WINDOW_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {t(`admin.batchRunWindow_${preset}`)}
            </option>
          ))}
        </select>
        {windowPreset === "custom" && (
          <>
            <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
              {t("admin.batchRunWindowFrom")}
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none"
              />
            </label>
            <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
              {t("admin.batchRunWindowTo")}
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none"
              />
            </label>
            {windowInvalid && <span className="text-xs font-medium text-rose-600">{t("admin.batchRunWindowInvalid")}</span>}
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={visibleKeys.length === 0} />
          {t("admin.batchRunSelectAllVisible")}
        </label>
        <button
          type="button"
          onClick={() => setSelectedKeys(new Set())}
          disabled={selectedKeys.size === 0}
          className="text-slate-500 underline-offset-2 hover:underline disabled:opacity-50"
        >
          {t("admin.batchRunClearSelection")}
        </button>
        {runTotal > 0 && (
          <span className="text-slate-500">
            {t("admin.batchRunProgress")
              .replace("{done}", String(completedCount))
              .replace("{total}", String(runTotal))}
          </span>
        )}
      </div>

      {visibleEntries.length === 0 ? (
        <div className="mt-2 text-xs font-medium text-slate-500">{t("admin.batchRunNoSources")}</div>
      ) : (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-100">
          {visibleEntries.map((entry) => (
            <label
              key={entry.key}
              className="flex items-center justify-between gap-2 border-b border-slate-50 px-3 py-1.5 text-xs last:border-b-0 hover:bg-slate-50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedKeys.has(entry.key)}
                  onChange={() => toggleEntry(entry.key)}
                  disabled={isBatchRunning}
                />
                <span className="truncate font-medium text-slate-700">{entry.label}</span>
                {entry.stateCode && <span className="shrink-0 text-slate-500">{entry.stateCode}</span>}
                <Badge variant="outline" className="shrink-0 border-slate-200 text-slate-500">
                  {levelLabel(entry.level)}
                </Badge>
              </span>
              {statusBadge(entryStatuses[entry.key])}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
