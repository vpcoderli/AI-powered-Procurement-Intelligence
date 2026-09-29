"use client";

import { useState } from "react";
import { LedgeredApprovalPanel, providerFamiliesOf } from "@/components/admin/LedgeredApprovalPanel";
import { PlatformReviewsPanel } from "@/components/admin/PlatformReviewsPanel";
import { getAdminApprovalReadiness } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useAdminSession } from "../admin-session";
import { AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

// Families come from readiness (console-read) because the index API is admin/operator only (plan decision 14).
const loadFamilies = () => getAdminApprovalReadiness().then((summary) => providerFamiliesOf(summary.sources));

// The panels were written to sit in a card (each root ends in a hairline); this is the card the old sources
// section gave them, minus the hairline on its last edge.
const PANEL_CARD = "rounded-lg border border-slate-200 bg-white shadow-sm [&>div]:border-b-0";

export function OnboardingSection() {
  const { t } = useLanguage();
  const { user, isAdmin, canRunOperations } = useAdminSession();
  const families = useAdminResource(loadFamilies);
  const [platformReviewRevision, setPlatformReviewRevision] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <section className={PANEL_CARD}>
        <PlatformReviewsPanel
          canManage={isAdmin}
          reviewerEmail={user.email}
          onSaved={() => setPlatformReviewRevision((revision) => revision + 1)}
        />
      </section>
      {families.data ? (
        <section className={PANEL_CARD}>
          <LedgeredApprovalPanel
            providerFamilies={families.data}
            canApprove={isAdmin}
            canRequestPrechecks={canRunOperations}
            refreshKey={platformReviewRevision}
          />
        </section>
      ) : (
        <AdminSectionStateCard
          action={families.status === "error" ? () => void families.reload() : undefined}
          actionLabel={t("admin.refresh")}
          code={families.status === "error" ? "error" : "loading"}
          message={families.status === "error" ? t("admin.errorDescription") : t("admin.loading")}
          title={t("admin.ledgeredApprovalTitle")}
        />
      )}
    </div>
  );
}
