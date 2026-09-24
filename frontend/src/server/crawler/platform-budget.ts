/**
 * Per-platform request budget (spec 2026-09-24 §5.5). A shared platform (BidNet) sees every
 * tenant run as traffic from one client, so the worker spends an hourly request budget per
 * `provider_family` instead of a fixed number of sources per tick, and pauses a platform after
 * a throttle signature. Never bypasses anything: it only decides when we ask again.
 */

import type { RunCrawlerSourceOnceResult } from "./orchestrator";

export const DEFAULT_PLATFORM_BUDGETS: Readonly<Record<string, number>> = { bidnet: 60 };
export const DEFAULT_PLATFORM_PAUSE_MS = 30 * 60 * 1000;
export const DEFAULT_TICK_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** `CRAWLER_PLATFORM_BUDGETS=bidnet=60,bonfire=30,foo=unlimited` over the defaults; null = unlimited. */
export function platformBudgetsFromEnv(env: Record<string, string | undefined> = process.env): Map<string, number | null> {
  const budgets = new Map<string, number | null>(Object.entries(DEFAULT_PLATFORM_BUDGETS));
  for (const entry of (env.CRAWLER_PLATFORM_BUDGETS ?? "").split(",")) {
    const [family = "", value = ""] = entry.split("=").map((part) => part.trim());
    if (!family || !value) continue;
    if (value.toLowerCase() === "unlimited") {
      budgets.set(family, null);
      continue;
    }
    const perHour = Number(value);
    if (Number.isInteger(perHour) && perHour > 0) budgets.set(family, perHour);
  }
  return budgets;
}

export function platformPauseMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CRAWLER_PLATFORM_PAUSE_MS?.trim();
  const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : DEFAULT_PLATFORM_PAUSE_MS;
}

/** One tick's share of each budgeted platform's hourly request budget. */
export class PlatformTickBudget {
  private readonly allowance = new Map<string, number>();
  private readonly remainingByFamily = new Map<string, number>();

  constructor(budgets: Map<string, number | null>, tickMs: number) {
    for (const [family, perHour] of budgets) {
      if (perHour === null) continue;
      const share = Math.max(1, Math.floor((perHour * tickMs) / HOUR_MS));
      this.allowance.set(family, share);
      this.remainingByFamily.set(family, share);
    }
  }

  budgetedFamilies(): Set<string> {
    return new Set(this.allowance.keys());
  }

  isBudgeted(family: string | null): family is string {
    return family !== null && this.allowance.has(family);
  }

  /** Reserve up to `cost` requests (never more than a whole tick); null = wait for the next tick. */
  reserve(family: string, cost: number): number | null {
    const remaining = this.remainingByFamily.get(family);
    if (remaining === undefined) return cost;
    const needed = Math.min(cost, this.allowance.get(family)!);
    if (remaining < needed) return null;
    this.remainingByFamily.set(family, remaining - needed);
    return needed;
  }

  /** Refund what a run did not use, or charge what it used beyond its reservation. */
  settle(family: string, reserved: number, actual: number): void {
    const remaining = this.remainingByFamily.get(family);
    if (remaining === undefined) return;
    this.remainingByFamily.set(family, Math.max(0, remaining + reserved - actual));
  }
}

/** Platform pauses outlive a tick: the worker keeps one registry for its whole lifetime. */
export class PlatformPauseRegistry {
  private readonly until = new Map<string, number>();

  pause(family: string, untilMs: number): void {
    this.until.set(family, Math.max(untilMs, this.until.get(family) ?? 0));
  }

  pausedUntil(family: string | null, nowMs: number): number | null {
    if (!family) return null;
    const until = this.until.get(family);
    if (until === undefined) return null;
    if (until <= nowMs) {
      this.until.delete(family);
      return null;
    }
    return until;
  }
}

/** `metadata.pagination.requests_made` of a finished run, or null when the run did not report it. */
export function requestsMadeOf(result: RunCrawlerSourceOnceResult): number | null {
  if (result.status !== "success" && result.status !== "failure") return null;
  const metadata = result.runner?.payload?.metadata;
  const pagination = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).pagination : null;
  if (!pagination || typeof pagination !== "object") return null;
  const value = Number((pagination as Record<string, unknown>).requests_made);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
