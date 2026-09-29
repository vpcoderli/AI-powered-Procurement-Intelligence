import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminSourcePrecheckResult } from "@/lib/api/admin";
import {
  precheckFetchStatusKey,
  precheckListMethodKey,
  precheckVerdictTone,
  runPrecheckRequest,
} from "./SourcePrecheckPanel";

function precheck(overrides: Partial<AdminSourcePrecheckResult> = {}): AdminSourcePrecheckResult {
  return {
    sourceId: "bidnet_ny_erie",
    checkedAt: "2026-09-16T00:00:00.000Z",
    verdict: "ready",
    reasons: [],
    robots: { status: "clear", flagged: false, flagReason: null },
    fetch: {
      status: "ok",
      items: 3,
      sample: [{ title: "Roof replacement", url: "https://example.gov/bid/1" }],
      listMethod: "scrapling",
      errorCode: null,
      errorMessage: null,
      httpStatus: 200,
      wafChallenge: false,
    },
    suggestedBaseUrl: null,
    ...overrides,
  };
}

describe("precheckVerdictTone", () => {
  it("separates a verified empty portal from a ready one and from a fixable failure", () => {
    expect(precheckVerdictTone("ready")).toContain("emerald");
    expect(precheckVerdictTone("empty")).toContain("sky");
    expect(precheckVerdictTone("needs_fix")).toContain("amber");
  });
});

describe("precheckFetchStatusKey", () => {
  it("keys the fetch headline off the dry run's own outcome", () => {
    expect(precheckFetchStatusKey(precheck())).toBe("admin.sourcePrecheckFetch_ok");
    expect(precheckFetchStatusKey(precheck({ fetch: { ...precheck().fetch, status: "empty_verified" } }))).toBe(
      "admin.sourcePrecheckFetch_empty_verified",
    );
    expect(precheckFetchStatusKey(precheck({ fetch: { ...precheck().fetch, status: "failed" } }))).toBe(
      "admin.sourcePrecheckFetch_failed",
    );
  });
});

describe("precheckListMethodKey", () => {
  it("maps the three methods the crawler reports in metadata.listExtraction", () => {
    expect(precheckListMethodKey("scrapling")).toBe("admin.sourcePrecheckListMethod_scrapling");
    expect(precheckListMethodKey("adapter")).toBe("admin.sourcePrecheckListMethod_adapter");
    expect(precheckListMethodKey("adapter_fallback")).toBe("admin.sourcePrecheckListMethod_adapter_fallback");
  });

  it("returns null for an unmapped or missing method so the raw value is shown", () => {
    // t() echoes an unknown dot-path back verbatim, which would render as a raw i18n key.
    expect(precheckListMethodKey("something_new")).toBeNull();
    expect(precheckListMethodKey(null)).toBeNull();
  });
});

// A precheck request writes its result into the row's robots and live-health columns only when it succeeds, so the
// parent's cue to re-read the row (`onPrecheckCompleted`) must fire for a success and for nothing else.
describe("runPrecheckRequest", () => {
  /** Handlers that log what they were told, in order. */
  function recorder() {
    const events: string[] = [];
    return {
      events,
      handlers: {
        onResult: (result: AdminSourcePrecheckResult) => {
          events.push(`result:${result.verdict}`);
        },
        onError: (message: string) => {
          events.push(`error:${message}`);
        },
        onCompleted: () => {
          events.push("completed");
        },
      },
    };
  }

  it("shows the result, then tells the parent the row changed, once", async () => {
    const { events, handlers } = recorder();

    await runPrecheckRequest(async () => precheck(), handlers);

    expect(events).toEqual(["result:ready", "completed"]);
  });

  it("counts a needs_fix verdict as a completed precheck: the server wrote it into the row all the same", async () => {
    const { events, handlers } = recorder();

    await runPrecheckRequest(async () => precheck({ verdict: "needs_fix" }), handlers);

    expect(events).toEqual(["result:needs_fix", "completed"]);
  });

  it("does not tell the parent anything when the request fails, and shows the server's message verbatim", async () => {
    const { events, handlers } = recorder();

    await runPrecheckRequest(async () => {
      throw new Error("Pre-check could not run the crawler for bidnet_ny_erie: spawn python3 ENOENT");
    }, handlers);

    expect(events).toEqual(["error:Pre-check could not run the crawler for bidnet_ny_erie: spawn python3 ENOENT"]);
  });

  it("treats a rejection that is not an Error, and a sender that throws before it returns a promise, as a failed request", async () => {
    const rejected = recorder();
    await runPrecheckRequest(() => Promise.reject("gateway timeout"), rejected.handlers);
    expect(rejected.events).toEqual(["error:gateway timeout"]);

    const thrown = recorder();
    await runPrecheckRequest(() => {
      throw new Error("offline");
    }, thrown.handlers);
    expect(thrown.events).toEqual(["error:offline"]);
  });

  it("tells the parent once per successful request, and not for the failed one between two of them", async () => {
    const { events, handlers } = recorder();

    await runPrecheckRequest(async () => precheck(), handlers);
    await runPrecheckRequest(async () => {
      throw new Error("PRECHECK_FAILED");
    }, handlers);
    await runPrecheckRequest(async () => precheck({ verdict: "empty" }), handlers);

    expect(events.filter((event) => event === "completed")).toHaveLength(2);
    expect(events).toEqual(["result:ready", "completed", "error:PRECHECK_FAILED", "result:empty", "completed"]);
  });

  it("does not present a failed refresh as a failed precheck: the result was already shown", async () => {
    const events: string[] = [];

    await expect(
      runPrecheckRequest(async () => precheck(), {
        onResult: () => {
          events.push("result");
        },
        onError: () => {
          events.push("error");
        },
        onCompleted: () => {
          throw new Error("refresh broke");
        },
      }),
    ).rejects.toThrow("refresh broke");

    expect(events).toEqual(["result"]);
  });

  it("needs no parent callback: a mount that passes none keeps showing results and errors as before", async () => {
    const events: string[] = [];
    const handlers = {
      onResult: (result: AdminSourcePrecheckResult) => {
        events.push(`result:${result.verdict}`);
      },
      onError: (message: string) => {
        events.push(`error:${message}`);
      },
    };

    await runPrecheckRequest(async () => precheck(), handlers);
    await runPrecheckRequest(async () => {
      throw new Error("boom");
    }, handlers);

    expect(events).toEqual(["result:ready", "error:boom"]);
  });
});

describe("SourcePrecheckPanel wiring", () => {
  const component = readFileSync(new URL("SourcePrecheckPanel.tsx", import.meta.url), "utf8");

  it("runs the C5 pre-check route with the five-record dry-run limit", () => {
    expect(component).toContain("precheckAdminDataSource(source.id, { limit: 5 })");
  });

  it("routes the request through runPrecheckRequest and hands the parent's callback to it", () => {
    expect(component).toContain("void runPrecheckRequest(() => precheckAdminDataSource(source.id, { limit: 5 }), {");
    expect(component).toContain("onResult: setResult,");
    expect(component).toContain("onError: setError,");
    expect(component).toContain("onCompleted: onPrecheckCompleted,");
    // The panel's own busy flag clears however the request ends.
    expect(component).toContain(".finally(() => setRunning(false))");
    // Both new props are optional, so a mount that passes neither keeps today's behaviour.
    expect(component).toContain("canApprove?: boolean;");
    expect(component).toContain("onPrecheckCompleted?: () => void;");
    expect(component).toContain("canApprove = true,");
  });

  it("only writes a suggested base URL behind an explicit confirmation", () => {
    expect(component).toContain('t("admin.sourcePrecheckAdoptConfirm")');
    expect(component).toContain("if (!confirmFn(");
    expect(component).toContain("updateAdminDataSource(source.id, { baseUrl: suggested })");
  });

  it("renders the verdict, robots, fetch, list-method and error lines through i18n", () => {
    for (const key of [
      "admin.sourcePrecheckTitle",
      "admin.sourcePrecheckRun",
      "admin.sourcePrecheckRobots",
      "admin.sourcePrecheckFetch",
      "admin.sourcePrecheckListMethod",
      "admin.sourcePrecheckError",
      "admin.sourcePrecheckSuggestedBaseUrl",
      "admin.sourcePrecheckAdopt",
    ]) {
      expect(component).toContain(`t("${key}")`);
    }
    expect(component).toContain("t(`admin.sourcePrecheckVerdict_${result.verdict}`)");
  });

  it("shows server errors verbatim", () => {
    expect(component).toContain("caught instanceof Error ? caught.message : String(caught)");
  });

  it("offers the approval form only for governance-gated county/city rows the viewer may approve", () => {
    expect(component).toContain("canApprove && isLocalJurisdictionSource(source)");
    expect(component).toContain("ApproveLocalSourceDialog");
  });

  it("is mounted on the source detail page with the signed-in admin's email as reviewer", () => {
    const view = readFileSync(new URL("./sources/SourceDetailView.tsx", import.meta.url), "utf8");

    expect(view).toContain("SourcePrecheckPanel");
    expect(view).toContain("reviewerEmail={user.email}");
    // The row the panel wrote is swapped in (and the kept config form rebuilt when its inputs changed).
    expect(view).toContain("onSourceUpdated={replaceSourceFromApprovalTab}");
    expect(view).toMatch(/const replaceSourceFromApprovalTab = \(next: AdminDataSource\) => \{[^}]*\n\s*replaceSource\(next\);\n\s*\};/);
  });

  it("has both dictionaries carrying the pre-check keys, translated", () => {
    const en = readFileSync(new URL("../../lib/i18n/dictionaries/en.ts", import.meta.url), "utf8");
    const zh = readFileSync(new URL("../../lib/i18n/dictionaries/zh.ts", import.meta.url), "utf8");

    for (const dictionary of [en, zh]) {
      expect(dictionary).toContain("sourcePrecheckTitle:");
      expect(dictionary).toContain("sourcePrecheckVerdict_needs_fix:");
      expect(dictionary).toContain("sourcePrecheckListMethod_adapter_fallback:");
      expect(dictionary).toContain("sourcePrecheckAdoptConfirm:");
    }
    expect(zh).toContain("前置检查");
    expect(zh).toContain("写入 base_url");
  });
});
