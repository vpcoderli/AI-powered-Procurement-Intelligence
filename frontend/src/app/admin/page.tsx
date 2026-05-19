"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listAdminCrawlerLogs,
  listAdminDataSources,
  runStateCrawlersNow,
  updateAdminDataSource,
  type AdminCrawlerLog,
  type AdminDataSource,
  type AdminDataSourcesResponse,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: AdminDataSourcesResponse; logs: AdminCrawlerLog[] };

const STATE_CRAWLER_SOURCE_IDS_BY_STATE: Record<string, string> = {
  CA: "ca_caleprocure",
  TX: "tx_esbd",
  NY: "ny_contract_reporter",
  FL: "fl_mfmp",
  IL: "il_bidbuy",
};

function stateCrawlerSourceIdFor(source: AdminDataSource) {
  if (source.issuerType !== "state") return null;

  return STATE_CRAWLER_SOURCE_IDS_BY_STATE[source.stateCode] ?? null;
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

export default function AdminPage() {
  const { t } = useLanguage();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([listAdminDataSources(), listAdminCrawlerLogs()])
      .then(([data, logsResponse]) => {
        setState({ status: "ready", data, logs: logsResponse.logs });
      })
      .catch(() => {
        setState({ status: "error" });
      });
  }, []);

  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const summary = state.status === "ready" ? state.data.summary : null;
  const sources = state.status === "ready" ? state.data.sources : [];
  const logs = state.status === "ready" ? state.logs : [];

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
                    <Badge variant="outline" className={statusTone(source.latestLog?.status)}>
                      {source.latestLog?.status ?? t("admin.notRun")}
                    </Badge>
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
