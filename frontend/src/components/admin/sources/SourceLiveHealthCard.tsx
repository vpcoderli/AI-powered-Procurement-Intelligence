"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminDataSource } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { compactErrorMessage, formatDate } from "../admin-format";
import {
  liveSourceHealthLabel,
  liveSourceHealthTone,
  liveSourceOperationalSeverityTone,
  liveSourceRecommendedActionLabel,
  liveSourceTrendStatusLabel,
  sourceHealthClassificationFor,
  sourceHealthClassificationLabel,
  sourceHealthDispositionLabel,
  sourceHealthTriageLabel,
  sourceHealthTriageStatus,
  sourceHealthTriageTone,
  type SourceHealthTriageAction,
  type SourceHealthTriageFields,
} from "./source-labels";

export interface SourceLiveHealthCardProps {
  source: AdminDataSource;
  canRunOperations: boolean;
  /** The write this card started: its own buttons stay disabled while it runs and the running one is relabelled. */
  pending: "recheck" | "triage" | null;
  /** Another write on the page is running (the detail page's Run, Enable/Disable, Approve, Hold...): every button is disabled, none is relabelled. */
  busy?: boolean;
  onRecheck: () => void;
  onTriage: (action: SourceHealthTriageAction) => void;
}

/**
 * Live source health and its triage queue fields, with the operator's recheck and triage controls. The card has
 * no outer margin of its own; the container spaces it.
 */
export function SourceLiveHealthCard({ source, canRunOperations, pending, busy = false, onRecheck, onTriage }: SourceLiveHealthCardProps) {
  const { t } = useLanguage();
  const liveHealth = source.latestLiveHealth;
  const healthTrend = source.sourceHealthTrend;
  const liveHealthTriage = source as SourceHealthTriageFields;
  const triageStatus = sourceHealthTriageStatus(liveHealthTriage);
  const liveHealthCode = liveHealth?.statusCode ?? liveHealth?.httpStatus ?? null;
  const liveHealthErrorMessage = liveHealth?.error ?? liveHealth?.errorMessage ?? null;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-700">{t("admin.liveSourceHealth")}</span>
        <Badge variant="outline" className={liveSourceHealthTone(liveHealth?.status)}>
          {liveSourceHealthLabel(t, liveHealth?.status)}
        </Badge>
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
          {sourceHealthClassificationLabel(t, sourceHealthClassificationFor(source))}
        </Badge>
      </div>
      {liveHealth ? (
        <>
          <div className="mt-1 text-slate-500">
            {t("admin.liveSourceCheckedAt").replace("{time}", formatDate(liveHealth.checkedAt))}
            {liveHealthCode ? ` · HTTP ${liveHealthCode}` : ""}
            {liveHealth?.latencyMs !== null && liveHealth?.latencyMs !== undefined
              ? ` · ${liveHealth.latencyMs} ms`
              : ""}
          </div>
          {liveHealthErrorMessage && (
            <div className="mt-1 text-rose-700">
              {compactErrorMessage(liveHealthErrorMessage)}
            </div>
          )}
          {liveHealth.reason && (
            <div className="mt-1 text-slate-600">
              {compactErrorMessage(liveHealth.reason)}
            </div>
          )}
          {liveHealth.evidenceSnippets.length > 0 && (
            <div className="mt-1 text-slate-500">
              {liveHealth.evidenceSnippets.slice(0, 2).map((snippet) => (
                <div key={snippet}>{compactErrorMessage(snippet)}</div>
              ))}
            </div>
          )}
          {liveHealth?.recommendedAction && liveHealth.recommendedAction !== "none" && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-slate-600">
              <span className="font-medium">{t("admin.liveSourceRecommendedAction")}:</span>
              <span>{liveSourceRecommendedActionLabel(t, liveHealth?.recommendedAction)}</span>
              <Badge
                variant="outline"
                className={liveSourceOperationalSeverityTone(liveHealth?.operationalSeverity)}
              >
                {liveHealth?.operationalSeverity}
              </Badge>
            </div>
          )}
          {healthTrend && (
            <div className="mt-2 rounded border border-slate-100 bg-slate-50 px-2 py-1">
              <div className="font-medium text-slate-700">{t("admin.liveSourceHealthTrend")}</div>
              <div className="mt-1 text-slate-500">
                {t("admin.liveSourceHealthTrendSummary")
                  .replace("{sampleSize}", String(healthTrend.sampleSize))
                  .replace("{healthyPercent}", String(healthTrend.healthyPercent))}
              </div>
              <div className="mt-1 text-slate-500">
                {t("admin.liveSourceHealthCurrentStreak")
                  .replace("{status}", liveSourceTrendStatusLabel(t, healthTrend.currentStatus))
                  .replace("{count}", String(healthTrend.currentStreak))}
              </div>
              {healthTrend.lastUnhealthyAt && (
                <div className="mt-1 text-rose-700">
                  {t("admin.liveSourceHealthLastUnhealthy").replace(
                    "{time}",
                    formatDate(healthTrend.lastUnhealthyAt),
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mt-1 text-slate-500">{t("admin.liveSourceHealthNoCheck")}</div>
      )}
      <div className="mt-2 rounded border border-slate-100 bg-slate-50 px-2 py-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-700">{t("admin.sourceHealthTriage")}</span>
          <Badge variant="outline" className={sourceHealthTriageTone(triageStatus)}>
            {sourceHealthTriageLabel(t, triageStatus)}
          </Badge>
        </div>
        <div className="mt-1 grid gap-1 text-slate-500">
          <div>
            <span className="font-medium text-slate-600">{t("admin.sourceHealthOwner")}:</span>{" "}
            {liveHealthTriage.liveHealthOwner ?? t("admin.sourceHealthTriage_unassigned")}
          </div>
          <div>
            <span className="font-medium text-slate-600">{t("admin.sourceHealthDisposition")}:</span>{" "}
            {sourceHealthDispositionLabel(t, liveHealthTriage.liveHealthDisposition)}
          </div>
          <div>
            <span className="font-medium text-slate-600">{t("admin.sourceHealthNextReview")}:</span>{" "}
            {formatDate(liveHealthTriage.liveHealthNextReviewAt ?? null)}
          </div>
          {liveHealthTriage.liveHealthReviewedAt && (
            <div>
              <span className="font-medium text-slate-600">
                {t("admin.sourceHealthReviewedAt")}:
              </span>{" "}
              {formatDate(liveHealthTriage.liveHealthReviewedAt)}
            </div>
          )}
          {liveHealthTriage.liveHealthNotes && (
            <div className="text-slate-600">
              <span className="font-medium">{t("admin.sourceHealthNotes")}:</span>{" "}
              {compactErrorMessage(liveHealthTriage.liveHealthNotes)}
            </div>
          )}
        </div>
        {canRunOperations && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(
              [
                ["assign", "sourceHealthTriageAssign"],
                ["accepted_fallback", "sourceHealthTriageAcceptFallback"],
                ["manual", "sourceHealthTriageManual"],
                ["vendor_account", "sourceHealthTriageVendorAccount"],
                ["clear", "sourceHealthTriageClear"],
              ] satisfies [SourceHealthTriageAction, string][]
            ).map(([action, labelKey]) => (
              <Button
                key={action}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onTriage(action)}
                disabled={busy || pending === "triage"}
                className="h-7 rounded-lg border-slate-200 px-2 text-xs"
              >
                {pending === "triage" ? t("admin.sourceHealthTriageSaving") : t(`admin.${labelKey}`)}
              </Button>
            ))}
          </div>
        )}
      </div>
      {canRunOperations && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRecheck()}
          disabled={busy || pending === "recheck"}
          className="mt-2 h-7 rounded-lg border-slate-200 px-2 text-xs"
        >
          {pending === "recheck" ? t("admin.recheckingSource") : t("admin.recheckSource")}
        </Button>
      )}
    </div>
  );
}
