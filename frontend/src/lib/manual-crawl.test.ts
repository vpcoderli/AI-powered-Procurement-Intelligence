import { describe, expect, it, vi } from "vitest";
import type { AdminDataSource } from "@/lib/api/admin";
import {
  BATCH_RUN_CHUNK_SIZE,
  SAM_GOV_ENTRY_KEY,
  type BatchRunSource,
  batchJurisdictionLevelOf,
  batchStatusFromRunResult,
  batchSuccessKind,
  blockedReasonHintKey,
  buildBatchRunEntries,
  chunkBatchKeys,
  countBatchEntriesByLevel,
  deferredThrottleSourceId,
  filterBatchEntries,
  resolveBatchWindow,
  runManualCrawl,
  samGovDateFromIso,
  type ManualCrawlProgress,
  type ManualCrawlTransport,
} from "./manual-crawl";

const entries = (count: number) => Array.from({ length: count }, (_, index) => ({ key: `s${index}`, kind: "state_task" as const }));
const success = (keys: string[]) => ({ results: keys.map((source) => ({ source, status: "success", ok: true })) });
const samEntry = { key: "sam_gov_federal", kind: "sam_gov" as const };
const transportFor = (runState: ManualCrawlTransport["runState"]): ManualCrawlTransport => ({
  runState,
  runSamGov: async () => ({ source: "sam_gov", ok: true, status: "success" }),
});

describe("manual crawl execution", () => {
  it("sends sequential groups of five and keeps immutable per-source progress", async () => {
    const calls: string[][] = [];
    const snapshots: ManualCrawlProgress[] = [];
    let inFlight = 0;
    const outcome = await runManualCrawl({ entries: entries(12) }, {
      transportFailure: "continue",
      onProgress: (snapshot) => snapshots.push(snapshot),
      transport: transportFor(async (keys) => {
        expect(inFlight).toBe(0);
        inFlight += 1;
        calls.push(keys);
        await Promise.resolve();
        inFlight -= 1;
        return success(keys);
      }),
    });
    expect(calls).toEqual([["s0", "s1", "s2", "s3", "s4"], ["s5", "s6", "s7", "s8", "s9"], ["s10", "s11"]]);
    expect(outcome.tally).toEqual({ ok: 12, failed: 0, skipped: 0 });
    expect(outcome.completedCount).toBe(12);
    expect(outcome.unsentIds).toEqual([]);
    expect(snapshots[0].statuses.s0).toEqual({ phase: "pending" });
    expect(snapshots[1].statuses.s0).toEqual({ phase: "running" });
    expect(snapshots.at(-1)?.statuses.s0).toMatchObject({ phase: "done", status: "success" });
  });

  it("finishes missing requested rows as unknown and ignores unrelated result and error rows", async () => {
    const outcome = await runManualCrawl({ entries: entries(4) }, {
      transportFailure: "continue",
      transport: transportFor(async () => ({
        results: [
          { source: "s0", status: "success", ok: true, runner: { fetchedCount: 0, payload: { metadata: { emptyState: { verified: true, marker: "No open bids" }, dateFilter: { kept: 0, dropped: 5 } } } } },
          { source: "s1", status: "blocked", ok: false, reason: "Source legal review has not approved ingestion." },
          { source: "unrequested", status: "success", ok: true },
        ],
        errors: [{ source: "s2", message: "Unknown source", code: "UNKNOWN_SOURCE" }, { source: "unrequested_error", code: "UNKNOWN_SOURCE" }],
      })),
    });
    expect(Object.keys(outcome.statuses)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(outcome.statuses.s0).toMatchObject({ status: "success", fetchedCount: 0, emptyState: { verified: true, marker: "No open bids" }, dateFilter: { kept: 0, dropped: 5 } });
    expect(outcome.statuses.s1).toMatchObject({ status: "blocked", reason: "Source legal review has not approved ingestion." });
    expect(outcome.statuses.s2).toMatchObject({ phase: "done", status: "unknown", reason: "Unknown source", errorCode: "UNKNOWN_SOURCE" });
    expect(outcome.statuses.s3).toMatchObject({ phase: "done", status: "unknown" });
    expect(outcome.tally).toEqual({ ok: 1, failed: 2, skipped: 1 });
    expect(outcome.completedCount).toBe(4);
  });

  it("stops after a list transport failure, retaining completed results and distinguishing unsent sources", async () => {
    const calls: string[][] = [];
    const failure = new Error("gateway timeout");
    const outcome = await runManualCrawl({ entries: entries(12) }, {
      transportFailure: "stop",
      transport: transportFor(async (keys) => {
        calls.push(keys);
        if (calls.length === 2) throw failure;
        return success(keys);
      }),
    });
    expect(calls).toHaveLength(2);
    expect(outcome).toMatchObject({ failed: true, failure, total: 12, completedCount: 10, tally: { ok: 5, failed: 0, skipped: 0 } });
    expect(outcome.statuses.s0).toMatchObject({ status: "success" });
    expect(outcome.statuses.s5).toMatchObject({ phase: "done", status: "failure", reason: "gateway timeout" });
    expect(outcome.statuses.s10).toEqual({ phase: "pending" });
    expect(outcome.attemptedIds).toHaveLength(10);
    expect(outcome.unsentIds).toEqual(["s10", "s11"]);
  });

  it("continues jurisdiction chunks and SAM after a transport failure", async () => {
    const calls: string[] = [];
    const outcome = await runManualCrawl({ entries: [...entries(12), samEntry] }, {
      transportFailure: "continue",
      transport: {
        runState: async (keys) => {
          calls.push(keys.join(","));
          if (calls.length === 2) throw new Error("offline");
          return success(keys);
        },
        runSamGov: async () => { calls.push("sam"); return { source: "sam_gov", status: "disabled", ok: false }; },
      },
    });
    expect(calls).toEqual(["s0,s1,s2,s3,s4", "s5,s6,s7,s8,s9", "s10,s11", "sam"]);
    expect(outcome.completedCount).toBe(13);
    expect(outcome.unsentIds).toEqual([]);
    expect(outcome.statuses.s5).toMatchObject({ status: "failure" });
    expect(outcome.statuses.s10).toMatchObject({ status: "success" });
    expect(outcome.statuses.sam_gov_federal).toMatchObject({ status: "disabled" });
  });

  it("does not transport-stop on structured failures or an unfamiliar resolved body", async () => {
    const calls: string[][] = [];
    const outcome = await runManualCrawl({ entries: entries(11) }, {
      transportFailure: "stop",
      transport: transportFor(async (keys) => {
        calls.push(keys);
        if (calls.length === 1) return { results: keys.map((source) => ({ source, status: "failure", ok: false })) };
        if (calls.length === 2) return { unexpected: "payload" };
        return success(keys);
      }),
    });
    expect(calls).toHaveLength(3);
    expect(outcome.failed).toBe(false);
    expect(outcome.tally).toEqual({ ok: 1, failed: 10, skipped: 0 });
    expect(outcome.statuses.s5).toMatchObject({ status: "unknown" });
  });

  it("runs SAM last with its own date format and carries actual outcome reasons", async () => {
    const calls: unknown[] = [];
    const outcome = await runManualCrawl({ entries: [samEntry, ...entries(1)] }, {
      transportFailure: "continue",
      window: { postedFrom: "2026-08-01", postedTo: "2026-08-21" },
      transport: {
        runState: async (keys, window) => { calls.push({ keys, window }); return success(keys); },
        runSamGov: async (window) => { calls.push({ sam: window }); return { source: "sam_gov", status: "blocked", ok: false, reason: "Source governance has not approved ingestion." }; },
      },
    });
    expect(calls).toEqual([{ keys: ["s0"], window: { postedFrom: "2026-08-01", postedTo: "2026-08-21" } }, { sam: { postedFrom: "08/01/2026", postedTo: "08/21/2026" } }]);
    expect(outcome.statuses.sam_gov_federal).toMatchObject({ phase: "done", status: "blocked", reason: "Source governance has not approved ingestion." });
    expect(outcome.tally).toEqual({ ok: 1, failed: 0, skipped: 1 });
  });

  it.each(["success", "failure", "blocked", "locked", "disabled", "deferred"])("normalizes the valid resolved SAM outcome %s", async (status) => {
    const outcome = await runManualCrawl({ entries: [samEntry] }, {
      transportFailure: "continue",
      transport: { ...transportFor(async () => success([])), runSamGov: async () => ({ source: "sam_gov", ok: status === "success", status, reason: "actual reason", runner: { fetchedCount: 0, payload: { metadata: { emptyState: { verified: true, marker: "No opportunities" } } } } }) },
    });
    expect(outcome.statuses.sam_gov_federal).toMatchObject({ phase: "done", status, reason: "actual reason", fetchedCount: 0, emptyState: { verified: true, marker: "No opportunities" } });
  });

  it.each([
    { source: "unrequested", ok: true, status: "success" },
    { status: "success" },
    { source: "sam_gov", status: "success" },
    { source: "sam_gov", ok: false, status: "success" },
    { source: "sam_gov", ok: true, status: "failure" },
    { source: "sam_gov", ok: true, status: "blocked" },
    { source: "sam_gov", ok: true, status: "locked" },
    { source: "sam_gov", ok: true, status: "disabled" },
    { source: "sam_gov", ok: true, status: "deferred" },
    { source: "sam_gov", ok: "true", status: "success" },
    { source: "sam_gov", ok: false, status: "unfamiliar" },
  ])("settles the malformed SAM envelope %j as unknown through both transports", async (body) => {
    const response = { ...body, reason: "unattributable reason", runner: { fetchedCount: 99 } };
    const inMemory = await runManualCrawl({ entries: [samEntry] }, {
      transportFailure: "continue",
      transport: { ...transportFor(async () => success([])), runSamGov: async () => response },
    });
    vi.stubGlobal("fetch", async () => Response.json(response));
    try {
      const browser = await runManualCrawl({ entries: [samEntry] }, { transportFailure: "continue" });
      expect([inMemory.statuses.sam_gov_federal, browser.statuses.sam_gov_federal]).toEqual([
        { phase: "done", status: "unknown" },
        { phase: "done", status: "unknown" },
      ]);
      for (const outcome of [inMemory, browser]) {
        expect(outcome).toMatchObject({ failed: false, completedCount: 1, tally: { ok: 0, failed: 1, skipped: 0 }, unsentIds: [] });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Unauthorized" } } },
    { status: 403, body: { error: { code: "FORBIDDEN", message: "Forbidden" } } },
    { status: 500, body: { source: "unrequested", ok: false, status: "failure" } },
    { status: 500, body: { source: "sam_gov", ok: true, status: "failure" } },
    { status: 500, body: { unexpected: "payload" } },
  ])("keeps HTTP $status rejection of invalid SAM responses as a transport failure", async ({ status, body }) => {
    vi.stubGlobal("fetch", async () => Response.json(body, { status }));
    try {
      const outcome = await runManualCrawl({ entries: [samEntry] }, { transportFailure: "stop" });
      expect(outcome).toMatchObject({ failed: true, failure: { status }, tally: { ok: 0, failed: 0, skipped: 0 }, completedCount: 1 });
      expect(outcome.statuses.sam_gov_federal).toMatchObject({ phase: "done", status: "failure" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not assume SAM succeeded from an unknown resolved body", async () => {
    const outcome = await runManualCrawl({ entries: [samEntry] }, {
      transportFailure: "continue",
      transport: { ...transportFor(async () => success([])), runSamGov: async () => ({ ok: true }) },
    });
    expect(outcome.statuses.sam_gov_federal).toMatchObject({ phase: "done", status: "unknown" });
    expect(outcome.tally).toEqual({ ok: 0, failed: 1, skipped: 0 });
  });

  it("maps explicit local sources before aliases, deduplicates state aliases, and leaves federal out of source runs", async () => {
    const calls: string[][] = [];
    const outcome = await runManualCrawl({ sources: [
      { id: "city_portal", jurisdictionLevel: "city", issuerType: "state", stateCode: "IL", crawlerSourceId: "il_bidbuy" },
      { id: "ca_state", issuerType: "state", stateCode: "CA", crawlerSourceId: null },
      { id: "california_caleprocure", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
      { id: "sam_gov", issuerType: "federal", stateCode: "US", crawlerSourceId: "il_bidbuy" },
    ] }, {
      transportFailure: "stop",
      transport: transportFor(async (keys) => { calls.push(keys); return success(keys); }),
    });
    expect(calls).toEqual([["city_portal", "ca_caleprocure"]]);
    expect(outcome.notRunnableIds).toEqual(["sam_gov"]);
    expect(outcome.total).toBe(2);
  });

  it("allows a jurisdiction run above the list's twenty-source limit", async () => {
    const outcome = await runManualCrawl({ entries: entries(23) }, { transportFailure: "continue", transport: transportFor(async (keys) => success(keys)) });
    expect(outcome.completedCount).toBe(23);
  });

  it("normalizes padded dates before sending ISO state and SAM windows", async () => {
    const windows: unknown[] = [];
    await runManualCrawl({ entries: [...entries(1), samEntry] }, {
      transportFailure: "continue",
      window: { postedFrom: " 2026-08-01 ", postedTo: " 2026-08-21 " },
      transport: {
        runState: async (keys, window) => { windows.push(window); return success(keys); },
        runSamGov: async (window) => { windows.push(window); return { source: "sam_gov", ok: true, status: "success" }; },
      },
    });
    expect(windows).toEqual([{ postedFrom: "2026-08-01", postedTo: "2026-08-21" }, { postedFrom: "08/01/2026", postedTo: "08/21/2026" }]);
  });

  it("rejects invalid direct execution windows before sending any request", async () => {
    const calls: string[][] = [];
    await expect(runManualCrawl({ entries: entries(1) }, {
      transportFailure: "continue",
      window: { postedFrom: "2026-02-30" },
      transport: transportFor(async (keys) => { calls.push(keys); return success(keys); }),
    })).rejects.toThrow("Invalid published-date window.");
    expect(calls).toEqual([]);
  });

  it("uses the real browser API adapters for state and SAM windows and an HTTP 409 governance result", async () => {
    const requests: Array<{ url: unknown; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return url === "/api/crawler/state/run"
        ? Response.json(success(["s0"]))
        : Response.json({ source: "sam_gov", ok: false, status: "blocked", reason: "Source governance has not approved ingestion." }, { status: 409 });
    });
    try {
      const outcome = await runManualCrawl({ entries: [...entries(1), samEntry] }, {
        transportFailure: "continue",
        window: { postedFrom: "2026-08-01", postedTo: "2026-08-21" },
      });
      expect(requests).toEqual([
        { url: "/api/crawler/state/run", body: { sources: ["s0"], postedFrom: "2026-08-01", postedTo: "2026-08-21" } },
        { url: "/api/crawler/sam-gov/run", body: { postedFrom: "08/01/2026", postedTo: "08/21/2026" } },
      ]);
      expect(outcome.failed).toBe(false);
      expect(outcome.statuses.sam_gov_federal).toMatchObject({ status: "blocked", reason: "Source governance has not approved ingestion." });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

const crawlerSourceIdFor = (source: BatchRunSource) => source.crawlerSourceId ?? null;

describe("batchJurisdictionLevelOf", () => {
  it.each(["county", "city", "township", "special_district"])("groups legacy %s rows by their issuer type", (issuerType) => {
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: null, issuerType }))).toBe(issuerType);
  });
  it("uses the row's jurisdiction level when it is a known value", () => {
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: "county" }))).toBe("county");
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: "special_district" }))).toBe("special_district");
  });

  it("maps legacy NULL jurisdiction rows to state, and federal issuers to federal", () => {
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: null }))).toBe("state");
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: null, issuerType: "federal" }))).toBe("federal");
  });

  it("accepts township as a known level", () => {
    expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: "township" }))).toBe("township");
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

  it("uses the local row id even when the supplied legacy mapper would return a state alias", () => {
    const result = buildBatchRunEntries([adminSource({ id: "city_portal", jurisdictionLevel: "city", issuerType: "state", crawlerSourceId: "il_bidbuy" })], crawlerSourceIdFor);
    expect(result.map((entry) => entry.key)).toEqual([SAM_GOV_ENTRY_KEY, "city_portal"]);
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
      township: 0,
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

  it.each(["2026-02-30", "2026-13-01", "2026-00-01"])("rejects the nonexistent calendar date %s", (from) => {
    expect(resolveBatchWindow("custom", { from, to: "" }, today)).toBe("invalid");
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

  it("maps the platform-deferral status and its reason (C7)", () => {
    expect(
      batchStatusFromRunResult({
        source: "bidnet_co_denver",
        ok: false,
        status: "deferred",
        reason: "platform_throttled:bidnet_ny_erie",
      }),
    ).toMatchObject({ status: "deferred", reason: "platform_throttled:bidnet_ny_erie" });
  });

  it("carries the verified-empty-state marker off the run payload (C1)", () => {
    expect(
      batchStatusFromRunResult({
        source: "bidnet_ny_erie",
        ok: true,
        status: "success",
        runner: {
          fetchedCount: 0,
          payload: {
            metadata: {
              emptyState: {
                verified: true,
                marker: "There are no open bids at this time.",
                tenant_confirmed: true,
                method: "adapter",
              },
            },
          },
        },
      }),
    ).toMatchObject({
      status: "success",
      fetchedCount: 0,
      emptyState: { verified: true, marker: "There are no open bids at this time." },
    });
  });

  it("leaves emptyState off an ordinary run so nothing renders an empty badge by default", () => {
    expect(batchStatusFromRunResult({ source: "x", ok: true, status: "success", runner: { fetchedCount: 4 } })).toEqual(
      { phase: "done", status: "success", fetchedCount: 4, dateFilter: undefined },
    );
  });
});

describe("batchSuccessKind", () => {
  it("calls a verified empty list what it is, not a zero-row success", () => {
    expect(
      batchSuccessKind({
        phase: "done",
        status: "success",
        fetchedCount: 0,
        emptyState: { verified: true, marker: "There are no open bids at this time." },
      }),
    ).toBe("verified_empty");
  });

  it("marks an unexplained zero-row success separately from a run that ingested rows", () => {
    expect(batchSuccessKind({ phase: "done", status: "success", fetchedCount: 0 })).toBe("zero");
    expect(batchSuccessKind({ phase: "done", status: "success", fetchedCount: 7 })).toBe("rows");
  });

  it("does not claim an empty state when the crawler could not verify one", () => {
    expect(
      batchSuccessKind({
        phase: "done",
        status: "success",
        fetchedCount: 0,
        emptyState: { verified: false, marker: null },
      }),
    ).toBe("zero");
  });

  it("is irrelevant for non-success and in-flight statuses", () => {
    expect(batchSuccessKind({ phase: "done", status: "failure" })).toBe("rows");
    expect(batchSuccessKind({ phase: "running" })).toBe("rows");
  });
});

describe("deferredThrottleSourceId", () => {
  it("names the source that tripped the platform throttle", () => {
    expect(deferredThrottleSourceId("platform_throttled:bidnet_ny_erie")).toBe("bidnet_ny_erie");
  });

  it("returns null for any other reason shape, so the raw text is shown instead", () => {
    expect(deferredThrottleSourceId("Source governance has not approved ingestion.")).toBeNull();
    expect(deferredThrottleSourceId(undefined)).toBeNull();
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
