"use client";

import { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UniversalState } from "@/components/universal-state";
import { isLocalJurisdictionSource } from "@/components/admin/ApproveLocalSourceDialog";
import { CrawlerConfigPanel } from "@/components/admin/CrawlerConfigPanel";
import { approvalReasonKey } from "@/components/admin/LedgeredApprovalPanel";
import { SourcePrecheckPanel } from "@/components/admin/SourcePrecheckPanel";
import {
  AdminApiError,
  checkAdminDataSourceHealth,
  getAdminDataSourceDetail,
  runStateCrawlersNow,
  updateAdminDataSource,
  type AdminDataSource,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { CrawlerLogList } from "./CrawlerLogList";
import { crawlerRunIdFor } from "./crawler-run-id";
import { SourceBidsCard } from "./SourceBidsCard";
import { SourceComplianceCard } from "./SourceComplianceCard";
import { SourceLiveHealthCard } from "./SourceLiveHealthCard";
import { sourceHealthTriagePatchForAction, type SourceHealthTriageAction } from "./source-labels";

export type SourceDetailTab = "overview" | "config" | "approval" | "runs" | "bids";

/** Spec §6.2 tab order. */
export function sourceDetailTabs(): SourceDetailTab[] {
  return ["overview", "config", "approval", "runs", "bids"];
}

type PendingAction = "run" | "toggle" | "approve" | "hold" | "recheck" | "triage" | null;

export function SourceDetailView({ sourceId }: { sourceId: string }) {
  const { t } = useLanguage();
  const { user, canRunOperations, canManageUsers } = useAdminSession();
  const loadDetail = useCallback(() => getAdminDataSourceDetail(sourceId), [sourceId]);
  const resource = useAdminResource(loadDetail);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [tab, setTab] = useState<SourceDetailTab>("overview");

  const detail = resource.data;
  // The panels hand back the row they just wrote. The header badges, the readiness and the log keys are
  // derived from the row on the server (an approval or a new base URL changes them), so the detail is
  // re-read right after the row is swapped in; the panels stay mounted while it loads.
  const replaceSource = (next: AdminDataSource) => {
    resource.setData((current) => (current ? { ...current, source: next } : current));
    void resource.reload();
  };

  const act = async (action: Exclude<PendingAction, null>, work: () => Promise<void>) => {
    setPending(action);
    setNotice(null);
    try {
      await work();
    } finally {
      setPending(null);
    }
  };

  if (!detail) {
    if (resource.status === "error" && resource.error instanceof AdminApiError && resource.error.status === 404) {
      return (
        <UniversalState
          actions={[{ href: "/admin/sources", label: t("admin.sourceDetailBackToList") }]}
          className="bg-white"
          code="empty"
          message={t("admin.sourceDetailNotFoundDescription")}
          title={t("admin.sourceDetailNotFoundTitle")}
        />
      );
    }
    if (resource.status === "error") {
      return (
        <AdminSectionStateCard
          action={() => void resource.reload()}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.nav_sourceDetail")}
        />
      );
    }
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.nav_sourceDetail")} />;
  }

  const source = detail.source;
  const runId = crawlerRunIdFor(source);

  const runNow = () =>
    act("run", async () => {
      if (!runId) return;
      try {
        await runStateCrawlersNow([runId]);
        setNotice(t("admin.runSourceQueued").replace("{source}", source.label));
        await resource.reload();
      } catch {
        setNotice(t("admin.runSourceFailed").replace("{source}", source.label));
      }
    });

  const toggleEnabled = () =>
    act("toggle", async () => {
      try {
        await updateAdminDataSource(source.id, { isEnabled: !source.isEnabled });
        await resource.reload();
      } catch {
        setNotice(t("admin.updateFailed"));
      }
    });

  // The old table's per-row approve/hold (it writes no compliance ledger).
  const updateApproval = (approvalStatus: "approved" | "needs_review") =>
    act(approvalStatus === "approved" ? "approve" : "hold", async () => {
      try {
        await updateAdminDataSource(
          source.id,
          approvalStatus === "approved"
            ? { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "Approved from Admin source approval workflow." }
            : { approvedForIngestion: false, approvalStatus: "needs_review", legalReviewStatus: "not_reviewed", approvalNotes: "Held for source health or legal review." },
        );
        setNotice(t("admin.sourceApprovalUpdated"));
        await resource.reload();
      } catch {
        setNotice(t("admin.sourceApprovalFailed"));
      }
    });

  const recheck = () =>
    act("recheck", async () => {
      try {
        const { source: updated } = await checkAdminDataSourceHealth(source.id, { timeoutMs: 10_000 });
        replaceSource(updated);
        setNotice(t("admin.sourceHealthRechecked"));
      } catch {
        setNotice(t("admin.sourceHealthRecheckFailed"));
      }
    });

  const triage = (action: SourceHealthTriageAction) =>
    act("triage", async () => {
      try {
        const { source: updated } = await updateAdminDataSource(
          source.id,
          sourceHealthTriagePatchForAction(action, user.email || user.displayName || user.id),
        );
        replaceSource(updated);
        setNotice(t("admin.sourceHealthTriageUpdated"));
      } catch {
        setNotice(t("admin.sourceHealthTriageFailed"));
      }
    });

  const facts: Array<[string, string]> = [
    [t("admin.fieldSourceId"), source.id],
    [t("admin.fieldJurisdiction"), source.jurisdictionName ?? "-"],
    [t("admin.fieldGeoid"), source.fipsCode ?? "-"],
    [t("admin.fieldBaseUrl"), source.baseUrl ?? "-"],
    [t("admin.fieldPlatform"), detail.states.platform],
    [t("admin.cadence"), source.cadence],
    [t("admin.fieldLastSuccess"), formatDate(source.lastSuccessAt)],
    [t("admin.fieldLastFailure"), formatDate(source.lastFailureAt)],
    [t("admin.fieldConsecutiveFailures"), String(source.consecutiveFailures)],
  ];
  const readinessReasonKey = detail.readiness?.reason ? approvalReasonKey(detail.readiness.reason) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-slate-950">{source.label}</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t(`admin.coverageLevel_${detail.states.level}`)}</Badge>
            <Badge variant="outline">{source.stateCode}</Badge>
            <Badge variant="outline">{t(`admin.sourcesApproval_${detail.states.approval}`)}</Badge>
            <Badge variant="outline">{t(`admin.sourcesHealth_${detail.states.health}`)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRunOperations && runId && (
            <Button type="button" onClick={() => void runNow()} disabled={pending !== null} className="h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
              <Play size={16} />
              {t("admin.sourceDetailRunNow")}
            </Button>
          )}
          {canRunOperations && (
            <Button type="button" variant="outline" onClick={() => void toggleEnabled()} disabled={pending !== null} className="h-9 rounded-lg border-slate-200">
              {source.isEnabled ? t("admin.sourceDetailDisable") : t("admin.sourceDetailEnable")}
            </Button>
          )}
          {canManageUsers && (
            <>
              {/* This approve writes no compliance ledger, so it is offered for federal/state rows only. A
                  county/city/township row is approved through the ledgered batch panel or the "approve
                  county/city source" form in the precheck card (spec §7.3). Hold stays available for every row,
                  as it was in the old table. */}
              {!isLocalJurisdictionSource(source) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void updateApproval("approved")}
                  disabled={pending !== null || source.approvalStatus === "approved"}
                  className="h-9 rounded-lg border-emerald-200 text-emerald-700"
                >
                  {t("admin.approveSource")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => void updateApproval("needs_review")}
                disabled={pending !== null || source.approvalStatus === "needs_review"}
                className="h-9 rounded-lg border-amber-200 text-amber-700"
              >
                {t("admin.holdSource")}
              </Button>
            </>
          )}
        </div>
      </section>

      <AdminNotice message={notice} />
      {resource.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}

      <Tabs value={tab} onValueChange={(value) => setTab(value as SourceDetailTab)}>
        {/* The five English labels are wider than a phone; scroll the strip instead of the page. */}
        <div className="max-w-full overflow-x-auto">
          <TabsList>
            {sourceDetailTabs().map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`admin.sourceDetailTab_${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-slate-500">{label}</dt>
                <dd className="break-all text-sm text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <SourceLiveHealthCard
            source={source}
            canRunOperations={canRunOperations}
            pending={pending === "recheck" || pending === "triage" ? pending : null}
            onRecheck={() => void recheck()}
            onTriage={(action) => void triage(action)}
          />
        </TabsContent>

        <TabsContent value="config">
          {canRunOperations ? (
            <CrawlerConfigPanel source={source} disabled={pending !== null} onSaved={replaceSource} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              <p>{t("admin.sourceDetailConfigReadOnly")}</p>
              <p className="mt-2 font-medium text-slate-700">{t("admin.fieldFetchConfig")}</p>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(source.fetchConfig, null, 2)}</pre>
            </div>
          )}
        </TabsContent>

        <TabsContent value="approval" className="flex flex-col gap-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="font-semibold text-slate-950">{t("admin.sourceDetailReadiness")}</div>
            {detail.readiness ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{t(`admin.ledgeredApprovalBucket_${detail.readiness.bucket}`)}</Badge>
                {detail.readiness.reason && (
                  <span className="text-slate-600">{readinessReasonKey ? t(readinessReasonKey) : detail.readiness.reason}</span>
                )}
                <span className="text-slate-500">
                  {t("admin.platformReviewStatus")}: {t(`admin.platformReviewStatus_${detail.readiness.platformReview.status}`)}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-slate-600">{t("admin.sourceDetailReadinessNotLocal")}</p>
            )}
          </section>
          {canRunOperations && (
            <SourcePrecheckPanel source={source} reviewerEmail={user.email} disabled={pending !== null} onSourceUpdated={replaceSource} />
          )}
          <SourceComplianceCard source={source} />
        </TabsContent>

        <TabsContent value="runs">
          <CrawlerLogList sources={detail.logSourceKeys} title={t("admin.sourceDetailTab_runs")} />
        </TabsContent>

        <TabsContent value="bids">
          <SourceBidsCard bids={detail.bids} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
