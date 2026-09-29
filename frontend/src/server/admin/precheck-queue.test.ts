import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import {
  type PendingCandidateRow,
  PrecheckRequestInputError,
  clearPrecheckRequest,
  clearPrecheckRequestFromMysql,
  isPendingPrecheck,
  isPrecheckFresh,
  listQueuedPrechecks,
  listQueuedPrechecksFromMysql,
  normalizeRequestPrechecksInput,
  requestPrechecks,
  requestPrechecksFromMysql,
  selectPrecheckTargets,
} from "./precheck-queue";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const FRESH = "2026-09-20T00:00:00.000Z"; // 9 days old
const STALE = "2026-09-01T00:00:00.000Z"; // 28 days old

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    issuerType: "county",
    stateCode: "MI",
    baseUrl: `https://www.bidnetdirect.com/mitn/${id}/solicitations/open-bids`,
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
    ["needs_review local, stale precheck", { approvalStatus: "needs_review", liveHealthReviewedAt: STALE }, true],
    ["fresh precheck", { approvalStatus: null, liveHealthReviewedAt: FRESH }, false],
    ["already approved", { approvalStatus: "approved", liveHealthReviewedAt: null }, false],
    ["blocked", { approvalStatus: "blocked", liveHealthReviewedAt: null }, false],
    ["disabled", { approvalStatus: null, liveHealthReviewedAt: null, isEnabled: false }, false],
    ["already queued", { approvalStatus: null, liveHealthReviewedAt: null, precheckRequestedAt: NOW.toISOString() }, false],
    ["state level", { approvalStatus: null, liveHealthReviewedAt: null, jurisdictionLevel: "state" }, false],
  ])("isPendingPrecheck: %s", (_label, overrides, expected) => {
    expect(
      isPendingPrecheck(
        { id: "x", providerFamily: "bidnet", jurisdictionLevel: "county", approvalStatus: null, isEnabled: true, liveHealthReviewedAt: null, precheckRequestedAt: null, ...overrides },
        NOW,
      ),
    ).toBe(expected);
  });

  it("normalizeRequestPrechecksInput accepts ids or a pending family, nothing else", () => {
    expect(normalizeRequestPrechecksInput({ sourceIds: [" a ", "b", "a"] })).toEqual({ sourceIds: ["a", "b"], providerFamily: null, pending: false });
    expect(normalizeRequestPrechecksInput({ providerFamily: "BidNet", pending: true })).toEqual({ sourceIds: [], providerFamily: "bidnet", pending: true });
    expect(() => normalizeRequestPrechecksInput({})).toThrow(PrecheckRequestInputError);
    expect(() => normalizeRequestPrechecksInput({ providerFamily: "bidnet" })).toThrow(PrecheckRequestInputError);
    expect(() => normalizeRequestPrechecksInput({ sourceIds: Array.from({ length: 501 }, (_, i) => `s${i}`) })).toThrow(PrecheckRequestInputError);
  });
});

describe("SQLite queue", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      row("bidnet_mi_a"),
      row("bidnet_mi_b", { liveHealthReviewedAt: FRESH }),
      row("bidnet_mi_c", { approvalStatus: "approved" }),
      row("bidnet_mi_d", { liveHealthReviewedAt: STALE, approvalStatus: "needs_review" }),
      row("bonfire_oh_e", { providerFamily: "bonfire" }),
      row("state_mi", { jurisdictionLevel: "state", issuerType: "state" }),
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
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
      { id: "bidnet_mi_b", provider_family: "bidnet", jurisdiction_level: "county", approval_status: null, is_enabled: 1, live_health_reviewed_at: FRESH, precheck_requested_at: null, base_url: "https://x/b" },
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
