import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminOverview, AdminOverviewCoverage } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import { adminRoleFlags, type useAdminSession } from "../admin-session";
import type { AdminResourceStatus, useAdminResource } from "../use-admin-resource";

// The view reads the shell's session and one resource; both hooks are replaced with plain state so each role and
// each block's failure can be rendered without a DOM. The stubs are typed against the real hooks' return types, so
// a change to either shape fails type-checking of this file instead of going unnoticed.
type SessionStub = ReturnType<typeof useAdminSession>;
type ResourceStub = ReturnType<typeof useAdminResource<AdminOverview>>;
const stubs = vi.hoisted(() => ({ session: null as SessionStub | null, resource: null as ResourceStub | null }));

vi.mock("../admin-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../admin-session")>()),
  useAdminSession: (): SessionStub => {
    if (!stubs.session) throw new Error("signIn() was not called");
    return stubs.session;
  },
}));
vi.mock("../use-admin-resource", () => ({
  useAdminResource: (): ResourceStub => {
    if (!stubs.resource) throw new Error("load() was not called");
    return stubs.resource;
  },
}));

import { AdminOverviewView } from "./AdminOverviewView";

const admin = en.admin as Record<string, string>;

function signIn(role: AdminConsoleRole) {
  const session: SessionStub = {
    user: { id: "user-1", email: `${role}@example.com`, displayName: null, role, tier: "enterprise", features: [] },
    ...adminRoleFlags(role),
  };
  stubs.session = session;
}

function load(state: { status: AdminResourceStatus; data?: AdminOverview | null; error?: unknown }) {
  const resource: ResourceStub = {
    status: state.status, data: state.data ?? null, error: state.error ?? null, reload: async () => undefined, setData: () => undefined,
  };
  stubs.resource = resource;
}

const STATE_CODES = ["CA", "CO", "NY", "OH", "TX", "FL", "WA", "MI", "PA", "IL", "GA", "AZ"];

function coverage(stateCount: number): AdminOverviewCoverage {
  return {
    totals: { sources: 1020, scheduled: 59, awaitingApproval: 953, neverRun: 960 },
    byLevel: [
      { level: "state", total: 55, enabled: 55, approved: 55, awaitingApproval: 0, blocked: 0, neverRun: 5 },
      { level: "county", total: 266, enabled: 266, approved: 7, awaitingApproval: 257, blocked: 2, neverRun: 258 },
    ],
    byState: STATE_CODES.slice(0, stateCount).map((stateCode, index) => ({ stateCode, total: 40 - index, byLevel: { county: 40 - index } })),
  };
}

function overview(overrides: Partial<AdminOverview> = {}): AdminOverview {
  return {
    generatedAt: "2026-09-30T08:00:00.000Z",
    coverage: coverage(3),
    pipeline: [
      {
        providerFamily: "bidnet",
        platformReview: { status: "missing", review: null },
        counts: { approvable: 120, awaiting_precheck: 833, needs_fix: 0, missing_platform_review: 0, approved: 8, blocked: 3 },
        queued: 4,
        oldestQueuedAt: "2026-09-29T08:00:00.000Z",
      },
    ],
    crawlHealth: {
      runs24h: { success: 8, failure: 1, other: 0 },
      runs7d: { success: 40, failure: 3, other: 1 },
      lastRunAt: "2026-09-30T07:00:00.000Z",
      failingSources: 1,
      worstFailing: [{ id: "bidnet_oh_franklin", label: "Franklin County", consecutiveFailures: 4, lastFailureAt: "2026-09-30T07:00:00.000Z" }],
      throttleEvents24h: 0,
    },
    bids: { open: 3705, closed: 30, awarded: 2, new24h: 12, new7d: 90, openByLevel: { state: 3000, county: 705 }, pendingQa: 17 },
    errors: {},
    ...overrides,
  };
}

const render = () => renderToStaticMarkup(<LanguageProvider><AdminOverviewView /></LanguageProvider>);
/** The headings of the blocks that rendered, in order (a block's <h2> opens with its icon; a failure card's has none). */
const blockHeadings = (html: string) => [...html.matchAll(/<h2[^>]*><svg[^>]*>.*?<\/svg>([^<]*)<\/h2>/g)].map((match) => match[1]);
/** The titles of the failure cards, in order. */
const failedBlocks = (html: string) =>
  [...html.matchAll(/data-state-code="error".*?<h2[^>]*>([^<]*)<\/h2><p[^>]*>([^<]*)<\/p>/g)].map((match) => `${match[1]}: ${match[2]}`);
const BID_QA_LINK = 'href="/admin/quality/bids"';

beforeEach(() => {
  signIn("admin");
  load({ status: "ready", data: overview() });
});

describe("AdminOverviewView blocks", () => {
  it("renders the four blocks in spec order", () => {
    expect(blockHeadings(render())).toEqual([admin.overviewCoverageTitle, admin.overviewPipelineTitle, admin.overviewCrawlTitle, admin.overviewBidsTitle]);
  });

  it("answers a block the server could not compute with its own failure card and still renders the others", () => {
    load({ status: "ready", data: overview({ coverage: null, errors: { coverage: { code: "SECTION_FAILED", message: "This section could not be computed." } } }) });
    const html = render();

    expect(failedBlocks(html)).toEqual([`${admin.overviewCoverageTitle}: ${admin.overviewSectionFailed}`]);
    // The other three blocks render their content.
    expect(blockHeadings(html)).toEqual([admin.overviewPipelineTitle, admin.overviewCrawlTitle, admin.overviewBidsTitle]);
    expect(html).toContain("bidnet");
    expect(html).toContain("Franklin County");
    expect(html).toContain(">3705<");
    expect(html).not.toContain(admin.overviewByLevel);
  });

  it("shows a failure card for every block that failed, and none when nothing did", () => {
    load({ status: "ready", data: overview({ pipeline: null, bids: null }) });
    const html = render();

    expect(failedBlocks(html)).toEqual([
      `${admin.overviewPipelineTitle}: ${admin.overviewSectionFailed}`,
      `${admin.overviewBidsTitle}: ${admin.overviewSectionFailed}`,
    ]);
    expect(blockHeadings(html)).toEqual([admin.overviewCoverageTitle, admin.overviewCrawlTitle]);

    load({ status: "ready", data: overview() });
    expect(failedBlocks(render())).toEqual([]);
  });
});

describe("AdminOverviewView bid QA link", () => {
  it("links the pending QA count to bid QA for an admin and an operator", () => {
    for (const role of ["admin", "operator"] as const) {
      signIn(role);
      const html = render();
      expect(html, role).toContain(BID_QA_LINK);
      expect(html, role).toContain(admin.overviewOpenBidQa);
    }
  });

  it("offers support no link to a page it cannot open, but still shows the count", () => {
    signIn("support");
    const html = render();

    expect(html).not.toContain(BID_QA_LINK);
    expect(html).not.toContain(admin.overviewOpenBidQa);
    expect(html).toContain(admin.overviewPendingQa);
    expect(html).toContain(">17<");
  });
});

describe("AdminOverviewView states table", () => {
  const showAll = (count: number) => admin.overviewShowAllStates.replace("{count}", String(count));

  it("offers to show every state only when there are more than ten", () => {
    load({ status: "ready", data: overview({ coverage: coverage(11) }) });
    const eleven = render();
    expect(eleven).toContain(`>${showAll(11)}</button>`);
    expect(eleven).toContain('aria-expanded="false"');
    // Only the top ten rows are shown until the list is expanded.
    expect(eleven).toContain(">IL<");
    expect(eleven).not.toContain(">GA<");

    load({ status: "ready", data: overview({ coverage: coverage(10) }) });
    const ten = render();
    expect(ten).not.toContain(showAll(10));
    expect(ten).not.toContain('aria-expanded="false"');
    expect(ten).toContain(">IL<");
  });
});
