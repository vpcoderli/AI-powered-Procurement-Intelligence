import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminSourcePrecheckResult } from "@/lib/api/admin";
import {
  precheckFetchStatusKey,
  precheckListMethodKey,
  precheckVerdictTone,
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

describe("SourcePrecheckPanel wiring", () => {
  const component = readFileSync(new URL("SourcePrecheckPanel.tsx", import.meta.url), "utf8");

  it("runs the C5 pre-check route with the five-record dry-run limit", () => {
    expect(component).toContain("precheckAdminDataSource(source.id, { limit: 5 })");
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

  it("offers the approval form only for governance-gated county/city rows", () => {
    expect(component).toContain("isLocalJurisdictionSource(source)");
    expect(component).toContain("ApproveLocalSourceDialog");
  });

  it("is mounted per data-source row with the signed-in admin's email as reviewer", () => {
    const page = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");

    expect(page).toContain("SourcePrecheckPanel");
    expect(page).toContain("reviewerEmail={user?.email ?? null}");
    expect(page).toContain("onSourceUpdated={replaceSource}");
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
