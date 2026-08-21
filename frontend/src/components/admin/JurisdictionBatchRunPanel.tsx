"use client";

import { useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  runSamGovCrawlerNow,
  runStateCrawlersNow,
  type AdminDataSource,
  type StateCrawlerRunResultEntry,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/**
 * Jurisdiction batch run + date window panel (spec:
 * docs/superpowers/specs/2026-08-21-jurisdiction-batch-run-date-window-design.md).
 *
 * Reuses the existing manual run routes — /api/crawler/state/run for state/county/city/
 * special-district `data_sources` rows (chunked, sequential) and /api/crawler/sam-gov/run for
 * the synthetic federal SAM.gov entry — with an optional published-date window passed through
 * as postedFrom/postedTo. No new backend routes or queue infrastructure.
 */

export const BATCH_JURISDICTION_LEVELS = ["federal", "state", "county", "city", "special_district"] as const;
export type BatchJurisdictionLevel = (typeof BATCH_JURISDICTION_LEVELS)[number];

export const BATCH_WINDOW_PRESETS = ["all", "last7", "last30", "last90", "custom"] as const;
export type BatchWindowPreset = (typeof BATCH_WINDOW_PRESETS)[number];

export const BATCH_RUN_CHUNK_SIZE = 5;

export const SAM_GOV_ENTRY_KEY = "sam_gov_federal";

export interface BatchRunEntry {
  /** Stable selection key: the runnable crawler source id, or SAM_GOV_ENTRY_KEY for federal. */
  key: string;
  kind: "state_task" | "sam_gov";
  label: string;
  level: BatchJurisdictionLevel;
  stateCode: string | null;
}

export type BatchRunEntryStatus =
  | { phase: "pending" }
  | { phase: "running" }
  | {
      phase: "done";
      status: "success" | "failure" | "blocked" | "locked" | "disabled" | "unknown";
      fetchedCount?: number;
      dateFilter?: { kept?: number; dropped?: number; unparsed?: number };
      /** Orchestrator-provided blocked reason (governance / legal review), shown as a hint. */
      reason?: string;
    };

/**
 * Maps the orchestrator's blocked `reason` sentence onto an i18n hint key, so the panel can
 * explain WHY a run was blocked (governance approval vs legal review) instead of leaving the
 * bare "blocked" badge ambiguous with a portal-side rejection. Unknown reasons fall back to
 * the raw text.
 */
export function blockedReasonHintKey(reason: string | undefined): string | null {
  if (!reason) return null;
  if (reason.includes("legal review")) return "admin.batchRunBlockedLegal";
  if (reason.includes("governance")) return "admin.batchRunBlockedApproval";
  return null;
}

export function batchJurisdictionLevelOf(source: Pick<AdminDataSource, "jurisdictionLevel" | "issuerType">): BatchJurisdictionLevel {
  const level = source.jurisdictionLevel;
  if (level && (BATCH_JURISDICTION_LEVELS as readonly string[]).includes(level)) {
    return level as BatchJurisdictionLevel;
  }
  // Legacy rows (NULL jurisdiction) predate the registry's jurisdiction columns: federal issuer
  // rows are federal, everything else in `data_sources` was a state portal.
  return source.issuerType === "federal" ? "federal" : "state";
}

/**
 * Flattens the admin source list into runnable batch entries: every enabled non-federal row with
 * a resolvable crawler source id, plus one synthetic SAM.gov entry for the federal level (federal
 * rows are excluded from /api/crawler/state/run and run through /api/crawler/sam-gov/run instead).
 */
export function buildBatchRunEntries(
  sources: AdminDataSource[],
  crawlerSourceIdFor: (source: AdminDataSource) => string | null,
): BatchRunEntry[] {
  const entries: BatchRunEntry[] = [
    { key: SAM_GOV_ENTRY_KEY, kind: "sam_gov", label: "SAM.gov", level: "federal", stateCode: null },
  ];

  for (const source of sources) {
    if (!source.isEnabled) continue;
    const level = batchJurisdictionLevelOf(source);
    if (level === "federal") continue;
    const crawlerSourceId = crawlerSourceIdFor(source);
    if (!crawlerSourceId) continue;
    entries.push({
      key: crawlerSourceId,
      kind: "state_task",
      label: source.label,
      level,
      stateCode: source.stateCode || null,
    });
  }

  return entries;
}

export function filterBatchEntries(
  entries: BatchRunEntry[],
  levelFilter: BatchJurisdictionLevel | "all",
  stateFilter: string | "all",
): BatchRunEntry[] {
  return entries.filter((entry) => {
    if (levelFilter !== "all" && entry.level !== levelFilter) return false;
    if (stateFilter !== "all" && entry.stateCode !== stateFilter) return false;
    return true;
  });
}

export function countBatchEntriesByLevel(entries: BatchRunEntry[]): Record<BatchJurisdictionLevel, number> {
  const counts = { federal: 0, state: 0, county: 0, city: 0, special_district: 0 };
  for (const entry of entries) counts[entry.level] += 1;
  return counts;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type BatchWindow = { postedFrom?: string; postedTo?: string } | null;

/**
 * Resolves the selected time window into postedFrom/postedTo (ISO yyyy-mm-dd, inclusive).
 * Returns null for "all" (no window) and the string "invalid" for an unusable custom window.
 * "lastN" spans exactly N calendar days ending today (UTC).
 */
export function resolveBatchWindow(
  preset: BatchWindowPreset,
  custom: { from: string; to: string },
  today: Date,
): BatchWindow | "invalid" {
  if (preset === "all") return null;

  if (preset === "custom") {
    const from = custom.from.trim();
    const to = custom.to.trim();
    if (!from && !to) return null;
    if (from && !ISO_DATE_PATTERN.test(from)) return "invalid";
    if (to && !ISO_DATE_PATTERN.test(to)) return "invalid";
    if (from && to && from > to) return "invalid";
    return { ...(from ? { postedFrom: from } : {}), ...(to ? { postedTo: to } : {}) };
  }

  const days = preset === "last7" ? 7 : preset === "last30" ? 30 : 90;
  const from = new Date(today.getTime());
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { postedFrom: isoDate(from), postedTo: isoDate(today) };
}

/** "2026-08-01" -> "08/01/2026" (the SAM.gov API's MM/dd/yyyy format). */
export function samGovDateFromIso(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

export function chunkBatchKeys(keys: string[], size = BATCH_RUN_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += size) {
    chunks.push(keys.slice(index, index + size));
  }
  return chunks;
}

export function batchStatusFromRunResult(entry: StateCrawlerRunResultEntry): BatchRunEntryStatus {
  const status =
    entry.status === "success" || entry.status === "failure" || entry.status === "blocked" ||
    entry.status === "locked" || entry.status === "disabled"
      ? entry.status
      : "unknown";
  return {
    phase: "done",
    status,
    fetchedCount: entry.runner?.fetchedCount,
    dateFilter: entry.runner?.payload?.metadata?.dateFilter,
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

export interface JurisdictionBatchRunPanelProps {
  sources: AdminDataSource[];
  crawlerSourceIdFor: (source: AdminDataSource) => string | null;
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

  const markStatuses = (keys: string[], status: BatchRunEntryStatus) => {
    setEntryStatuses((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = status;
      return next;
    });
  };

  const runBatch = async () => {
    if (windowInvalid || selectedKeys.size === 0 || isBatchRunning) return;

    const selectedEntries = entries.filter((entry) => selectedKeys.has(entry.key));
    const stateKeys = selectedEntries.filter((entry) => entry.kind === "state_task").map((entry) => entry.key);
    const includeSamGov = selectedEntries.some((entry) => entry.kind === "sam_gov");
    const total = stateKeys.length + (includeSamGov ? 1 : 0);

    setIsBatchRunning(true);
    setCompletedCount(0);
    setRunTotal(total);
    setEntryStatuses(Object.fromEntries(selectedEntries.map((entry) => [entry.key, { phase: "pending" }])));

    // The guard above already returned when windowInvalid, so batchWindow is a usable window here.
    const runWindow = batchWindow;

    try {
      for (const chunk of chunkBatchKeys(stateKeys)) {
        markStatuses(chunk, { phase: "running" });
        try {
          const response = await runStateCrawlersNow(chunk, {
            ...(runWindow?.postedFrom ? { postedFrom: runWindow.postedFrom } : {}),
            ...(runWindow?.postedTo ? { postedTo: runWindow.postedTo } : {}),
          });
          setEntryStatuses((current) => {
            const next = { ...current };
            for (const result of response.results) {
              next[result.source] = batchStatusFromRunResult(result);
            }
            for (const error of response.errors ?? []) {
              next[error.source] = { phase: "done", status: "unknown" };
            }
            return next;
          });
        } catch {
          markStatuses(chunk, { phase: "done", status: "failure" });
        }
        setCompletedCount((current) => current + chunk.length);
      }

      if (includeSamGov) {
        markStatuses([SAM_GOV_ENTRY_KEY], { phase: "running" });
        try {
          await runSamGovCrawlerNow({
            ...(runWindow?.postedFrom ? { postedFrom: samGovDateFromIso(runWindow.postedFrom) } : {}),
            ...(runWindow?.postedTo ? { postedTo: samGovDateFromIso(runWindow.postedTo) } : {}),
          });
          markStatuses([SAM_GOV_ENTRY_KEY], { phase: "done", status: "success" });
        } catch {
          markStatuses([SAM_GOV_ENTRY_KEY], { phase: "done", status: "failure" });
        }
        setCompletedCount((current) => current + 1);
      }
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
    const tone =
      status.status === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : status.status === "failure" || status.status === "unknown"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-amber-200 bg-amber-50 text-amber-700";
    const blockedHintKey = status.status === "blocked" ? blockedReasonHintKey(status.reason) : null;
    return (
      <span className="flex flex-wrap items-center justify-end gap-1">
        <Badge variant="outline" className={tone}>
          {t(`admin.batchRunStatus_${status.status}`)}
        </Badge>
        {status.status === "success" && typeof status.fetchedCount === "number" && (
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
                {entry.stateCode && <span className="shrink-0 text-slate-400">{entry.stateCode}</span>}
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
