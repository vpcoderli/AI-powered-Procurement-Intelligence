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
  updateAdminDataSource,
  type AdminDataSource,
} from "@/lib/api/admin";
import { runManualCrawl } from "@/lib/manual-crawl";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useBusyIds } from "../busy-reporting";
import { useAdminResource } from "../use-admin-resource";
import { CrawlerLogList } from "./CrawlerLogList";
import { crawlerRunIdFor } from "./crawler-run-id";
import { SourceBidsCard } from "./SourceBidsCard";
import { SourceComplianceCard } from "./SourceComplianceCard";
import { SourceLiveHealthCard } from "./SourceLiveHealthCard";
import { SourceProfileCard } from "./SourceProfileCard";
import { singleRunReport } from "./source-bulk-actions";
import { sourceHealthTriagePatchForAction, type SourceHealthTriageAction } from "./source-labels";

export type SourceDetailTab = "overview" | "config" | "approval" | "runs" | "bids";

/** Spec §6.2 tab order. */
export function sourceDetailTabs(): SourceDetailTab[] {
  return ["overview", "config", "approval", "runs", "bids"];
}

export type PendingAction = "run" | "toggle" | "approve" | "hold" | "recheck" | "triage" | null;

/** The reused panels that start writes of their own and report them through `onBusyChange`. */
export type BusyPanel = "precheck" | "config";

/**
 * The pending slot once `finished` settles: cleared only if it still names that action, so a write that ends late
 * never frees the slot a newer write holds (and never re-enables the controls under it).
 */
export function settledPending(current: PendingAction, finished: Exclude<PendingAction, null>): PendingAction {
  return current === finished ? null : current;
}

/** The row fields the crawler config form is built from (CrawlerConfigPanel's formFromSource). */
export function crawlerConfigInputsChanged(
  previous: Pick<AdminDataSource, "baseUrl" | "cadence" | "fetchConfig">,
  next: Pick<AdminDataSource, "baseUrl" | "cadence" | "fetchConfig">,
): boolean {
  return (
    previous.baseUrl !== next.baseUrl ||
    previous.cadence !== next.cadence ||
    JSON.stringify(previous.fetchConfig ?? {}) !== JSON.stringify(next.fetchConfig ?? {})
  );
}

type Notice = { message: string; tone: "info" | "error" };

export function SourceDetailView({ sourceId }: { sourceId: string }) {
  const { t } = useLanguage();
  const { user, isAdmin, canRunOperations, canManageUsers } = useAdminSession();
  const loadDetail = useCallback(() => getAdminDataSourceDetail(sourceId), [sourceId]);
  const resource = useAdminResource(loadDetail);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  // Writes the reused panels start themselves (a precheck, adopting the suggested base URL, the ledgered approval, the
  // config save) never pass through act(), so each panel reports its own busy state instead.
  const { busyIds: busyPanels, setBusy: setPanelBusy } = useBusyIds<BusyPanel>();
  const onPrecheckBusyChange = useCallback((busy: boolean) => setPanelBusy("precheck", busy), [setPanelBusy]);
  const onConfigBusyChange = useCallback((busy: boolean) => setPanelBusy("config", busy), [setPanelBusy]);
  // One lock for every control the page owns: one of its own actions is in flight, or a panel is writing. Whichever
  // write is running, no other one may start under it.
  const locked = pending !== null || busyPanels.size > 0;
  const [tab, setTab] = useState<SourceDetailTab>("overview");
  // The config tab stays mounted (keepMounted) so an unsaved edit survives a tab switch, and its form is built from
  // the row once, when it mounts. A write from the approval tab that changes what the form was built from (the
  // precheck card's "write to base_url") remounts it; otherwise its next save would put the old address back.
  const [configFormRevision, setConfigFormRevision] = useState(0);

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
      setPending((current) => settledPending(current, action));
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
  const info = (message: string) => setNotice({ message, tone: "info" });
  const failure = (message: string) => setNotice({ message, tone: "error" });

  // The approval tab's writes (the precheck card's base URL adoption, the ledgered approval form).
  const replaceSourceFromApprovalTab = (next: AdminDataSource) => {
    if (crawlerConfigInputsChanged(source, next)) setConfigFormRevision((revision) => revision + 1);
    replaceSource(next);
  };

  // A precheck writes its result into the row's robots and live-health columns, from which the server derives the
  // readiness box, the header badges and the live-health card, so the detail is re-read. The response is not a row
  // (nothing to swap in) and a precheck writes none of the config form's inputs (nothing to remount): the card keeps
  // its fresh result, and the reload keeps the detail on screen while it runs.
  const refreshAfterPrecheck = () => void resource.reload();

  const runNow = () =>
    act("run", async () => {
      if (!runId) return;
      try {
        const outcome = await runManualCrawl({ sources: [source] }, { transportFailure: "stop" });
        if (outcome.failed) throw outcome.failure;
        setNotice(singleRunReport(t, source.label, outcome.statuses[runId]));
        await resource.reload();
      } catch {
        failure(t("admin.runSourceFailed").replace("{source}", source.label));
      }
    });

  const toggleEnabled = () =>
    act("toggle", async () => {
      try {
        await updateAdminDataSource(source.id, { isEnabled: !source.isEnabled });
        await resource.reload();
      } catch {
        failure(t("admin.updateFailed"));
      }
    });

  // Approve (federal/state rows) and Hold of this one source; neither writes a compliance ledger.
  const updateApproval = (approvalStatus: "approved" | "needs_review") =>
    act(approvalStatus === "approved" ? "approve" : "hold", async () => {
      try {
        await updateAdminDataSource(
          source.id,
          approvalStatus === "approved"
            ? { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "Approved from Admin source approval workflow." }
            : { approvedForIngestion: false, approvalStatus: "needs_review", legalReviewStatus: "not_reviewed", approvalNotes: "Held for source health or legal review." },
        );
        info(t("admin.sourceApprovalUpdated"));
        await resource.reload();
      } catch {
        failure(t("admin.sourceApprovalFailed"));
      }
    });

  const recheck = () =>
    act("recheck", async () => {
      try {
        const { source: updated } = await checkAdminDataSourceHealth(source.id, { timeoutMs: 10_000 });
        replaceSource(updated);
        info(t("admin.sourceHealthRechecked"));
      } catch {
        failure(t("admin.sourceHealthRecheckFailed"));
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
        info(t("admin.sourceHealthTriageUpdated"));
      } catch {
        failure(t("admin.sourceHealthTriageFailed"));
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
            <Button type="button" onClick={() => void runNow()} disabled={locked} className="h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
              <Play size={16} />
              {t("admin.sourceDetailRunNow")}
            </Button>
          )}
          {canRunOperations && (
            <Button type="button" variant="outline" onClick={() => void toggleEnabled()} disabled={locked} className="h-9 rounded-lg border-slate-200">
              {source.isEnabled ? t("admin.sourceDetailDisable") : t("admin.sourceDetailEnable")}
            </Button>
          )}
          {canManageUsers && (
            <>
              {/* This approve writes no compliance ledger, so it is offered for federal/state rows only. A
                  county/city/township row is approved through the ledgered batch panel or the "approve
                  county/city source" form in the precheck card (spec §7.3). Hold is offered for every row but a
                  blocked one: a block changes only through an explicit Approve here or that ledgered form. */}
              {!isLocalJurisdictionSource(source) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void updateApproval("approved")}
                  disabled={locked || source.approvalStatus === "approved"}
                  className="h-9 rounded-lg border-emerald-200 text-emerald-700"
                >
                  {t("admin.approveSource")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => void updateApproval("needs_review")}
                disabled={locked || source.approvalStatus === "needs_review" || source.approvalStatus === "blocked"}
                className="h-9 rounded-lg border-amber-200 text-amber-700"
              >
                {t("admin.holdSource")}
              </Button>
            </>
          )}
        </div>
      </section>

      <AdminNotice message={notice?.message ?? null} tone={notice?.tone} />
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
            busy={locked}
            onRecheck={() => void recheck()}
            onTriage={(action) => void triage(action)}
          />
        </TabsContent>

        {/* keepMounted: switching tabs must not throw away an unsaved config edit. */}
        <TabsContent value="config" keepMounted>
          {canRunOperations ? (
            <CrawlerConfigPanel key={configFormRevision} source={source} disabled={locked} onSaved={replaceSource} onBusyChange={onConfigBusyChange} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              <p>{t("admin.sourceDetailConfigReadOnly")}</p>
              <p className="mt-2 font-medium text-slate-700">{t("admin.fieldFetchConfig")}</p>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(source.fetchConfig, null, 2)}</pre>
            </div>
          )}
        </TabsContent>

        {/* keepMounted: switching tabs must not throw away the precheck card's fresh result (its robots.txt flag
            decides whether the ledgered approval form requires a legal reference) or a half-filled approval form. */}
        <TabsContent value="approval" keepMounted className="flex flex-col gap-4">
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
          <SourceProfileCard source={source} />
          {canRunOperations && (
            <SourcePrecheckPanel
              source={source}
              reviewerEmail={user.email}
              disabled={locked}
              canApprove={isAdmin}
              onSourceUpdated={replaceSourceFromApprovalTab}
              onPrecheckCompleted={refreshAfterPrecheck}
              onBusyChange={onPrecheckBusyChange}
            />
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
