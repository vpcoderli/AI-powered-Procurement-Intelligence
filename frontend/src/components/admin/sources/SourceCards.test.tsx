import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminCrawlerLog, AdminDataSourceDetail } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { formatBidDate, formatDate, textPreview } from "../admin-format";
import { CRAWLER_LOG_ERROR_PREVIEW_CHARS, CrawlerLogRow } from "./CrawlerLogList";
import { SourceBidsCard } from "./SourceBidsCard";
import { SourceComplianceCard } from "./SourceComplianceCard";
import { SourceLiveHealthCard } from "./SourceLiveHealthCard";
import { SourceProfileCard } from "./SourceProfileCard";
import { adminSourceFixture as source } from "./test-fixtures";

const admin = en.admin as Record<string, string>;

// The cards only need the language context; the provider renders as English on the server.
const render = (node: React.ReactElement) => renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
const text = (html: string) => html.replace(/<!-- -->/g, "");
/** A dictionary value as renderToStaticMarkup escapes it. */
const escaped = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
/** Any text as renderToStaticMarkup escapes it. */
const escapedMarkup = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function approvalEvent(id: string, action: string, actorUserId: string | null, reason: string | null = null) {
  return {
    id, sourceId: "bidnet_co_denver", actorUserId, action, previousApprovalStatus: null, nextApprovalStatus: null,
    previousLegalReviewStatus: null, nextLegalReviewStatus: null, previousApprovedForIngestion: null, nextApprovedForIngestion: null,
    reason, createdAt: "2026-09-10T12:00:00.000Z",
  };
}

const noop = () => undefined;

describe("SourceComplianceCard", () => {
  it("renders the ledger and every approval event the API returns, each with its reason, actor and time", () => {
    const history = [
      approvalEvent("e1", "approved", "user-1", "依据平台审查 #3；预检 ready @2026-09-27T10:00:00.000Z"),
      approvalEvent("e2", "held", null, "Held for source health or legal review."),
      approvalEvent("e3", "approved", "user-3"),
      approvalEvent("e4", "blocked", "user-4", "Blocked 2026-09-21: no such tenant (HTTP 404)."),
      approvalEvent("e5", "updated", null, "Approved from Admin batch source approval workflow."),
    ];
    const html = text(
      render(
        <SourceComplianceCard
          source={source({
            robotsTxtStatus: "clear",
            tosReviewed: true,
            complianceReviewer: "reviewer@example.com",
            legalOpinionReference: "LEGAL-42",
            complianceReviewDueAt: "2027-01-15T00:00:00.000Z",
            approvalHistory: history,
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
    expect(html.match(/<li>/g)).toHaveLength(5);
    for (const actor of ["user-1", "user-3", "user-4"]) expect(html).toContain(`Actor ${actor}`);
    for (const event of history) if (event.reason) expect(html).toContain(event.reason);
    for (const label of [admin.sourceApprovalAction_approved, admin.sourceApprovalAction_held, admin.sourceApprovalAction_blocked, admin.sourceApprovalAction_updated]) {
      expect(html).toContain(`<span class="font-medium">${label}</span>`);
    }
    expect(html).toContain(formatDate("2026-09-10T12:00:00.000Z"));
    // The card has no width cap of its own; the detail page lets it fill the tab.
    expect(html).not.toContain("max-w-64");
  });

  it("leaves the history box out when the source has no approval events", () => {
    const html = render(<SourceComplianceCard source={source()} />);

    expect(html).toContain(admin.complianceLedger);
    expect(html).toContain(admin.tosReviewed_no);
    expect(html).not.toContain(admin.sourceApprovalHistory);
    expect(html).not.toContain(admin.complianceReviewDue);
  });

  // Every stored review due date is a YYYY-MM-DD day (ledgered approval copies the platform review's next_review_at).
  // formatDate printed 2027-09-16 as "Sep 16, 08:00 AM": no year, a midnight UTC shown as 08:00 in UTC+8, and the
  // day before west of UTC.
  it("prints the review due date as the day it is: with its year, without a time and in any viewer's zone", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["Asia/Shanghai", "UTC", "America/Los_Angeles", "Pacific/Honolulu", "Pacific/Kiritimati"]) {
        process.env.TZ = zone;
        const html = text(render(<SourceComplianceCard source={source({ complianceReviewDueAt: "2027-09-16" })} />));

        expect(html, zone).toContain(`${admin.complianceReviewDue}: 2027-09-16</div>`);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("prints a review due date stored as a timestamp as its date, and any other text as stored", () => {
    const due = (complianceReviewDueAt: string) => text(render(<SourceComplianceCard source={source({ complianceReviewDueAt })} />));

    expect(due("2027-01-15T00:00:00.000Z")).toContain(`${admin.complianceReviewDue}: 2027-01-15</div>`);
    expect(due("2027-01-15T23:59:59.000Z")).toContain(`${admin.complianceReviewDue}: 2027-01-15</div>`);
    expect(due("2027-01-15 08:00:00")).toContain(`${admin.complianceReviewDue}: 2027-01-15</div>`);
    expect(due("next spring")).toContain(`${admin.complianceReviewDue}: next spring</div>`);
  });

  it("prints the review due date with the shared date-only label and keeps formatDate for the event times", () => {
    const card = readFileSync(new URL("SourceComplianceCard.tsx", import.meta.url), "utf8");

    expect(card).toContain("platformReviewDateLabel(source.complianceReviewDueAt)");
    expect(card).not.toContain("formatDate(source.complianceReviewDueAt");
    // An approval event's createdAt is a real timestamp.
    expect(card).toContain("formatDate(event.createdAt)");
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
    // Formatted like the rest of the console; a calendar day stays that day in any time zone.
    expect(html).toContain(`${admin.fieldPublished}: ${formatBidDate("2026-09-01")} · ${admin.fieldDeadline}: - · ${admin.bidLifecycle_open}`);
    expect(html).toContain(`${admin.fieldPublished}: - · ${admin.fieldDeadline}: ${formatBidDate("2026-11-01")}`);
    expect(html).not.toContain(": 2026-09-01 ");
  });

  it("formats a US calendar day and a timestamp, and prints a portal's own text as stored", () => {
    const html = text(
      render(
        <SourceBidsCard
          bids={{
            counts: { open: 2, closed: 0, awarded: 0, total: 2 },
            latest: [
              { id: "a:1", title: "Salt", publishedDate: "09/22/2026", deadlineDate: "2026-10-13T19:00:00.000Z", lifecycleStatus: "open" },
              { id: "a:2", title: "Sand", publishedDate: "Aug 31, 2026 @ 02:00 PM", deadlineDate: "1788984000000", lifecycleStatus: "open" },
            ],
          }}
        />,
      ),
    );

    expect(html).toContain(`${admin.fieldPublished}: ${formatBidDate("2026-09-22")} · ${admin.fieldDeadline}: ${formatDate("2026-10-13T19:00:00.000Z")}`);
    expect(html).toContain(`${admin.fieldPublished}: Aug 31, 2026 @ 02:00 PM · ${admin.fieldDeadline}: 1788984000000`);
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
    expect(html).not.toContain("Portal answered 403");
    expect(html).not.toContain(admin.fallbackUsed);
  });

  // A crawler error carries the portal URL (HtmlPageError … for url: https://www.bidnetdirect.com/…), one unbreakable
  // word that widened a phone-sized page by ~190px: the text column may shrink and the messages wrap anywhere.
  it("lets a long error or fallback message wrap instead of widening the page", () => {
    const long = `HtmlPageError: HTML request failed: 404 Client Error for url: https://www.bidnetdirect.com/${"colorado/".repeat(12)}solicitations/open-bids`;
    const html = text(render(<CrawlerLogRow log={{ ...log, errorMessage: long }} />));

    expect(html).toContain('<div class="grid gap-2 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center"><div class="min-w-0">');
    expect(html).toContain(`<div class="mt-1 text-sm break-words text-rose-700 [overflow-wrap:anywhere]">${long}</div>`);
    expect(html).toContain('<div class="mt-1 text-sm break-words text-amber-700 [overflow-wrap:anywhere]">');
  });

  it("shows an error of at most the preview length whole, exactly as before, without an expander", () => {
    for (const message of ["Portal answered 403", "e".repeat(CRAWLER_LOG_ERROR_PREVIEW_CHARS)]) {
      const html = render(<CrawlerLogRow log={{ ...log, errorMessage: message }} />);

      expect(html).toContain(`<div class="mt-1 text-sm break-words text-rose-700 [overflow-wrap:anywhere]">${message}</div>`);
      expect(html).not.toContain("<details");
      expect(html).not.toContain(admin.crawlerLogShowFullError);
    }
  });

  // A failed portal fetch can carry the whole HTML page it got (45,380 characters for bidnet_oh_cuyahoga), which made
  // each such row about 23,000px tall: a long error shows its opening, and the full text waits behind a native
  // expander in a box with its own scroll.
  it("shows a long error's opening, with the full text behind a Show full error expander in a scrolling box", () => {
    const page = `HTML request failed with status 404: <!DOCTYPE html><html lang="en"><head>${'<meta content="text/html" />'.repeat(1600)}</head></html>`;
    const html = render(<CrawlerLogRow log={{ ...log, errorMessage: page }} />);
    const preview = textPreview(page, CRAWLER_LOG_ERROR_PREVIEW_CHARS);

    expect(preview).not.toBeNull();
    expect(html).toContain(
      `<div class="mt-1 text-sm break-words text-rose-700 [overflow-wrap:anywhere]">${escapedMarkup(preview!)}<details class="mt-1">` +
        `<summary class="cursor-pointer text-xs font-medium">${admin.crawlerLogShowFullError}</summary>` +
        '<div class="mt-1 max-h-64 overflow-y-auto rounded border border-rose-100 bg-rose-50/40 p-2 text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">' +
        `${escapedMarkup(page)}</div></details></div>`,
    );
    // The whole page is in the markup once, inside the expander; the row itself carries only the preview.
    expect(html.split(escapedMarkup(page))).toHaveLength(2);
    expect(html.indexOf(escapedMarkup(page))).toBeGreaterThan(html.indexOf("<details"));
  });

  it("labels the expander in both languages", () => {
    expect(admin.crawlerLogShowFullError).toBe("Show full error");
    expect((zh.admin as Record<string, string>).crawlerLogShowFullError).toBe("展开完整错误");
  });
});

describe("SourceProfileCard", () => {
  const stateSource = source({
    id: "california_caleprocure", label: "California Cal eProcure", issuerType: "state", jurisdictionLevel: "state", stateCode: "CA",
    approvalStatus: "approved", approvedForIngestion: true, legalReviewStatus: "approved_public", approvalNotes: "Default public non-state source governance.",
    accessPattern: "public_http", accessMode: "http", activationStatus: "active", sourceConfidence: "high",
    requiresLogin: true, requiresBrowser: true, sourceAuthority: "official", trustStatus: "verified", evidenceMode: "direct_portal",
    crawlerSourceId: "ca_caleprocure", crawlerAdapterKind: "dedicated", crawlerMaturity: "verified",
    crawlerCapabilities: ["query", "attachments", "detail_pages", "pagination"], crawlerBaseUrl: "https://www.caleprocure.ca.gov/pages/Events-BS3/event-search.aspx",
    validityNotes: "Cal eProcure lists every state agency's open events.", fallbackNotes: "Use the event search when the list API is down.",
  });

  it("shows the approval, ingestion, legal review and approval notes the admin reads before Hold or Approve", () => {
    const html = text(
      render(
        <SourceProfileCard
          source={source({ approvalStatus: "blocked", approvedForIngestion: false, legalReviewStatus: "not_reviewed", approvalNotes: "Blocked 2026-09-21: no tenant at https://www.bidnetdirect.com/franklin-county-oh (HTTP 404)." })}
        />,
      ),
    );

    expect(html).toContain(`<h3 class="text-sm font-semibold text-slate-950">${escaped(admin.sourceProfileTitle)}</h3>`);
    expect(html).toContain(`>${admin.fieldApproval}</dt>`);
    expect(html).toContain(`>${admin.sourceApproval_blocked}</span>`);
    // Not approved for ingestion.
    expect(html).toContain(`>${admin.sourceApprovalRequired}</span>`);
    expect(html).toContain(`>${admin.sourceLegalReview}</dt>`);
    expect(html).toContain(`>${admin.sourceLegalReview_not_reviewed}</span>`);
    expect(html).toContain(`>${admin.sourceApprovalNotes}</dt>`);
    expect(html).toContain("Blocked 2026-09-21: no tenant at https://www.bidnetdirect.com/franklin-county-oh (HTTP 404).");
  });

  it("shows the access, trust and crawler profile and the validity and fallback notes of a state portal", () => {
    const html = text(render(<SourceProfileCard source={stateSource} />));

    expect(html).toContain(`>${admin.sourceApproval_approved}</span>`);
    expect(html).not.toContain(admin.sourceApprovalRequired);
    expect(html).toContain(`>${admin.sourceLegalReview_approved_public}</span>`);
    for (const [label, value] of [
      [admin.sourceAccessPattern, "public_http"],
      [admin.sourceAccessMode, "http"],
      [admin.sourceActivationStatus, "active"],
      [admin.sourceConfidence, "high"],
    ]) {
      expect(html).toContain(`>${label}</dt><dd class="mt-1 flex flex-wrap items-center gap-1 text-sm text-slate-900">${value}</dd>`);
    }
    // Login decides the ledger an approval must carry; browser and login are listed, manual is not.
    expect(html).toContain(`>${admin.sourceRequiresLogin}</span>`);
    expect(html).toContain(`>${admin.sourceRequiresBrowser}</span>`);
    expect(html).not.toContain(`>${admin.sourceRequiresManual}</span>`);
    for (const label of [admin.sourceAuthority_official, admin.sourceTrust_verified, admin.sourceEvidence_direct_portal]) expect(html).toContain(`>${label}</span>`);
    for (const label of [admin.crawlerAdapter_dedicated, admin.crawlerMaturity_verified, admin.crawlerCapability_query, admin.crawlerCapability_attachments, admin.crawlerCapability_detail_pages, admin.crawlerCapability_pagination]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).toContain('title="https://www.caleprocure.ca.gov/pages/Events-BS3/event-search.aspx">ca_caleprocure - caleprocure.ca.gov</span>');
    expect(html).toContain("Cal eProcure lists every state agency&#x27;s open events.");
    expect(html).toContain("Use the event search when the list API is down.");
  });

  it("says a field is empty with a dash instead of leaving it out", () => {
    const html = text(render(<SourceProfileCard source={source()} />));
    /** What the <dd> after the <dt> named `label` holds. */
    const valueOf = (label: string) => {
      const marker = `>${escaped(label)}</dt><dd`;
      const start = html.indexOf(marker);
      if (start < 0) return undefined;
      const open = html.indexOf(">", start + marker.length) + 1;
      return html.slice(open, html.indexOf("</dd>", open));
    };

    expect(valueOf(admin.sourceRequirements)).toBe("-");
    expect(valueOf(admin.sourceTrustProfile)).toBe("-");
    expect(valueOf(admin.sourceValidityNotes)).toBe('<span class="whitespace-pre-line break-words [overflow-wrap:anywhere]">-</span>');
    expect(valueOf(admin.sourceFallbackNotes)).toBe('<span class="whitespace-pre-line break-words [overflow-wrap:anywhere]">-</span>');
    expect(valueOf(admin.sourceApprovalNotes)).toBe('<span class="whitespace-pre-line break-words [overflow-wrap:anywhere]">-</span>');
    // A registry row without legacy crawler metadata still names its adapter and maturity ("None").
    expect(html).toContain(`>${admin.crawler}</dt>`);
    expect(html).toContain(`>${admin.crawlerAdapter_none}</span>`);
    expect(html).not.toContain(" - ");
  });
});
