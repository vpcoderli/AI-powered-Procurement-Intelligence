import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import type { RunSourcePrecheckOptions, SourcePrecheckResult } from "@/server/admin/source-precheck";
import { PlatformPauseRegistry, PlatformTickBudget } from "./platform-budget";
import { PRECHECK_BUDGET_COST, PRECHECK_DISCOVERY_COST, precheckRequestCost, runQueuedPrechecksOnce } from "./precheck-queue-runner";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const TICK_MS = 15 * 60 * 1000;

function precheck(sourceId: string, overrides: Partial<SourcePrecheckResult["fetch"]> = {}, verdict: SourcePrecheckResult["verdict"] = "ready"): SourcePrecheckResult {
  return {
    sourceId, checkedAt: NOW.toISOString(), verdict, reasons: [],
    robots: { status: "clear", flagged: false, flagReason: null },
    fetch: { status: "ok", items: 3, sample: [], listMethod: "scrapling", errorCode: null, errorMessage: null, httpStatus: 200, wafChallenge: false, ...overrides },
    suggestedBaseUrl: null,
  };
}

function row(id: string, family: string, requestedAt: string) {
  return { id, label: id, issuerType: "county", stateCode: "MI", providerFamily: family, jurisdictionLevel: "county", isEnabled: 1, baseUrl: `https://x/${id}`, precheckRequestedAt: requestedAt, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
}

describe("runQueuedPrechecksOnce", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      row("bidnet_a", "bidnet", "2026-09-29T07:00:00.000Z"),
      row("bidnet_b", "bidnet", "2026-09-29T07:01:00.000Z"),
      row("bidnet_c", "bidnet", "2026-09-29T07:02:00.000Z"),
      row("bonfire_d", "bonfire", "2026-09-29T07:03:00.000Z"),
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("processes in request order, clears finished flags, stops a family on a WAF challenge and pauses it", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) =>
      sourceId === "bidnet_b" ? precheck(sourceId, { status: "failed", httpStatus: 202, wafChallenge: true }, "needs_fix") : precheck(sourceId));
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS); // 15 per tick
    const pauses = new PlatformPauseRegistry();

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses, clock: () => NOW.getTime(), pauseMs: 1000, runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bidnet_a", "bidnet_b", "bonfire_d"]);
    expect(typeof runSourcePrecheck.mock.calls[0][0].scanCompliance).toBe("function");
    expect(result.processed.map((entry) => [entry.sourceId, entry.outcome])).toEqual([["bidnet_a", "done"], ["bidnet_b", "challenge"], ["bonfire_d", "done"]]);
    expect(result.skipped).toEqual({ budget: 0, paused: 1 });
    expect(result.stoppedFamilies).toEqual(["bidnet"]);
    expect(pauses.pausedUntil("bidnet", NOW.getTime())).not.toBeNull();

    const flags = Object.fromEntries(testDb.db.select({ id: dataSources.id, at: dataSources.precheckRequestedAt }).from(dataSources).all().map((entry) => [entry.id, entry.at]));
    expect(flags.bidnet_a).toBeNull();
    expect(flags.bidnet_b).not.toBeNull(); // challenge: retried after the pause
    expect(flags.bidnet_c).not.toBeNull(); // never reached this tick
    expect(flags.bonfire_d).toBeNull();
  });

  it("skips a budgeted family whose tick allowance is exhausted and leaves the flag", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS); // 15 per tick …
    expect(budget.reserve("bidnet", 15)).toBe(15);                              // … all spent by the daily lists
    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });
    expect(result.skipped.budget).toBe(3);
    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bonfire_d"]);
  });

  it("settles the budget with the discovery cost after a 404 and keeps an errored source queued", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => {
      if (sourceId === "bidnet_a") return precheck(sourceId, { status: "failed", httpStatus: 404 }, "needs_fix");
      if (sourceId === "bidnet_b") throw new Error("python3 not found");
      return precheck(sourceId);
    });
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    const settle = vi.spyOn(budget, "settle");
    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });
    expect(settle).toHaveBeenCalledWith("bidnet", PRECHECK_BUDGET_COST, PRECHECK_BUDGET_COST + PRECHECK_DISCOVERY_COST);
    expect(result.processed.find((entry) => entry.sourceId === "bidnet_b")).toMatchObject({ outcome: "error", error: "python3 not found" });
    const flag = testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).all().find((entry) => entry.at !== null);
    expect(flag).toBeDefined();
  });

  it("spaces two prechecks of one platform by the platform minimum interval", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));
    const sleep = vi.fn(async () => {});
    await runQueuedPrechecksOnce({
      database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(),
      runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 5000, sleep, now: () => NOW.getTime() },
    });
    expect(sleep).toHaveBeenCalledTimes(2); // bidnet_b and bidnet_c wait; bonfire_d is another platform
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("charges a precheck that threw its whole reservation, keeps every failed source queued and moves on", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions): Promise<SourcePrecheckResult> => {
      throw new Error(`crawler exited abnormally for ${sourceId}`);
    });
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    const settle = vi.spyOn(budget, "settle");

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(result.processed.map((entry) => [entry.outcome, entry.error])).toEqual(
      ["bidnet_a", "bidnet_b", "bidnet_c", "bonfire_d"].map((id) => ["error", `crawler exited abnormally for ${id}`]), // one failure never stops the queue
    );
    expect(settle.mock.calls).toEqual([["bidnet", 2, 2], ["bidnet", 2, 2], ["bidnet", 2, 2]]); // bonfire is not budgeted
    expect(testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).all().every((entry) => entry.at !== null)).toBe(true);
  });

  it("hands every precheck the same robots.txt cache, so a host is fetched once per tick however many sources use it", async () => {
    const robotsFetch = vi.fn<typeof fetch>(async () => new Response("User-agent: *\nDisallow: /private/\n", { status: 200 }));
    const statuses: string[] = [];
    const runSourcePrecheck = vi.fn(async ({ sourceId, scanCompliance }: RunSourcePrecheckOptions) => {
      const baseUrl = sourceId.startsWith("bidnet") ? `https://www.bidnetdirect.com/michigan/${sourceId}` : `https://bonfirehub.com/portal/${sourceId}`;
      const report = await scanCompliance!([{ id: sourceId, stateCode: "MI", label: sourceId, baseUrl }], { now: NOW });
      statuses.push(report.results[0].status);
      return precheck(sourceId);
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch, platformDeferral: { minIntervalMs: 0 } });

    expect(statuses).toEqual(["clear", "clear", "clear", "clear"]); // four sources, all scanned through the shared cache
    expect(robotsFetch.mock.calls.map(([url]) => String(url)).sort()).toEqual(["https://bonfirehub.com/robots.txt", "https://www.bidnetdirect.com/robots.txt"]);
    const summary = info.mock.calls.map(([line]) => JSON.parse(String(line))).find((entry) => entry.event === "crawler_precheck_queue_processed");
    expect(summary).toMatchObject({ queued: 4, done: 4, challenge: 0, error: 0, skippedBudget: 0, skippedPaused: 0, stoppedFamilies: [], robotsFetches: 2 });
    info.mockRestore();
  });

  it("does not start a family an earlier tick paused, and spends none of its budget", async () => {
    const pauses = new PlatformPauseRegistry();
    pauses.pause("bidnet", NOW.getTime() + 60_000);
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    const reserve = vi.spyOn(budget, "reserve");
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses, clock: () => NOW.getTime(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bonfire_d"]);
    expect(result.skipped).toEqual({ budget: 0, paused: 3 });
    expect(result.stoppedFamilies).toEqual([]);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("stops a family on a challenge even when the pause length is zero", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) =>
      precheck(sourceId, { status: "failed", httpStatus: 403, wafChallenge: true }, "needs_fix"));

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), clock: () => NOW.getTime(), pauseMs: 0, runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    // A zero-length pause expires at once; the per-tick stop is what keeps bidnet_b and bidnet_c untouched.
    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bidnet_a", "bonfire_d"]);
    expect(result.skipped.paused).toBe(2);
    expect(result.stoppedFamilies).toEqual(["bidnet", "bonfire"]);
  });

  it("runs a source with no platform family without budget, spacing or a platform pause, and leaves it queued on a challenge", async () => {
    testDb.db.insert(dataSources).values({ ...row("solo_e", "unused", "2026-09-29T06:59:00.000Z"), providerFamily: null }).run();
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    const reserve = vi.spyOn(budget, "reserve");
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) =>
      sourceId === "solo_e" ? precheck(sourceId, { status: "failed", httpStatus: 202, wafChallenge: true }, "needs_fix") : precheck(sourceId));
    const sleep = vi.fn(async () => {});

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses: new PlatformPauseRegistry(), clock: () => NOW.getTime(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 5000, sleep, now: () => NOW.getTime() } });

    expect(result.processed[0]).toMatchObject({ sourceId: "solo_e", providerFamily: null, outcome: "challenge" });
    expect(result.stoppedFamilies).toEqual([]);
    expect(result.processed.slice(1).map((entry) => entry.outcome)).toEqual(["done", "done", "done", "done"]); // nothing was stopped
    expect(reserve).toHaveBeenCalledTimes(3); // bidnet only
    expect(sleep).toHaveBeenCalledTimes(2); // bidnet_b, bidnet_c
    const flag = testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).where(eq(dataSources.id, "solo_e")).get();
    expect(flag?.at).toBe("2026-09-29T06:59:00.000Z");
  });

  it("keeps the flag of a source that was queued again while its precheck ran", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => {
      if (sourceId === "bonfire_d") testDb.db.update(dataSources).set({ precheckRequestedAt: "2026-09-29T08:30:00.000Z" }).where(eq(dataSources.id, sourceId)).run();
      return precheck(sourceId);
    });

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(result.processed.find((entry) => entry.sourceId === "bonfire_d")).toMatchObject({ outcome: "done", error: "re-queued while running" });
    const flag = testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).where(eq(dataSources.id, "bonfire_d")).get();
    expect(flag?.at).toBe("2026-09-29T08:30:00.000Z"); // the newer request is still pending
  });

  it("lists at most maxPerTick queued sources, oldest first", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), maxPerTick: 2, runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(result.queued).toBe(2);
    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bidnet_a", "bidnet_b"]);
  });

  it("runs on the MySQL twins when a store is given and never touches the SQLite handle", async () => {
    const queue = [{ id: "bidnet_a", provider_family: "bidnet", base_url: "https://x/bidnet_a", precheck_requested_at: "2026-09-29T07:00:00.000Z" }];
    const query = vi.fn<(sql: string, values?: unknown[]) => Promise<unknown[][]>>(async () => [queue]);
    const execute = vi.fn<(sql: string, values?: never[]) => Promise<Array<{ affectedRows: number }>>>(async () => [{ affectedRows: 1 }]);
    const mysql = { query, execute } as never;
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));

    const result = await runQueuedPrechecksOnce({ database: {} as AppDatabase, mysql, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(query.mock.calls[0][0]).toContain("WHERE precheck_requested_at IS NOT NULL ORDER BY precheck_requested_at ASC, id ASC LIMIT 50");
    expect(runSourcePrecheck.mock.calls[0][0].mysql).toBe(mysql);
    expect(execute).toHaveBeenCalledWith("UPDATE data_sources SET precheck_requested_at = NULL WHERE id = ? AND precheck_requested_at = ?", ["bidnet_a", "2026-09-29T07:00:00.000Z"]);
    expect(result.processed).toEqual([{ sourceId: "bidnet_a", providerFamily: "bidnet", outcome: "done", verdict: "ready", error: null }]);
    // The four rows the SQLite handle holds were never looked at.
    expect(testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).all().every((entry) => entry.at !== null)).toBe(true);
  });

  it("precheckRequestCost adds the tenant probe only after a 404", () => {
    expect(precheckRequestCost(precheck("x"))).toBe(PRECHECK_BUDGET_COST);
    expect(precheckRequestCost(precheck("x", { status: "failed", httpStatus: 404 }, "needs_fix"))).toBe(PRECHECK_BUDGET_COST + PRECHECK_DISCOVERY_COST);
  });
});
