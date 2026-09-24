import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_PAUSE_MS,
  PlatformPauseRegistry,
  PlatformTickBudget,
  platformBudgetsFromEnv,
  platformPauseMs,
  requestsMadeOf,
} from "./platform-budget";

const HOUR = 60 * 60 * 1000;

describe("platformBudgetsFromEnv", () => {
  it("defaults BidNet to 60 requests an hour and layers the environment on top", () => {
    expect(platformBudgetsFromEnv({})).toEqual(new Map([["bidnet", 60]]));
    expect(platformBudgetsFromEnv({ CRAWLER_PLATFORM_BUDGETS: "bidnet=30, bonfire=unlimited, bad=x, =5" }))
      .toEqual(new Map<string, number | null>([["bidnet", 30], ["bonfire", null]]));
  });
});

describe("platformPauseMs", () => {
  it("reads a non-negative override and otherwise pauses 30 minutes", () => {
    expect(platformPauseMs({})).toBe(DEFAULT_PLATFORM_PAUSE_MS);
    expect(platformPauseMs({ CRAWLER_PLATFORM_PAUSE_MS: "60000" })).toBe(60_000);
    expect(platformPauseMs({ CRAWLER_PLATFORM_PAUSE_MS: "-1" })).toBe(DEFAULT_PLATFORM_PAUSE_MS);
  });
});

describe("PlatformTickBudget", () => {
  it("gives each tick its share of the hourly budget, at least one request", () => {
    const budget = new PlatformTickBudget(new Map([["bidnet", 60], ["tiny", 1], ["free", null]]), 15 * 60 * 1000);
    expect(budget.budgetedFamilies()).toEqual(new Set(["bidnet", "tiny"]));
    expect(budget.reserve("bidnet", 15)).toBe(15);
    expect(budget.reserve("bidnet", 1)).toBeNull();
    expect(budget.reserve("tiny", 4)).toBe(1);
    expect(budget.isBudgeted("free")).toBe(false);
    expect(budget.reserve("free", 99)).toBe(99);
  });

  it("refunds what a run did not use and charges what it used beyond the reservation", () => {
    const budget = new PlatformTickBudget(new Map([["bidnet", 8]]), HOUR);
    const reserved = budget.reserve("bidnet", 4)!;
    budget.settle("bidnet", reserved, 1);
    expect(budget.reserve("bidnet", 7)).toBe(7);
    budget.settle("bidnet", 7, 9);
    expect(budget.reserve("bidnet", 1)).toBeNull();
  });
});

describe("PlatformPauseRegistry", () => {
  it("pauses a platform until the given time", () => {
    const pauses = new PlatformPauseRegistry();
    pauses.pause("bidnet", 1_000);
    expect(pauses.pausedUntil("bidnet", 999)).toBe(1_000);
    expect(pauses.pausedUntil("bidnet", 1_000)).toBeNull();
    expect(pauses.pausedUntil(null, 0)).toBeNull();
  });
});

describe("requestsMadeOf", () => {
  it("reads metadata.pagination.requests_made from a finished run", () => {
    const runner = (metadata: unknown) => ({ ok: true, source: "s", status: "success", stdout: "", stderr: "", payload: { metadata } });
    expect(requestsMadeOf({ ok: true, source: "s", status: "success", runner: runner({ pagination: { requests_made: 2 } }) } as never)).toBe(2);
    expect(requestsMadeOf({ ok: true, source: "s", status: "success", runner: runner({}) } as never)).toBeNull();
    expect(requestsMadeOf({ ok: false, source: "s", status: "deferred", reason: "x" } as never)).toBeNull();
  });
});
