"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { SourceDataQualityReport } from "@/server/source-validity/source-data-quality";
import { formatDate } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

async function loadSourceQuality(): Promise<SourceDataQualityReport> {
  const response = await fetch("/api/admin/source-data-quality", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("Unable to read source quality report.");
  return (await response.json() as { report: SourceDataQualityReport }).report;
}
const count = (value: number | null) => value === null ? "N/A" : String(value);

export function SourceDataQualityReportView({ report }: { report: SourceDataQualityReport }) {
  const { t } = useLanguage();
  const [level, setLevel] = useState("all");
  const [provider, setProvider] = useState("all");
  const rows = report.rows.filter((row) => (level === "all" || row.jurisdictionLevel === level) && (provider === "all" || (row.providerFamily ?? "unknown") === provider));
  const providers = [...new Set(report.rows.map((row) => row.providerFamily ?? "unknown"))].sort();
  const label = (key: string) => t(`admin.sourceQuality${key}`);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{label("Hint")}</p>
      {report.readConsistency === "per_query" && <AdminNotice message={label("PerQueryHint")} />}
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50"><tr>{["Jurisdiction", "Sources", "Usable", "Degraded", "Empty", "Unknown"].map((key) => <th key={key} className="p-3 font-medium">{label(key)}</th>)}</tr></thead>
          <tbody>{report.segments.map((segment) => <tr key={segment.jurisdictionLevel} className="border-t border-slate-100"><td className="p-3">{t(`admin.coverageLevel_${segment.jurisdictionLevel}`)}</td>{[segment.totalSources, segment.usableSources, segment.degradedSources, segment.verifiedEmptySources, segment.unknownSources].map((value, index) => <td key={index} className="p-3 tabular-nums">{value}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">{label("Jurisdiction")} <select value={level} onChange={(event) => setLevel(event.target.value)} className="rounded border border-slate-200 p-2"><option value="all">{label("All")}</option>{report.segments.map((segment) => <option key={segment.jurisdictionLevel} value={segment.jurisdictionLevel}>{t(`admin.coverageLevel_${segment.jurisdictionLevel}`)}</option>)}</select></label>
        <label className="text-sm">{label("Provider")} <select value={provider} onChange={(event) => setProvider(event.target.value)} className="rounded border border-slate-200 p-2"><option value="all">{label("All")}</option>{providers.map((value) => <option key={value} value={value}>{value === "unknown" ? label("Unknown") : value}</option>)}</select></label>
      </div>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="bg-slate-50"><tr>{["Source", "ListExecution", "Coverage", "Content", "RunCounts", "Bodies", "Stored", "Backlog", "Freshness", "Attachments"].map((key) => <th key={key} className="p-3 font-medium">{label(key)}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr key={row.sourceId} className="border-t border-slate-100 align-top">
            <td className="p-3"><Link className="font-medium text-blue-700 underline" href={`/admin/sources/${encodeURIComponent(row.sourceId)}`}>{row.sourceLabel}</Link><div className="mt-1 text-xs text-slate-500">{row.stateCode} · {t(`admin.coverageLevel_${row.jurisdictionLevel}`)} · {row.providerFamily ?? label("Unknown")}</div>{!row.enabled && <div className="text-xs text-slate-500">{t("admin.sourcesHealth_disabled")}</div>}</td>
            <td className="p-3">{label(`Execution_${row.execution}`)}<div className="text-xs text-slate-500">{formatDate(row.lastExecutionAt)}</div></td>
            <td className="p-3">{label(`Coverage_${row.listCoverage}`)}</td>
            <td className={`p-3 ${["partial", "unusable"].includes(row.contentStatus) ? "text-amber-800" : "text-slate-700"}`}>{label(`Content_${row.contentStatus}`)}</td>
            <td className="p-3"><div>{label("Unique")}: {count(row.run.uniqueCount)}</div><div>{label("Accepted")}: {count(row.run.acceptedCount)}</div><div>{label("Quarantined")}: {count(row.run.quarantinedCount)}</div><div>{label("Duplicates")}: {count(row.run.duplicateCount)}</div></td>
            <td className="p-3"><div>{label("ValidBodies")}: {count(row.run.validBodyCount)}</div><div>{label("NewBodies")}: {count(row.run.fetchedBodyCount)}</div><div>{label("RetainedBodies")}: {count(row.run.retainedBodyCount)}</div><div>{label("AnalysisReady")}: {count(row.run.analysisReadyCount)}</div></td>
            <td className="p-3"><div>{label("Records")}: {row.stored.bidCount}</div><div>{label("ValidBodies")}: {row.stored.validBodyCount}</div><div>{label("CoreInvalid")}: {row.stored.coreInvalidCount}</div><div>{label("AnalysisReady")}: {row.stored.analysisReadyCount}</div></td>
            <td className="p-3"><div>{label("PendingBodies")}: {count(row.stored.bodyBacklog?.pendingCount ?? null)}</div><div>{label("NeverAttempted")}: {count(row.stored.bodyBacklog?.neverAttemptedCount ?? null)}</div><div>{label("OldestPending")}: {row.stored.bodyBacklog?.oldestPendingObservedAt ? formatDate(row.stored.bodyBacklog.oldestPendingObservedAt) : "N/A"}</div><div>{label("NextRetry")}: {row.stored.bodyBacklog?.nextRetryAt ? formatDate(row.stored.bodyBacklog.nextRetryAt) : "N/A"}</div>{row.stored.bodyBacklog && Object.keys(row.stored.bodyBacklog.statusCounts).length > 0 && <details className="mt-1"><summary className="cursor-pointer">{label("BacklogReasons")}</summary>{Object.entries(row.stored.bodyBacklog.statusCounts).map(([reason, total]) => <div key={reason}>{label(`Backlog_${reason}`)}: {total}</div>)}</details>}</td>
            <td className="p-3"><div>{label("OldestVerified")}: {row.stored.oldestBodyVerifiedAt ? formatDate(row.stored.oldestBodyVerifiedAt) : "N/A"}</div><div>{label("AgeHours")}: {count(row.stored.oldestBodyAgeHours)}</div><div>{label("VerificationUnknown")}: {row.stored.bodyVerificationUnknownCount}</div></td>
            <td className="p-3"><div>{label("Discovered")}: {row.stored.attachmentsDiscovered}</div><div>{label("Archived")}: {row.stored.attachmentsArchived}</div><div>{label("Verified")}: {row.stored.attachmentsVerified}</div></td>
          </tr>)}</tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-sm text-slate-500">{label("NoSources")}</p>}
      </div>
      <p className="text-xs text-slate-500">{label("CheckedAt")}: {formatDate(report.checkedAt)} · {label("Unattributed")}: {report.unattributedBidCount}</p>
    </div>
  );
}

export function SourceDataQualitySection() {
  const { t } = useLanguage();
  const resource = useAdminResource(loadSourceQuality);
  const title = t("admin.sourceQualityTitle");
  if (!resource.data) return <AdminSectionStateCard action={() => void resource.reload()} actionLabel={t("admin.refresh")} title={title} code={resource.status === "error" ? "error" : "loading"} message={t(resource.status === "error" ? "admin.errorDescription" : "admin.loading")} />;
  return <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><Button variant="outline" size="sm" onClick={() => void resource.reload()} disabled={resource.status === "loading"}>{t("admin.refresh")}</Button></div>
    {resource.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
    <SourceDataQualityReportView report={resource.data} />
  </section>;
}
