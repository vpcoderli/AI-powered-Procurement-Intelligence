import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawlerConfigPanel } from "@/components/admin/CrawlerConfigPanel";
import type { SourcePrecheckPanelProps } from "@/components/admin/SourcePrecheckPanel";
import { AdminApiError, type AdminDataSource, type AdminDataSourceDetail } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import { adminRoleFlags, type useAdminSession } from "../admin-session";
import type { useBusyIds } from "../busy-reporting";
import type { AdminResourceStatus, useAdminResource } from "../use-admin-resource";
import type { BusyPanel } from "./SourceDetailView";
import { adminSourceDetailFixture, adminSourceFixture } from "./test-fixtures";

// The view reads the shell's session, one resource and the set of panels that are writing; the hooks are replaced with
// plain state so the markup of each role, load state and busy state can be rendered without a DOM. The stubs are typed
// against the real hooks' return types, so a change to any shape fails type-checking of this file instead of going
// unnoticed.
type SessionStub = ReturnType<typeof useAdminSession>;
type ResourceStub = ReturnType<typeof useAdminResource<AdminDataSourceDetail>>;
type BusyStub = ReturnType<typeof useBusyIds<BusyPanel>>;
type ConfigPanelProps = React.ComponentProps<typeof CrawlerConfigPanel>;
const stubs = vi.hoisted(() => ({
  session: null as SessionStub | null,
  resource: null as ResourceStub | null,
  busy: null as BusyStub | null,
  // What the view last handed the precheck and config cards (see the panel mocks below).
  precheckProps: null as SourcePrecheckPanelProps | null,
  configProps: null as ConfigPanelProps | null,
}));

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
vi.mock("../busy-reporting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../busy-reporting")>()),
  useBusyIds: (): BusyStub => {
    if (!stubs.busy) throw new Error("busyPanels() was not called");
    return stubs.busy;
  },
}));
// The real cards, rendered as before; the wrappers only keep the props the view passed them, so a test can read the
// flags and call the callbacks the view wired in without a DOM.
vi.mock("@/components/admin/CrawlerConfigPanel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/admin/CrawlerConfigPanel")>();
  return {
    ...original,
    CrawlerConfigPanel: (props: ConfigPanelProps) => {
      stubs.configProps = props;
      return <original.CrawlerConfigPanel {...props} />;
    },
  };
});
vi.mock("@/components/admin/SourcePrecheckPanel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/admin/SourcePrecheckPanel")>();
  return {
    ...original,
    SourcePrecheckPanel: (props: SourcePrecheckPanelProps) => {
      stubs.precheckProps = props;
      return <original.SourcePrecheckPanel {...props} />;
    },
  };
});

import { SourceDetailView } from "./SourceDetailView";

// The writes the view can make to the resource, recorded so a test can tell a re-read from a row swap.
const reload = vi.fn(async () => undefined);
const setData = vi.fn();
// The reports the view took from its panels, recorded with the id each came in under.
const setBusy = vi.fn<BusyStub["setBusy"]>();

const admin = en.admin as Record<string, string>;

function signIn(role: AdminConsoleRole) {
  const session: SessionStub = {
    user: { id: "user-1", email: `${role}@example.com`, displayName: null, role, tier: "enterprise", features: [] },
    ...adminRoleFlags(role),
  };
  stubs.session = session;
}

/** The panels that are writing right now, as the view's busy hook would answer. */
function busyPanels(...ids: BusyPanel[]) {
  stubs.busy = { busyIds: new Set(ids), setBusy };
}

function load(state: { status: AdminResourceStatus; data?: AdminDataSourceDetail | null; error?: unknown }) {
  const resource: ResourceStub = {
    status: state.status, data: state.data ?? null, error: state.error ?? null, reload, setData,
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
  reload.mockClear();
  setData.mockClear();
  setBusy.mockClear();
  stubs.precheckProps = null;
  stubs.configProps = null;
  busyPanels();
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

  // The approve form's PATCH writes governance fields, which the API answers 403 to an operator.
  it("offers the county/city approve form in the precheck card to an admin only", () => {
    const approvalMarkup = () => panelsOf(render())[2].markup;

    expect(hasButton(approvalMarkup(), admin.approveLocalSourceOpen)).toBe(true);

    signIn("operator");
    const operator = approvalMarkup();
    // An operator still runs prechecks (and may write a suggested base URL); only the governance form is gone.
    expect(operator).toContain(admin.sourcePrecheckTitle);
    expect(hasButton(operator, admin.sourcePrecheckRun)).toBe(true);
    expect(hasButton(operator, admin.approveLocalSourceOpen)).toBe(false);
  });
});

describe("SourceDetailView precheck card wiring", () => {
  it("tells the card whether the viewer may approve: an admin may, an operator may not", () => {
    render();
    expect(stubs.precheckProps?.canApprove).toBe(true);

    signIn("operator");
    render();
    expect(stubs.precheckProps?.canApprove).toBe(false);
  });

  it("does not mount the card for support, which cannot run operations", () => {
    signIn("support");
    render();

    expect(stubs.precheckProps).toBeNull();
  });

  // A precheck writes its result into the row's robots and live-health columns, from which the server derives the
  // readiness box, the header badges and the live-health card; the response itself is not a row.
  it("re-reads the detail once when a precheck completes, without swapping a row in", () => {
    render();
    const props = stubs.precheckProps;
    expect(props?.onPrecheckCompleted).toBeTypeOf("function");
    expect(reload).not.toHaveBeenCalled();

    props?.onPrecheckCompleted?.();

    expect(reload).toHaveBeenCalledTimes(1);
    // Nothing is written into the loaded detail, so the card keeps its fresh result and the panels stay as they are.
    expect(setData).not.toHaveBeenCalled();
  });
});

// A write a reused panel starts itself (a precheck, adopting the suggested base URL, the ledgered approval, the config
// save) never passes through the page's own pending slot. The panels report it, and the page holds every control it
// owns for as long as one of them is writing, exactly as it does while one of its own actions is pending.
describe("SourceDetailView busy lock (writes the reused panels start themselves)", () => {
  const disabled = (html: string, label: string) => buttonTag(html, label).includes(' disabled=""');
  // An approved state row leaves Hold enabled; a held one leaves the (ledger-less) Approve enabled.
  const approvedRow = () => load({ status: "ready", data: stateDetail() });
  const heldRow = () => load({ status: "ready", data: stateDetail({ approvalStatus: "needs_review", approvedForIngestion: false }) });

  it("leaves every control enabled while no panel is writing", () => {
    approvedRow();
    const html = render();

    for (const label of [admin.sourceDetailRunNow, admin.sourceDetailDisable, admin.holdSource, admin.recheckSource, admin.sourceHealthTriageAssign]) {
      expect(buttonTag(html, label)).not.toBe("");
      expect(disabled(html, label)).toBe(false);
    }
    expect(stubs.precheckProps?.disabled).toBe(false);
    expect(stubs.configProps?.disabled).toBe(false);

    heldRow();
    expect(disabled(render(), admin.approveSource)).toBe(false);
  });

  it.each<BusyPanel>(["precheck", "config"])("holds every control of the page while the %s panel is writing", (panel) => {
    busyPanels(panel);

    approvedRow();
    const html = render();
    for (const label of [admin.sourceDetailRunNow, admin.sourceDetailDisable, admin.holdSource, admin.recheckSource, admin.sourceHealthTriageAssign]) {
      expect(buttonTag(html, label)).not.toBe("");
      expect(disabled(html, label)).toBe(true);
    }
    // Both panels are held, the one that is writing and the one that is not.
    expect(stubs.precheckProps?.disabled).toBe(true);
    expect(stubs.configProps?.disabled).toBe(true);

    heldRow();
    expect(disabled(render(), admin.approveSource)).toBe(true);
  });

  it("stays locked as long as any one panel is still writing", () => {
    busyPanels("precheck", "config");
    approvedRow();
    const html = render();

    expect(disabled(html, admin.sourceDetailRunNow)).toBe(true);
    expect(stubs.configProps?.disabled).toBe(true);
  });

  it("still applies each control's own status rule once the page is free", () => {
    // An approved row can only be held; a held one can only be approved.
    approvedRow();
    const approved = render();
    expect(disabled(approved, admin.approveSource)).toBe(true);
    expect(disabled(approved, admin.holdSource)).toBe(false);

    heldRow();
    const held = render();
    expect(disabled(held, admin.approveSource)).toBe(false);
    expect(disabled(held, admin.holdSource)).toBe(true);
  });

  it("hears the writes of each panel under that panel's own id", () => {
    render();
    expect(stubs.precheckProps?.onBusyChange).toBeTypeOf("function");
    expect(stubs.configProps?.onBusyChange).toBeTypeOf("function");

    stubs.precheckProps?.onBusyChange?.(true);
    stubs.configProps?.onBusyChange?.(true);
    stubs.precheckProps?.onBusyChange?.(false);
    stubs.configProps?.onBusyChange?.(false);

    expect(setBusy.mock.calls).toEqual([["precheck", true], ["config", true], ["precheck", false], ["config", false]]);
  });

  it("takes no report from a page that is only rendered: a panel says nothing until it writes", () => {
    render();

    expect(setBusy).not.toHaveBeenCalled();
  });

  it("mounts neither panel for support, so nothing there can hold the page", () => {
    signIn("support");
    render();

    expect(stubs.precheckProps).toBeNull();
    expect(stubs.configProps).toBeNull();
  });
});
