import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateDataQualityReport, StateDataQualityRiskLevel, StateDataQualityRow } from "@/lib/api/admin";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import type { RiskChecklistCheck, RiskChecklistReport } from "@/server/risk/checklist";
import type { RiskChecklistSnapshot, RiskChecklistTrend } from "@/server/risk/snapshots";
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

function load(
  matrix: StateDataQualityReport | null,
  ok = true,
  checks: RiskChecklistCheck[] = [],
  extra: { trend?: Partial<RiskChecklistTrend>; history?: RiskChecklistSnapshot[] } = {},
) {
  const report: RiskChecklistReport = { ok, checkedAt: CHECKED_AT, checks };
  const trend: RiskChecklistTrend = {
    snapshotCount: 0,
    globalUrlAllPassing: true,
    stateCoverageDeclined: false,
    attachmentDownloadCountChanged: false,
    latestGlobalUrlSummary: null,
    latestStateCoverageSummary: null,
    latestAttachmentSummary: null,
    ...extra.trend,
  };
  const status: AdminResourceStatus = "ready";
  stubs.resource = {
    status,
    data: { report, history: extra.history ?? [], trend, stateDataQuality: matrix },
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

// The server writes the titles of its checks and the fixes and owners of its actions in English. The section words
// each by its code (a check's id, an action's reason code, an owner's slug) and prints the server's own text only for
// a code the dictionary does not know: one from a newer build.
type StateAction = StateDataQualityReport["actions"][number];

function stateAction(reasonCode: string, recommendedAction: string, ownerHint: string, evidence: string): StateAction {
  return {
    id: `CA:ca_portal:${reasonCode}`,
    priority: "P0",
    stateCode: "CA",
    sourceId: "ca_portal",
    sourceLabel: "CA portal",
    reasonCode: reasonCode as StateAction["reasonCode"],
    title: `CA ${reasonCode}`,
    recommendedAction,
    ownerHint,
    dueInHours: 24,
    evidence,
  };
}

/** The wording the server sends for the codes below, as the API answers it. */
const SERVER_TEXT = {
  coverageLabel: "50 state data coverage",
  governanceLabel: "Source ingestion governance metadata",
  missingBidFix: "Run or repair the state crawler, then verify at least one active state bid is imported.",
  archiveFix: "Re-archive the failed attachment and verify the stored file and checksum.",
} as const;

const CHECKS: RiskChecklistCheck[] = [
  {
    id: "state-coverage",
    label: SERVER_TEXT.coverageLabel,
    ok: true,
    summary: "50/50 required states have at least one active bid",
  },
  {
    id: "source-ingestion-governance",
    label: SERVER_TEXT.governanceLabel,
    ok: false,
    summary: "50 state crawler sources checked for approval metadata, restricted-source blocks, and local ingestion readiness",
    details: ["CA ca_caleprocure is enabled but not approved for production ingestion"],
  },
  {
    id: "check-from-a-newer-build",
    label: "A check this build has no title for",
    ok: false,
    summary: "3 things checked",
    details: ["thing 2 failed"],
  },
];

const ACTIONS: StateAction[] = [
  stateAction("missing_state_bid", SERVER_TEXT.missingBidFix, "data-ops", "CA has no active state bid rows."),
  stateAction(
    "attachment_archive_invalid",
    SERVER_TEXT.archiveFix,
    "archive-ops",
    "bid_1/att_1 is marked archived but its file or checksum is not valid.",
  ),
  stateAction("reason_from_a_newer_build", "Do the newer thing first.", "team-from-a-newer-build", "Something new happened."),
];

describe.each<Language>(["en", "zh"])("server-written check titles and action text in %s", (language) => {
  const t = admin(language);

  it("titles each check by its id and prints its summary and details as the server stored them", () => {
    load(stateReport(), false, CHECKS);
    const text = textNodes(render(language));

    expect(text).toContain(t.riskCheckLabel_state_coverage);
    expect(text).toContain(t.riskCheckLabel_source_ingestion_governance);
    expect(text).toContain("50/50 required states have at least one active bid");
    expect(text).toContain(CHECKS[1].summary);
    expect(text).toContain("CA ca_caleprocure is enabled but not approved for production ingestion");
    expect(text).toContain("3 things checked");
    expect(text).toContain("thing 2 failed");
  });

  it("prints the server's own title for a check the dictionary has no title for", () => {
    load(stateReport(), false, CHECKS);

    expect(textNodes(render(language))).toContain("A check this build has no title for");
  });

  it("words each action's fix and owner in the page's language and leaves the evidence as stored", () => {
    load(stateReport({ actions: ACTIONS }));
    const text = textNodes(render(language));

    expect(text).toContain(t.stateQualityAction_missing_state_bid);
    expect(text).toContain(t.stateQualityAction_attachment_archive_invalid);
    expect(text).toContain(t.stateQualityOwner_data_ops);
    expect(text).toContain(t.stateQualityOwner_archive_ops);
    expect(text).toContain("CA has no active state bid rows.");
    expect(text).toContain("bid_1/att_1 is marked archived but its file or checksum is not valid.");
    // The reason code itself is a technical token and stays as it is.
    expect(text.some((node) => node.includes("CA · missing_state_bid"))).toBe(true);
  });

  it("prints the server's own fix and owner for a reason and a team the dictionary does not know", () => {
    load(stateReport({ actions: ACTIONS }));
    const text = textNodes(render(language));

    expect(text).toContain("Do the newer thing first.");
    expect(text).toContain("team-from-a-newer-build");
    expect(text).toContain("Something new happened.");
  });

  it("words the recommended-action filter in the page's language and filters on the server's text", () => {
    load(stateReport({ actions: ACTIONS }));
    const html = render(language);

    expect(html).toContain(`<option value="${SERVER_TEXT.missingBidFix}">${t.stateQualityAction_missing_state_bid}</option>`);
    expect(html).toContain(`<option value="${SERVER_TEXT.archiveFix}">${t.stateQualityAction_attachment_archive_invalid}</option>`);
    expect(html).toContain('<option value="Do the newer thing first.">Do the newer thing first.</option>');
  });

  it("leaves no dictionary key or placeholder on the page", () => {
    load(stateReport({ actions: ACTIONS }), false, CHECKS);
    const html = render(language);

    expect(html).not.toMatch(/admin\.[a-zA-Z]/);
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});

describe("server-written check titles and action text in Chinese", () => {
  it("prints none of the English the server writes for a check, a fix or a team it knows", () => {
    load(stateReport({ actions: ACTIONS }), false, CHECKS);
    const text = textNodes(render("zh"));

    for (const english of [
      SERVER_TEXT.coverageLabel,
      SERVER_TEXT.governanceLabel,
      SERVER_TEXT.missingBidFix,
      SERVER_TEXT.archiveFix,
      "data-ops",
      "archive-ops",
    ]) {
      expect(
        text.filter((node) => node.includes(english)),
        english,
      ).toEqual([]);
    }
  });
});

describe("server-written check titles and action text in English", () => {
  it("prints the wording the server sends, as it always did", () => {
    load(stateReport({ actions: ACTIONS }), false, CHECKS);
    const text = textNodes(render("en"));

    for (const serverText of [
      SERVER_TEXT.coverageLabel,
      SERVER_TEXT.governanceLabel,
      SERVER_TEXT.missingBidFix,
      SERVER_TEXT.archiveFix,
      "data-ops",
      "archive-ops",
    ]) {
      expect(text, serverText).toContain(serverText);
    }
  });
});

// The checklist can come back with a check that was set aside: 50-state coverage on seed data is NOT RUN. It is neither
// a pass nor a failure, and the console must not show it as either.
const NOT_RUN_COVERAGE: RiskChecklistCheck = {
  id: "state-coverage",
  label: SERVER_TEXT.coverageLabel,
  ok: false,
  status: "not_run",
  summary: "not evaluated on seed data: 5/50 required states have at least one active bid",
  details: ["run on seed data: which states have an active bid is a property of the business database", "missing state AK"],
};

const PASSING_CONTENT: RiskChecklistCheck = {
  id: "state-content",
  label: "State bid content is non-empty",
  ok: true,
  status: "pass",
  summary: "5 state bids checked for title, issuer, URL, state, and description",
};

const FAILING_ATTACHMENTS: RiskChecklistCheck = {
  id: "attachment-downloads",
  label: "Attachments use safe non-404 download routes",
  ok: false,
  status: "fail",
  summary: "6 state attachments checked",
  details: ["bid_1: attachment SOW would return 404"],
};

/** The text nodes that follow the first node equal to `heading`. */
const after = (text: string[], heading: string) => text.slice(text.indexOf(heading) + 1);

function snapshotOf(id: string, ok: boolean, checks: RiskChecklistCheck[]): RiskChecklistSnapshot {
  return { id, ok, checkedAt: CHECKED_AT, createdAt: CHECKED_AT, report: { ok, checkedAt: CHECKED_AT, checks } };
}

describe.each<Language>(["en", "zh"])("a risk check that did not run in %s", (language) => {
  const t = admin(language);

  it("headlines the checklist as not fully verified: neither all passed nor needs attention", () => {
    load(null, false, [NOT_RUN_COVERAGE, PASSING_CONTENT]);
    const text = textNodes(render(language));

    expect(text).toContain(t.riskCheckIncomplete.replace("{count}", "1"));
    expect(text).not.toContain(t.riskCheckPassed);
    expect(text).not.toContain(t.riskCheckFailed);
  });

  it("still headlines a failure as a failure when another check did not run", () => {
    load(null, false, [NOT_RUN_COVERAGE, FAILING_ATTACHMENTS]);
    const text = textNodes(render(language));

    expect(text).toContain(t.riskCheckFailed);
    expect(text).not.toContain(t.riskCheckPassed);
    expect(text.some((node) => node === t.riskCheckIncomplete.replace("{count}", "1"))).toBe(false);
  });

  it("badges the check Not run, with its summary as the server wrote it, and badges the others as they are", () => {
    load(null, false, [NOT_RUN_COVERAGE, PASSING_CONTENT, FAILING_ATTACHMENTS]);
    const text = textNodes(render(language));

    // A check card reads: its title, its summary, its badge.
    const card = (title: string) => text.slice(text.indexOf(title), text.indexOf(title) + 3);
    expect(card(t.riskCheckLabel_state_coverage)).toEqual([
      t.riskCheckLabel_state_coverage,
      NOT_RUN_COVERAGE.summary,
      t.riskCheckNotRun,
    ]);
    expect(card(t.riskCheckLabel_state_content)[2]).toBe(t.riskCheckOk);
    expect(card(t.riskCheckLabel_attachment_downloads)[2]).toBe(t.riskCheckIssue);
  });

  it("does not paint what it did not run in the colour of a failure", () => {
    load(null, false, [NOT_RUN_COVERAGE]);
    const html = render(language);

    const detailList = html.match(/<ul class="([^"]*)">(?:(?!<\/ul>)[\s\S])*missing state AK/);
    expect(detailList?.[1]).toContain("text-amber-700");
    expect(detailList?.[1]).not.toContain("text-rose-700");
  });

  it("reads the state coverage trend as Not run while the latest coverage check did not run", () => {
    load(null, false, [NOT_RUN_COVERAGE], { trend: { stateCoverageDeclined: null, latestStateCoverageSummary: NOT_RUN_COVERAGE.summary } });
    const text = textNodes(render(language));

    expect(after(text, t.riskTrendStateCoverageDeclined).slice(0, 2)).toEqual([NOT_RUN_COVERAGE.summary, t.riskCheckNotRun]);
  });

  it("reads the state coverage trend as before once the check ran", () => {
    load(null, true, [{ ...NOT_RUN_COVERAGE, ok: true, status: "pass", summary: "50/50 required states have at least one active bid", details: undefined }]);
    const text = textNodes(render(language));

    expect(after(text, t.riskTrendStateCoverageDeclined)[1]).toBe(t.riskCheckOk);
  });

  it("badges a recorded snapshot Not run when a check of its report did not run, Issue when one failed, Pass when none did", () => {
    load(null, false, [NOT_RUN_COVERAGE], {
      history: [
        snapshotOf("incomplete", false, [NOT_RUN_COVERAGE, PASSING_CONTENT]),
        snapshotOf("failed", false, [NOT_RUN_COVERAGE, FAILING_ATTACHMENTS]),
        snapshotOf("passed", true, [PASSING_CONTENT]),
      ],
    });
    const rows = after(textNodes(render(language)), t.riskCheckHistory);

    // A snapshot row reads: its badge, when it was checked, the global URL summary.
    expect([rows[0], rows[3], rows[6]]).toEqual([t.riskCheckNotRun, t.riskCheckIssue, t.riskCheckOk]);
  });

  it("leaves no dictionary key or placeholder on the page", () => {
    load(null, false, [NOT_RUN_COVERAGE, PASSING_CONTENT], { history: [snapshotOf("incomplete", false, [NOT_RUN_COVERAGE])] });
    const html = render(language);

    expect(html).not.toMatch(/admin\.[a-zA-Z]/);
    expect(html).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});

describe("a risk check that did not run in Chinese", () => {
  it("prints none of the English words for it", () => {
    load(null, false, [NOT_RUN_COVERAGE, PASSING_CONTENT]);
    const text = textNodes(render("zh"));

    expect(text).toContain(zhAdmin.riskCheckNotRun);
    expect(text).not.toContain(enAdmin.riskCheckNotRun);
    expect(text.some((node) => node.includes("Not fully verified"))).toBe(false);
  });
});
