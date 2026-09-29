import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminCrawlerLog, AdminDataSourceDetail } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { CrawlerLogRow } from "./CrawlerLogList";
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
