import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminDataSource } from "@/lib/api/admin";
import {
  BATCH_RUN_CHUNK_SIZE,
  SAM_GOV_ENTRY_KEY,
  batchJurisdictionLevelOf,
  batchStatusFromRunResult,
  blockedReasonHintKey,
  buildBatchRunEntries,
  chunkBatchKeys,
  countBatchEntriesByLevel,
  filterBatchEntries,
  resolveBatchWindow,
  samGovDateFromIso,
} from "./JurisdictionBatchRunPanel";

function adminSource(overrides: Partial<AdminDataSource> = {}): AdminDataSource {
  return {
    id: "il_bidbuy",
    label: "Illinois BidBuy",
    issuerType: "state",
    stateCode: "IL",
    baseUrl: "https://www.bidbuy.illinois.gov",
    isEnabled: true,
    cadence: "daily",
    jurisdictionLevel: "state",
    jurisdictionName: "Illinois",
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    crawlerSourceId: "il_bidbuy",
    ...overrides,
  } as AdminDataSource;
}

const crawlerSourceIdFor = (source: AdminDataSource) => source.crawlerSourceId ?? null;

describe("batchJurisdictionLevelOf", () => {
  it("uses the row's jurisdiction level when it is a known value", () => {
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: "county" }))).toBe("county");
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: "special_district" }))).toBe("special_district");
  });

  it("maps legacy NULL jurisdiction rows to state, and federal issuers to federal", () => {
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: null }))).toBe("state");
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: null, issuerType: "federal" }))).toBe("federal");
  });
});

describe("buildBatchRunEntries", () => {
  it("always includes the synthetic SAM.gov federal entry first", () => {
    const entries = buildBatchRunEntries([], crawlerSourceIdFor);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: SAM_GOV_ENTRY_KEY, kind: "sam_gov", level: "federal" });
  });

  it("includes enabled non-federal rows with a runnable crawler id and skips the rest", () => {
    const entries = buildBatchRunEntries(
      [
        adminSource(),
        adminSource({ id: "tx_harris", label: "Harris County", jurisdictionLevel: "county", crawlerSourceId: "tx_harris" }),
        adminSource({ id: "disabled", isEnabled: false, crawlerSourceId: "disabled" }),
        adminSource({ id: "no_crawler_id", crawlerSourceId: null }),
        adminSource({ id: "sam_gov_row", issuerType: "federal", jurisdictionLevel: "federal", crawlerSourceId: "sam_gov_row" }),
      ],
      crawlerSourceIdFor,
    );

    expect(entries.map((entry) => entry.key)).toEqual([SAM_GOV_ENTRY_KEY, "il_bidbuy", "tx_harris"]);
    expect(entries[2]).toMatchObject({ level: "county", stateCode: "IL", kind: "state_task" });
  });
});

describe("filterBatchEntries / countBatchEntriesByLevel", () => {
  const entries = buildBatchRunEntries(
    [
      adminSource(),
      adminSource({ id: "ca_la_city", label: "Los Angeles", stateCode: "CA", jurisdictionLevel: "city", crawlerSourceId: "ca_la_city" }),
      adminSource({ id: "ca_orange", label: "Orange County", stateCode: "CA", jurisdictionLevel: "county", crawlerSourceId: "ca_orange" }),
    ],
    crawlerSourceIdFor,
  );

  it("filters by jurisdiction level and state code", () => {
    expect(filterBatchEntries(entries, "all", "all")).toHaveLength(4);
    expect(filterBatchEntries(entries, "city", "all").map((entry) => entry.key)).toEqual(["ca_la_city"]);
    expect(filterBatchEntries(entries, "all", "CA").map((entry) => entry.key)).toEqual(["ca_la_city", "ca_orange"]);
    expect(filterBatchEntries(entries, "county", "IL")).toHaveLength(0);
  });

  it("counts entries per level for the filter chips", () => {
    expect(countBatchEntriesByLevel(entries)).toEqual({
      federal: 1,
      state: 1,
      county: 1,
      city: 1,
      special_district: 0,
    });
  });
});

describe("resolveBatchWindow", () => {
  const today = new Date("2026-08-21T12:00:00.000Z");

  it("returns no window for the all preset", () => {
    expect(resolveBatchWindow("all", { from: "", to: "" }, today)).toBeNull();
  });

  it("spans exactly N calendar days ending today for lastN presets", () => {
    expect(resolveBatchWindow("last7", { from: "", to: "" }, today)).toEqual({
      postedFrom: "2026-08-15",
      postedTo: "2026-08-21",
    });
    expect(resolveBatchWindow("last30", { from: "", to: "" }, today)).toEqual({
      postedFrom: "2026-07-23",
      postedTo: "2026-08-21",
    });
    expect(resolveBatchWindow("last90", { from: "", to: "" }, today)).toEqual({
      postedFrom: "2026-05-24",
      postedTo: "2026-08-21",
    });
  });

  it("passes through a valid custom window, allowing open ends", () => {
    expect(resolveBatchWindow("custom", { from: "2026-08-01", to: "2026-08-21" }, today)).toEqual({
      postedFrom: "2026-08-01",
      postedTo: "2026-08-21",
    });
    expect(resolveBatchWindow("custom", { from: "2026-08-01", to: "" }, today)).toEqual({
      postedFrom: "2026-08-01",
    });
    expect(resolveBatchWindow("custom", { from: "", to: "" }, today)).toBeNull();
  });

  it("flags malformed or inverted custom windows as invalid", () => {
    expect(resolveBatchWindow("custom", { from: "08/01/2026", to: "" }, today)).toBe("invalid");
    expect(resolveBatchWindow("custom", { from: "2026-08-21", to: "2026-08-01" }, today)).toBe("invalid");
  });
});

describe("samGovDateFromIso", () => {
  it("converts ISO dates to the SAM.gov MM/dd/yyyy format", () => {
    expect(samGovDateFromIso("2026-08-01")).toBe("08/01/2026");
  });
});

describe("chunkBatchKeys", () => {
  it("chunks the selection into groups of at most the batch chunk size", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g"];
    const chunks = chunkBatchKeys(keys);
    expect(BATCH_RUN_CHUNK_SIZE).toBe(5);
    expect(chunks).toEqual([["a", "b", "c", "d", "e"], ["f", "g"]]);
    expect(chunkBatchKeys([])).toEqual([]);
  });
});

describe("batchStatusFromRunResult", () => {
  it("maps orchestrator statuses and carries fetched + date filter counts", () => {
    expect(
      batchStatusFromRunResult({
        source: "il_bidbuy",
        ok: true,
        status: "success",
        runner: { fetchedCount: 25, payload: { metadata: { dateFilter: { kept: 20, dropped: 5, unparsed: 0 } } } },
      }),
    ).toEqual({
      phase: "done",
      status: "success",
      fetchedCount: 25,
      dateFilter: { kept: 20, dropped: 5, unparsed: 0 },
    });
  });

  it("maps governance and unexpected statuses", () => {
    expect(batchStatusFromRunResult({ source: "x", ok: false, status: "blocked" })).toMatchObject({ status: "blocked" });
    expect(batchStatusFromRunResult({ source: "x", ok: false, status: "weird" })).toMatchObject({ status: "unknown" });
  });

  it("carries the orchestrator's blocked reason so the UI can explain the hold", () => {
    expect(
      batchStatusFromRunResult({
        source: "x",
        ok: false,
        status: "blocked",
        reason: "Source governance has not approved ingestion.",
      }),
    ).toMatchObject({ status: "blocked", reason: "Source governance has not approved ingestion." });
  });
});

describe("blockedReasonHintKey", () => {
  it("maps the two orchestrator blocked reasons onto i18n hint keys", () => {
    expect(blockedReasonHintKey("Source governance has not approved ingestion.")).toBe(
      "admin.batchRunBlockedApproval",
    );
    expect(blockedReasonHintKey("Source legal review has not approved ingestion.")).toBe(
      "admin.batchRunBlockedLegal",
    );
  });

  it("returns null for unknown or missing reasons (raw text fallback in the UI)", () => {
    expect(blockedReasonHintKey("Something else entirely.")).toBeNull();
    expect(blockedReasonHintKey(undefined)).toBeNull();
  });
});

describe("JurisdictionBatchRunPanel component wiring", () => {
  const component = readFileSync(new URL("JurisdictionBatchRunPanel.tsx", import.meta.url), "utf8");

  it("runs the selection in sequential chunks through the manual run routes", () => {
    expect(component).toContain("runStateCrawlersNow(chunk");
    expect(component).toContain("chunkBatchKeys(stateKeys)");
    expect(component).toContain("runSamGovCrawlerNow");
    expect(component).toContain("samGovDateFromIso");
  });

  it("keeps all user-facing copy behind the i18n dictionaries", () => {
    expect(component).toContain('t("admin.batchRunTitle")');
    expect(component).toContain('t("admin.batchRunWindowInvalid")');
    expect(component).toContain('t(`admin.batchRunLevel_${level}`)');
    expect(component).toContain('t(`admin.batchRunWindow_${preset}`)');
  });

  it("disables the run button while running, with nothing selected, or with an invalid window", () => {
    expect(component).toContain("disabled={disabled || isBatchRunning || selectedKeys.size === 0 || windowInvalid}");
  });

  it("is mounted in the admin sources section with the page's crawler source id resolver", () => {
    const page = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("JurisdictionBatchRunPanel");
    expect(page).toContain("crawlerSourceIdFor={stateCrawlerSourceIdFor}");
    // A full load() refresh would unmount the sources section (it only renders when status is
    // "ready") and wipe the batch report, so the panel must NOT be wired to it.
    expect(page).not.toContain("onCompleted={load}");
    // County/city registry rows carry no legacy per-state crawler metadata; the resolver must
    // fall back to the data_sources row id so sub-state sources are runnable in the batch panel.
    expect(page).toContain("subStateSourceId");
  });
});
