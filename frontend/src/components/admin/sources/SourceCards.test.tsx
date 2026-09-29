import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminCrawlerLog, AdminDataSourceDetail } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { CrawlerLogRow } from "./CrawlerLogList";
import { SourceBidsCard } from "./SourceBidsCard";
import { SourceComplianceCard } from "./SourceComplianceCard";
import { SourceLiveHealthCard } from "./SourceLiveHealthCard";
import { adminSourceFixture as source } from "./test-fixtures";

const admin = en.admin as Record<string, string>;

// The cards only need the language context; the provider renders as English on the server.
const render = (node: React.ReactElement) => renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
const text = (html: string) => html.replace(/<!-- -->/g, "");

function approvalEvent(id: string, action: string, actorUserId: string | null) {
  return {
    id, sourceId: "bidnet_co_denver", actorUserId, action, previousApprovalStatus: null, nextApprovalStatus: null,
    previousLegalReviewStatus: null, nextLegalReviewStatus: null, previousApprovedForIngestion: null, nextApprovedForIngestion: null,
    reason: null, createdAt: "2026-09-10T12:00:00.000Z",
  };
}

const noop = () => undefined;

describe("SourceComplianceCard", () => {
  it("renders the ledger and the two latest approval events, with no width cap of its own", () => {
    const html = text(
      render(
        <SourceComplianceCard
          source={source({
            robotsTxtStatus: "clear",
            tosReviewed: true,
            complianceReviewer: "reviewer@example.com",
            legalOpinionReference: "LEGAL-42",
            complianceReviewDueAt: "2027-01-15T00:00:00.000Z",
            approvalHistory: [approvalEvent("e1", "approved", "user-1"), approvalEvent("e2", "held", null), approvalEvent("e3", "approved", "user-3")],
          })}
        />,
      ),
    );

    expect(html).toContain(admin.complianceLedger);
    expect(html).toContain(admin.robotsTxt_clear);
    expect(html).toContain(admin.tosReviewed_yes);
    expect(html).toContain("Reviewer: reviewer@example.com");
    expect(html).toContain("LEGAL-42");
    expect(html).toContain(admin.sourceApprovalHistory);
    expect(html).toContain("Actor user-1");
    expect(html).not.toContain("Actor user-3");
    // The table cell that still hosts the card caps its width; the detail page lets it fill the tab.
    expect(html).not.toContain("max-w-64");
  });

  it("leaves the history box out when the source has no approval events", () => {
    const html = render(<SourceComplianceCard source={source()} />);

    expect(html).toContain(admin.complianceLedger);
    expect(html).toContain(admin.tosReviewed_no);
    expect(html).not.toContain(admin.sourceApprovalHistory);
  });
});

describe("SourceLiveHealthCard", () => {
  const props = { canRunOperations: true, pending: null, onRecheck: noop, onTriage: noop };
  const controlLabels = [
    admin.sourceHealthTriageAssign,
    admin.sourceHealthTriageAcceptFallback,
    admin.sourceHealthTriageManual,
    admin.sourceHealthTriageVendorAccount,
    admin.sourceHealthTriageClear,
    admin.recheckSource,
  ];

  it("shows the empty state, the triage queue and the operator controls", () => {
    const html = render(<SourceLiveHealthCard source={source()} {...props} />);

    expect(html).toContain(admin.liveSourceHealth);
    expect(html).toContain(admin.liveSourceHealthNoCheck);
    expect(html).toContain(admin.sourceHealthTriage_unassigned);
    for (const label of controlLabels) expect(html).toContain(label);
  });

  it("hides every write control without operations access", () => {
    const html = render(<SourceLiveHealthCard source={source()} {...props} canRunOperations={false} />);

    expect(html).toContain(admin.liveSourceHealth);
    for (const label of controlLabels) expect(html).not.toContain(label);
  });

  it("disables the controls of the running write and relabels it", () => {
    const rechecking = render(<SourceLiveHealthCard source={source()} {...props} pending="recheck" />);
    expect(rechecking).toContain(admin.recheckingSource);
    expect(rechecking).not.toContain(`>${admin.recheckSource}<`);
    expect(rechecking.match(/ disabled=""/g)?.length).toBe(1);

    const triaging = render(<SourceLiveHealthCard source={source()} {...props} pending="triage" />);
    expect(triaging.match(new RegExp(`>${admin.sourceHealthTriageSaving}<`, "g"))?.length).toBe(5);
    expect(triaging).not.toContain("common.saving");
    expect(triaging.match(/ disabled=""/g)?.length).toBe(5);
    expect(triaging).toContain(`>${admin.recheckSource}<`);
  });

  it("disables every control while another write on the page is running, without relabelling any of them", () => {
    const html = render(<SourceLiveHealthCard source={source()} {...props} busy />);

    // Five triage buttons and the recheck button: the detail page's Run, Enable/Disable, Approve or Hold is in flight.
    expect(html.match(/ disabled=""/g)?.length).toBe(6);
    expect(html).toContain(`>${admin.recheckSource}<`);
    expect(html).not.toContain(admin.recheckingSource);
    expect(html).not.toContain(admin.sourceHealthTriageSaving);
  });

  it("keeps every control enabled while nothing is running", () => {
    expect(render(<SourceLiveHealthCard source={source()} {...props} />)).not.toContain(' disabled=""');
    expect(render(<SourceLiveHealthCard source={source()} {...props} busy={false} />)).not.toContain(' disabled=""');
  });

  it("has no outer margin of its own, like the compliance card", () => {
    expect(render(<SourceLiveHealthCard source={source()} {...props} />).startsWith('<div class="rounded-md border')).toBe(true);
    expect(render(<SourceLiveHealthCard source={source()} {...props} />)).not.toMatch(/^<div class="[^"]*\bmt-2\b/);
  });

  it("renders the latest live check, its trend and the review fields", () => {
    const html = text(
      render(
        <SourceLiveHealthCard
          source={source({
            latestLiveHealth: {
              checkedAt: "2026-09-20T10:00:00.000Z", status: "unhealthy", method: "GET", httpStatus: 403, statusCode: 403, statusText: "Forbidden",
              errorCode: null, errorMessage: null, error: null, classification: "forbidden", reason: "Portal answers 403 to the crawler",
              evidenceSnippets: ["Access denied", "Enable cookies", "third snippet is not shown"], latencyMs: 412, url: null,
              operationalSeverity: "critical", recommendedAction: "update_registry_url",
            },
            sourceHealthTrend: { sampleSize: 8, healthyChecks: 6, unhealthyChecks: 2, skippedChecks: 0, healthyPercent: 75, currentStatus: "unhealthy", currentStreak: 2, lastUnhealthyAt: "2026-09-20T10:00:00.000Z" },
            liveHealthOwner: "ops@example.com",
            liveHealthDisposition: "manual",
            liveHealthNotes: "Waiting on the vendor",
          })}
          {...props}
        />,
      ),
    );

    expect(html).toContain(admin.liveSourceHealth_unhealthy);
    expect(html).toContain(admin.sourceHealthClassification_forbidden);
    expect(html).toContain("HTTP 403");
    expect(html).toContain("412 ms");
    expect(html).toContain("Portal answers 403 to the crawler");
    expect(html).toContain("Access denied");
    expect(html).not.toContain("third snippet is not shown");
    expect(html).toContain(admin.sourceHealthAction_update_registry_url);
    expect(html).toContain("critical");
    expect(html).toContain(admin.liveSourceHealthTrend);
    expect(html).toContain("ops@example.com");
    expect(html).toContain("Waiting on the vendor");
    expect(html).not.toContain(admin.liveSourceHealthNoCheck);
  });
});

describe("SourceBidsCard", () => {
  const bids: AdminDataSourceDetail["bids"] = {
    counts: { open: 3, closed: 2, awarded: 1, total: 6 },
    latest: [
      { id: "bidnet_co_denver:9001", title: "Roof replacement", publishedDate: "2026-09-01", deadlineDate: null, lifecycleStatus: "open" },
      { id: "bidnet_co_denver:9002", title: "Snow removal", publishedDate: null, deadlineDate: "2026-11-01", lifecycleStatus: "mystery" },
    ],
  };

  it("counts the bids by lifecycle and links each latest bid to its detail page", () => {
    const html = text(render(<SourceBidsCard bids={bids} />));

    for (const [label, value] of [[admin.bidLifecycle_open, 3], [admin.bidLifecycle_closed, 2], [admin.bidLifecycle_awarded, 1], [admin.bidTotal, 6]] as const) {
      expect(html).toContain(`<dt class="text-xs font-medium text-slate-500">${label}</dt><dd class="text-xl font-semibold text-slate-950">${value}</dd>`);
    }
    expect(html).toContain('href="/bids/bidnet_co_denver%3A9001"');
    expect(html).toContain("Roof replacement");
    expect(html).toContain(`${admin.fieldPublished}: 2026-09-01 · ${admin.fieldDeadline}: - · ${admin.bidLifecycle_open}`);
    expect(html).toContain(`${admin.fieldPublished}: - · ${admin.fieldDeadline}: 2026-11-01`);
  });

  it("shows an unknown lifecycle status as itself instead of a raw dictionary key", () => {
    const html = text(render(<SourceBidsCard bids={bids} />));

    expect(html).toContain("· mystery");
    expect(html).not.toContain("admin.bidLifecycle_mystery");
  });

  it("says so when the source has no bids", () => {
    const html = render(<SourceBidsCard bids={{ counts: { open: 0, closed: 0, awarded: 0, total: 0 }, latest: [] }} />);

    expect(html).toContain(admin.sourceDetailNoBids);
    expect(html).not.toContain("<ul");
  });
});

describe("CrawlerLogRow", () => {
  const log: AdminCrawlerLog = {
    id: "log-1", source: "bidnet_co_denver", runId: "run-1", status: "failure", startedAt: "2026-09-20T10:00:00.000Z",
    finishedAt: "2026-09-20T10:01:00.000Z", durationMs: 60_000, fetchedCount: 25, insertedCount: 3, updatedCount: 2, skippedCount: 0,
    failedCount: 1, errorCode: "HTTP_403", errorMessage: "Portal answered 403", metadata: null, fallbackSource: "fixture", fallbackReason: "Live fetch blocked", fallbackFixture: null,
  };

  it("renders the run's source, status, counts, error and fallback", () => {
    const html = text(render(<CrawlerLogRow log={log} />));

    expect(html).toContain("bidnet_co_denver");
    expect(html).toContain(">failure<");
    expect(html).toContain("25/3/2/1");
    expect(html).toContain("Portal answered 403");
    expect(html).toContain(`${admin.fallbackUsed}</span>: Live fetch blocked`);
  });

  it("renders a clean run without an error or fallback line", () => {
    const html = text(render(<CrawlerLogRow log={{ ...log, status: "success", failedCount: 0, errorMessage: null, fallbackSource: null, fallbackReason: null }} />));

    expect(html).toContain(">success<");
    expect(html).not.toContain("text-rose-700\">Portal");
    expect(html).not.toContain(admin.fallbackUsed);
  });
});
