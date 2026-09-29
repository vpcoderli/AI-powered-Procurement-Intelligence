"use client";

import { Activity, Bell, Download, Search, ShieldCheck, UserCog } from "lucide-react";
import { getAdminMarketingFunnel } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { AdminNotice, AdminSectionStateCard, SummaryCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

const loadFunnel = () => getAdminMarketingFunnel().then((response) => response.summary);

export function GrowthFunnelSection() {
  const { t } = useLanguage();
  const funnel = useAdminResource(loadFunnel);
  const marketingFunnel = funnel.data;

  if (funnel.status === "error" && !marketingFunnel) {
    return (
      <AdminSectionStateCard
        action={() => void funnel.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.growthFunnelTitle")}
      />
    );
  }
  if (!marketingFunnel) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.growthFunnelTitle")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {funnel.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold text-slate-950">
            <Bell size={18} />
            {t("admin.growthFunnelTitle")}
          </div>
          <a
            href="/api/admin/marketing/leads/export"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download size={16} />
            {t("admin.growthExportLeads")}
          </a>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label={t("admin.growthRequestDemo")} value={marketingFunnel.counts.requestDemoSubmitted} icon={Bell} />
          <SummaryCard label={t("admin.growthSignupComplete")} value={marketingFunnel.counts.completeSignup} icon={UserCog} />
          <SummaryCard label={t("admin.growthProfileStarted")} value={marketingFunnel.counts.startSupplierProfile} icon={Activity} />
          <SummaryCard label={t("admin.growthProfileComplete")} value={marketingFunnel.counts.completeSupplierProfile} icon={ShieldCheck} />
          <SummaryCard label={t("admin.growthFirstMatchedBid")} value={marketingFunnel.counts.firstMatchedBidViewed} icon={Search} />
        </div>
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="text-sm font-black text-slate-950">{t("admin.growthLatestLeads")}</div>
          {marketingFunnel.latestRequestDemoLeads.length === 0 ? (
            <div className="mt-2 text-sm font-medium text-slate-500">{t("admin.growthNoLeads")}</div>
          ) : (
            <div className="mt-3 grid gap-2">
              {marketingFunnel.latestRequestDemoLeads.map((lead) => (
                <div
                  key={lead.eventId}
                  className="grid gap-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm md:grid-cols-[1fr_auto]"
                >
                  <div>
                    <div className="font-bold text-slate-900">{lead.companyName ?? lead.email ?? lead.eventId}</div>
                    <div className="text-slate-500">{lead.email ?? "-"}</div>
                  </div>
                  <div className="text-xs font-medium text-slate-500">{formatDate(lead.occurredAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
