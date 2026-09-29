import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import {
  type PendingCandidateRow,
  type PrecheckEvidence,
  type PrecheckEvidenceInput,
  PrecheckRequestInputError,
  clearPrecheckRequest,
  clearPrecheckRequestFromMysql,
  isHeldByPerson,
  isPendingPrecheck,
  isPrecheckFresh,
  listQueuedPrechecks,
  listQueuedPrechecksFromMysql,
  normalizeRequestPrechecksInput,
  precheckEvidence,
  requestPrechecks,
  requestPrechecksFromMysql,
  selectPrecheckTargets,
  selectPrecheckTargetsFromMysql,
} from "./precheck-queue";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const FRESH = "2026-09-20T00:00:00.000Z"; // 9 days old
const STALE = "2026-09-01T00:00:00.000Z"; // 28 days old
// A timeline inside the 14-day window: precheck (FRESH), then an approval, a failure and a hold.
const APPROVED_AT = "2026-09-21T00:00:00.000Z";
const FAILED_AT = "2026-09-22T00:00:00.000Z";
const HELD_AT = "2026-09-23T00:00:00.000Z";
const URL_X = "https://www.bidnetdirect.com/mitn/x/solicitations/open-bids";

/** The `live_health_notes` record `runSourcePrecheck` writes: the prechecked address and its verdict. */
function precheckNotes(baseUrl: string | null, verdict = "ready") {
  return JSON.stringify({ precheck: { baseUrl, verdict } });
}

/** A fresh `ready` precheck of URL_X, as the precheck write-back leaves it. */
const READY_PRECHECK = { liveHealthDisposition: "ready", liveHealthNotes: precheckNotes(URL_X), liveHealthReviewedAt: FRESH } as const;

function candidate(overrides: Partial<PendingCandidateRow> = {}): PendingCandidateRow {
  return {
    id: "x", providerFamily: "bidnet", jurisdictionLevel: "county", approvalStatus: null, isEnabled: true, baseUrl: URL_X,
    liveHealthDisposition: null, liveHealthReviewedAt: null, liveHealthNotes: null, lastFailureAt: null, lastApprovalReviewedAt: null,
    precheckRequestedAt: null,
    ...overrides,
  };
}

function urlFor(id: string) {
  return `https://www.bidnetdirect.com/mitn/${id}/solicitations/open-bids`;
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    issuerType: "county",
    stateCode: "MI",
    baseUrl: urlFor(id),
    providerFamily: "bidnet",
    jurisdictionLevel: "county",
    isEnabled: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("pure rules", () => {
  it("isPrecheckFresh honours the 14-day window", () => {
    expect(isPrecheckFresh(null, NOW)).toBe(false);
    expect(isPrecheckFresh(FRESH, NOW)).toBe(true);
    expect(isPrecheckFresh(STALE, NOW)).toBe(false);
    expect(isPrecheckFresh("garbage", NOW)).toBe(false);
  });

  it.each<[string, Partial<PendingCandidateRow>, boolean]>([
    ["unapproved local, never prechecked", { approvalStatus: null, liveHealthReviewedAt: null }, true],
    ["needs_review local, stale precheck", { approvalStatus: "needs_review", ...READY_PRECHECK, liveHealthReviewedAt: STALE }, true],
    ["fresh precheck", { approvalStatus: null, ...READY_PRECHECK }, false],
    ["already approved", { approvalStatus: "approved", liveHealthReviewedAt: null }, false],
    ["blocked", { approvalStatus: "blocked", liveHealthReviewedAt: null }, false],
    ["disabled", { approvalStatus: null, liveHealthReviewedAt: null, isEnabled: false }, false],
    ["already queued", { approvalStatus: null, liveHealthReviewedAt: null, precheckRequestedAt: NOW.toISOString() }, false],
    ["state level", { approvalStatus: null, liveHealthReviewedAt: null, jurisdictionLevel: "state" }, false],
  ])("isPendingPrecheck: %s", (_label, overrides, expected) => {
    expect(isPendingPrecheck(candidate(overrides), NOW)).toBe(expected);
  });

  it("normalizeRequestPrechecksInput accepts ids or a pending family, nothing else", () => {
    expect(normalizeRequestPrechecksInput({ sourceIds: [" a ", "b", "a"] })).toEqual({ sourceIds: ["a", "b"], providerFamily: null, pending: false });
    expect(normalizeRequestPrechecksInput({ providerFamily: "BidNet", pending: true })).toEqual({ sourceIds: [], providerFamily: "bidnet", pending: true });
    expect(() => normalizeRequestPrechecksInput({})).toThrow(PrecheckRequestInputError);
    expect(() => normalizeRequestPrechecksInput({ providerFamily: "bidnet" })).toThrow(PrecheckRequestInputError);
    expect(() => normalizeRequestPrechecksInput({ sourceIds: Array.from({ length: 501 }, (_, i) => `s${i}`) })).toThrow(PrecheckRequestInputError);
  });
});

describe("precheckEvidence", () => {
  const EARLIER = "2026-09-18T00:00:00.000Z";

  function evidenceRow(overrides: Partial<PrecheckEvidenceInput> = {}): PrecheckEvidenceInput {
    return { baseUrl: URL_X, ...READY_PRECHECK, lastFailureAt: null, lastApprovalReviewedAt: null, ...overrides };
  }

  it.each<[string, Partial<PrecheckEvidenceInput>, PrecheckEvidence]>([
    ["a fresh ready precheck of the current address", {}, "usable"],
    ["a fresh empty precheck of the current address", { liveHealthDisposition: "empty", liveHealthNotes: precheckNotes(URL_X, "empty") }, "usable"],
    ["no verdict", { liveHealthDisposition: null }, "missing"],
    ["an empty verdict", { liveHealthDisposition: "" }, "missing"],
    ["no precheck time", { liveHealthReviewedAt: null }, "missing"],
    ["a precheck of another address", { liveHealthNotes: precheckNotes("https://www.bidnetdirect.com/mitn/old/solicitations/open-bids") }, "base_url_changed"],
    ["pre-phase-3 notes without an address", { liveHealthNotes: JSON.stringify({ precheck: { verdict: "ready" } }) }, "base_url_changed"],
    ["free-text notes", { liveHealthNotes: "checked by hand" }, "base_url_changed"],
    ["a row without an address", { baseUrl: null }, "base_url_changed"],
    ["a failure after the precheck", { lastFailureAt: FAILED_AT }, "superseded"],
    ["a governance change after the precheck", { lastApprovalReviewedAt: APPROVED_AT }, "superseded"],
    ["a failure and a governance change before the precheck", { lastFailureAt: EARLIER, lastApprovalReviewedAt: EARLIER }, "usable"],
    ["a failure at the precheck's own instant (not strictly later)", { lastFailureAt: FRESH }, "usable"],
    ["an unparsable failure time (fail-closed)", { lastFailureAt: "not a date" }, "superseded"],
    ["an unparsable governance time (fail-closed)", { lastApprovalReviewedAt: "not a date" }, "superseded"],
    ["an unparsable precheck time with a failure on record (fail-closed)", { liveHealthReviewedAt: "not a date", lastFailureAt: EARLIER }, "superseded"],
    ["an unparsable precheck time and nothing else", { liveHealthReviewedAt: "not a date" }, "stale"],
    ["a precheck older than 14 days", { liveHealthReviewedAt: STALE }, "stale"],
    ["a fresh needs_fix of the current address", { liveHealthDisposition: "needs_fix", liveHealthNotes: precheckNotes(URL_X, "needs_fix") }, "needs_fix"],
  ])("%s -> %s", (_label, overrides, expected) => {
    expect(precheckEvidence(evidenceRow(overrides), NOW)).toBe(expected);
  });

  it("checks in order: missing, base_url_changed, superseded, stale, needs_fix", () => {
    const otherAddress = precheckNotes("https://www.bidnetdirect.com/mitn/old/solicitations/open-bids", "needs_fix");
    // Each row also matches every rule after the one that decides it.
    expect(precheckEvidence(evidenceRow({ liveHealthDisposition: null, liveHealthNotes: otherAddress, lastFailureAt: FAILED_AT }), NOW)).toBe("missing");
    expect(precheckEvidence(evidenceRow({ liveHealthDisposition: "needs_fix", liveHealthNotes: otherAddress, lastFailureAt: FAILED_AT, liveHealthReviewedAt: STALE }), NOW)).toBe("base_url_changed");
    expect(precheckEvidence(evidenceRow({ liveHealthDisposition: "needs_fix", lastFailureAt: FAILED_AT, liveHealthReviewedAt: STALE }), NOW)).toBe("superseded");
    expect(precheckEvidence(evidenceRow({ liveHealthDisposition: "needs_fix", liveHealthReviewedAt: STALE }), NOW)).toBe("stale");
  });
});

describe("isHeldByPerson", () => {
  it.each<[string, { approvalStatus: string | null; lastApprovalReviewedAt: string | null; lastFailureAt: string | null }, boolean]>([
    ["a hold: needs_review written by a governance change", { approvalStatus: "needs_review", lastApprovalReviewedAt: HELD_AT, lastFailureAt: null }, true],
    ["a hold placed after an earlier failure", { approvalStatus: "needs_review", lastApprovalReviewedAt: HELD_AT, lastFailureAt: FAILED_AT }, true],
    ["a health demotion: the failure came after the last governance change", { approvalStatus: "needs_review", lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: FAILED_AT }, false],
    ["a registered row the console shows as needs_review with no governance change", { approvalStatus: "needs_review", lastApprovalReviewedAt: null, lastFailureAt: null }, false],
    ["a raw NULL approval_status", { approvalStatus: null, lastApprovalReviewedAt: HELD_AT, lastFailureAt: null }, false],
    ["approved", { approvalStatus: "approved", lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: null }, false],
    ["blocked", { approvalStatus: "blocked", lastApprovalReviewedAt: HELD_AT, lastFailureAt: null }, false],
  ])("%s -> %s", (_label, row, expected) => {
    expect(isHeldByPerson(row)).toBe(expected);
  });
});

describe("isPendingPrecheck: the readiness rows awaiting a precheck, not already queued (final review I1)", () => {
  const precheckedAt = { ...READY_PRECHECK, liveHealthReviewedAt: FRESH };

  it.each<[string, Partial<PendingCandidateRow>, boolean]>([
    ["missing: never prechecked", {}, true],
    ["missing: a precheck time without a verdict", { liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes(URL_X) }, true],
    ["stale: a ready precheck older than 14 days", { ...READY_PRECHECK, liveHealthReviewedAt: STALE }, true],
    ["superseded: demoted by a failure after its precheck", { approvalStatus: "needs_review", ...precheckedAt, lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: FAILED_AT }, true],
    ["base_url_changed: a fresh ready precheck of another address", { ...READY_PRECHECK, liveHealthNotes: precheckNotes("https://www.bidnetdirect.com/mitn/old/solicitations/open-bids") }, true],
    ["base_url_changed: a fresh needs_fix of the address a person has since fixed", { liveHealthDisposition: "needs_fix", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes("https://www.bidnetdirect.com/mitn/old/solicitations/open-bids", "needs_fix") }, true],
    ["held by a person, on a usable precheck", { approvalStatus: "needs_review", ...precheckedAt, lastApprovalReviewedAt: HELD_AT }, false],
    ["held by a person, never prechecked", { approvalStatus: "needs_review", lastApprovalReviewedAt: HELD_AT }, false],
    ["held: a governance change on a NULL-status row, which the console reads as needs_review", { approvalStatus: null, lastApprovalReviewedAt: HELD_AT }, false],
    ["already queued", { precheckRequestedAt: NOW.toISOString() }, false],
    ["disabled", { isEnabled: false }, false],
    ["a fresh usable precheck", { ...READY_PRECHECK }, false],
    ["a fresh needs_fix of the current address", { liveHealthDisposition: "needs_fix", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes(URL_X, "needs_fix") }, false],
    ["approved", { approvalStatus: "approved" }, false],
    ["blocked", { approvalStatus: "blocked" }, false],
  ])("%s -> %s", (_label, overrides, expected) => {
    expect(isPendingPrecheck(candidate(overrides), NOW)).toBe(expected);
  });
});

/**
 * One family's rows for the selector tests of both dialects: which of them a platform-wide "--pending" queues.
 * Each row's base_url is `urlFor(id)`.
 */
const SELECTOR_SCENARIO: Array<{ id: string; pending: boolean; fields: Record<string, unknown> }> = [
  { id: "bidnet_mi_1_never", pending: true, fields: {} },
  { id: "bidnet_mi_2_stale", pending: true, fields: { liveHealthDisposition: "ready", liveHealthReviewedAt: STALE, liveHealthNotes: precheckNotes(urlFor("bidnet_mi_2_stale")) } },
  { id: "bidnet_mi_3_demoted", pending: true, fields: { approvalStatus: "needs_review", liveHealthDisposition: "ready", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes(urlFor("bidnet_mi_3_demoted")), lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: FAILED_AT } },
  { id: "bidnet_mi_4_moved", pending: true, fields: { liveHealthDisposition: "needs_fix", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes("https://www.bidnetdirect.com/mitn/old/solicitations/open-bids", "needs_fix") } },
  { id: "bidnet_mi_5_held", pending: false, fields: { approvalStatus: "needs_review", liveHealthDisposition: "ready", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes(urlFor("bidnet_mi_5_held")), lastApprovalReviewedAt: HELD_AT } },
  { id: "bidnet_mi_6_ready", pending: false, fields: { liveHealthDisposition: "ready", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes(urlFor("bidnet_mi_6_ready")) } },
  { id: "bidnet_mi_7_needs_fix", pending: false, fields: { liveHealthDisposition: "needs_fix", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes(urlFor("bidnet_mi_7_needs_fix"), "needs_fix") } },
];
const SCENARIO_PENDING_IDS = SELECTOR_SCENARIO.filter((entry) => entry.pending).map((entry) => entry.id);

describe("SQLite queue", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      row("bidnet_mi_a"),
      // A complete fresh precheck, as the write-back records it: verdict, time and the prechecked address.
      row("bidnet_mi_b", { liveHealthDisposition: "ready", liveHealthReviewedAt: FRESH, liveHealthNotes: precheckNotes(urlFor("bidnet_mi_b")) }),
      row("bidnet_mi_c", { approvalStatus: "approved" }),
      row("bidnet_mi_d", { liveHealthDisposition: "ready", liveHealthReviewedAt: STALE, liveHealthNotes: precheckNotes(urlFor("bidnet_mi_d")), approvalStatus: "needs_review" }),
      row("bonfire_oh_e", { providerFamily: "bonfire" }),
      row("state_mi", { jurisdictionLevel: "state", issuerType: "state" }),
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("queues what the readiness calls awaiting precheck: missing, stale, superseded, moved; never held, usable or a current needs_fix", () => {
    testDb.db.insert(dataSources).values(SELECTOR_SCENARIO.map((entry) => row(entry.id, entry.fields))).run();

    const selected = selectPrecheckTargets(testDb.db, { providerFamily: "bidnet", pending: true }, NOW);

    // The scenario's pending rows, alongside the fixture's own bidnet_mi_a (never prechecked) and bidnet_mi_d (stale).
    expect(selected).toEqual([...SCENARIO_PENDING_IDS, "bidnet_mi_a", "bidnet_mi_d"].sort());
  });

  it("selects and marks the pending sources of a family", () => {
    expect(selectPrecheckTargets(testDb.db, { providerFamily: "bidnet", pending: true }, NOW)).toEqual(["bidnet_mi_a", "bidnet_mi_d"]);
    const result = requestPrechecks(testDb.db, { providerFamily: "bidnet", pending: true }, NOW);
    expect(result).toEqual({ requestedCount: 2, sourceIds: ["bidnet_mi_a", "bidnet_mi_d"] });
    expect(listQueuedPrechecks(testDb.db).map((entry) => entry.id)).toEqual(["bidnet_mi_a", "bidnet_mi_d"]);
    // idempotent: nothing new the second time
    expect(requestPrechecks(testDb.db, { providerFamily: "bidnet", pending: true }, NOW).requestedCount).toBe(0);
  });

  it("marks explicit ids regardless of freshness but never twice, ignoring unknown ids", () => {
    const result = requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_b", "bidnet_mi_c", "nope"] }, NOW);
    expect(result.sourceIds).toEqual(["bidnet_mi_b", "bidnet_mi_c"]);
    expect(requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_b"] }, NOW).requestedCount).toBe(0);
  });

  it("lists oldest request first and clears only a matching timestamp", () => {
    requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_b"] }, new Date("2026-09-29T09:00:00.000Z"));
    requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_a"] }, NOW);
    const queued = listQueuedPrechecks(testDb.db);
    expect(queued.map((entry) => entry.id)).toEqual(["bidnet_mi_a", "bidnet_mi_b"]);
    expect(queued[0]).toMatchObject({ providerFamily: "bidnet", baseUrl: expect.stringContaining("bidnet_mi_a") });
    expect(clearPrecheckRequest(testDb.db, "bidnet_mi_a", "2000-01-01T00:00:00.000Z")).toBe(false);
    expect(clearPrecheckRequest(testDb.db, "bidnet_mi_a", NOW.toISOString())).toBe(true);
    expect(listQueuedPrechecks(testDb.db).map((entry) => entry.id)).toEqual(["bidnet_mi_b"]);
  });
});

describe("MySQL twins", () => {
  it("selects with the pending predicate, updates only unmarked ids, lists and clears", async () => {
    const query = vi.fn<(sql: string) => Promise<unknown[][]>>(async () => [[
      { id: "bidnet_mi_a", provider_family: "bidnet", jurisdiction_level: "county", approval_status: null, is_enabled: 1, live_health_reviewed_at: null, precheck_requested_at: null, base_url: "https://x/a" },
      {
        id: "bidnet_mi_b", provider_family: "bidnet", jurisdiction_level: "county", approval_status: null, is_enabled: 1, base_url: "https://x/b",
        live_health_disposition: "ready", live_health_reviewed_at: FRESH, live_health_notes: precheckNotes("https://x/b"),
        last_failure_at: null, last_approval_reviewed_at: null, precheck_requested_at: null,
      },
    ]]);
    const execute = vi.fn<(sql: string, values?: never[]) => Promise<Array<{ affectedRows: number }>>>(async () => [{ affectedRows: 1 }]);
    const store = { query, execute } as never;

    const result = await requestPrechecksFromMysql(store, { providerFamily: "bidnet", pending: true }, NOW);
    expect(result.sourceIds).toEqual(["bidnet_mi_a"]);
    const update = execute.mock.calls[0];
    expect(String(update[0])).toContain("UPDATE data_sources SET precheck_requested_at = ?");
    expect(String(update[0])).toContain("AND precheck_requested_at IS NULL");

    query.mockResolvedValueOnce([[{ id: "bidnet_mi_a", provider_family: "bidnet", base_url: "https://x/a", precheck_requested_at: NOW.toISOString() }]] as never);
    expect(await listQueuedPrechecksFromMysql(store)).toEqual([{ id: "bidnet_mi_a", providerFamily: "bidnet", baseUrl: "https://x/a", precheckRequestedAt: NOW.toISOString() }]);

    execute.mockResolvedValueOnce([{ affectedRows: 0 }] as never);
    expect(await clearPrecheckRequestFromMysql(store, "bidnet_mi_a", "stale")).toBe(false);
  });
});

describe("MySQL twins: SQL shape", () => {
  type Query = (sql: string, values?: unknown[]) => Promise<unknown[][]>;
  type Execute = (sql: string, values?: never[]) => Promise<Array<{ affectedRows: number }>>;

  it("queries a family's local levels and touches nothing when no source is pending", async () => {
    const query = vi.fn<Query>(async () => [[]]);
    const execute = vi.fn<Execute>(async () => [{ affectedRows: 0 }]);

    const result = await requestPrechecksFromMysql({ query, execute } as never, { providerFamily: "bidnet", pending: true }, NOW);

    expect(result).toEqual({ requestedCount: 0, sourceIds: [] });
    expect(query.mock.calls[0][0]).toContain("jurisdiction_level IN (?, ?, ?, ?)");
    expect(query.mock.calls[0][0]).toContain("(approval_status IS NULL OR approval_status = 'needs_review')");
    expect(query.mock.calls[0][0]).toContain("AND precheck_requested_at IS NULL");
    expect(query.mock.calls[0][1]).toEqual(["bidnet", "county", "city", "township", "special_district"]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("selects the columns the precheck evidence rule reads", async () => {
    const query = vi.fn<Query>(async () => [[]]);

    await selectPrecheckTargetsFromMysql({ query, execute: vi.fn<Execute>() } as never, { providerFamily: "bidnet", pending: true }, NOW);

    const columns = /SELECT ([\s\S]*?) FROM data_sources/.exec(query.mock.calls[0][0])?.[1].split(",").map((column) => column.trim());
    expect(columns).toEqual(expect.arrayContaining(["base_url", "live_health_disposition", "live_health_notes", "last_failure_at", "last_approval_reviewed_at"]));
    expect(columns).toEqual(expect.arrayContaining(["id", "approval_status", "is_enabled", "live_health_reviewed_at", "precheck_requested_at"]));
  });

  it("applies the same pending rule as SQLite to the rows the pre-filter returns", async () => {
    const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const mysqlRows = SELECTOR_SCENARIO.map(({ id, fields }) => ({
      id, provider_family: "bidnet", jurisdiction_level: "county", approval_status: null, is_enabled: 1, base_url: urlFor(id),
      live_health_disposition: null, live_health_reviewed_at: null, live_health_notes: null, last_failure_at: null,
      last_approval_reviewed_at: null, precheck_requested_at: null,
      ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [snake(key), value])),
    }));
    const query = vi.fn<Query>(async () => [mysqlRows]);

    const selected = await selectPrecheckTargetsFromMysql({ query, execute: vi.fn<Execute>() } as never, { providerFamily: "bidnet", pending: true }, NOW);

    expect(selected).toEqual(SCENARIO_PENDING_IDS);
  });

  it("marks explicit ids with one guarded UPDATE per 200 ids and reports each id once", async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `bidnet_mi_${String(index).padStart(3, "0")}`);
    const query = vi.fn<Query>(async () => [ids.map((id) => ({ id }))]);
    const execute = vi.fn<Execute>(async () => [{ affectedRows: 200 }]);

    const result = await requestPrechecksFromMysql({ query, execute } as never, { sourceIds: ids }, NOW);

    expect(query.mock.calls[0][0]).toContain("WHERE id IN (");
    expect(query.mock.calls[0][0]).toContain("AND precheck_requested_at IS NULL");
    expect(query.mock.calls[0][1]).toEqual(ids);
    expect(result).toEqual({ requestedCount: 450, sourceIds: ids });

    expect(execute).toHaveBeenCalledTimes(3);
    const bound = execute.mock.calls.map(([, values]) => values ?? []);
    expect(bound.map((values) => values.length - 2)).toEqual([200, 200, 50]);
    expect(bound.flatMap((values) => values.slice(2))).toEqual(ids);
    for (const values of bound) expect(values.slice(0, 2)).toEqual([NOW.toISOString(), NOW.toISOString()]);
    for (const [sql] of execute.mock.calls) expect(sql).toContain("AND precheck_requested_at IS NULL");
  });

  it("lists the queue oldest first, capped, and clears only the timestamp it was given", async () => {
    const query = vi.fn<Query>(async () => [[]]);
    const execute = vi.fn<Execute>(async () => [{ affectedRows: 1 }]);
    const store = { query, execute } as never;

    await listQueuedPrechecksFromMysql(store);
    await listQueuedPrechecksFromMysql(store, 25);
    expect(query.mock.calls[0][0]).toContain("WHERE precheck_requested_at IS NOT NULL ORDER BY precheck_requested_at ASC, id ASC LIMIT 200");
    expect(query.mock.calls[1][0]).toContain("LIMIT 25");

    expect(await clearPrecheckRequestFromMysql(store, "bidnet_mi_a", NOW.toISOString())).toBe(true);
    expect(execute.mock.calls[0][0]).toBe("UPDATE data_sources SET precheck_requested_at = NULL WHERE id = ? AND precheck_requested_at = ?");
    expect(execute.mock.calls[0][1]).toEqual(["bidnet_mi_a", NOW.toISOString()]);
  });
});
