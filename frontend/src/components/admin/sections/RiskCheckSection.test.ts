import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { RISK_CHECK_IDS } from "@/server/risk/checklist";
import {
  ownerHintForReason,
  recommendedActionForReason,
  STATE_DATA_QUALITY_OWNER_HINTS,
  STATE_DATA_QUALITY_REASON_CODES,
} from "@/server/source-validity/state-data-quality";
import {
  filterStateDataQualityActionsByRecommendedAction,
  filterStateDataQualityRows,
  riskCheckLabel,
  riskCheckStatusLabel,
  riskCheckStatusTone,
  riskReportHeading,
  STATE_DATA_QUALITY_RISK_FILTERS,
  stateAttachmentRealRatio,
  stateDataQualityActionText,
  stateDataQualityOwnerLabel,
  stateDataQualityP0BlockerNotice,
  stateDataQualityRecommendedActionLabels,
  toRiskSectionData,
} from "./RiskCheckSection";

const enAdmin = en.admin as Record<string, string>;
const zhAdmin = zh.admin as Record<string, string>;
/** The page's `t` in one language, for the `admin.` keys the section reads. */
const tIn = (dictionary: Record<string, string>) => (key: string) => dictionary[key.replace(/^admin\./, "")] ?? key;
const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

describe("risk check section", () => {
  it("titles the matrix as the 50-state portal quality view and loads its own report", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('t("admin.stateQualityMatrixTitle")');
    expect(source).not.toContain("50-state data quality matrix");
    expect(source).toContain("getAdminRiskChecklist()");
    expect(source).toContain("useAdminResource(");
  });

  it("follows the resource render rule and refreshes through the resource", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("useAdminResource(loadRiskReport)");
    expect(source).toContain('code="error"');
    expect(source).toContain('code="loading"');
    expect(source).toContain('t("admin.sectionRefreshFailed")');
    expect(source).toContain("risk.reload()");
    expect(source).toContain("isRefreshingRiskReport");
  });

  // Moved from src/app/admin/page.test.ts ("keeps successful admin sections ready when one admin API rejects"):
  // the `risk` slice mapping now lives in toRiskSectionData.
  it("maps the risk checklist response to the section data", () => {
    const report = { ok: true, checkedAt: "2026-06-10T00:00:00.000Z", checks: [] };
    const trend = { globalUrlAllPassing: true, stateCoverageDeclined: false, attachmentDownloadCountChanged: false };
    const stateDataQuality = {
      ok: false,
      checkedAt: "2026-06-10T00:00:00.000Z",
      summary: { totalStates: 50, p0BlockerStates: 5, p1WarningStates: 0, p2WarningStates: 0 },
      rows: [],
    };

    const data = toRiskSectionData({ report, history: [], trend, stateDataQuality } as never);
    expect(data.report).toBe(report);
    expect(data.history).toEqual([]);
    expect(data.trend).toBe(trend);
    expect(data.stateDataQuality?.summary).toMatchObject({ totalStates: 50, p0BlockerStates: 5 });

    // An older server answers without a state data quality report.
    expect(toRiskSectionData({ report, history: [], trend } as never).stateDataQuality).toBeNull();
  });

  // Moved from src/app/admin/page.test.ts ("renders user access controls alongside crawler operations").
  it("keeps the risk check and state data quality matrix it took over from the dashboard page", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("getAdminRiskChecklist");
    expect(source).toContain("StateDataQualityMatrix");
    expect(source).toContain("stateDataQuality");
    expect(source).toContain("stateQualityRiskFilter");
    expect(source).toContain("stateQualityReasonFilter");
    expect(source).toContain("STATE_DATA_QUALITY_RISK_FILTERS");
    expect(source).toContain("filterStateDataQualityRows");
    expect(source).toContain("stateAttachmentRealRatio");
    expect(source).toContain('t("admin.stateQualityActionQueue")');
    expect(source).toContain("report.actions");
    expect(source).toContain("recommendedAction");
    expect(source).toContain('t("admin.stateQualityP0Notice")');
    expect(source).not.toContain("CA/FL/IL/NY/TX source-health production risk");
    expect(source).toContain('t("admin.riskCheck")');
    expect(source).toContain('t("admin.riskCheckGlobalUrlTitle")');
    expect(source).toContain('t("admin.riskCheckGlobalUrlDescription")');
    expect(source).toContain('t("admin.riskCheckMoreIssues")');
    expect(source).toContain('check.id === "global-url-validity"');
    expect(source).toContain('t("admin.refreshRiskCheck")');
    expect(source).toContain('t("admin.exportRiskCheck")');
    expect(source).toContain("refreshRiskReport");
    expect(source).toContain("exportRiskReport");
    expect(source).toContain("URL.createObjectURL");
    expect(source).toContain("risk-check-report");
    expect(source).toContain("riskDetailBidHref");
    expect(source).toContain("bidDetailPath");
    expect(source).toContain("RiskDetailItem");
    expect(source).toContain('t("admin.riskCheckHistory")');
    expect(source).toContain('t("admin.riskCheckHistoryEmpty")');
    expect(source).toContain('t("admin.riskCheckTrend")');
    expect(source).toContain('t("admin.riskTrendGlobalUrlStable")');
    expect(source).toContain('t("admin.riskTrendStateCoverageDeclined")');
    expect(source).toContain('t("admin.riskTrendAttachmentChanged")');
    expect(source).toContain("riskHistory");
    expect(source).toContain("riskTrend");
    expect(source).toContain("riskReport");
    expect(source).toContain("RiskCheck");
  });

  // Moved from src/app/admin/page.test.ts ("filters state data quality action rows by recommended action").
  it("filters state data quality action rows by recommended action", () => {
    const actions = [
      {
        id: "ca:crawler",
        recommendedAction: "Run or repair the state crawler, then verify at least one active state bid is imported.",
      },
      {
        id: "tx:archive",
        recommendedAction: "Re-archive the failed attachment and verify the stored file and checksum.",
      },
      {
        id: "ny:crawler",
        recommendedAction: "Run or repair the state crawler, then verify at least one active state bid is imported.",
      },
    ];

    expect(filterStateDataQualityActionsByRecommendedAction(actions, "all").map((action) => action.id)).toEqual([
      "ca:crawler",
      "tx:archive",
      "ny:crawler",
    ]);
    expect(
      filterStateDataQualityActionsByRecommendedAction(
        actions,
        "Run or repair the state crawler, then verify at least one active state bid is imported.",
      ).map((action) => action.id),
    ).toEqual(["ca:crawler", "ny:crawler"]);
  });

  // Moved from src/app/admin/page.test.ts ("filters state data quality matrix rows by P0/P1/P2 and reason code").
  it("filters state data quality matrix rows by P0/P1/P2 and reason code", () => {
    expect(STATE_DATA_QUALITY_RISK_FILTERS).toEqual(["all", "P0", "P1", "P2"]);

    const rows = [
      {
        stateCode: "CA",
        riskLevel: "P0",
        reasons: [{ code: "missing_state_bid", severity: "P0", message: "missing" }],
      },
      {
        stateCode: "FL",
        riskLevel: "P1",
        reasons: [{ code: "fixture_fallback", severity: "P1", message: "fallback" }],
      },
      {
        stateCode: "IL",
        riskLevel: "P2",
        reasons: [{ code: "risk_check_stale_or_missing", severity: "P2", message: "stale" }],
      },
      {
        stateCode: "TX",
        riskLevel: "P0",
        reasons: [{ code: "attachment_archive_invalid", severity: "P0", message: "archive" }],
      },
    ];

    expect(
      filterStateDataQualityRows(rows, { riskLevel: "P0", reasonCode: "all" }).map((row) => row.stateCode),
    ).toEqual(["CA", "TX"]);
    expect(
      filterStateDataQualityRows(rows, { riskLevel: "all", reasonCode: "fixture_fallback" }).map((row) => row.stateCode),
    ).toEqual(["FL"]);
    expect(
      filterStateDataQualityRows(rows, { riskLevel: "P0", reasonCode: "missing_state_bid" }).map((row) => row.stateCode),
    ).toEqual(["CA"]);
  });

  // Moved from src/app/admin/page.test.ts ("describes CA FL IL NY TX P0 blockers as state data quality blockers ...").
  it("describes CA FL IL NY TX P0 blockers as state data quality blockers, not source health production risk", () => {
    const notice = stateDataQualityP0BlockerNotice(
      ["CA", "FL", "IL", "NY", "TX"].map((stateCode) => ({
        stateCode,
        riskLevel: "P0",
      })),
      tIn(enAdmin),
    );

    expect(notice).toBe(
      "CA/FL/IL/NY/TX P0 blockers are state data quality blockers; currently blocked: CA/FL/IL/NY/TX. These are not live source-health failures.",
    );
    expect(notice).not.toContain("source-health production risk");
    expect(stateDataQualityP0BlockerNotice([{ stateCode: "CA", riskLevel: "P1" }], tIn(enAdmin))).toBeNull();
  });

  it("names only the watched states that are P0 blockers, in the language of the page", () => {
    const rows = [
      { stateCode: "TX", riskLevel: "P0" },
      { stateCode: "CA", riskLevel: "P0" },
      { stateCode: "FL", riskLevel: "P1" },
      // Not a watched state, so it is not named even at P0.
      { stateCode: "WA", riskLevel: "P0" },
    ];

    expect(stateDataQualityP0BlockerNotice(rows, tIn(enAdmin))).toBe(
      "CA/FL/IL/NY/TX P0 blockers are state data quality blockers; currently blocked: CA/TX. These are not live source-health failures.",
    );
    const zhNotice = stateDataQualityP0BlockerNotice(rows, tIn(zhAdmin));
    expect(zhNotice).toBe("CA/FL/IL/NY/TX 的 P0 阻断项属于州级数据质量阻断项；当前受阻：CA/TX。这些并非 Live 来源健康故障。");
    expect(zhNotice).not.toMatch(/[{}]/);
  });

  it("words the matrix as its summary sentence and the console do", () => {
    // The columns are named as the summary sentence names them, in both languages.
    for (const dictionary of [enAdmin, zhAdmin]) {
      for (const key of ["stateQualityColumnBids", "stateQualityColumnAttachmentRatio", "stateQualityColumnReasonCode"]) {
        expect(dictionary.stateQualitySummary, key).toContain(dictionary[key]);
      }
    }
    // Containment alone cannot tell 招标数 from the bare 招标, which is a substring of the summary too: the column
    // counts bids, so it is named exactly as the summary sentence names it.
    expect(zhAdmin.stateQualityColumnBids).toBe("招标数");
    // A table row is a 记录 in the empty-state message, and the notice uses the console's own "Live 来源健康" term.
    expect(zhAdmin.stateQualityNoRows).toContain("数据质量记录");
    expect(zhAdmin.stateQualityP0Notice).toContain(zhAdmin.liveSourceHealth);
  });

  it("keeps no English UI copy in the matrix", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    // The keys are blanked so that a key name is not read as English copy.
    const sourceWithoutKeys = source.replace(/admin\.[A-Za-z_]+/g, "admin.");
    for (const literal of [
      "State data quality action queue",
      "No state data quality actions are open.",
      "No state data quality rows match this filter.",
      "Recommended action",
      "Risk filter",
      "Reason code",
      "P0 blocker review",
      "total states:",
      "all recommended actions",
      "all reason codes",
      "attachment real ratio",
      "enabled source",
      "CA/FL/IL/NY/TX P0 blockers",
      "not live source-health failures",
      "Summary:",
    ]) {
      expect(sourceWithoutKeys, literal).not.toContain(literal);
    }
    // The table headers, the badges and the filter labels are all looked up.
    for (const key of [
      "stateQualityColumnState",
      "stateQualityColumnRisk",
      "stateQualityColumnBids",
      "stateQualityColumnEnabledSource",
      "stateQualityColumnAttachmentRatio",
      "stateQualityColumnReasonCode",
      "stateQualityPass",
      "stateQualityBlockerReview",
      "stateQualitySummary",
      "stateQualityTotalStates",
      "stateQualityActionCount",
      "stateQualityRecommendedAction",
      "stateQualityAllRecommendedActions",
      "stateQualityNoActions",
      "stateQualityDueHours",
      "stateQualityRiskFilter",
      "stateQualityFilterAll",
      "stateQualityReasonCode",
      "stateQualityAllReasonCodes",
      "stateQualityNoRows",
      "stateQualityReasonNone",
    ]) {
      expect(source, key).toContain(`t("admin.${key}")`);
    }
  });

  it("has an English and a different Chinese text, with the same placeholders, for every key it uses", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    const keys = [...new Set([...source.matchAll(/\bt\("admin\.([A-Za-z_]+)"\)/g)].map((match) => match[1]))];
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(enAdmin[key], `en ${key}`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key}`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key} differs from en`).not.toBe(enAdmin[key]);
      expect(placeholders(zhAdmin[key]), `${key} placeholders`).toEqual(placeholders(enAdmin[key]));
    }
  });

  it("formats the real attachment ratio of a state row", () => {
    expect(stateAttachmentRealRatio({ attachmentSummary: { realFileOpenable: 3, total: 4 } } as never)).toBe("3/4 (75%)");
    expect(stateAttachmentRealRatio({ attachmentSummary: { realFileOpenable: 0, total: 0 } } as never)).toBe("0/0 (0%)");
  });
});

/**
 * The dictionary key a server-written code is looked up under: `<prefix>_<code>`, the kebab-case of a check id or an
 * owner slug turned into snake_case like every other key. It is spelled out here, not imported, so the test pins the
 * naming rule as well as the component following it.
 */
const keyFor = (prefix: string, code: string) => `${prefix}_${code.replace(/-/g, "_")}`;

const checkTitleKeys = RISK_CHECK_IDS.map((id) => keyFor("riskCheckLabel", id));
const reasonActionKeys = STATE_DATA_QUALITY_REASON_CODES.map((code) => keyFor("stateQualityAction", code));
/** Every team the server can name: the exported list and whatever `ownerHintForReason` actually answers. */
const ownerSlugs = [
  ...new Set<string>([...STATE_DATA_QUALITY_OWNER_HINTS, ...STATE_DATA_QUALITY_REASON_CODES.map(ownerHintForReason)]),
];
const ownerKeys = ownerSlugs.map((slug) => keyFor("stateQualityOwner", slug));

/** Every dictionary key that starts with `<prefix>_`, so a text left behind for a code the server dropped is found too. */
const keysWithPrefix = (dictionary: Record<string, string>, prefix: string) =>
  Object.keys(dictionary)
    .filter((key) => key.startsWith(`${prefix}_`))
    .sort();

describe("server-written text the section translates by its code", () => {
  // A new server check, reason or owner has no dictionary entry until someone writes one: these are the tests that
  // notice. Their ids and codes are read from the server modules, not listed here.
  it("titles every check the server builds, in English and in a different Chinese", () => {
    expect(RISK_CHECK_IDS.length).toBeGreaterThan(0);
    RISK_CHECK_IDS.forEach((id, index) => {
      const key = checkTitleKeys[index];
      expect(enAdmin[key], `en ${key}: the server builds the "${id}" check`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key}: the server builds the "${id}" check`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key} differs from en`).not.toBe(enAdmin[key]);
      expect(placeholders(zhAdmin[key]), `${key} placeholders`).toEqual(placeholders(enAdmin[key]));
    });
  });

  it("words the fix for every reason the server can raise, as the server does in English and differently in Chinese", () => {
    expect(STATE_DATA_QUALITY_REASON_CODES.length).toBeGreaterThan(0);
    for (const code of STATE_DATA_QUALITY_REASON_CODES) {
      const key = keyFor("stateQualityAction", code);
      expect(enAdmin[key], `en ${key}: the server raises "${code}"`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key}: the server raises "${code}"`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key} differs from en`).not.toBe(enAdmin[key]);
      expect(placeholders(zhAdmin[key]), `${key} placeholders`).toEqual(placeholders(enAdmin[key]));
      // English keeps printing exactly what the server writes, so a reworded server text has to reach the dictionary.
      expect(enAdmin[key], `en ${key} is the server's own wording`).toBe(recommendedActionForReason(code));
    }
  });

  it("names every team the server hands an action to, in English as the server does and differently in Chinese", () => {
    expect(ownerSlugs.length).toBeGreaterThan(0);
    for (const slug of ownerSlugs) {
      const key = keyFor("stateQualityOwner", slug);
      expect(enAdmin[key], `en ${key}: the server hands actions to "${slug}"`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key}: the server hands actions to "${slug}"`).toBeTruthy();
      expect(zhAdmin[key], `zh ${key} differs from en`).not.toBe(enAdmin[key]);
      expect(enAdmin[key], `en ${key} is the server's own slug`).toBe(slug);
    }
  });

  it("keeps no text for a check, reason or owner the server no longer has", () => {
    for (const dictionary of [enAdmin, zhAdmin]) {
      expect(keysWithPrefix(dictionary, "riskCheckLabel")).toEqual([...checkTitleKeys].sort());
      expect(keysWithPrefix(dictionary, "stateQualityAction")).toEqual([...reasonActionKeys].sort());
      expect(keysWithPrefix(dictionary, "stateQualityOwner")).toEqual([...ownerKeys].sort());
    }
  });

  it("gives no two codes the same key", () => {
    for (const keys of [checkTitleKeys, reasonActionKeys, ownerKeys]) expect(new Set(keys).size).toBe(keys.length);
  });

  it("prints the language's text for a code the dictionary knows, whatever wording the server sent", () => {
    for (const dictionary of [enAdmin, zhAdmin]) {
      const t = tIn(dictionary);

      expect(riskCheckLabel({ id: "state-coverage", label: "server wording" }, t)).toBe(dictionary.riskCheckLabel_state_coverage);
      expect(riskCheckLabel({ id: "source-ingestion-governance", label: "server wording" }, t)).toBe(
        dictionary.riskCheckLabel_source_ingestion_governance,
      );
      expect(
        stateDataQualityActionText({ reasonCode: "missing_state_bid", recommendedAction: "server wording" }, t),
      ).toBe(dictionary.stateQualityAction_missing_state_bid);
      expect(stateDataQualityOwnerLabel("data-ops", t)).toBe(dictionary.stateQualityOwner_data_ops);
    }
  });

  it("prints the text the server sent for a check, reason or owner the dictionary does not know", () => {
    for (const dictionary of [enAdmin, zhAdmin]) {
      const t = tIn(dictionary);

      expect(riskCheckLabel({ id: "check-from-a-newer-build", label: "A newer check" }, t)).toBe("A newer check");
      expect(
        stateDataQualityActionText({ reasonCode: "reason_from_a_newer_build", recommendedAction: "Do the newer thing." }, t),
      ).toBe("Do the newer thing.");
      expect(stateDataQualityOwnerLabel("team-from-a-newer-build", t)).toBe("team-from-a-newer-build");
    }
    // A blank entry is as good as none: the page never shows an empty title.
    const blank = tIn({ ...zhAdmin, riskCheckLabel_state_coverage: "", stateQualityOwner_data_ops: "" });
    expect(riskCheckLabel({ id: "state-coverage", label: "50 state data coverage" }, blank)).toBe("50 state data coverage");
    expect(stateDataQualityOwnerLabel("data-ops", blank)).toBe("data-ops");
  });

  it("labels each recommended-action filter option by the action's code and keeps the server's text as its value", () => {
    const missingBid = recommendedActionForReason("missing_state_bid");
    const staleCrawler = recommendedActionForReason("crawler_stale_or_missing");
    const actions = [
      { reasonCode: "missing_state_bid", recommendedAction: missingBid },
      { reasonCode: "crawler_stale_or_missing", recommendedAction: staleCrawler },
      { reasonCode: "missing_state_bid", recommendedAction: missingBid },
      { reasonCode: "reason_from_a_newer_build", recommendedAction: "Do the newer thing." },
    ];
    const labels = stateDataQualityRecommendedActionLabels(actions, tIn(zhAdmin));

    // One label per distinct server text: the text is what the filter matches on.
    expect([...labels.keys()].sort()).toEqual([missingBid, staleCrawler, "Do the newer thing."].sort());
    expect(labels.get(missingBid)).toBe(zhAdmin.stateQualityAction_missing_state_bid);
    expect(labels.get(staleCrawler)).toBe(zhAdmin.stateQualityAction_crawler_stale_or_missing);
    expect(labels.get("Do the newer thing.")).toBe("Do the newer thing.");
    expect(stateDataQualityRecommendedActionLabels([], tIn(zhAdmin)).size).toBe(0);
  });

  it("prints a check's title, an action's fix and its owner through those lookups, never the raw server text", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");

    expect(source).toContain("riskCheckLabel(check, t)");
    expect(source).toContain("stateDataQualityActionText(action, t)");
    expect(source).toContain("stateDataQualityOwnerLabel(action.ownerHint, t)");
    expect(source).toContain("stateDataQualityRecommendedActionLabels(report.actions, t)");
    for (const raw of ["{check.label}", "{action.recommendedAction}", "{action.ownerHint}"]) {
      expect(source, raw).not.toContain(raw);
    }
    // Summaries, details and evidence carry counts and ids, so they stay as the server stored them.
    expect(source).toContain("{check.summary}");
    expect(source).toContain("{action.evidence}");
    // The lookups read the dictionary, not the server modules, which pull in node built-ins and the database.
    expect(source).not.toMatch(/from "@\/server\//);
  });

  it("words the Chinese titles, fixes and teams in the console's vocabulary", () => {
    const keys = [...checkTitleKeys, ...reasonActionKeys, ...ownerKeys];

    for (const key of keys) {
      // Real Chinese, in which only technical tokens keep their Latin letters.
      expect(zhAdmin[key], key).toMatch(/[\u4e00-\u9fff]/);
      const leftover = zhAdmin[key].replace(/\b(?:URL|ID|P0|QA|Beta|Live|Fixture)\b/g, "").match(/[A-Za-z]{2,}/g);
      expect(leftover, `${key}: ${zhAdmin[key]}`).toBeNull();
    }

    // The console's own word for each thing the English text names.
    const vocabulary: Array<[RegExp, string[]]> = [
      [/crawler/i, ["爬虫"]],
      [/attachment/i, ["附件"]],
      [/\bbids?\b/i, ["招标"]],
      [/\bsources?\b/i, ["数据源", "来源"]],
      [/snapshot/i, ["快照"]],
      [/checksum/i, ["校验和"]],
      [/archiv/i, ["归档"]],
      [/approval/i, ["审批"]],
      [/risk checklist/i, ["风险巡检"]],
      [/health/i, ["健康"]],
    ];
    for (const key of keys) {
      for (const [english, terms] of vocabulary) {
        if (!english.test(enAdmin[key])) continue;
        expect(
          terms.some((term) => zhAdmin[key].includes(term)),
          `${key} names ${english} as ${terms.join(" / ")}: ${zhAdmin[key]}`,
        ).toBe(true);
      }
    }

    // 已启用 is a state and 停用 an act, as everywhere else in the console: "disable duplicate enabled sources" is both.
    expect(zhAdmin.stateQualityAction_duplicate_canonical_enabled_source).toContain("已启用");
    expect(zhAdmin.stateQualityAction_duplicate_canonical_enabled_source).toContain("停用");
    expect(zhAdmin.stateQualityAction_duplicate_canonical_enabled_source).not.toContain("禁用");
    // An active bid is the console's 启用招标, as the global URL health description already says.
    expect(zhAdmin.riskCheckGlobalUrlDescription).toContain("启用招标");
    expect(zhAdmin.riskCheckLabel_global_url_validity).toContain("启用招标");
    // The risk checklist is the 风险巡检 the page title names.
    expect(zhAdmin.stateQualityAction_risk_check_stale_or_missing).toContain(zhAdmin.riskCheck);
  });
});

describe("a risk check that did not run", () => {
  // The checklist can come back with a check set aside (50-state coverage on seed data). That is neither a pass nor a
  // failure, so the console words it, and colours it, as a third thing.
  it("is worded Not run, apart from Pass and Issue, in both languages", () => {
    for (const dictionary of [enAdmin, zhAdmin]) {
      const t = tIn(dictionary);

      expect(riskCheckStatusLabel("pass", t)).toBe(dictionary.riskCheckOk);
      expect(riskCheckStatusLabel("fail", t)).toBe(dictionary.riskCheckIssue);
      expect(riskCheckStatusLabel("not_run", t)).toBe(dictionary.riskCheckNotRun);
      expect(new Set([dictionary.riskCheckOk, dictionary.riskCheckIssue, dictionary.riskCheckNotRun]).size).toBe(3);
    }
    expect(enAdmin.riskCheckNotRun).toBe("Not run");
  });

  it("is coloured as neither a pass nor a failure", () => {
    const tones = new Set([riskCheckStatusTone("pass"), riskCheckStatusTone("fail"), riskCheckStatusTone("not_run")]);

    expect(tones.size).toBe(3);
    expect(riskCheckStatusTone("not_run")).not.toMatch(/emerald|rose/);
  });

  it("makes the checklist's heading neither All checks passed nor Needs attention while a check did not run", () => {
    const pass = { ok: true, status: "pass" } as const;
    const fail = { ok: false, status: "fail" } as const;
    const notRun = { ok: false, status: "not_run" } as const;

    for (const dictionary of [enAdmin, zhAdmin]) {
      const t = tIn(dictionary);

      expect(riskReportHeading({ ok: true, checks: [pass] }, t)).toBe(dictionary.riskCheckPassed);
      expect(riskReportHeading({ ok: false, checks: [pass, fail] }, t)).toBe(dictionary.riskCheckFailed);
      // A failure outranks a check that did not run.
      expect(riskReportHeading({ ok: false, checks: [notRun, fail] }, t)).toBe(dictionary.riskCheckFailed);
      expect(riskReportHeading({ ok: false, checks: [pass, notRun] }, t)).toBe(dictionary.riskCheckIncomplete.replace("{count}", "1"));
      expect(riskReportHeading({ ok: false, checks: [notRun, notRun, pass] }, t)).toBe(dictionary.riskCheckIncomplete.replace("{count}", "2"));
      // Never a pass, even from a report that calls itself ok.
      expect(riskReportHeading({ ok: true, checks: [pass, notRun] }, t)).toBe(dictionary.riskCheckIncomplete.replace("{count}", "1"));
      // A report from before the status existed has only ok.
      expect(riskReportHeading({ ok: true, checks: [{ ok: true }] }, t)).toBe(dictionary.riskCheckPassed);
      expect(riskReportHeading({ ok: false, checks: [{ ok: false }] }, t)).toBe(dictionary.riskCheckFailed);
    }
  });

  it("says the checklist is not fully verified in Chinese with the console's own word for it", () => {
    expect(zhAdmin.riskCheckNotRun).toBe("未执行");
    expect(zhAdmin.riskCheckIncomplete).toContain("未完全验证");
    expect(zhAdmin.riskCheckIncomplete).toContain("{count}");
  });
});
