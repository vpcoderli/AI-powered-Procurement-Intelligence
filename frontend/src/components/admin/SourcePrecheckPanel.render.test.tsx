import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSourcePrecheckResult, precheckAdminDataSource as PrecheckApi } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { ApproveLocalSourceDialogProps } from "./ApproveLocalSourceDialog";

const mocks = vi.hoisted(() => ({
  precheck: vi.fn<typeof PrecheckApi>(),
  /** The onClick each rendered button was given, by its label. */
  clicks: new Map<string, () => void>(),
  /** What the panel last handed the approval form (see the ApproveLocalSourceDialog mock below). */
  dialogProps: null as ApproveLocalSourceDialogProps | null,
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

// The real form, rendered as before; the wrapper only keeps the props the panel handed it, so a test can call the
// callbacks the panel wired in (a server render cannot open the form and press its submit button).
vi.mock("./ApproveLocalSourceDialog", async (importOriginal) => {
  const original = await importOriginal<typeof import("./ApproveLocalSourceDialog")>();
  return {
    ...original,
    ApproveLocalSourceDialog: (props: ApproveLocalSourceDialogProps) => {
      mocks.dialogProps = props;
      return <original.ApproveLocalSourceDialog {...props} />;
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
  mocks.dialogProps = null;
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

describe("SourcePrecheckPanel busy reporting (onBusyChange)", () => {
  /** The values a `onBusyChange` spy was called with, in order. */
  const reported = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(([busy]) => busy);
  /** Lets every promise the press started settle. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Renders the panel with a recording handler and presses Pre-check. Nothing is awaited: the request is in flight. */
  function pressPrecheck(props: Partial<SourcePrecheckPanelProps> = {}) {
    const onBusyChange = vi.fn<(busy: boolean) => void>();
    render(undefined, { onBusyChange, ...props });
    const press = mocks.clicks.get(admin.sourcePrecheckRun);
    expect(press).toBeTypeOf("function");
    press?.();
    return onBusyChange;
  }

  it("reports nothing while it only renders: busy is reported by a write, never by a render", () => {
    const onBusyChange = vi.fn<(busy: boolean) => void>();

    render(undefined, { onBusyChange });
    render(stateSource(), { onBusyChange });

    expect(onBusyChange).not.toHaveBeenCalled();
    expect(mocks.precheck).not.toHaveBeenCalled();
  });

  it("reports busy as soon as a precheck starts, stays busy while the request is in flight, and reports idle once it succeeded", async () => {
    let respond!: (result: AdminSourcePrecheckResult) => void;
    mocks.precheck.mockReturnValue(new Promise<AdminSourcePrecheckResult>((resolve) => (respond = resolve)));

    const onBusyChange = pressPrecheck();
    expect(reported(onBusyChange)).toEqual([true]);
    await settle();
    expect(reported(onBusyChange)).toEqual([true]);

    respond(precheckResult());
    await settle();
    expect(reported(onBusyChange)).toEqual([true, false]);
  });

  it("reports idle after a failed request, once", async () => {
    mocks.precheck.mockRejectedValue(new Error("Pre-check could not run the crawler for bidnet_co_denver"));

    const onBusyChange = pressPrecheck();
    expect(reported(onBusyChange)).toEqual([true]);
    await settle();

    expect(reported(onBusyChange)).toEqual([true, false]);
  });

  it("reports idle when the request throws before it returns a promise", async () => {
    mocks.precheck.mockImplementation(() => {
      throw new Error("offline");
    });

    const onBusyChange = pressPrecheck();
    expect(reported(onBusyChange)).toEqual([true]);
    await settle();

    expect(reported(onBusyChange)).toEqual([true, false]);
  });

  it("reports idle after the parent's onPrecheckCompleted ran, so the page is locked until its refresh was started", async () => {
    mocks.precheck.mockResolvedValue(precheckResult());
    const order: string[] = [];
    const onBusyChange = vi.fn((busy: boolean) => {
      order.push(busy ? "busy" : "idle");
    });

    pressPrecheck({ onBusyChange, onPrecheckCompleted: () => order.push("completed") });
    await settle();

    expect(order).toEqual(["busy", "completed", "idle"]);
  });

  it("runs the precheck for a mount that passes no handler, and hands the approval form one that is safe to call", async () => {
    mocks.precheck.mockResolvedValue(precheckResult());
    render();

    mocks.clicks.get(admin.sourcePrecheckRun)?.();
    expect(mocks.dialogProps?.onBusyChange).toBeTypeOf("function");
    expect(() => {
      mocks.dialogProps?.onBusyChange?.(true);
      mocks.dialogProps?.onBusyChange?.(false);
    }).not.toThrow();
    await settle();

    expect(mocks.precheck).toHaveBeenCalledTimes(1);
  });

  describe("the approval form's own write", () => {
    it("is the card's write: busy while the form says so, idle once it says it settled", () => {
      const onBusyChange = vi.fn<(busy: boolean) => void>();
      render(undefined, { onBusyChange });
      const form = mocks.dialogProps;
      expect(form).not.toBeNull();

      form?.onBusyChange?.(true);
      expect(reported(onBusyChange)).toEqual([true]);
      form?.onBusyChange?.(false);
      expect(reported(onBusyChange)).toEqual([true, false]);
    });

    it("keeps the card busy after a precheck that started under it has settled", async () => {
      mocks.precheck.mockResolvedValue(precheckResult());
      const onBusyChange = vi.fn<(busy: boolean) => void>();
      render(undefined, { onBusyChange });

      mocks.dialogProps?.onBusyChange?.(true);
      mocks.clicks.get(admin.sourcePrecheckRun)?.();
      await settle();
      // One episode: no second busy for the precheck, and no idle while the form is still writing.
      expect(reported(onBusyChange)).toEqual([true]);

      mocks.dialogProps?.onBusyChange?.(false);
      expect(reported(onBusyChange)).toEqual([true, false]);
    });

    it("keeps the card busy until a precheck that outlasts the form has settled", async () => {
      let respond!: (result: AdminSourcePrecheckResult) => void;
      mocks.precheck.mockReturnValue(new Promise<AdminSourcePrecheckResult>((resolve) => (respond = resolve)));
      const onBusyChange = vi.fn<(busy: boolean) => void>();
      render(undefined, { onBusyChange });

      mocks.clicks.get(admin.sourcePrecheckRun)?.();
      mocks.dialogProps?.onBusyChange?.(true);
      mocks.dialogProps?.onBusyChange?.(false);
      expect(reported(onBusyChange)).toEqual([true]);

      respond(precheckResult());
      await settle();
      expect(reported(onBusyChange)).toEqual([true, false]);
    });
  });
});
