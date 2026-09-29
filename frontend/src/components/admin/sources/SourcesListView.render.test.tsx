import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { useRouter, usePathname, useSearchParams } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { AdminDataSourceListItem, AdminDataSourceListResponse } from "@/server/admin/data-source-list-contract";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import { formatDate } from "../admin-format";
import { adminRoleFlags, type useAdminSession } from "../admin-session";
import type { AdminResourceStatus, useAdminResource } from "../use-admin-resource";

// The view reads the shell's session, the URL and one resource; the hooks are replaced with plain state so the
// markup of each role, URL and load state can be rendered without a DOM. The stubs are typed against the real
// hooks' return types, so a change to either shape fails type-checking of this file instead of going unnoticed.
type SessionStub = ReturnType<typeof useAdminSession>;
type ResourceStub = ReturnType<typeof useAdminResource<AdminDataSourceListResponse>>;
type RouterStub = ReturnType<typeof useRouter>;
type PathnameStub = ReturnType<typeof usePathname>;
type SearchParamsStub = ReturnType<typeof useSearchParams>;
const stubs = vi.hoisted(() => ({ session: null as SessionStub | null, resource: null as ResourceStub | null, search: "" }));

vi.mock("next/navigation", async (importOriginal) => {
  const { ReadonlyURLSearchParams } = await importOriginal<typeof import("next/navigation")>();
  return {
    useRouter: (): RouterStub => ({
      back: () => undefined, forward: () => undefined, refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined,
    }),
    usePathname: (): PathnameStub => "/admin/sources",
    useSearchParams: (): SearchParamsStub => new ReadonlyURLSearchParams(stubs.search),
  };
});
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

import { SourcesListView } from "./SourcesListView";

const admin = en.admin as Record<string, string>;

function signIn(role: AdminConsoleRole) {
  const session: SessionStub = {
    user: { id: "user-1", email: `${role}@example.com`, displayName: null, role, tier: "enterprise", features: [] },
    ...adminRoleFlags(role),
  };
  stubs.session = session;
}

function load(state: { status: AdminResourceStatus; data?: AdminDataSourceListResponse | null; error?: unknown }) {
  const resource: ResourceStub = {
    status: state.status, data: state.data ?? null, error: state.error ?? null, reload: async () => undefined, setData: () => undefined,
  };
  stubs.resource = resource;
}

const item = (overrides: Partial<AdminDataSourceListItem> = {}): AdminDataSourceListItem => ({
  id: "bidnet_co_denver", label: "City and County of Denver", stateCode: "CO", level: "county", issuerType: "county", jurisdictionLevel: "county",
  jurisdictionName: "Denver County", providerFamily: "bidnet", approvalState: "awaiting", isEnabled: true, health: "never_run",
  lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, precheckRequestedAt: null, liveHealthDisposition: null, crawlerSourceId: null,
  ...overrides,
});
const stateItem = () =>
  item({
    id: "ca_caleprocure", label: "California Cal eProcure", stateCode: "CA", level: "state", issuerType: "state", jurisdictionLevel: "state",
    providerFamily: "state_portal", approvalState: "approved", health: "failing", isEnabled: false, consecutiveFailures: 4,
    lastSuccessAt: "2026-09-27T07:00:00.000Z", lastFailureAt: "2026-09-29T07:00:00.000Z", crawlerSourceId: "ca_caleprocure",
  });
const listResponse = (overrides: Partial<AdminDataSourceListResponse> = {}): AdminDataSourceListResponse => ({
  items: [item(), stateItem()],
  total: 1020,
  page: 1,
  pageSize: 50,
  facets: {
    level: [{ value: "state", count: 50 }, { value: "county", count: 400 }],
    state: [{ value: "CA", count: 30 }, { value: "CO", count: 24 }, { value: "OH", count: 9 }],
    platform: [{ value: "bidnet", count: 900 }, { value: "state_portal", count: 50 }],
    approval: [{ value: "approved", count: 60 }, { value: "awaiting", count: 900 }, { value: "blocked", count: 60 }],
    health: [{ value: "never_run", count: 800 }, { value: "healthy", count: 200 }, { value: "failing", count: 20 }],
  },
  ...overrides,
});

const render = (search = "") => {
  stubs.search = search;
  return renderToStaticMarkup(<LanguageProvider><SourcesListView /></LanguageProvider>);
};
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The rendered <button> whose whole label is `label`, or "" when there is none. */
const buttonTag = (html: string, label: string) => new RegExp(`<button[^>]*>${escapeRegExp(label)}</button>`).exec(html)?.[0] ?? "";
const hasButton = (html: string, label: string) => buttonTag(html, label) !== "";
const isDisabled = (tag: string) => tag.includes(' disabled=""');
const count = (template: string, value: number) => template.replace("{count}", String(value));

beforeEach(() => {
  signIn("admin");
  load({ status: "ready", data: listResponse() });
});

describe("SourcesListView load states", () => {
  it("shows a loading card until the first page arrives", () => {
    load({ status: "loading" });
    const html = render();

    expect(html).toContain('data-state-code="loading"');
    expect(html).toContain(admin.nav_sourcesList);
    expect(html).not.toContain("<table");
  });

  it("answers a failed first load with a retryable error card", () => {
    load({ status: "error", error: new AdminApiError(500, "INTERNAL_ERROR", "Request failed") });
    const html = render();

    expect(html).toContain('data-state-code="error"');
    expect(html).toContain(admin.errorDescription);
    expect(html).toContain(admin.refresh);
    expect(html).not.toContain("<table");
  });

  it("keeps the loaded rows and says so when a refresh failed", () => {
    load({ status: "error", data: listResponse(), error: new Error("offline") });
    const html = render();

    expect(html).toContain("City and County of Denver");
    expect(html).toContain(admin.sectionRefreshFailed);
  });

  it("marks the table busy while a reload runs and keeps its rows", () => {
    load({ status: "loading", data: listResponse() });
    const html = render();

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("City and County of Denver");
  });
});

describe("SourcesListView rows", () => {
  it("links each source to its detail page and shows its level, state, platform, badges, last run, failures and enabled flag", () => {
    const html = render();

    expect(html).toContain('href="/admin/sources/bidnet_co_denver"');
    expect(html).toContain('href="/admin/sources/ca_caleprocure"');
    expect(html).toContain(">bidnet_co_denver<");
    for (const label of [
      admin.source, admin.fieldLevel, admin.fieldState, admin.fieldPlatform, admin.fieldApproval, admin.fieldHealth, admin.lastRun, admin.fieldConsecutiveFailures, admin.enabled,
    ]) {
      expect(html).toContain(`>${label}</th>`);
    }
    for (const label of [admin.coverageLevel_county, admin.coverageLevel_state, "CO", "CA", "bidnet", "state_portal"]) {
      expect(html).toContain(`>${label}</td>`);
    }
    for (const label of [admin.sourcesApproval_awaiting, admin.sourcesApproval_approved, admin.sourcesHealth_never_run, admin.sourcesHealth_failing]) {
      expect(html).toContain(`>${label}</span>`);
    }
    // The state row's last run is its newer failure, not its older success; a never-run row shows the dash.
    expect(html).toContain(`>${formatDate("2026-09-29T07:00:00.000Z")}</td>`);
    expect(html).not.toContain(formatDate("2026-09-27T07:00:00.000Z"));
    expect(html).toContain(">-</td>");
    expect(html).toContain(`>${admin.on}</td>`);
    expect(html).toContain(`>${admin.off}</td>`);
    expect(html).toContain(">4</td>");
  });

  it("encodes a source id into the detail link", () => {
    load({ status: "ready", data: listResponse({ items: [item({ id: "odd id/2" })] }) });

    expect(render()).toContain('href="/admin/sources/odd%20id%2F2"');
  });

  it("says so when no source matches", () => {
    load({ status: "ready", data: listResponse({ items: [], total: 0 }) });
    const html = render("level=city");

    expect(html).toContain(admin.sourcesEmpty);
    expect(html).toContain("0–0 of 0");
    expect(html).not.toContain(">bidnet_co_denver<");
  });
});

describe("SourcesListView filters", () => {
  it("offers a chip with its count for every value of the four chip facets", () => {
    const html = render();

    for (const chip of [
      `${admin.coverageLevel_state} (50)`, `${admin.coverageLevel_county} (400)`,
      `${admin.sourcesApproval_approved} (60)`, `${admin.sourcesApproval_awaiting} (900)`, `${admin.sourcesApproval_blocked} (60)`,
      `${admin.sourcesHealth_never_run} (800)`, `${admin.sourcesHealth_healthy} (200)`, `${admin.sourcesHealth_failing} (20)`,
      "bidnet (900)", "state_portal (50)",
    ]) {
      expect(hasButton(html, chip)).toBe(true);
    }
    for (const label of [admin.fieldLevel, admin.fieldApproval, admin.fieldHealth, admin.fieldPlatform, admin.fieldState]) {
      expect(html).toContain(`>${label}</span>`);
    }
    // Nothing is selected, so no chip is pressed and there is nothing to clear.
    expect(html).not.toContain('aria-pressed="true"');
    expect(hasButton(html, admin.sourcesClearFilters)).toBe(false);
  });

  it("presses the chips the URL selects, keeps a selected value the counts lost at 0 and offers to clear", () => {
    const html = render("level=county&level=township&approval=awaiting&platform=bidnet");

    expect(buttonTag(html, `${admin.coverageLevel_county} (400)`)).toContain('aria-pressed="true"');
    expect(buttonTag(html, `${admin.coverageLevel_state} (50)`)).toContain('aria-pressed="false"');
    expect(buttonTag(html, `${admin.coverageLevel_township} (0)`)).toContain('aria-pressed="true"');
    expect(buttonTag(html, `${admin.sourcesApproval_awaiting} (900)`)).toContain('aria-pressed="true"');
    expect(buttonTag(html, "bidnet (900)")).toContain('aria-pressed="true"');
    expect(hasButton(html, admin.sourcesClearFilters)).toBe(true);
  });

  it("adds states from a select and shows the chosen ones as removable chips", () => {
    const html = render("state=co&state=Colorado");

    // A lower-case state is read as CO; a value that is not a two-letter code is dropped, so only CO is a chip.
    expect(hasButton(html, "CO (24)")).toBe(true);
    expect(buttonTag(html, "CO (24)")).toContain('aria-pressed="true"');
    expect(html).not.toContain("COLORADO");
    // The select only offers the states that are not chosen yet.
    expect(html).toContain(`aria-label="${admin.fieldState}"`);
    expect(html).toContain(`<option value="" selected="">${admin.sourcesAddState}</option>`);
    expect(html).toContain('<option value="CA">CA (30)</option>');
    expect(html).toContain('<option value="OH">OH (9)</option>');
    expect(html).not.toContain('<option value="CO">');
  });

  it("fills the search box, the sort controls and the page size from the URL", () => {
    const html = render("q=den&sort=-failures&pageSize=100");

    expect(html).toContain('value="den"');
    expect(html).toContain(`placeholder="${admin.sourcesSearchPlaceholder}"`);
    expect(hasButton(html, admin.sourcesSearch)).toBe(true);
    expect(html).toContain(`aria-label="${admin.sourcesSort}"`);
    expect(html).toContain('<option value="failures" selected="">');
    for (const key of ["label", "lastRun", "failures", "updated"]) {
      expect(html).toContain(`>${admin[`sourcesSort_${key}`]}</option>`);
    }
    expect(html).toMatch(/<input type="checkbox" checked=""[^>]*\/>/);
    expect(html).toContain(admin.sourcesSortDescending);
    expect(html).toContain('<option value="100" selected="">100</option>');
  });
});

describe("SourcesListView pagination", () => {
  it("summarises the page and disables Previous on the first page", () => {
    const html = render();

    expect(html).toContain("1–50 of 1020");
    expect(isDisabled(buttonTag(html, admin.paginationPrevious))).toBe(true);
    expect(isDisabled(buttonTag(html, admin.paginationNext))).toBe(false);
    expect(html).toContain(`aria-label="${admin.paginationPageSize}"`);
    for (const size of [25, 50, 100, 200]) expect(html).toContain(`>${size}</option>`);
  });

  it("disables Next on the last page and reports the short last range", () => {
    load({ status: "ready", data: listResponse({ page: 21 }) });
    const html = render("page=21");

    expect(html).toContain("1001–1020 of 1020");
    expect(isDisabled(buttonTag(html, admin.paginationNext))).toBe(true);
    expect(isDisabled(buttonTag(html, admin.paginationPrevious))).toBe(false);
  });
});

describe("SourcesListView bulk actions by role", () => {
  const bulkLabels = {
    queue: admin.sourcesQueuePrechecks,
    queueAll: count(admin.sourcesQueueAllMatching, 1020),
    run: admin.sourceDetailRunNow,
    approve: admin.batchApproveSources,
    hold: admin.holdSource,
  };

  it("gives an admin the checkboxes and every bulk action, disabled until rows are selected", () => {
    signIn("admin");
    const html = render();

    expect(html).toContain(`aria-label="${admin.batchRunSelectAllVisible}"`);
    expect(html).toContain('aria-label="City and County of Denver"');
    expect(html).toContain(count(admin.sourcesSelectedCount, 0));
    for (const label of Object.values(bulkLabels)) expect(hasButton(html, label)).toBe(true);
    // Queue-all works on the filtered list itself, so it needs no selection; the others act on the selected rows.
    expect(isDisabled(buttonTag(html, bulkLabels.queueAll))).toBe(false);
    for (const label of [bulkLabels.queue, bulkLabels.run, bulkLabels.approve, bulkLabels.hold]) {
      expect(isDisabled(buttonTag(html, label))).toBe(true);
    }
  });

  it("gives an operator the run and precheck actions but not approve or hold (the batch route is admin-only)", () => {
    signIn("operator");
    const html = render();

    expect(html).toContain(`aria-label="${admin.batchRunSelectAllVisible}"`);
    for (const label of [bulkLabels.queue, bulkLabels.queueAll, bulkLabels.run]) expect(hasButton(html, label)).toBe(true);
    for (const label of [bulkLabels.approve, bulkLabels.hold]) expect(hasButton(html, label)).toBe(false);
  });

  it("gives support a read-only list: no checkboxes, no selection bar, no bulk action", () => {
    signIn("support");
    const html = render();

    expect(html).not.toContain(`aria-label="${admin.batchRunSelectAllVisible}"`);
    expect(html).not.toContain('aria-label="City and County of Denver"');
    expect(html).not.toContain(count(admin.sourcesSelectedCount, 0));
    for (const label of Object.values(bulkLabels)) expect(hasButton(html, label)).toBe(false);
    // The read-only controls are still there.
    expect(html).toContain('href="/admin/sources/bidnet_co_denver"');
    expect(hasButton(html, admin.sourcesSearch)).toBe(true);
    expect(hasButton(html, admin.paginationNext)).toBe(true);
  });

  it("keeps the whole bar off while a page is loading, so no action reads a total that is about to change", () => {
    signIn("admin");
    load({ status: "loading", data: listResponse() });
    const html = render();

    for (const label of Object.values(bulkLabels)) {
      expect(hasButton(html, label), label).toBe(true);
      expect(isDisabled(buttonTag(html, label)), label).toBe(true);
    }
    // The same page once it has loaded: Queue all matching is available again.
    load({ status: "ready", data: listResponse() });
    expect(isDisabled(buttonTag(render(), bulkLabels.queueAll))).toBe(false);
  });

  it("keeps Queue all matching off when the filters match nothing", () => {
    load({ status: "ready", data: listResponse({ items: [], total: 0 }) });
    const html = render("level=city");

    expect(isDisabled(buttonTag(html, count(admin.sourcesQueueAllMatching, 0)))).toBe(true);
  });

  it("spans the empty-state cell over the checkbox column only for roles that have it", () => {
    load({ status: "ready", data: listResponse({ items: [], total: 0 }) });

    signIn("admin");
    expect(render()).toContain('colSpan="10"');
    signIn("support");
    expect(render()).toContain('colSpan="9"');
  });
});
