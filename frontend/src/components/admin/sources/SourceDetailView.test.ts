import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { crawlerConfigInputsChanged, settledPending, sourceDetailTabs } from "./SourceDetailView";
import { adminSourceFixture } from "./test-fixtures";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("source detail view", () => {
  it("has the five spec tabs in order with translated labels", () => {
    expect(sourceDetailTabs()).toEqual(["overview", "config", "approval", "runs", "bids"]);
    const enAdmin = en.admin as Record<string, string>;
    const zhAdmin = zh.admin as Record<string, string>;
    for (const tab of sourceDetailTabs()) {
      expect(zhAdmin[`sourceDetailTab_${tab}`]).toBeTruthy();
      expect(zhAdmin[`sourceDetailTab_${tab}`]).not.toBe(enAdmin[`sourceDetailTab_${tab}`]);
    }
  });

  it("loads the detail endpoint and reuses the existing panels", () => {
    const view = read("SourceDetailView.tsx");
    expect(view).toContain("getAdminDataSourceDetail(sourceId)");
    expect(view).toContain("<SourcePrecheckPanel");
    expect(view).toContain("reviewerEmail={user.email}");
    expect(view).toContain("onSourceUpdated={replaceSourceFromApprovalTab}");
    expect(view).toContain("<CrawlerConfigPanel");
    expect(view).toContain("onSaved={replaceSource}");
    expect(view).toContain("<CrawlerLogList");
    expect(view).toContain("sources={detail.logSourceKeys}");
    expect(view).toContain("!isLocalJurisdictionSource(source)");
    expect(view).toContain('t("admin.sourceDetailNotFoundTitle")');
  });

  // Every write of the page goes through act(), which owns one pending slot. The live-health card used to lock only
  // its own two actions, so a recheck or triage could start while Run, Enable/Disable, Approve or Hold was in
  // flight, and whichever finished first cleared the slot and re-enabled every control under the other write.
  // The reused panels start writes that never pass through act(); they report those through onBusyChange, and the
  // page treats a busy panel exactly like a pending action (behaviour: SourceDetailView.render.test.tsx).
  it("locks every control of the page while any action is pending or any panel is writing", () => {
    const view = read("SourceDetailView.tsx");

    expect(view).toContain("const locked = pending !== null || busyPanels.size > 0;");
    // Run and Enable/Disable, then the two panels.
    expect(view.match(/disabled=\{locked\}/g)).toHaveLength(4);
    // Approve and Hold, which also keep their own status rules.
    expect(view).toContain('disabled={locked || source.approvalStatus === "approved"}');
    expect(view).toContain("busy={locked}");
    // The pending slot alone no longer gates a control: `locked` is the one place it is read.
    expect(view.match(/pending !== null/g)).toHaveLength(1);
    expect(view).toContain("setPending((current) => settledPending(current, action))");
    expect(view).not.toContain("setPending(null)");
  });

  // Each panel reports under its own id, so one that says idle twice (its write settled, then it unmounted) cannot free
  // a lock another panel still holds. The dialog inside the precheck card reports through that card.
  it("hears about the writes of each reused panel under that panel's own id", () => {
    const view = read("SourceDetailView.tsx");

    expect(view).toContain("const { busyIds: busyPanels, setBusy: setPanelBusy } = useBusyIds<BusyPanel>();");
    expect(view).toContain('useCallback((busy: boolean) => setPanelBusy("precheck", busy), [setPanelBusy])');
    expect(view).toContain('useCallback((busy: boolean) => setPanelBusy("config", busy), [setPanelBusy])');
    expect(view).toContain("onBusyChange={onPrecheckBusyChange}");
    expect(view).toContain("onBusyChange={onConfigBusyChange}");
    expect(view).not.toContain("<ApproveLocalSourceDialog");
    // The hooks sit ahead of the early returns, and the state is only set from the callbacks the panels report through.
    expect(view.indexOf("useBusyIds<BusyPanel>()")).toBeLessThan(view.indexOf("if (!detail) {"));
    expect(view.match(/setBusyIds\(|setPanelBusy\(/g)).toHaveLength(2);
  });

  // Base UI's Tabs.Panel unmounts a hidden panel by default: a tab switch threw away an unsaved config edit and the
  // precheck card's fresh result (whose robots.txt flag makes the ledgered approval form demand a legal reference).
  it("keeps the config and approval tabs mounted while another tab is shown", () => {
    const view = read("SourceDetailView.tsx");

    expect(view).toContain('<TabsContent value="config" keepMounted>');
    expect(view).toContain('<TabsContent value="approval" keepMounted className="flex flex-col gap-4">');
    // The runs tab reads its first page when it is opened, so it is not kept.
    expect(view).toContain('<TabsContent value="runs">');
  });

  // The kept config form is built from the row once; a base URL the precheck card writes back must not be undone by
  // the form's next save, so an approval-tab write that changes the form's inputs remounts it. Its own save does not.
  it("remounts the kept config form when a write from the approval tab changes what it was built from", () => {
    const view = read("SourceDetailView.tsx");

    expect(view).toContain("<CrawlerConfigPanel key={configFormRevision}");
    expect(view).toContain("if (crawlerConfigInputsChanged(source, next)) setConfigFormRevision((revision) => revision + 1);");
    expect(view.match(/setConfigFormRevision\(/g)).toHaveLength(1);

    const row = adminSourceFixture({ fetchConfig: { enrichment: { enabled: true } } });
    expect(crawlerConfigInputsChanged(row, { ...row })).toBe(false);
    // The ledgered approval form writes governance fields only.
    expect(crawlerConfigInputsChanged(row, adminSourceFixture({ ...row, approvalStatus: "approved", isEnabled: true }))).toBe(false);
    expect(crawlerConfigInputsChanged(row, { ...row, fetchConfig: { enrichment: { enabled: true } } })).toBe(false);
    expect(crawlerConfigInputsChanged(row, { ...row, baseUrl: "https://www.bidnetdirect.com/colorado/city-and-county-of-denver" })).toBe(true);
    expect(crawlerConfigInputsChanged(row, { ...row, cadence: "weekly" })).toBe(true);
    expect(crawlerConfigInputsChanged(row, { ...row, fetchConfig: { enrichment: { enabled: false } } })).toBe(true);
  });

  // The precheck card's approve form PATCHes governance fields, which the API answers 403 to an operator, so only an
  // admin is offered it. A precheck writes its result into the row's robots and live-health columns, from which the
  // server derives the readiness bucket, the header badges and the live-health card: the detail is re-read after it.
  it("hides the ledgered approve form from non-admins and re-reads the detail after a precheck", () => {
    const view = read("SourceDetailView.tsx");

    expect(view).toContain("const { user, isAdmin, canRunOperations, canManageUsers } = useAdminSession();");
    expect(view).toContain("canApprove={isAdmin}");
    expect(view).toContain("onPrecheckCompleted={refreshAfterPrecheck}");
    expect(view).toContain("const refreshAfterPrecheck = () => void resource.reload();");
    // Neither the card's identity nor the kept config form changes on a precheck: a key on the card would remount it
    // and drop its fresh result, and only an approval-tab write that changed the form's inputs may rebuild that form.
    expect(view).not.toMatch(/<SourcePrecheckPanel[^>]*\bkey=/);
    expect(view.match(/setConfigFormRevision\(/g)).toHaveLength(1);
  });

  it("puts the source's profile and governance card on the approval tab", () => {
    const view = read("SourceDetailView.tsx");

    expect(view).toContain("<SourceProfileCard source={source} />");
    expect(view).toContain("<AdminNotice message={notice?.message ?? null} tone={notice?.tone} />");
    // A blocked row is changed only through an explicit Approve or the ledgered form, never by Hold.
    expect(view).toContain('disabled={locked || source.approvalStatus === "needs_review" || source.approvalStatus === "blocked"}');
  });

  it("clears the pending slot only for the action that is finishing", () => {
    expect(settledPending("run", "run")).toBeNull();
    expect(settledPending("triage", "triage")).toBeNull();
    // A slow write finishing after another one started must not free the slot the newer write holds.
    expect(settledPending("triage", "run")).toBe("triage");
    expect(settledPending("recheck", "toggle")).toBe("recheck");
    expect(settledPending(null, "run")).toBeNull();
  });

  it("keeps the moved row markup in its own cards", () => {
    expect(read("SourceLiveHealthCard.tsx")).toContain("const liveHealth = source.latestLiveHealth");
    expect(read("SourceLiveHealthCard.tsx")).toContain("const healthTrend = source.sourceHealthTrend");
    expect(read("SourceComplianceCard.tsx")).toContain('t("admin.complianceLedger")');
    expect(read("CrawlerLogList.tsx")).toContain("listAdminCrawlerLogs(");
    // The page merge and the cursor hand-off moved into crawler-log-pages.ts (unit-tested there); the list wires them.
    expect(read("CrawlerLogList.tsx")).toContain("visibleCrawlerLogs(");
    expect(read("CrawlerLogList.tsx")).toContain("appendCrawlerLogPage(");
    expect(read("crawler-log-pages.ts")).toContain("nextCursor");
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations") and
  // page.test.tsx ("renders source health triage queue fields and dispositions ..."): the live health box's
  // markup now lives in SourceLiveHealthCard.
  it("renders live health, its trend and the triage queue in the live health card", () => {
    const card = read("SourceLiveHealthCard.tsx");

    expect(card).toContain('t("admin.liveSourceHealth")');
    expect(card).toContain("source.latestLiveHealth");
    expect(card).toContain("liveHealth.reason");
    expect(card).toContain("liveHealth.evidenceSnippets");
    expect(card).toContain('t("admin.liveSourceHealthNoCheck")');
    expect(card).toContain("liveHealth?.statusCode");
    expect(card).toContain("liveHealth?.latencyMs");
    expect(card).toContain("liveHealth?.error");
    expect(card).toContain("liveHealth?.recommendedAction");
    expect(card).toContain("liveHealth?.operationalSeverity");
    expect(card).toContain("source.sourceHealthTrend");
    expect(card).toContain('t("admin.liveSourceRecommendedAction")');
    expect(card).toContain('t("admin.liveSourceHealthTrend")');
    expect(card).toContain('t("admin.liveSourceHealthTrendSummary")');
    expect(card).toContain('t("admin.liveSourceHealthCurrentStreak")');
    expect(card).toContain('t("admin.liveSourceHealthLastUnhealthy")');
    expect(card).toContain('t("admin.recheckSource")');
    expect(card).toContain('t("admin.sourceHealthTriage")');
    expect(card).toContain('t("admin.sourceHealthTriage_unassigned")');
    expect(card).toContain("sourceHealthTriageAssign");
    expect(card).toContain("sourceHealthTriageAcceptFallback");
    expect(card).toContain("sourceHealthTriageClear");
    for (const field of [
      "liveHealthOwner",
      "liveHealthDisposition",
      "liveHealthNextReviewAt",
      "liveHealthNotes",
      "liveHealthReviewedAt",
    ]) {
      expect(card).toContain(field);
    }
  });

  it("renders the compliance ledger and the approval history in the compliance card", () => {
    const card = read("SourceComplianceCard.tsx");

    expect(card).toContain("source.approvalHistory.map(");
    expect(card).not.toContain("approvalHistory.slice(");
    expect(card).toContain("{event.reason}");
    expect(card).toContain('t("admin.sourceApprovalHistory")');
    expect(card).toContain('t("admin.sourceApprovalActor")');
    expect(card).toContain("source.robotsTxtFlagReason");
    expect(card).toContain("source.complianceReviewer");
    expect(card).toContain("source.legalOpinionReference");
    expect(card).toContain("source.complianceReviewDueAt");
  });
});
