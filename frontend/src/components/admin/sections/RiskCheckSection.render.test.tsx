import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateDataQualityReport, StateDataQualityRiskLevel, StateDataQualityRow } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { RiskChecklistReport } from "@/server/risk/checklist";
import type { RiskChecklistTrend } from "@/server/risk/snapshots";
import type { StateDataQualityReason } from "@/server/source-validity/state-data-quality";
import type { AdminResourceStatus, useAdminResource } from "../use-admin-resource";
import type { AdminRiskSectionData } from "./RiskCheckSection";

// The section reads one resource and the language. The resource hook is replaced with plain state, typed against the
// real hook's return type. English goes through the real LanguageProvider; Chinese cannot (a server render always
// resolves to English), so `useLanguage` answers with the real Chinese dictionary and the same dot-path lookup.
type ResourceStub = ReturnType<typeof useAdminResource<AdminRiskSectionData>>;
const stubs = vi.hoisted(() => ({ language: "en" as "en" | "zh", resource: null as ResourceStub | null }));

vi.mock("../use-admin-resource", () => ({
  useAdminResource: (): ResourceStub => {
    if (!stubs.resource) throw new Error("load() was not called");
    return stubs.resource;
  },
}));
vi.mock("@/lib/i18n/LanguageContext", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/i18n/LanguageContext")>();
  const { zh: zhDictionary } = await import("@/lib/i18n/dictionaries/zh");
  const lookup = (key: string): string => {
    let value: unknown = zhDictionary;
    for (const part of key.split(".")) value = (value as Record<string, unknown> | undefined)?.[part];
    return typeof value === "string" ? value : key;
  };
  const zhLanguage: ReturnType<typeof original.useLanguage> = { language: "zh", setLanguage: () => undefined, t: lookup, dict: zhDictionary };
  return { ...original, useLanguage: () => (stubs.language === "zh" ? zhLanguage : original.useLanguage()) };
});

import { RiskCheckSection } from "./RiskCheckSection";

const enAdmin = en.admin as Record<string, string>;
const zhAdmin = zh.admin as Record<string, string>;
type Language = "en" | "zh";
const admin = (language: Language) => (language === "en" ? enAdmin : zhAdmin);

const CHECKED_AT = "2026-09-30T00:00:00.000Z";

function reason(code: StateDataQualityReason["code"], severity: StateDataQualityReason["severity"]): StateDataQualityReason {
  return { code, severity, message: `${code} message` };
}

function row(stateCode: string, riskLevel: StateDataQualityRiskLevel, reasons: StateDataQualityReason[]): StateDataQualityRow {
  return {
    stateCode,
    sourceId: `${stateCode.toLowerCase()}_portal`,
    sourceLabel: `${stateCode} portal`,
    sourceUrl: "https://example.gov/bids",
    riskLevel,
    bidCount: 12,
    enabledSourceCount: 2,
    latestCrawlerStartedAt: null,
    latestSourceHealthCheckedAt: null,
    latestRiskCheckCheckedAt: null,
    attachmentStatus: "real_file_openable",
    attachmentSummary: { total: 4, realFileOpenable: 3, downloadNote: 0, missingOrFailed: 1 },
    reasons,
  };
}

function stateReport(overrides: Partial<StateDataQualityReport> = {}): StateDataQualityReport {
  return {
    ok: false,
    checkedAt: CHECKED_AT,
    summary: { totalStates: 50, p0BlockerStates: 2, p1WarningStates: 1, p2WarningStates: 0 },
    actions: [
      {
        id: "ca:crawler",
        priority: "P0",
        stateCode: "CA",
        sourceId: "ca_portal",
        sourceLabel: "CA portal",
        reasonCode: "missing_state_bid",
        title: "Repair the CA crawler",
        recommendedAction: "Run or repair the state crawler.",
        ownerHint: "crawler-oncall",
        dueInHours: 24,
        evidence: "No active state bid is imported.",
      },
    ],
    attachmentWorklist: [],
    rows: [
      row("CA", "P0", [reason("missing_state_bid", "P0")]),
      row("TX", "P0", [reason("attachment_archive_invalid", "P0"), reason("crawler_stale_or_missing", "P1")]),
      row("FL", "P1", [reason("fixture_fallback", "P1")]),
      row("WA", "PASS", []),
    ],
    ...overrides,
  };
}

function load(matrix: StateDataQualityReport | null, ok = true) {
  const report: RiskChecklistReport = { ok, checkedAt: CHECKED_AT, checks: [] };
  const trend: RiskChecklistTrend = {
    snapshotCount: 0,
    globalUrlAllPassing: true,
    stateCoverageDeclined: false,
    attachmentDownloadCountChanged: false,
    latestGlobalUrlSummary: null,
    latestStateCoverageSummary: null,
    latestAttachmentSummary: null,
  };
  const status: AdminResourceStatus = "ready";
  stubs.resource = {
    status,
    data: { report, history: [], trend, stateDataQuality: matrix },
    error: null,
    reload: async () => undefined,
    setData: () => undefined,
  };
}

function render(language: Language) {
  stubs.language = language;
  return renderToStaticMarkup(
    <LanguageProvider>
      <RiskCheckSection />
    </LanguageProvider>,
  );
}

/** The text nodes of rendered markup, so an attribute value (`value="all"`) is never read as on-screen copy. */
const textNodes = (html: string) => html.split(/<[^>]*>/).map((text) => text.trim()).filter(Boolean);

beforeEach(() => {
  load(stateReport());
});

describe.each<Language>(["en", "zh"])("state portal quality matrix in %s", (language) => {
  const t = admin(language);

  it("prints the matrix chrome from the dictionary", () => {
    const html = render(language);
    const text = textNodes(html);

    expect(text).toContain(t.stateQualityMatrixTitle);
    expect(text).toContain(t.stateQualityBlockerReview);
    expect(text).toContain(t.stateQualitySummary);
    expect(text).toContain(t.stateQualityTotalStates.replace("{count}", "50"));
    expect(text).toContain(t.stateQualityActionQueue);
    expect(text).toContain(t.stateQualityActionCount.replace("{shown}", "1").replace("{total}", "1"));
    expect(text).toContain(t.stateQualityRecommendedAction);
    expect(text).toContain(t.stateQualityReasonCode);
    expect(text).toContain(t.stateQualityRiskFilter);
    expect(text).toContain(t.stateQualityDueHours.replace("{hours}", "24"));
    expect(html).toMatch(new RegExp(`<option value="all"[^>]*>${t.stateQualityAllRecommendedActions}</option>`));
    expect(html).toMatch(new RegExp(`<option value="all"[^>]*>${t.stateQualityAllReasonCodes}</option>`));
  });

  it("labels the table headers, the All filter, and a state without a risk or a reason", () => {
    const text = textNodes(render(language));

    for (const key of [
      "stateQualityColumnState",
      "stateQualityColumnRisk",
      "stateQualityColumnBids",
      "stateQualityColumnEnabledSource",
      "stateQualityColumnAttachmentRatio",
      "stateQualityColumnReasonCode",
    ]) {
      expect(text, key).toContain(t[key]);
    }
    expect(text).toContain(t.stateQualityFilterAll);
    // The P levels and the reason codes are codes and stay as they are; PASS is a word.
    for (const code of ["P0", "P1", "P2", "missing_state_bid", "fixture_fallback", "3/4 (75%)"]) expect(text, code).toContain(code);
    expect(text).toContain(t.stateQualityPass);
    expect(text).toContain(t.stateQualityReasonNone);
  });

  it("says which of the watched states are P0 blockers, and nothing when none is", () => {
    expect(textNodes(render(language))).toContain(
      t.stateQualityP0Notice.replace("{watchlist}", "CA/FL/IL/NY/TX").replace("{states}", "CA/TX"),
    );

    load(stateReport({ rows: [row("FL", "P1", []), row("WA", "P0", [])] }));
    expect(textNodes(render(language)).some((node) => node.includes("CA/FL/IL/NY/TX"))).toBe(false);
  });

  it("prints the empty action queue and the empty table", () => {
    load(stateReport({ actions: [], rows: [] }));
    const text = textNodes(render(language));

    expect(text).toContain(t.stateQualityNoActions);
    expect(text).toContain(t.stateQualityNoRows);
    expect(text).toContain(t.stateQualityActionCount.replace("{shown}", "0").replace("{total}", "0"));
  });

  it("names a passing matrix PASS and leaves no placeholder or dictionary key on the page", () => {
    load(stateReport({ ok: true, rows: [row("WA", "PASS", [])], actions: [] }), true);
    const html = render(language);

    expect(textNodes(html)).toContain(t.stateQualityPass);
    expect(textNodes(html)).not.toContain(t.stateQualityBlockerReview);
    expect(html).not.toMatch(/\{(count|shown|total|hours|watchlist|states)\}/);
    // A key the dictionary lacks would print as itself.
    expect(html).not.toMatch(/admin\.[a-zA-Z]/);
  });
});

describe("state portal quality matrix in Chinese", () => {
  it("prints none of the English copy the matrix used to hard-code", () => {
    const text = textNodes(render("zh"));

    for (const key of [
      "stateQualityPass",
      "stateQualityBlockerReview",
      "stateQualitySummary",
      "stateQualityActionQueue",
      "stateQualityRecommendedAction",
      "stateQualityAllRecommendedActions",
      "stateQualityRiskFilter",
      "stateQualityFilterAll",
      "stateQualityReasonCode",
      "stateQualityAllReasonCodes",
      "stateQualityColumnState",
      "stateQualityColumnRisk",
      "stateQualityColumnBids",
      "stateQualityColumnEnabledSource",
      "stateQualityColumnAttachmentRatio",
      "stateQualityColumnReasonCode",
      "stateQualityReasonNone",
    ]) {
      expect(zhAdmin[key], key).not.toBe(enAdmin[key]);
      expect(text.filter((node) => node === enAdmin[key]), `${key}: "${enAdmin[key]}"`).toEqual([]);
    }
    expect(text.some((node) => /P0 blockers are state data quality blockers/.test(node))).toBe(false);
    expect(text.some((node) => /^total states:/.test(node))).toBe(false);
    expect(text.some((node) => /\d+\/\d+ actions$/.test(node))).toBe(false);
    expect(text.some((node) => /^\d+h$/.test(node))).toBe(false);
  });
});

describe("state portal quality matrix in English", () => {
  it("renders the copy it always did", () => {
    const text = textNodes(render("en"));

    expect(text).toContain("P0 blocker review");
    expect(text).toContain("Summary: total states, P0/P1/P2 counts, source enablement, bids, attachment real ratio, and reason code.");
    expect(text).toContain("total states: 50");
    expect(text).toContain("CA/FL/IL/NY/TX P0 blockers are state data quality blockers; currently blocked: CA/TX. These are not live source-health failures.");
    expect(text).toContain("State data quality action queue");
    expect(text).toContain("1/1 actions");
    expect(text).toContain("24h");
    expect(text).toContain("Recommended action");
    expect(text).toContain("Risk filter");
    expect(text).toContain("Reason code");
    expect(text).toContain("All");
    for (const header of ["state", "risk", "bids", "enabled source", "attachment real ratio", "reason code"]) expect(text).toContain(header);
    expect(text).toContain("PASS");
    expect(text).toContain("none");
  });
});
