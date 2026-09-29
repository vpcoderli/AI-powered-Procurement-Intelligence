import type { MysqlDataSourcesStore } from "@/server/admin/data-sources-repository";
import { createCachedRobotsFetch, createCrawlerBackedRobotsFetch } from "@/server/admin/crawler-robots-fetch";
import {
  clearPrecheckRequest,
  clearPrecheckRequestFromMysql,
  listQueuedPrechecks,
  listQueuedPrechecksFromMysql,
  type QueuedPrecheck,
} from "@/server/admin/precheck-queue";
import {
  runSourcePrecheck as defaultRunSourcePrecheck,
  type RunSourcePrecheckOptions,
  type SourcePrecheckResult,
  type SourcePrecheckVerdict,
} from "@/server/admin/source-precheck";
import type { AppDatabase } from "@/server/db/client";
import { scanSourceCompliance } from "@/server/source-validity/robots-compliance-scan";
import { classifyCrawlerFailure } from "./failure-classifier";
import { platformPauseMs, type PlatformPauseRegistry, type PlatformTickBudget } from "./platform-budget";
import { PlatformDeferralTracker, type PlatformDeferralOptions } from "./platform-deferral";
import { runCrawlTask as defaultRunCrawlTask, type CrawlTaskResult } from "./state-runner";

/** robots.txt + one list page. */
export const PRECHECK_BUDGET_COST = 2;
/** The tenant probe a 404 triggers (DISCOVERY_MAX_REQUESTS in source-precheck.ts). */
export const PRECHECK_DISCOVERY_COST = 6;
/** Prechecks STARTED per tick. Rows skipped for budget, pause or retry backoff do not count against it. */
export const DEFAULT_PRECHECKS_PER_TICK = 50;
/** Oldest queued rows read per tick: wide enough that a big backlog of one family cannot hide the others. */
export const PRECHECK_LISTING_WINDOW = 500;
/** Consecutive challenged or errored attempts after which a source is given up on (its flag is cleared). */
export const PRECHECK_MAX_ATTEMPTS = 3;

export function precheckRequestCost(result: SourcePrecheckResult): number {
  return PRECHECK_BUDGET_COST + (result.fetch.httpStatus === 404 ? PRECHECK_DISCOVERY_COST : 0);
}

/**
 * Worker-lifetime retry state of queued prechecks that were challenged or errored, kept like the
 * platform pause registry so it outlives a tick. A challenged source keeps its old queue timestamp
 * and would otherwise head the queue again on every tick: the registry backs it off (`notBefore`)
 * so the rest of its family gets its turn, and counts the streak so the worker eventually gives up.
 */
export class PrecheckRetryRegistry {
  private readonly entries = new Map<string, { streak: number; notBefore: number }>();

  /** The time before which the source must not be tried again, or null when it is free to run. */
  notBefore(sourceId: string, nowMs: number): number | null {
    const entry = this.entries.get(sourceId);
    return entry && entry.notBefore > nowMs ? entry.notBefore : null;
  }

  /** Consecutive challenged or errored attempts so far. */
  streak(sourceId: string): number {
    return this.entries.get(sourceId)?.streak ?? 0;
  }

  /** Records a challenged or errored attempt and returns the new streak. */
  recordFailure(sourceId: string, notBeforeMs: number): number {
    const streak = this.streak(sourceId) + 1;
    this.entries.set(sourceId, { streak, notBefore: notBeforeMs });
    return streak;
  }

  /** A completed or abandoned precheck starts the source over. */
  reset(sourceId: string): void {
    this.entries.delete(sourceId);
  }
}

export type PrecheckDisposition =
  | { kind: "completed" }
  | { kind: "challenge"; reason: string }
  | { kind: "error"; reason: string };

/** What runCrawlTask reports when no result document came back at all (state-runner.ts). */
const PROCESS_ERROR_CODES = new Set(["CrawlerTaskTimeoutError", "CrawlerOutputError", "CrawlerProcessError", "CrawlerLeaseLostError"]);
/** Node's own spawn/exec failures: ENOENT, EACCES, EAGAIN, ERR_CHILD_PROCESS_STDIO_MAXBUFFER, ... Never a Python exception name. */
const NODE_ERROR_CODE = /^E[A-Z0-9_]+$/;
const EXIT_CODE = /^\d+$/;
/** public_page.py words a transport failure "HTML request failed: <error>" and an HTTP answer "HTML request failed with status N: ...". */
const TRANSPORT_FAILURE = /\bHTML request failed:/i;

function isProcessLevelCode(code: string | null, allowExitCode: boolean): boolean {
  if (!code) return false;
  return PROCESS_ERROR_CODES.has(code) || NODE_ERROR_CODE.test(code) || (allowExitCode && EXIT_CODE.test(code));
}

function brief(message: string | null): string {
  const text = (message ?? "").replace(/\s+/g, " ").trim();
  return text ? `: ${text.slice(0, 160)}` : "";
}

/**
 * Whether a returned precheck is a finished verdict or a reason to keep the source queued.
 *
 *  - completed: ready / empty, and every `needs_fix` that is evidence about the source itself
 *    (404, parse failure, no rows). The flag is cleared.
 *  - challenge: the platform refused the request (WAF challenge, 403/202) or rate-limited it (429).
 *  - error: the run says nothing about the source (interpreter missing, timeout, crash, no output,
 *    network or 5xx failure); a later attempt may succeed.
 *
 * Only a FAILED dry run can be either: `wafChallenge` is derived from stderr text, so a run that
 * parsed rows must not read as a challenge because a detail page logged a 403.
 *
 * `crawl` is the raw result the crawler subprocess returned, when the caller observed it. The summary
 * in `precheck` keeps only the top-level `errorCode`. `runCrawlTask` reports a failure document's own
 * error name there, and falls back to the exit status ("1") only when the child printed no usable
 * error name: a crash without a result document, or a success document it rewrote because the child
 * then exited non-zero. `crawl` shows that directly (`payload === null`, or a numeric code on the
 * rewritten document). Without it only codes that cannot be Python names count as process-level, so a
 * bare exit status is not read as a crash.
 */
export function classifyPrecheck(precheck: SourcePrecheckResult, crawl: CrawlTaskResult | null = null): PrecheckDisposition {
  const fetched = precheck.fetch;
  if (fetched.status !== "failed") return { kind: "completed" };

  if (fetched.wafChallenge || fetched.httpStatus === 429) {
    const reason = fetched.httpStatus === 429 ? "rate limited (HTTP 429)" : `platform challenge${fetched.httpStatus ? ` (HTTP ${fetched.httpStatus})` : ""}`;
    return { kind: "challenge", reason };
  }

  // When Python printed a failure document its own error name and message are the ones to classify.
  const payload = crawl?.payload ?? null;
  const code = payload ? payload.errorCode ?? null : fetched.errorCode;
  const message = payload ? payload.errorMessage ?? null : fetched.errorMessage;

  // No result document (ENOENT, timeout, crash, unparsable output), or a success document that
  // runCrawlTask rewrote because the child then exited non-zero (numeric code).
  const noResult = crawl ? payload === null || isProcessLevelCode(code, true) : isProcessLevelCode(code, false);
  if (noResult) return { kind: "error", reason: `crawler process failed${code ? ` (${code})` : ""}${brief(message)}` };

  const status = fetched.httpStatus;
  const serverError = status !== null && status >= 500 && status < 600;
  if (serverError || classifyCrawlerFailure({ errorCode: code, errorMessage: message }) === "network" || TRANSPORT_FAILURE.test(message ?? "")) {
    return { kind: "error", reason: `transient failure${serverError ? ` (HTTP ${status})` : code ? ` (${code})` : ""}${brief(message)}` };
  }
  return { kind: "completed" };
}

export interface QueuedPrecheckOutcome {
  sourceId: string;
  providerFamily: string | null;
  /** `abandoned`: challenged or errored PRECHECK_MAX_ATTEMPTS times in a row, so the flag was cleared. */
  outcome: "done" | "challenge" | "error" | "abandoned";
  verdict: SourcePrecheckVerdict | null;
  error: string | null;
}

export interface RunQueuedPrechecksOnceResult {
  /** Rows read from the queue this tick (at most PRECHECK_LISTING_WINDOW), not the prechecks started. */
  queued: number;
  /** One entry per precheck actually started. */
  processed: QueuedPrecheckOutcome[];
  /** `paused` also covers a family stopped earlier in this tick; `retry` is a source still backing off. */
  skipped: { budget: number; paused: number; retry: number };
  /** Families that stopped early this tick after a challenge or an error. */
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
  /** The worker's lifetime retry state; default: fresh per call, i.e. no backoff across calls. */
  retries?: PrecheckRetryRegistry;
  clock?: () => number;
  pauseMs?: number;
  /** Prechecks started per tick (default DEFAULT_PRECHECKS_PER_TICK); skipped rows are free. */
  maxPerTick?: number;
  runSourcePrecheck?: typeof defaultRunSourcePrecheck;
  /** The crawler subprocess behind each precheck; injected by tests so nothing spawns Python. */
  runCrawlTask?: typeof defaultRunCrawlTask;
  robotsFetch?: typeof fetch;
  /** Spacing between two prechecks of one platform (CRAWLER_PLATFORM_MIN_INTERVAL_MS); tests pass { minIntervalMs: 0 }. */
  platformDeferral?: PlatformDeferralOptions;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Spec 2026-09-24 §7.2. Runs queued prechecks oldest-first inside whatever budget the daily lists
 * left. A completed precheck (any verdict about the source) clears the flag. A challenge or an
 * error (see classifyPrecheck; a thrown precheck counts as one) leaves the flag, backs the source
 * off for `pauseMs`, stops its family for the rest of the tick, and after PRECHECK_MAX_ATTEMPTS in
 * a row gives the source up: `runSourcePrecheck` has already written `needs_fix` and the reason,
 * so the flag is cleared and the outcome is `abandoned`. Only a challenge also pauses the shared
 * platform registry, which the daily crawl reads too.
 */
export async function runQueuedPrechecksOnce(options: RunQueuedPrechecksOnceOptions): Promise<RunQueuedPrechecksOnceResult> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? (() => Date.now());
  const pauseMs = options.pauseMs ?? platformPauseMs();
  const runPrecheck = options.runSourcePrecheck ?? defaultRunSourcePrecheck;
  const crawl = options.runCrawlTask ?? defaultRunCrawlTask;
  const retries = options.retries ?? new PrecheckRetryRegistry();
  const robotsFetch = createCachedRobotsFetch(options.robotsFetch ?? createCrawlerBackedRobotsFetch());
  const scanCompliance: NonNullable<RunSourcePrecheckOptions["scanCompliance"]> = (inputs, scanOptions) =>
    scanSourceCompliance(inputs, { ...scanOptions, fetchImpl: robotsFetch });
  const maxStarted = options.maxPerTick ?? DEFAULT_PRECHECKS_PER_TICK;
  const spacing = new PlatformDeferralTracker(options.platformDeferral);

  const queued = options.mysql
    ? await listQueuedPrechecksFromMysql(options.mysql, PRECHECK_LISTING_WINDOW)
    : listQueuedPrechecks(options.database, PRECHECK_LISTING_WINDOW);
  const result: RunQueuedPrechecksOnceResult = { queued: queued.length, processed: [], skipped: { budget: 0, paused: 0, retry: 0 }, stoppedFamilies: [] };

  const clearFlag = async (entry: QueuedPrecheck): Promise<boolean> =>
    options.mysql
      ? clearPrecheckRequestFromMysql(options.mysql, entry.id, entry.precheckRequestedAt)
      : clearPrecheckRequest(options.database, entry.id, entry.precheckRequestedAt);

  const stopFamily = (family: string | null) => {
    if (family && !result.stoppedFamilies.includes(family)) result.stoppedFamilies.push(family);
  };

  /** One challenged or errored attempt: back the source off, stop its family, maybe give up. Never throws. */
  const failAttempt = async (entry: QueuedPrecheck, kind: "challenge" | "error", verdict: SourcePrecheckVerdict | null, reason: string): Promise<void> => {
    const family = entry.providerFamily;
    if (kind === "challenge" && family) options.pauses.pause(family, clock() + pauseMs);
    stopFamily(family);
    const attempts = retries.recordFailure(entry.id, clock() + pauseMs);
    if (attempts < PRECHECK_MAX_ATTEMPTS) {
      result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: kind, verdict, error: kind === "error" ? reason : null });
      return;
    }
    try {
      const cleared = await clearFlag(entry);
      retries.reset(entry.id);
      result.processed.push({
        sourceId: entry.id,
        providerFamily: family,
        outcome: "abandoned",
        verdict,
        error: `gave up after ${attempts} attempts: ${reason}${cleared ? "" : " (a newer request is still queued)"}`,
      });
      console.warn(JSON.stringify({ event: "crawler_precheck_abandoned", source: entry.id, family, attempts, lastOutcome: kind, reason }));
    } catch (error) {
      // The flag stays; the streak stays at the limit, so the next failed attempt tries to give up again.
      result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "error", verdict, error: `could not give up after ${attempts} attempts: ${errorMessage(error)}` });
    }
  };

  let started = 0;
  for (const entry of queued) {
    // maxPerTick counts prechecks actually started; the skips below are free, so a big backlog of
    // one family cannot use up the slots that another family's sources could have had.
    if (started >= maxStarted) break;
    const family = entry.providerFamily;
    if (family && (result.stoppedFamilies.includes(family) || options.pauses.pausedUntil(family, clock()) !== null)) {
      result.skipped.paused += 1;
      continue;
    }
    // A source that was challenged or errored waits out its own backoff, so the rest of its family gets its turn.
    if (retries.notBefore(entry.id, clock()) !== null) {
      result.skipped.retry += 1;
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
    started += 1;

    // runSourcePrecheck keeps only a summary of its crawl, and that summary cannot tell a crash from
    // an ordinary failure document; keep the raw result for classifyPrecheck.
    const observed: { crawl: CrawlTaskResult | null } = { crawl: null };
    let settled = false;
    try {
      const precheck = await runPrecheck({
        database: options.database,
        mysql: options.mysql,
        sourceId: entry.id,
        now,
        scanCompliance,
        runCrawlTask: async (source, taskOptions, context) => {
          observed.crawl = await crawl(source, taskOptions, context);
          return observed.crawl;
        },
      });
      if (options.budget.isBudgeted(family)) {
        options.budget.settle(family, reserved, precheckRequestCost(precheck));
        settled = true;
      }

      const disposition = classifyPrecheck(precheck, observed.crawl);
      if (disposition.kind !== "completed") {
        await failAttempt(entry, disposition.kind, precheck.verdict, disposition.reason);
        continue;
      }

      const cleared = await clearFlag(entry);
      retries.reset(entry.id);
      result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "done", verdict: precheck.verdict, error: cleared ? null : "re-queued while running" });
    } catch (error) {
      // Nothing is known about what was fetched; charge the reservation (unless the precheck itself
      // already settled it and only the flag clear failed) and keep the source queued.
      if (options.budget.isBudgeted(family) && !settled) options.budget.settle(family, reserved, PRECHECK_BUDGET_COST);
      await failAttempt(entry, "error", null, errorMessage(error));
    }
  }

  const count = (outcome: QueuedPrecheckOutcome["outcome"]) => result.processed.filter((entry) => entry.outcome === outcome).length;
  console.info(
    JSON.stringify({
      event: "crawler_precheck_queue_processed",
      queued: result.queued,
      done: count("done"),
      challenge: count("challenge"),
      error: count("error"),
      abandoned: count("abandoned"),
      skippedBudget: result.skipped.budget,
      skippedPaused: result.skipped.paused,
      skippedRetry: result.skipped.retry,
      stoppedFamilies: result.stoppedFamilies,
      robotsFetches: robotsFetch.misses(),
    }),
  );
  return result;
}
