import type { MysqlDataSourcesStore } from "@/server/admin/data-sources-repository";
import { createCachedRobotsFetch, createCrawlerBackedRobotsFetch } from "@/server/admin/crawler-robots-fetch";
import {
  clearPrecheckRequest,
  clearPrecheckRequestFromMysql,
  listQueuedPrechecks,
  listQueuedPrechecksFromMysql,
} from "@/server/admin/precheck-queue";
import {
  runSourcePrecheck as defaultRunSourcePrecheck,
  type RunSourcePrecheckOptions,
  type SourcePrecheckResult,
  type SourcePrecheckVerdict,
} from "@/server/admin/source-precheck";
import type { AppDatabase } from "@/server/db/client";
import { scanSourceCompliance } from "@/server/source-validity/robots-compliance-scan";
import { platformPauseMs, type PlatformPauseRegistry, type PlatformTickBudget } from "./platform-budget";
import { PlatformDeferralTracker, type PlatformDeferralOptions } from "./platform-deferral";

/** robots.txt + one list page. */
export const PRECHECK_BUDGET_COST = 2;
/** The tenant probe a 404 triggers (DISCOVERY_MAX_REQUESTS in source-precheck.ts). */
export const PRECHECK_DISCOVERY_COST = 6;
export const DEFAULT_PRECHECKS_PER_TICK = 50;

export function precheckRequestCost(result: SourcePrecheckResult): number {
  return PRECHECK_BUDGET_COST + (result.fetch.httpStatus === 404 ? PRECHECK_DISCOVERY_COST : 0);
}

export interface QueuedPrecheckOutcome {
  sourceId: string;
  providerFamily: string | null;
  outcome: "done" | "challenge" | "error";
  verdict: SourcePrecheckVerdict | null;
  error: string | null;
}

export interface RunQueuedPrechecksOnceResult {
  queued: number;
  processed: QueuedPrecheckOutcome[];
  skipped: { budget: number; paused: number };
  stoppedFamilies: string[];
}

export interface RunQueuedPrechecksOnceOptions {
  database: AppDatabase;
  mysql?: MysqlDataSourcesStore;
  now?: Date;
  /** The tick's budget, shared with runConfiguredCrawlerSourcesOnce (spec §5.5 priority 2: leftovers). */
  budget: PlatformTickBudget;
  /** The worker's lifetime registry. */
  pauses: PlatformPauseRegistry;
  clock?: () => number;
  pauseMs?: number;
  maxPerTick?: number;
  runSourcePrecheck?: typeof defaultRunSourcePrecheck;
  robotsFetch?: typeof fetch;
  /** Spacing between two prechecks of one platform (CRAWLER_PLATFORM_MIN_INTERVAL_MS); tests pass { minIntervalMs: 0 }. */
  platformDeferral?: PlatformDeferralOptions;
}

/**
 * Spec 2026-09-24 §7.2. Runs queued prechecks oldest-first inside whatever budget the daily lists
 * left. A finished precheck (any verdict) clears the flag; a WAF challenge pauses the platform,
 * leaves the flag and stops that family for this tick; an exception leaves the flag too.
 */
export async function runQueuedPrechecksOnce(options: RunQueuedPrechecksOnceOptions): Promise<RunQueuedPrechecksOnceResult> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? (() => Date.now());
  const pauseMs = options.pauseMs ?? platformPauseMs();
  const runPrecheck = options.runSourcePrecheck ?? defaultRunSourcePrecheck;
  const robotsFetch = createCachedRobotsFetch(options.robotsFetch ?? createCrawlerBackedRobotsFetch());
  const scanCompliance: NonNullable<RunSourcePrecheckOptions["scanCompliance"]> = (inputs, scanOptions) =>
    scanSourceCompliance(inputs, { ...scanOptions, fetchImpl: robotsFetch });
  const limit = options.maxPerTick ?? DEFAULT_PRECHECKS_PER_TICK;
  const spacing = new PlatformDeferralTracker(options.platformDeferral);

  const queued = options.mysql
    ? await listQueuedPrechecksFromMysql(options.mysql, limit)
    : listQueuedPrechecks(options.database, limit);
  const result: RunQueuedPrechecksOnceResult = { queued: queued.length, processed: [], skipped: { budget: 0, paused: 0 }, stoppedFamilies: [] };

  for (const entry of queued) {
    const family = entry.providerFamily;
    if (family && (result.stoppedFamilies.includes(family) || options.pauses.pausedUntil(family, clock()) !== null)) {
      result.skipped.paused += 1;
      continue;
    }
    let reserved = 0;
    if (options.budget.isBudgeted(family)) {
      const granted = options.budget.reserve(family, PRECHECK_BUDGET_COST);
      if (granted === null) {
        result.skipped.budget += 1;
        continue;
      }
      reserved = granted;
    }
    // Same politeness as the crawl loop: never two requests of one platform back to back.
    await spacing.waitForPlatformSlot({ id: entry.id, providerFamily: family });

    try {
      const precheck = await runPrecheck({ database: options.database, mysql: options.mysql, sourceId: entry.id, now, scanCompliance });
      if (options.budget.isBudgeted(family)) options.budget.settle(family, reserved, precheckRequestCost(precheck));

      if (precheck.fetch.wafChallenge) {
        result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "challenge", verdict: precheck.verdict, error: null });
        if (family) {
          options.pauses.pause(family, clock() + pauseMs);
          result.stoppedFamilies.push(family);
        }
        continue;
      }

      const cleared = options.mysql
        ? await clearPrecheckRequestFromMysql(options.mysql, entry.id, entry.precheckRequestedAt)
        : clearPrecheckRequest(options.database, entry.id, entry.precheckRequestedAt);
      result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "done", verdict: precheck.verdict, error: cleared ? null : "re-queued while running" });
    } catch (error) {
      // Nothing is known about what was fetched; charge the reservation and keep the source queued.
      if (options.budget.isBudgeted(family)) options.budget.settle(family, reserved, PRECHECK_BUDGET_COST);
      result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "error", verdict: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  console.info(
    JSON.stringify({
      event: "crawler_precheck_queue_processed",
      queued: result.queued,
      done: result.processed.filter((entry) => entry.outcome === "done").length,
      challenge: result.processed.filter((entry) => entry.outcome === "challenge").length,
      error: result.processed.filter((entry) => entry.outcome === "error").length,
      skippedBudget: result.skipped.budget,
      skippedPaused: result.skipped.paused,
      stoppedFamilies: result.stoppedFamilies,
      robotsFetches: robotsFetch.misses(),
    }),
  );
  return result;
}
