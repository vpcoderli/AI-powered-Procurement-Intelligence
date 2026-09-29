import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { settledPending, sourceDetailTabs } from "./SourceDetailView";

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
    expect(view).toContain("onSourceUpdated={replaceSource}");
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
  it("locks every control of the page while any action is pending", () => {
    const view = read("SourceDetailView.tsx");

    expect(view).toContain("busy={pending !== null}");
    expect(view).toContain("disabled={pending !== null}");
    expect(view).toContain("disabled={pending !== null || source.approvalStatus");
    expect(view).toContain("setPending((current) => settledPending(current, action))");
    expect(view).not.toContain("setPending(null)");
  });

  it("puts the source's profile and governance card on the approval tab", () => {
    expect(read("SourceDetailView.tsx")).toContain("<SourceProfileCard source={source} />");
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
