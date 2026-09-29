import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, type AdminDataSource, type AdminDataSourceDetail } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import { adminRoleFlags, type useAdminSession } from "../admin-session";
import type { AdminResourceStatus, useAdminResource } from "../use-admin-resource";
import { adminSourceDetailFixture, adminSourceFixture } from "./test-fixtures";

// The view reads the shell's session and one resource; both hooks are replaced with plain state so the
// markup of each role and load state can be rendered without a DOM. The stubs are typed against the real
// hooks' return types, so a change to either shape fails type-checking of this file instead of going unnoticed.
type SessionStub = ReturnType<typeof useAdminSession>;
type ResourceStub = ReturnType<typeof useAdminResource<AdminDataSourceDetail>>;
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

import { SourceDetailView } from "./SourceDetailView";

const admin = en.admin as Record<string, string>;

function signIn(role: AdminConsoleRole) {
  const session: SessionStub = {
    user: { id: "user-1", email: `${role}@example.com`, displayName: null, role, tier: "enterprise", features: [] },
    ...adminRoleFlags(role),
  };
  stubs.session = session;
}

function load(state: { status: AdminResourceStatus; data?: AdminDataSourceDetail | null; error?: unknown }) {
  const resource: ResourceStub = {
    status: state.status, data: state.data ?? null, error: state.error ?? null, reload: async () => undefined, setData: () => undefined,
  };
  stubs.resource = resource;
}

const render = () => renderToStaticMarkup(<LanguageProvider><SourceDetailView sourceId="bidnet_co_denver" /></LanguageProvider>);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A rendered <button> whose whole label is `label` (an approved badge's "Approved" must not count as the Approve button). */
const hasButton = (html: string, label: string) => new RegExp(`>${escapeRegExp(label)}</button>`).test(html);
/** The rendered <button> whose whole label is `label` (an icon may precede the text). */
const buttonTag = (html: string, label: string) => new RegExp(`<button[^>]*>(?:<svg[^>]*>.*?</svg>)?${escapeRegExp(label)}</button>`).exec(html)?.[0] ?? "";

const stateSource = (overrides: Partial<AdminDataSource> = {}) =>
  adminSourceFixture({
    id: "california_caleprocure", label: "California Cal eProcure", issuerType: "state", stateCode: "CA", jurisdictionLevel: "state",
    jurisdictionName: "California", fipsCode: "06", providerFamily: "state_portal", approvalStatus: "approved", approvedForIngestion: true,
    ...overrides,
  });
const stateDetail = (overrides: Partial<AdminDataSource> = {}) =>
  adminSourceDetailFixture(stateSource(overrides), { states: { level: "state", platform: "state_portal", approval: "approved", health: "healthy" } });

beforeEach(() => {
  signIn("admin");
  load({ status: "ready", data: adminSourceDetailFixture() });
});

describe("SourceDetailView load states", () => {
  it("shows a loading card until the detail arrives", () => {
    load({ status: "loading" });
    const html = render();

    expect(html).toContain('data-state-code="loading"');
    expect(html).toContain(admin.nav_sourceDetail);
  });

  it("answers an unknown id with the not-found card and a link back to the list", () => {
    load({ status: "error", error: new AdminApiError(404, "DATA_SOURCE_NOT_FOUND", "Data source not found") });
    const html = render();

    expect(html).toContain(admin.sourceDetailNotFoundTitle);
    expect(html).toContain(admin.sourceDetailNotFoundDescription);
    expect(html).toContain('href="/admin/sources"');
    expect(html).toContain(admin.sourceDetailBackToList);
  });

  it("answers any other failed load with a retryable error card", () => {
    load({ status: "error", error: new AdminApiError(500, "INTERNAL_ERROR", "Request failed") });
    const html = render();

    expect(html).toContain('data-state-code="error"');
    expect(html).toContain(admin.errorDescription);
    expect(html).toContain(admin.refresh);
    expect(html).not.toContain(admin.sourceDetailNotFoundTitle);
  });

  it("keeps showing the loaded source and says so when a refresh failed", () => {
    load({ status: "error", data: adminSourceDetailFixture(), error: new Error("offline") });
    const html = render();

    expect(html).toContain("City and County of Denver");
    expect(html).toContain(admin.sectionRefreshFailed);
  });
});

describe("SourceDetailView header", () => {
  it("names the source with its level, state, approval and health badges", () => {
    const html = render();

    expect(html).toContain("<h2");
    expect(html).toContain("City and County of Denver");
    for (const label of [admin.coverageLevel_county, "CO", admin.sourcesApproval_awaiting, admin.sourcesHealth_never_run]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("lists the five tabs in order and opens on the overview facts", () => {
    load({ status: "ready", data: adminSourceDetailFixture(adminSourceFixture({ consecutiveFailures: 3 })) });
    const html = render();

    const positions = ["overview", "config", "approval", "runs", "bids"].map((tab) => html.indexOf(`>${admin[`sourceDetailTab_${tab}`].replace("&", "&amp;")}</button>`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // The strip scrolls inside its own box, so the English labels do not widen a phone-sized page.
    expect(html).toContain('<div class="max-w-full overflow-x-auto"><div');
    for (const fact of ["bidnet_co_denver", "Denver County", "08031", "https://www.bidnetdirect.com/colorado/denver", "bidnet", "daily"]) {
      expect(html).toContain(fact);
    }
    expect(html).toContain(`>${admin.fieldConsecutiveFailures}<`);
    expect(html).toContain(">3<");
    expect(html).toContain(admin.liveSourceHealth);
  });

  it("gives an admin every action on a state source", () => {
    load({ status: "ready", data: stateDetail() });
    const html = render();

    expect(hasButton(html, admin.sourceDetailRunNow)).toBe(true);
    expect(hasButton(html, admin.sourceDetailDisable)).toBe(true);
    expect(hasButton(html, admin.approveSource)).toBe(true);
    expect(hasButton(html, admin.holdSource)).toBe(true);
    // An approved row can only be held; the old table disabled the same button.
    expect(buttonTag(html, admin.approveSource)).toContain(' disabled=""');
    expect(buttonTag(html, admin.holdSource)).not.toContain(' disabled=""');
  });

  it("offers Enable instead of Disable for a stopped source and disables Hold on a held one", () => {
    load({ status: "ready", data: stateDetail({ isEnabled: false, approvalStatus: "needs_review", approvedForIngestion: false }) });
    const html = render();

    expect(hasButton(html, admin.sourceDetailEnable)).toBe(true);
    expect(hasButton(html, admin.sourceDetailDisable)).toBe(false);
    expect(buttonTag(html, admin.holdSource)).toContain(' disabled=""');
    expect(buttonTag(html, admin.approveSource)).not.toContain(' disabled=""');
  });

  it("never offers the ledger-less Approve on a county row, but keeps Hold", () => {
    const html = render();

    expect(hasButton(html, admin.approveSource)).toBe(false);
    expect(hasButton(html, admin.holdSource)).toBe(true);
    expect(hasButton(html, admin.sourceDetailRunNow)).toBe(true);
  });

  it("gives an operator the run and enable controls but no approval controls", () => {
    signIn("operator");
    load({ status: "ready", data: stateDetail() });
    const html = render();

    expect(hasButton(html, admin.sourceDetailRunNow)).toBe(true);
    expect(hasButton(html, admin.sourceDetailDisable)).toBe(true);
    expect(hasButton(html, admin.approveSource)).toBe(false);
    expect(hasButton(html, admin.holdSource)).toBe(false);
  });

  it("gives support a read-only page", () => {
    signIn("support");
    load({ status: "ready", data: stateDetail() });
    const html = render();

    expect(html).toContain("California Cal eProcure");
    for (const label of [admin.sourceDetailRunNow, admin.sourceDetailDisable, admin.sourceDetailEnable, admin.approveSource, admin.holdSource, admin.recheckSource]) {
      expect(hasButton(html, label)).toBe(false);
    }
  });

  it("never offers Hold on a blocked row: a block changes only through an explicit Approve or the ledgered form", () => {
    load({ status: "ready", data: stateDetail({ approvalStatus: "blocked", approvedForIngestion: false }) });
    const blockedState = render();
    expect(buttonTag(blockedState, admin.holdSource)).toContain(' disabled=""');
    expect(buttonTag(blockedState, admin.approveSource)).not.toContain(' disabled=""');

    load({
      status: "ready",
      data: adminSourceDetailFixture(adminSourceFixture({ approvalStatus: "blocked" }), {
        states: { level: "county", platform: "bidnet", approval: "blocked", health: "never_run" },
      }),
    });
    const blockedCounty = render();
    expect(buttonTag(blockedCounty, admin.holdSource)).toContain(' disabled=""');
    expect(hasButton(blockedCounty, admin.approveSource)).toBe(false);
  });

  it("offers no run for a federal source, which has no crawler id", () => {
    load({
      status: "ready",
      data: adminSourceDetailFixture(adminSourceFixture({ id: "sam_gov", label: "SAM.gov", issuerType: "federal", stateCode: "US", jurisdictionLevel: "federal", approvalStatus: "approved" }), {
        states: { level: "federal", platform: "federal_portal", approval: "approved", health: "healthy" },
      }),
    });
    const html = render();

    expect(hasButton(html, admin.sourceDetailRunNow)).toBe(false);
    expect(hasButton(html, admin.sourceDetailDisable)).toBe(true);
  });
});

describe("SourceDetailView kept tabs", () => {
  /**
   * The rendered tab panels in order, each with the markup up to the next one. On the server the overview is the
   * shown panel, config and approval follow it hidden (kept mounted), and the runs and bids panels are not rendered.
   */
  const panelsOf = (html: string) => {
    const starts = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)];
    return starts.map((match, index) => ({
      hidden: match[0].includes(' hidden=""'),
      markup: html.slice(match.index, starts[index + 1]?.index ?? html.length),
    }));
  };
  const profileTitle = admin.sourceProfileTitle.replace("&", "&amp;");

  it("renders the config and approval tabs hidden behind the overview, so switching tabs keeps their state", () => {
    load({
      status: "ready",
      data: adminSourceDetailFixture(
        adminSourceFixture({
          approvalNotes: "依据平台审查 #3；预检 ready @2026-09-27T10:00:00.000Z",
          approvalHistory: [1, 2, 3, 4, 5].map((index) => ({
            id: `event-${index}`, sourceId: "bidnet_co_denver", actorUserId: `user-${index}`, action: index === 1 ? "approved" : "held",
            previousApprovalStatus: null, nextApprovalStatus: null, previousLegalReviewStatus: null, nextLegalReviewStatus: null,
            previousApprovedForIngestion: null, nextApprovedForIngestion: null, reason: `reason ${index}`, createdAt: `2026-09-2${index}T10:00:00.000Z`,
          })),
        }),
      ),
    });
    const panels = panelsOf(render());

    // Overview shown; config and approval mounted but hidden; runs and bids not mounted.
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true, true]);
    const [overview, config, approval] = panels;
    expect(overview.markup).toContain(admin.liveSourceHealth);
    expect(hasButton(config.markup, admin.crawlerConfigOpen)).toBe(true);
    expect(approval.markup).toContain(admin.sourceDetailReadiness);
    expect(approval.markup).toContain(profileTitle);
    expect(approval.markup).toContain(admin.sourcePrecheckTitle);
    expect(approval.markup).toContain("依据平台审查 #3；预检 ready @2026-09-27T10:00:00.000Z");
    // Every history event the API returned, with its reason.
    for (const index of [1, 2, 3, 4, 5]) {
      expect(approval.markup).toContain(`Actor user-${index}`);
      expect(approval.markup).toContain(`reason ${index}`);
    }
    // The governance card sits above the precheck card an admin acts in.
    expect(approval.markup.indexOf(profileTitle)).toBeLessThan(approval.markup.indexOf(admin.sourcePrecheckTitle));
  });

  it("shows support the governance card and the read-only config without the operator panels", () => {
    signIn("support");
    const [, config, approval] = panelsOf(render());

    expect(config.markup).toContain(admin.sourceDetailConfigReadOnly);
    expect(hasButton(config.markup, admin.crawlerConfigOpen)).toBe(false);
    expect(approval.markup).toContain(profileTitle);
    expect(approval.markup).not.toContain(admin.sourcePrecheckTitle);
  });
});
