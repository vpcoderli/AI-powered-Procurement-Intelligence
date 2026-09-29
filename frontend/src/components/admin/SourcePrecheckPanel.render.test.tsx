import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSourcePrecheckResult, precheckAdminDataSource as PrecheckApi } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";

const mocks = vi.hoisted(() => ({
  precheck: vi.fn<typeof PrecheckApi>(),
  /** The onClick each rendered button was given, by its label. */
  clicks: new Map<string, () => void>(),
}));

vi.mock("@/lib/api/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/admin")>()),
  precheckAdminDataSource: mocks.precheck,
}));
// The real button, rendered as before; the wrapper only keeps its onClick, so a test can press it without a DOM. A
// state setter called after a server render is a no-op, which leaves the panel's own callbacks to observe.
vi.mock("@/components/ui/button", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/button")>();
  return {
    ...original,
    Button: (props: React.ComponentProps<typeof original.Button>) => {
      if (typeof props.children === "string") mocks.clicks.set(props.children, () => props.onClick?.(undefined as never));
      return <original.Button {...props} />;
    },
  };
});

import { SourcePrecheckPanel, type SourcePrecheckPanelProps } from "./SourcePrecheckPanel";
import { adminSourceFixture } from "./sources/test-fixtures";

const admin = en.admin as Record<string, string>;

const render = (source = adminSourceFixture(), props: Partial<SourcePrecheckPanelProps> = {}) =>
  renderToStaticMarkup(
    <LanguageProvider>
      <SourcePrecheckPanel source={source} reviewerEmail="admin@example.com" onSourceUpdated={() => undefined} {...props} />
    </LanguageProvider>,
  );
/** A rendered <button> whose whole label is `label`. */
const hasButton = (html: string, label: string) => html.includes(`>${label}</button>`);

const stateSource = () => adminSourceFixture({ id: "california_caleprocure", issuerType: "state", stateCode: "CA", jurisdictionLevel: "state" });

const precheckResult = (): AdminSourcePrecheckResult => ({
  sourceId: "bidnet_co_denver",
  checkedAt: "2026-09-30T00:00:00.000Z",
  verdict: "ready",
  reasons: [],
  robots: { status: "clear", flagged: false, flagReason: null },
  fetch: { status: "ok", items: 3, sample: [], listMethod: "scrapling", errorCode: null, errorMessage: null, httpStatus: 200, wafChallenge: false },
  suggestedBaseUrl: null,
});

beforeEach(() => {
  mocks.precheck.mockReset();
  mocks.clicks.clear();
});

describe("SourcePrecheckPanel approve form (canApprove)", () => {
  // The form's PATCH writes governance fields, which the API answers 403 to an operator.
  it("offers the county/city approve form by default, so a mount that passes nothing keeps it", () => {
    expect(hasButton(render(), admin.approveLocalSourceOpen)).toBe(true);
    expect(hasButton(render(undefined, { canApprove: true }), admin.approveLocalSourceOpen)).toBe(true);
    expect(hasButton(render(undefined, { canApprove: undefined }), admin.approveLocalSourceOpen)).toBe(true);
  });

  it("leaves the approve form out when the viewer cannot approve", () => {
    expect(hasButton(render(undefined, { canApprove: false }), admin.approveLocalSourceOpen)).toBe(false);
  });

  it("still lets that viewer run a precheck", () => {
    const html = render(undefined, { canApprove: false });

    expect(html).toContain(admin.sourcePrecheckTitle);
    expect(hasButton(html, admin.sourcePrecheckRun)).toBe(true);
    expect(html).toContain(admin.sourcePrecheckIdle);
  });

  it("never offers the form for a federal/state row, whoever views it", () => {
    expect(hasButton(render(stateSource()), admin.approveLocalSourceOpen)).toBe(false);
    expect(hasButton(render(stateSource(), { canApprove: true }), admin.approveLocalSourceOpen)).toBe(false);
    expect(hasButton(render(stateSource(), { canApprove: false }), admin.approveLocalSourceOpen)).toBe(false);
    expect(hasButton(render(stateSource()), admin.sourcePrecheckRun)).toBe(true);
  });
});

describe("SourcePrecheckPanel precheck button (onPrecheckCompleted)", () => {
  /** Renders the panel, presses its Pre-check button, and waits for the request's promise chain to settle. */
  async function pressPrecheck(props: Partial<SourcePrecheckPanelProps> = {}) {
    render(undefined, props);
    const press = mocks.clicks.get(admin.sourcePrecheckRun);
    expect(press).toBeTypeOf("function");
    press?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("dry-runs five records for its own source and tells the parent once when that succeeds", async () => {
    mocks.precheck.mockResolvedValue(precheckResult());
    const onPrecheckCompleted = vi.fn();

    await pressPrecheck({ onPrecheckCompleted });

    expect(mocks.precheck).toHaveBeenCalledTimes(1);
    expect(mocks.precheck).toHaveBeenCalledWith("bidnet_co_denver", { limit: 5 });
    expect(onPrecheckCompleted).toHaveBeenCalledTimes(1);
  });

  it("does not tell the parent when the request fails", async () => {
    mocks.precheck.mockRejectedValue(new Error("Pre-check could not run the crawler for bidnet_co_denver"));
    const onPrecheckCompleted = vi.fn();

    await pressPrecheck({ onPrecheckCompleted });

    expect(mocks.precheck).toHaveBeenCalledTimes(1);
    expect(onPrecheckCompleted).not.toHaveBeenCalled();
  });

  it("runs the precheck for a mount that passes no callback", async () => {
    mocks.precheck.mockResolvedValue(precheckResult());

    await pressPrecheck();

    expect(mocks.precheck).toHaveBeenCalledTimes(1);
  });
});
