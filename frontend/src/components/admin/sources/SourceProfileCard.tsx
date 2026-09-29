"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { AdminDataSource } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  crawlerAdapterLabel,
  crawlerCapabilityLabel,
  crawlerMaturityLabel,
  crawlerTone,
  formatCrawlerBaseUrl,
  sourceApprovalLabel,
  sourceApprovalTone,
  sourceAuthorityLabel,
  sourceEvidenceLabel,
  sourceLegalReviewLabel,
  sourceLegalReviewTone,
  sourceRequirementLabels,
  sourceTrustLabel,
  sourceTrustTone,
} from "./source-labels";

const NEUTRAL_BADGE = "border-slate-200 bg-white text-slate-600";
const WARNING_BADGE = "border-amber-200 bg-amber-50 text-amber-700";
const AUTHORITY_BADGE = "border-indigo-200 bg-indigo-50 text-indigo-700";
/** Free text written by people and scripts (block reasons, URLs, evidence paths): kept as written and wrapped anywhere. */
const NOTE_CLASS = "whitespace-pre-line break-words [overflow-wrap:anywhere]";

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * The governance and profile fields an admin reads before Hold or Approve: the approval state with the
 * ingestion flag, the legal review and the approval notes (a ledgered batch approval writes its platform
 * review and precheck there); how the portal is reached, including whether it needs a login, which decides
 * what ledger an approval must carry; the registry's authority, trust and evidence; the crawler behind the
 * source; and the validity and fallback notes. Every value is the row's own, as the API returns it.
 */
export function SourceProfileCard({ source }: { source: AdminDataSource }) {
  const { t } = useLanguage();
  const requirements = sourceRequirementLabels(t, source);
  const hasTrustProfile = Boolean(source.sourceAuthority || source.trustStatus || source.evidenceMode);
  const crawlerHost = formatCrawlerBaseUrl(source.crawlerBaseUrl);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-950">{t("admin.sourceProfileTitle")}</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={t("admin.fieldApproval")}>
          <Badge variant="outline" className={sourceApprovalTone(source.approvalStatus)}>
            {sourceApprovalLabel(t, source)}
          </Badge>
          {!source.approvedForIngestion && (
            <Badge variant="outline" className={WARNING_BADGE}>
              {t("admin.sourceApprovalRequired")}
            </Badge>
          )}
        </Field>
        <Field label={t("admin.sourceLegalReview")}>
          <Badge variant="outline" className={sourceLegalReviewTone(source.legalReviewStatus)}>
            {sourceLegalReviewLabel(t, source.legalReviewStatus)}
          </Badge>
        </Field>
        <Field label={t("admin.sourceApprovalNotes")} wide>
          <span className={NOTE_CLASS}>{source.approvalNotes || "-"}</span>
        </Field>
        <Field label={t("admin.sourceAccessPattern")}>{source.accessPattern}</Field>
        <Field label={t("admin.sourceAccessMode")}>{source.accessMode}</Field>
        <Field label={t("admin.sourceActivationStatus")}>{source.activationStatus}</Field>
        <Field label={t("admin.sourceConfidence")}>{source.sourceConfidence}</Field>
        <Field label={t("admin.sourceRequirements")}>
          {requirements.length === 0
            ? "-"
            : requirements.map((label) => (
                <Badge key={label} variant="outline" className={WARNING_BADGE}>
                  {label}
                </Badge>
              ))}
        </Field>
        <Field label={t("admin.sourceTrustProfile")}>
          {!hasTrustProfile && "-"}
          {source.sourceAuthority && (
            <Badge variant="outline" className={AUTHORITY_BADGE}>
              {sourceAuthorityLabel(t, source.sourceAuthority)}
            </Badge>
          )}
          {source.trustStatus && (
            <Badge variant="outline" className={sourceTrustTone(source.trustStatus)}>
              {sourceTrustLabel(t, source.trustStatus)}
            </Badge>
          )}
          {source.evidenceMode && (
            <Badge variant="outline" className={NEUTRAL_BADGE}>
              {sourceEvidenceLabel(t, source.evidenceMode)}
            </Badge>
          )}
        </Field>
        <Field label={t("admin.crawler")} wide>
          <Badge variant="outline" className={crawlerTone(source.crawlerAdapterKind)}>
            {crawlerAdapterLabel(t, source.crawlerAdapterKind)}
          </Badge>
          <Badge variant="outline" className={crawlerTone(source.crawlerMaturity)}>
            {crawlerMaturityLabel(t, source.crawlerMaturity)}
          </Badge>
          {source.crawlerCapabilities.map((capability) => (
            <Badge key={capability} variant="outline" className={NEUTRAL_BADGE}>
              {crawlerCapabilityLabel(t, capability)}
            </Badge>
          ))}
          {crawlerHost && (
            <span className="text-xs break-all text-slate-500" title={source.crawlerBaseUrl ?? undefined}>
              {source.crawlerSourceId ?? source.id} - {crawlerHost}
            </span>
          )}
        </Field>
        <Field label={t("admin.sourceValidityNotes")} wide>
          <span className={NOTE_CLASS}>{source.validityNotes || "-"}</span>
        </Field>
        <Field label={t("admin.sourceFallbackNotes")} wide>
          <span className={NOTE_CLASS}>{source.fallbackNotes || "-"}</span>
        </Field>
      </dl>
    </section>
  );
}
