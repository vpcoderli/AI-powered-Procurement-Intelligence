"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Database, Download, History, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getAdminRiskChecklist,
  type AdminRiskChecklistResponse,
  type StateDataQualityReasonCode,
  type StateDataQualityReport,
  type StateDataQualityRiskLevel,
  type StateDataQualityRow,
} from "@/lib/api/admin";
import { bidDetailPath } from "@/lib/bid-routes";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

export type AdminRiskSectionData = {
  report: AdminRiskChecklistResponse["report"];
  history: AdminRiskChecklistResponse["history"];
  trend: AdminRiskChecklistResponse["trend"];
  stateDataQuality: AdminRiskChecklistResponse["stateDataQuality"];
};

export type RecommendedActionFilter = "all" | string;
export type StateDataQualityRiskFilter = "all" | Extract<StateDataQualityRiskLevel, "P0" | "P1" | "P2">;
export type StateDataQualityReasonFilter = "all" | StateDataQualityReasonCode | string;

type StateDataQualityFilters = {
  riskLevel: StateDataQualityRiskFilter | string;
  reasonCode: StateDataQualityReasonFilter;
};

export const STATE_DATA_QUALITY_RISK_FILTERS: StateDataQualityRiskFilter[] = ["all", "P0", "P1", "P2"];
const STATE_DATA_QUALITY_P0_BLOCKER_STATES = ["CA", "FL", "IL", "NY", "TX"] as const;

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

/** The notice above the matrix when one of the watched states is a P0 blocker, in the language of `t`; null when none is. */
export function stateDataQualityP0BlockerNotice(
  rows: Array<{ stateCode: string; riskLevel: string }>,
  t: (key: string) => string,
) {
  const blockerStates = STATE_DATA_QUALITY_P0_BLOCKER_STATES.filter((stateCode) =>
    rows.some((row) => row.stateCode === stateCode && row.riskLevel === "P0"),
  );

  if (blockerStates.length === 0) return null;

  return t("admin.stateQualityP0Notice")
    .replace("{watchlist}", STATE_DATA_QUALITY_P0_BLOCKER_STATES.join("/"))
    .replace("{states}", blockerStates.join("/"));
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

function stateDataQualityRiskFilterLabel(filter: StateDataQualityRiskFilter, t: (key: string) => string) {
  return filter === "all" ? t("admin.stateQualityFilterAll") : filter;
}

/** A row's risk level as a badge label: P0/P1/P2 are codes and print as they are, PASS is a word. */
function stateDataQualityRiskLabel(riskLevel: StateDataQualityRiskLevel | string, t: (key: string) => string) {
  return riskLevel === "PASS" ? t("admin.stateQualityPass") : riskLevel;
}

function StateDataQualityMatrix({ report }: { report: StateDataQualityReport }) {
  const { t } = useLanguage();
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
  const p0BlockerNotice = stateDataQualityP0BlockerNotice(report.rows, t);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-950">
            <Database size={15} />
            {t("admin.stateQualityMatrixTitle")}
            <Badge variant="outline" className={riskCheckTone(report.ok)}>
              {report.ok ? t("admin.stateQualityPass") : t("admin.stateQualityBlockerReview")}
            </Badge>
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {t("admin.stateQualitySummary")}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
            {t("admin.stateQualityTotalStates").replace("{count}", String(report.summary.totalStates))}
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
          <div className="text-xs font-black uppercase text-slate-700">{t("admin.stateQualityActionQueue")}</div>
          <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
            {t("admin.stateQualityActionCount")
              .replace("{shown}", String(filteredActions.length))
              .replace("{total}", String(report.actions.length))}
          </Badge>
        </div>
        <label className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          {t("admin.stateQualityRecommendedAction")}
          <select
            value={stateQualityActionRecommendedFilter}
            onChange={(event) => setStateQualityActionRecommendedFilter(event.target.value)}
            className="h-8 max-w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium normal-case text-slate-700 outline-none"
          >
            {actionRecommendedOptions.map((action) => (
              <option key={action} value={action}>
                {action === "all" ? t("admin.stateQualityAllRecommendedActions") : action}
              </option>
            ))}
          </select>
        </label>
        {filteredActions.length === 0 ? (
          <div className="mt-2 text-xs font-medium text-slate-500">{t("admin.stateQualityNoActions")}</div>
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
                    {t("admin.stateQualityDueHours").replace("{hours}", String(action.dueInHours))}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2 border-y border-slate-100 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-slate-500">{t("admin.stateQualityRiskFilter")}</span>
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
              {stateDataQualityRiskFilterLabel(filter, t)}
            </Button>
          ))}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          {t("admin.stateQualityReasonCode")}
          <select
            value={stateQualityReasonFilter}
            onChange={(event) => setStateQualityReasonFilter(event.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium normal-case text-slate-700 outline-none"
          >
            {reasonOptions.map((reasonCode) => (
              <option key={reasonCode} value={reasonCode}>
                {reasonCode === "all" ? t("admin.stateQualityAllReasonCodes") : reasonCode}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.stateQualityColumnState")}</TableHead>
              <TableHead>{t("admin.stateQualityColumnRisk")}</TableHead>
              <TableHead>{t("admin.stateQualityColumnBids")}</TableHead>
              <TableHead>{t("admin.stateQualityColumnEnabledSource")}</TableHead>
              <TableHead>{t("admin.stateQualityColumnAttachmentRatio")}</TableHead>
              <TableHead>{t("admin.stateQualityColumnReasonCode")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-5 text-center text-sm text-slate-500">
                  {t("admin.stateQualityNoRows")}
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
                      {stateDataQualityRiskLabel(row.riskLevel, t)}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.bidCount}</TableCell>
                  <TableCell>{row.enabledSourceCount}</TableCell>
                  <TableCell>{stateAttachmentRealRatio(row)}</TableCell>
                  <TableCell>
                    <div className="flex max-w-xl flex-wrap gap-1">
                      {reasonCodes.length === 0 ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          {t("admin.stateQualityReasonNone")}
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

/** The old dashboard's `risk` slice mapping, applied to the report's own response. */
export function toRiskSectionData(value: AdminRiskChecklistResponse): AdminRiskSectionData {
  return {
    report: value.report,
    history: value.history,
    trend: value.trend,
    stateDataQuality: value.stateDataQuality ?? null,
  };
}

const loadRiskReport = () => getAdminRiskChecklist().then(toRiskSectionData);

export function RiskCheckSection() {
  const { t } = useLanguage();
  const risk = useAdminResource(loadRiskReport);
  const [isRefreshingRiskReport, setIsRefreshingRiskReport] = useState(false);
  const riskReport = risk.data?.report ?? null;
  const riskHistory = risk.data?.history ?? [];
  const riskTrend = risk.data?.trend ?? null;
  const stateDataQuality = risk.data?.stateDataQuality ?? null;

  const refreshRiskReport = () => {
    setIsRefreshingRiskReport(true);
    void risk.reload().finally(() => {
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

  if (risk.status === "error" && risk.data === null) {
    return (
      <AdminSectionStateCard
        action={() => void risk.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.riskCheck")}
      />
    );
  }
  if (risk.status === "loading" && risk.data === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.riskCheck")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {risk.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {riskReport && riskTrend && (
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
    </div>
  );
}
