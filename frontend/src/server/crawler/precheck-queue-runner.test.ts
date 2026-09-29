import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { runSourcePrecheck as realRunSourcePrecheck, type RunSourcePrecheckOptions, type SourcePrecheckResult } from "@/server/admin/source-precheck";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { PlatformPauseRegistry, PlatformTickBudget } from "./platform-budget";
import {
  PRECHECK_BUDGET_COST,
  PRECHECK_DISCOVERY_COST,
  PRECHECK_MAX_ATTEMPTS,
  PrecheckRetryRegistry,
  classifyPrecheck,
  precheckRequestCost,
  runQueuedPrechecksOnce,
  type RunQueuedPrechecksOnceOptions,
} from "./precheck-queue-runner";
import type { CrawlTaskResult } from "./state-runner";

// Safety net for the cases that run the real runSourcePrecheck: a 404 there would probe tenants through the Python CLI.
vi.mock("@/server/admin/tenant-discovery", () => ({
  runDiscoverTenant: vi.fn(async () => {
    throw new Error("tenant discovery must not run in tests");
  }),
}));

const NOW = new Date("2026-09-29T08:00:00.000Z");
const TICK_MS = 15 * 60 * 1000;
const MINUTE = 60 * 1000;

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
    expect(result.skipped).toEqual({ budget: 0, paused: 1, retry: 0 });
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

  it("charges a precheck that threw its whole reservation, keeps it queued, stops only its own family and moves on", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions): Promise<SourcePrecheckResult> => {
      throw new Error(`crawler exited abnormally for ${sourceId}`);
    });
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    const settle = vi.spyOn(budget, "settle");
    const pauses = new PlatformPauseRegistry();

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses, clock: () => NOW.getTime(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    // bidnet_a errors and stops bidnet for the tick (an error is no evidence about the other bidnet sources, but
    // trying them now would charge each of them the same failure); bonfire_d is another platform and still runs.
    expect(result.processed.map((entry) => [entry.sourceId, entry.outcome, entry.error])).toEqual([
      ["bidnet_a", "error", "crawler exited abnormally for bidnet_a"],
      ["bonfire_d", "error", "crawler exited abnormally for bonfire_d"],
    ]);
    expect(result.skipped).toEqual({ budget: 0, paused: 2, retry: 0 });
    expect(result.stoppedFamilies).toEqual(["bidnet", "bonfire"]);
    expect(pauses.pausedUntil("bidnet", NOW.getTime())).toBeNull(); // only a challenge pauses the shared registry
    expect(settle.mock.calls).toEqual([["bidnet", 2, 2]]); // bonfire is not budgeted
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
    expect(result.skipped).toEqual({ budget: 0, paused: 3, retry: 0 });
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

  it("starts at most maxPerTick prechecks, oldest first, and reads the whole queue window to do it", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), maxPerTick: 2, runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(result.queued).toBe(4); // all four rows were read ...
    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bidnet_a", "bidnet_b"]); // ... two were started
    expect(result.processed).toHaveLength(2);
  });

  it("does not let rows skipped for budget use up the maxPerTick slots of a family queued behind them", async () => {
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    expect(budget.reserve("bidnet", 15)).toBe(15); // bidnet's whole tick is spent: its three rows are skipped
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses: new PlatformPauseRegistry(), maxPerTick: 1, runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    // The old semantics listed only the single oldest row (bidnet_a), skipped it, and started nothing.
    expect(result.skipped.budget).toBe(3);
    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bonfire_d"]);
  });

  it("runs on the MySQL twins when a store is given and never touches the SQLite handle", async () => {
    const queue = [{ id: "bidnet_a", provider_family: "bidnet", base_url: "https://x/bidnet_a", precheck_requested_at: "2026-09-29T07:00:00.000Z" }];
    const query = vi.fn<(sql: string, values?: unknown[]) => Promise<unknown[][]>>(async () => [queue]);
    const execute = vi.fn<(sql: string, values?: never[]) => Promise<Array<{ affectedRows: number }>>>(async () => [{ affectedRows: 1 }]);
    const mysql = { query, execute } as never;
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId));

    const result = await runQueuedPrechecksOnce({ database: {} as AppDatabase, mysql, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 } });

    expect(query.mock.calls[0][0]).toContain("WHERE precheck_requested_at IS NOT NULL ORDER BY precheck_requested_at ASC, id ASC LIMIT 500");
    expect(runSourcePrecheck.mock.calls[0][0].mysql).toBe(mysql);
    expect(execute).toHaveBeenCalledWith("UPDATE data_sources SET precheck_requested_at = NULL WHERE id = ? AND precheck_requested_at = ?", ["bidnet_a", "2026-09-29T07:00:00.000Z"]);
    expect(result.processed).toEqual([{ sourceId: "bidnet_a", providerFamily: "bidnet", outcome: "done", verdict: "ready", error: null }]);
    // The four rows the SQLite handle holds were never looked at.
    expect(testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).all().every((entry) => entry.at !== null)).toBe(true);
  });

  // A fresh tick's worth of everything except what a test passes in.
  function run(overrides: Partial<RunQueuedPrechecksOnceOptions> = {}) {
    return runQueuedPrechecksOnce({
      database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(),
      robotsFetch: vi.fn() as never, platformDeferral: { minIntervalMs: 0 },
      runSourcePrecheck: vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId)),
      ...overrides,
    });
  }

  function flags() {
    return Object.fromEntries(testDb.db.select({ id: dataSources.id, at: dataSources.precheckRequestedAt }).from(dataSources).all().map((entry) => [entry.id, entry.at]));
  }

  const challenge = (sourceId: string) => precheck(sourceId, { status: "failed", httpStatus: 403, wafChallenge: true }, "needs_fix");

  it("backs an errored source off across ticks, so the rest of its family runs while it waits", async () => {
    const retries = new PrecheckRetryRegistry();
    const pauses = new PlatformPauseRegistry();
    let clock = NOW.getTime();
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) =>
      sourceId === "bidnet_a" ? precheck(sourceId, { status: "failed", httpStatus: null, errorCode: "ENOENT", errorMessage: "spawn python3 ENOENT" }, "needs_fix") : precheck(sourceId));
    const tick = () => run({ retries, pauses, clock: () => clock, pauseMs: 30 * MINUTE, runSourcePrecheck });

    const first = await tick();
    expect(first.processed.map((entry) => [entry.sourceId, entry.outcome])).toEqual([["bidnet_a", "error"], ["bonfire_d", "done"]]);
    expect(first.skipped).toEqual({ budget: 0, paused: 2, retry: 0 }); // bidnet_b and bidnet_c: their family stopped for this tick
    expect(pauses.pausedUntil("bidnet", clock)).toBeNull(); // an error never pauses the registry the daily crawl reads
    expect(retries.streak("bidnet_a")).toBe(1);

    clock += 15 * MINUTE; // the next tick: nothing paused bidnet, but bidnet_a is still backing off
    const second = await tick();
    expect(second.skipped).toEqual({ budget: 0, paused: 0, retry: 1 });
    expect(second.processed.map((entry) => [entry.sourceId, entry.outcome])).toEqual([["bidnet_b", "done"], ["bidnet_c", "done"]]);

    clock += 15 * MINUTE + 1; // backoff over: bidnet_a is the oldest row again and is tried again, first
    const third = await tick();
    expect(third.processed.map((entry) => [entry.sourceId, entry.outcome])).toEqual([["bidnet_a", "error"]]);
    expect(retries.streak("bidnet_a")).toBe(2);
    expect(flags().bidnet_a).not.toBeNull();
  });

  it("does not re-run a challenged source with no platform family on every tick", async () => {
    testDb.db.insert(dataSources).values({ ...row("solo_e", "unused", "2026-09-29T06:59:00.000Z"), providerFamily: null }).run();
    const retries = new PrecheckRetryRegistry();
    let clock = NOW.getTime();
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => (sourceId === "solo_e" ? challenge(sourceId) : precheck(sourceId)));
    const tick = () => run({ retries, clock: () => clock, pauseMs: 30 * MINUTE, runSourcePrecheck });

    expect((await tick()).processed[0]).toMatchObject({ sourceId: "solo_e", outcome: "challenge" });
    clock += 15 * MINUTE;
    const second = await tick();

    expect(second.skipped.retry).toBe(1);
    expect(second.processed).toEqual([]);
    expect(runSourcePrecheck.mock.calls.filter((call) => call[0].sourceId === "solo_e")).toHaveLength(1);
  });

  it("gives a source up after three consecutive challenges: flag cleared, outcome abandoned, the family paused and then free for its other sources", async () => {
    const retries = new PrecheckRetryRegistry();
    const pauses = new PlatformPauseRegistry();
    let clock = NOW.getTime();
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => (sourceId === "bidnet_a" ? challenge(sourceId) : precheck(sourceId)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tick = () => run({ retries, pauses, clock: () => clock, pauseMs: 30 * MINUTE, runSourcePrecheck });

    const outcomes: string[] = [];
    let lastAttemptAt = clock;
    for (let attempt = 1; attempt <= PRECHECK_MAX_ATTEMPTS; attempt += 1) {
      lastAttemptAt = clock;
      const result = await tick();
      outcomes.push(result.processed[0].outcome);
      expect(result.processed[0]).toMatchObject({ sourceId: "bidnet_a", providerFamily: "bidnet" });
      clock += 30 * MINUTE + 1; // the pause and the backoff both lapse
    }

    expect(outcomes).toEqual(["challenge", "challenge", "abandoned"]);
    expect(flags().bidnet_a).toBeNull(); // given up: runSourcePrecheck already wrote needs_fix and the reason
    expect(retries.streak("bidnet_a")).toBe(0); // and a fresh request starts from zero
    expect(pauses.pausedUntil("bidnet", lastAttemptAt)).not.toBeNull(); // the last challenge still paused the platform
    const logged = warn.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(logged).toEqual([{ event: "crawler_precheck_abandoned", source: "bidnet_a", family: "bidnet", attempts: 3, lastOutcome: "challenge", reason: "platform challenge (HTTP 403)" }]);

    const fourth = await tick(); // bidnet_a is gone from the queue: the rest of the family finally runs
    expect(fourth.processed.map((entry) => [entry.sourceId, entry.outcome])).toEqual([["bidnet_b", "done"], ["bidnet_c", "done"]]);
    warn.mockRestore();
  });

  it("reports what it gave up on: the last verdict, and the reason", async () => {
    const retries = new PrecheckRetryRegistry();
    retries.recordFailure("bidnet_a", 0);
    retries.recordFailure("bidnet_a", 0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await run({ retries, runSourcePrecheck: vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => challenge(sourceId)) });

    expect(result.processed[0]).toEqual({ sourceId: "bidnet_a", providerFamily: "bidnet", outcome: "abandoned", verdict: "needs_fix", error: "gave up after 3 attempts: platform challenge (HTTP 403)" });
    warn.mockRestore();
  });

  it("gives up on a source whose precheck keeps throwing, with no verdict to report", async () => {
    const retries = new PrecheckRetryRegistry();
    let clock = NOW.getTime();
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions): Promise<SourcePrecheckResult> => {
      if (sourceId === "bidnet_a") throw new Error("disk I/O error");
      return precheck(sourceId);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const outcomes: Array<[string, string | null]> = [];
    for (let attempt = 1; attempt <= PRECHECK_MAX_ATTEMPTS; attempt += 1) {
      const result = await run({ retries, clock: () => clock, pauseMs: 30 * MINUTE, runSourcePrecheck });
      outcomes.push([result.processed[0].outcome, result.processed[0].error]);
      clock += 30 * MINUTE + 1;
    }

    expect(outcomes).toEqual([["error", "disk I/O error"], ["error", "disk I/O error"], ["abandoned", "gave up after 3 attempts: disk I/O error"]]);
    expect(flags().bidnet_a).toBeNull();
    warn.mockRestore();
  });

  it("starts a source over once a precheck of it completes", async () => {
    const retries = new PrecheckRetryRegistry();
    retries.recordFailure("bidnet_a", 0);
    retries.recordFailure("bidnet_a", 0);

    const result = await run({ retries });

    expect(result.processed[0]).toMatchObject({ sourceId: "bidnet_a", outcome: "done" });
    expect(retries.streak("bidnet_a")).toBe(0);
  });

  it("treats an HTTP 429 as a challenge: the platform is paused and the source stays queued", async () => {
    const pauses = new PlatformPauseRegistry();
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) =>
      precheck(sourceId, { status: "failed", httpStatus: 429, wafChallenge: false, errorCode: "HTTPError", errorMessage: "429 Too Many Requests" }, "needs_fix"));

    const result = await run({ pauses, clock: () => NOW.getTime(), pauseMs: 30 * MINUTE, runSourcePrecheck });

    expect(result.processed.map((entry) => [entry.sourceId, entry.outcome])).toEqual([["bidnet_a", "challenge"], ["bonfire_d", "challenge"]]);
    expect(pauses.pausedUntil("bidnet", NOW.getTime())).toBe(NOW.getTime() + 30 * MINUTE);
    expect(flags()).toMatchObject({ bidnet_a: expect.any(String), bidnet_b: expect.any(String), bidnet_c: expect.any(String), bonfire_d: expect.any(String) });
  });

  it("counts a successful precheck as done even when its stderr made wafChallenge true", async () => {
    const pauses = new PlatformPauseRegistry();
    const runSourcePrecheck = vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => precheck(sourceId, { wafChallenge: true, httpStatus: 403 }));

    const result = await run({ pauses, clock: () => NOW.getTime(), runSourcePrecheck });

    expect(result.processed.map((entry) => entry.outcome)).toEqual(["done", "done", "done", "done"]);
    expect(result.stoppedFamilies).toEqual([]);
    expect(pauses.pausedUntil("bidnet", NOW.getTime())).toBeNull();
    expect(Object.values(flags()).every((at) => at === null)).toBe(true);
  });

  it("charges the reservation once, and keeps the source queued, when only the flag clear fails", async () => {
    const queue = [{ id: "bidnet_a", provider_family: "bidnet", base_url: "https://x/bidnet_a", precheck_requested_at: "2026-09-29T07:00:00.000Z" }];
    const query = vi.fn<(sql: string, values?: unknown[]) => Promise<unknown[][]>>(async () => [queue]);
    const execute = vi.fn<(sql: string, values?: never[]) => Promise<Array<{ affectedRows: number }>>>(async () => {
      throw new Error("db down");
    });
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    const settle = vi.spyOn(budget, "settle");
    const retries = new PrecheckRetryRegistry();

    const result = await run({ database: {} as AppDatabase, mysql: { query, execute } as never, budget, retries });

    expect(result.processed).toEqual([{ sourceId: "bidnet_a", providerFamily: "bidnet", outcome: "error", verdict: null, error: "db down" }]);
    expect(settle.mock.calls).toEqual([["bidnet", 2, 2]]); // the precheck's own settle; the failed clear must not settle again
    expect(retries.streak("bidnet_a")).toBe(1);
  });

  it("keeps the flag and the streak when giving up fails, and tries again on the next failed attempt", async () => {
    const queue = [{ id: "bidnet_a", provider_family: "bidnet", base_url: "https://x/bidnet_a", precheck_requested_at: "2026-09-29T07:00:00.000Z" }];
    const query = vi.fn<(sql: string, values?: unknown[]) => Promise<unknown[][]>>(async () => [queue]);
    const execute = vi.fn<(sql: string, values?: never[]) => Promise<Array<{ affectedRows: number }>>>(async () => {
      throw new Error("db down");
    });
    const retries = new PrecheckRetryRegistry();
    retries.recordFailure("bidnet_a", 0);
    retries.recordFailure("bidnet_a", 0);

    const result = await run({ database: {} as AppDatabase, mysql: { query, execute } as never, retries, runSourcePrecheck: vi.fn(async ({ sourceId }: RunSourcePrecheckOptions) => challenge(sourceId)) });

    expect(result.processed).toEqual([{ sourceId: "bidnet_a", providerFamily: "bidnet", outcome: "error", verdict: "needs_fix", error: "could not give up after 3 attempts: db down" }]);
    expect(retries.streak("bidnet_a")).toBe(3);
  });

  it("precheckRequestCost adds the tenant probe only after a 404", () => {
    expect(precheckRequestCost(precheck("x"))).toBe(PRECHECK_BUDGET_COST);
    expect(precheckRequestCost(precheck("x", { status: "failed", httpStatus: 404 }, "needs_fix"))).toBe(PRECHECK_BUDGET_COST + PRECHECK_DISCOVERY_COST);
  });
});

describe("PrecheckRetryRegistry", () => {
  it("backs a source off until notBefore, counts its streak and starts over on reset", () => {
    const retries = new PrecheckRetryRegistry();
    expect(retries.notBefore("a", 1000)).toBeNull();
    expect(retries.streak("a")).toBe(0);

    expect(retries.recordFailure("a", 5000)).toBe(1);
    expect(retries.notBefore("a", 4999)).toBe(5000);
    expect(retries.notBefore("a", 5000)).toBeNull(); // free again from notBefore on ...
    expect(retries.recordFailure("a", 9000)).toBe(2); // ... but the streak is what counts toward giving up
    expect(retries.notBefore("b", 4999)).toBeNull(); // per source

    retries.reset("a");
    expect(retries.streak("a")).toBe(0);
    expect(retries.notBefore("a", 0)).toBeNull();
  });
});

describe("classifyPrecheck", () => {
  const failed = (overrides: Partial<SourcePrecheckResult["fetch"]>) => precheck("x", { status: "failed", httpStatus: null, wafChallenge: false, ...overrides }, "needs_fix");

  it("never reads a run that parsed rows or verified an empty list as a challenge or an error", () => {
    expect(classifyPrecheck(precheck("x", { wafChallenge: true, httpStatus: 403 }))).toEqual({ kind: "completed" });
    expect(classifyPrecheck(precheck("x", { status: "empty_verified", items: 0, wafChallenge: true, httpStatus: 202 }, "empty"))).toEqual({ kind: "completed" });
  });

  it("reads a failed run that the platform refused (challenge, 403/202) or rate-limited (429) as a challenge", () => {
    expect(classifyPrecheck(failed({ wafChallenge: true, httpStatus: 403 }))).toEqual({ kind: "challenge", reason: "platform challenge (HTTP 403)" });
    expect(classifyPrecheck(failed({ wafChallenge: true }))).toEqual({ kind: "challenge", reason: "platform challenge" });
    expect(classifyPrecheck(failed({ httpStatus: 429 }))).toEqual({ kind: "challenge", reason: "rate limited (HTTP 429)" });
  });

  it("keeps a verdict about the source itself as completed: a dead tenant, a parse failure, no rows", () => {
    expect(classifyPrecheck(failed({ httpStatus: 404, errorCode: "1", errorMessage: "HTML request failed with status 404: nope" }))).toEqual({ kind: "completed" });
    expect(classifyPrecheck(failed({ errorCode: "HtmlPageError", errorMessage: "HTML table was missing required headers" }))).toEqual({ kind: "completed" });
    expect(classifyPrecheck(failed({ errorCode: "EmptyCrawlerResultError", errorMessage: "no opportunities" }))).toEqual({ kind: "completed" });
  });

  it("without the raw crawl, reads only codes that cannot be a Python error name as a process failure", () => {
    for (const errorCode of ["ENOENT", "EACCES", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "CrawlerTaskTimeoutError", "CrawlerOutputError", "CrawlerProcessError"]) {
      expect(classifyPrecheck(failed({ errorCode, errorMessage: "boom" })).kind).toBe("error");
    }
    // A bare exit status ("1") beside a parse message. runCrawlTask no longer reports it for a failure document (that
    // reports its own error name), and without the raw crawl result a numeric code alone is not read as a crash.
    expect(classifyPrecheck(failed({ errorCode: "1", errorMessage: "HTML table was missing required headers" }))).toEqual({ kind: "completed" });
  });

  it("reads network-class errors, HTTP 5xx and transport failures as errors", () => {
    expect(classifyPrecheck(failed({ errorCode: "ConnectionError", errorMessage: "connection refused" }))).toMatchObject({ kind: "error", reason: "transient failure (ConnectionError): connection refused" });
    expect(classifyPrecheck(failed({ httpStatus: 503, errorCode: "HtmlPageError", errorMessage: "HTML request failed with status 503: unavailable" }))).toMatchObject({ kind: "error", reason: expect.stringContaining("HTTP 503") });
    expect(classifyPrecheck(failed({ errorCode: "HtmlPageError", errorMessage: "HTML request failed: HTTPSConnectionPool(host='www.bidnetdirect.com', port=443): Max retries exceeded" }))).toMatchObject({ kind: "error" });
  });
});

describe("runQueuedPrechecksOnce with the real runSourcePrecheck", () => {
  // runCrawlTask results for each failure mode, pushed through the real summary in source-precheck.ts. A crash that
  // printed no document has the exit status ("1") as its errorCode, exactly as Node's execFile reports it. The rows
  // that carry a failure document show `errorCode: "1"` too: that is what runCrawlTask reported for them before a
  // document's own error name was put ahead of the exit status. It now reports the name (e.g. "BidNetChallengeError"),
  // but classifyPrecheck reads `payload.errorCode` whenever a document is present, so those rows classify the same
  // under either top-level code (checked by running them with the names).
  let testDb: TestDatabase;

  beforeEach(async () => {
    // Spies are created per test (not while the describe is collected), so they never leak into other tests' log assertions.
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined); // a 404 precheck logs its failed tenant probe
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      row("bidnet_a", "bidnet", "2026-09-29T07:00:00.000Z"),
      row("bidnet_b", "bidnet", "2026-09-29T07:01:00.000Z"),
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.restoreAllMocks();
  });

  const failureDocument = (errorCode: string, errorMessage: string): CrawlerJsonRunPayload => ({
    source: "bidnet_a", runId: "run_1", status: "failure", startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 1,
    metadata: {}, bids: [], errorCode, errorMessage, errorStack: null,
  });
  const crawlFailure = (overrides: Partial<CrawlTaskResult>): CrawlTaskResult => ({
    ok: false, source: "bidnet_a", status: "failure", stdout: "", stderr: "", fetchedCount: 0, errorCode: null, payload: null, ...overrides,
  });
  const successDocument = (): CrawlerJsonRunPayload => ({
    ...failureDocument("", ""), status: "success", errorCode: null, errorMessage: null,
    bids: [{ id: "bid_1", source: "bidnet_a", source_bid_id: "1", dedupe_key: "bidnet_a:1", title: "Road work", description: "d", issuer_name: "County", issuer_type: "county", state_code: "MI", source_url: "https://x/1" }],
  });

  // [what happened, the CrawlTaskResult runCrawlTask returns for it, the outcome the queue must record]
  const cases: Array<[string, CrawlTaskResult, "done" | "challenge" | "error"]> = [
    ["the interpreter is missing (ENOENT)", crawlFailure({ errorCode: "ENOENT", stderr: "spawn python3 ENOENT" }), "error"],
    ["the crawler crashes without printing a result (exit code 1)", crawlFailure({ errorCode: "1", stderr: "Traceback (most recent call last): ImportError: No module named requests" }), "error"],
    ["the crawler is killed by the task timeout", crawlFailure({ errorCode: "CrawlerTaskTimeoutError", stderr: "Crawler task timed out after 1800000ms" }), "error"],
    ["the crawler exits 0 with output that is not a result", crawlFailure({ errorCode: "CrawlerOutputError" }), "error"],
    ["the crawler returns no result document under a code nobody has seen before", crawlFailure({ errorCode: "SomethingUnexpected", stderr: "?" }), "error"],
    ["Python reports a transport failure (network down, exit code 1)", crawlFailure({ errorCode: "1", payload: failureDocument("HtmlPageError", "HTML request failed: HTTPSConnectionPool(host='www.bidnetdirect.com', port=443): Max retries exceeded") }), "error"],
    ["Python reports a network-class exception by name (exit code 1)", crawlFailure({ errorCode: "1", payload: failureDocument("ConnectionError", "connection refused") }), "error"],
    ["the portal answers 503", crawlFailure({ errorCode: "1", payload: failureDocument("HtmlPageError", "HTML request failed with status 503: unavailable") }), "error"],
    ["the platform answers with a WAF challenge (202)", crawlFailure({ errorCode: "1", payload: failureDocument("BidNetChallengeError", "BidNet answered with an AWS WAF challenge (status 202)") }), "challenge"],
    ["the platform rate-limits (429)", crawlFailure({ errorCode: "1", payload: failureDocument("HtmlPageError", "HTML request failed with status 429: slow down") }), "challenge"],
    ["the tenant does not exist (404): a verdict about the source", crawlFailure({ errorCode: "1", payload: failureDocument("HtmlPageError", "HTML request failed with status 404: not found") }), "done"],
    ["the list page cannot be parsed: a verdict about the source", crawlFailure({ errorCode: "1", payload: failureDocument("HtmlPageError", "HTML table was missing required headers: ['title']") }), "done"],
    ["the list has no rows and no verified empty state", crawlFailure({ errorCode: "1", payload: failureDocument("EmptyCrawlerResultError", "Crawler returned no opportunities for source: bidnet_a") }), "done"],
    ["the run parsed rows while a detail page logged a 403 to stderr", { ...crawlFailure({}), ok: true, status: "success", errorCode: null, fetchedCount: 1, stderr: "detail fetch failed with status 403", payload: successDocument() }, "done"],
  ];

  it.each(cases)("when %s the queue records %s", async (_what, crawlResult, expected) => {
    const pauses = new PlatformPauseRegistry();
    const runCrawlTask = vi.fn(async () => crawlResult);
    const robotsFetch = vi.fn<typeof fetch>(async () => new Response("User-agent: *\nDisallow: /private/\n", { status: 200 }));

    const result = await runQueuedPrechecksOnce({
      database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses, clock: () => NOW.getTime(), pauseMs: 30 * MINUTE,
      maxPerTick: 1, // only the oldest row, bidnet_a
      runSourcePrecheck: realRunSourcePrecheck, runCrawlTask, robotsFetch, platformDeferral: { minIntervalMs: 0 },
    });

    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({ sourceId: "bidnet_a", outcome: expected });
    const stored = testDb.db.select({ id: dataSources.id, at: dataSources.precheckRequestedAt }).from(dataSources).all();
    expect(Object.fromEntries(stored.map((entry) => [entry.id, entry.at !== null]))).toEqual({ bidnet_a: expected !== "done", bidnet_b: true }); // only a completed precheck clears its flag
    expect(pauses.pausedUntil("bidnet", NOW.getTime()) !== null).toBe(expected === "challenge"); // only a challenge pauses the platform
    expect(result.stoppedFamilies).toEqual(expected === "done" ? [] : ["bidnet"]);
  });

  it("a crashed crawler is the case only the raw crawl result can tell from an ordinary failure document", async () => {
    // The same summary the parse-failure row above gives (errorCode "1", no HTTP status, no challenge): on its own it
    // reads as an ordinary failure, and only the missing payload marks this run as a crash.
    const crash = crawlFailure({ errorCode: "1", stderr: "Traceback" });
    const runCrawlTask = vi.fn(async () => crash);
    const seen: SourcePrecheckResult[] = [];
    const observing = async (options: RunSourcePrecheckOptions) => {
      const precheckResult = await realRunSourcePrecheck(options);
      seen.push(precheckResult);
      return precheckResult;
    };

    const result = await runQueuedPrechecksOnce({
      database: testDb.db, now: NOW, budget: new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS), pauses: new PlatformPauseRegistry(), maxPerTick: 1,
      runSourcePrecheck: observing, runCrawlTask, robotsFetch: vi.fn<typeof fetch>(async () => new Response("", { status: 404 })), platformDeferral: { minIntervalMs: 0 },
    });

    expect(seen[0].fetch).toMatchObject({ status: "failed", errorCode: "1", httpStatus: null, wafChallenge: false });
    expect(classifyPrecheck(seen[0])).toEqual({ kind: "completed" }); // the summary alone cannot tell
    expect(result.processed[0]).toMatchObject({ outcome: "error" }); // the raw crawl result can
    expect(testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).where(eq(dataSources.id, "bidnet_a")).get()?.at).not.toBeNull();
  });
});
