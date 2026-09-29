"use client";

import Link from "next/link";
import type { AdminDataSourceDetail } from "@/lib/api/admin";
import { bidDetailPath } from "@/lib/bid-routes";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const KNOWN_LIFECYCLES = ["open", "closed", "awarded"];

export function SourceBidsCard({ bids }: { bids: AdminDataSourceDetail["bids"] }) {
  const { t } = useLanguage();
  const counts: Array<[string, number]> = [
    [t("admin.bidLifecycle_open"), bids.counts.open],
    [t("admin.bidLifecycle_closed"), bids.counts.closed],
    [t("admin.bidLifecycle_awarded"), bids.counts.awarded],
    [t("admin.bidTotal"), bids.counts.total],
  ];
  // t() echoes an unknown dot-path back verbatim, so a status outside the three known ones shows as itself.
  const lifecycleLabel = (status: string) => (KNOWN_LIFECYCLES.includes(status) ? t(`admin.bidLifecycle_${status}`) : status);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-950">{t("admin.sourceDetailBidCounts")}</div>
      <dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className="text-xl font-semibold text-slate-950">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">{t("admin.sourceDetailLatestBids")}</div>
      {bids.latest.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-slate-500">{t("admin.sourceDetailNoBids")}</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {bids.latest.map((bid) => (
            <li key={bid.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <Link href={bidDetailPath(bid.id)} className="font-medium text-slate-900 hover:underline">
                {bid.title}
              </Link>
              <span className="text-xs text-slate-500">
                {t("admin.fieldPublished")}: {bid.publishedDate ?? "-"} · {t("admin.fieldDeadline")}: {bid.deadlineDate ?? "-"} ·{" "}
                {lifecycleLabel(bid.lifecycleStatus)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
