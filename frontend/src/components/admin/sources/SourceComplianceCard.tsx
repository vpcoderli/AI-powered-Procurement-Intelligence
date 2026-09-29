"use client";

import { Badge } from "@/components/ui/badge";
import type { AdminDataSource } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { robotsTxtStatusLabel, robotsTxtTone, sourceApprovalActionLabel, tosReviewedTone } from "./source-labels";

/**
 * The compliance ledger and the latest approval events of one source (moved from the old sources
 * table's crawler cell). The card has no width or outer margin of its own: the table cell caps it at
 * max-w-64, the detail page lets it fill the tab.
 */
export function SourceComplianceCard({ source }: { source: AdminDataSource }) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-600">
        <div className="font-semibold text-slate-700">{t("admin.complianceLedger")}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="outline" className={robotsTxtTone(source.robotsTxtStatus)}>
            {robotsTxtStatusLabel(t, source.robotsTxtStatus)}
          </Badge>
          <Badge variant="outline" className={tosReviewedTone(source.tosReviewed)}>
            {source.tosReviewed ? t("admin.tosReviewed_yes") : t("admin.tosReviewed_no")}
          </Badge>
        </div>
        {source.robotsTxtFlagReason && (
          <div className="mt-1 truncate text-amber-700" title={source.robotsTxtFlagReason}>
            {source.robotsTxtFlagReason}
          </div>
        )}
        {source.complianceReviewer && (
          <div className="mt-1 truncate" title={source.complianceReviewer}>
            {t("admin.complianceReviewer")}: {source.complianceReviewer}
          </div>
        )}
        {source.legalOpinionReference && (
          <div className="mt-1 truncate" title={source.legalOpinionReference}>
            {t("admin.legalOpinionReference")}: {source.legalOpinionReference}
          </div>
        )}
        {source.complianceReviewDueAt && (
          <div className="mt-1">
            {t("admin.complianceReviewDue")}: {formatDate(source.complianceReviewDueAt)}
          </div>
        )}
      </div>
      {source.approvalHistory.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50/70 p-2 text-xs leading-5 text-slate-600">
          <div className="font-semibold text-slate-700">{t("admin.sourceApprovalHistory")}</div>
          {source.approvalHistory.slice(0, 2).map((event) => (
            <div key={event.id} className="mt-1">
              <span className="font-medium">{sourceApprovalActionLabel(t, event.action)}</span>
              {" · "}
              <span>{formatDate(event.createdAt)}</span>
              {event.actorUserId ? (
                <>
                  {" · "}
                  <span>{t("admin.sourceApprovalActor").replace("{actor}", event.actorUserId)}</span>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
