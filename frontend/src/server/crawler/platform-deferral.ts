/**
 * Contract C7 — platform-level deferral.
 *
 * Every source hosted on a shared platform (`provider_family`, e.g. BidNet Direct) shares one
 * WAF/rate-limit budget. When one of them answers with a challenge/throttle signature, hitting
 * the rest of that family in the same tick reliably turns a single 403 into a batch of them
 * (observed 2026-08-21: all ten BidNet county sources blocked within a minute). So the first
 * throttle signature defers the family's remaining not-yet-run sources: they are reported as
 * `status: "deferred"` without ever being contacted — which is not a source failure, gets no
 * health write-back and is never retried by the worker.
 *
 * Independently of that, two sources of the same family are spaced by at least
 * `CRAWLER_PLATFORM_MIN_INTERVAL_MS` (default 5000 ms).
 */

import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { buildCrawlerFailureInput } from "./source-health-outcome";

export const DEFAULT_PLATFORM_MIN_INTERVAL_MS = 5_000;

export function platformMinIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CRAWLER_PLATFORM_MIN_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_PLATFORM_MIN_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_PLATFORM_MIN_INTERVAL_MS;
  return value;
}

/**
 * A status token in the Python error message: `status 403`, `HTTP 429`, `status_code=202` — a
 * status-ish word, up to 4 non-word characters, then a 3-digit code. Deliberately requires the word
 * so an id or byte count that happens to contain 403 never reads as a status.
 *
 * Only the FIRST status token in the message decides, because the crawler's own status always
 * precedes any quoted body: an `HtmlPageError` status message is
 * `HTML request failed with status <code>: <response body>` (crawler/apsi_crawler/html/public_page.py),
 * and the errorMessage checked here carries the run's stderr after that message. A 404 or 5xx body
 * that mentions "code 403" or "HTTP 202" therefore never pauses the whole platform.
 */
const STATUS_TOKEN_PATTERN = /\b(?:status|http|code)\w*\W{0,4}(\d{3})\b/i;
const THROTTLE_STATUSES: ReadonlySet<string> = new Set(["403", "429", "202"]);

function isThrottleErrorCode(errorCode: string | null) {
  if (!errorCode) return false;
  // BidNetChallengeError today; any future `<Platform>ChallengeError` means the same thing.
  return errorCode === "BidNetChallengeError" || /ChallengeError$/.test(errorCode);
}

/** isPlatformThrottleSignature's check for a failed run's error code and message — a crawler_logs row stores both. */
export function isThrottleFailure(input: { errorCode: string | null; errorMessage: string | null }): boolean {
  if (isThrottleErrorCode(input.errorCode)) return true;
  if (input.errorCode !== "HtmlPageError") return false;
  // No `g` flag: `exec` returns the first (leftmost) status token only.
  const firstStatus = STATUS_TOKEN_PATTERN.exec(input.errorMessage ?? "")?.[1];
  return firstStatus !== undefined && THROTTLE_STATUSES.has(firstStatus);
}

/**
 * True when a finished source run carries a platform challenge/throttle signature, i.e. the
 * platform (not this source's own page) refused the request.
 */
export function isPlatformThrottleSignature(result: RunCrawlerSourceOnceResult): boolean {
  if (result.status !== "failure") return false;
  const input = buildCrawlerFailureInput(result.runner);
  return isThrottleFailure({ errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null });
}

export function platformDeferredResult(sourceId: string, throttledBy: string): RunCrawlerSourceOnceResult {
  return {
    ok: false,
    source: sourceId,
    status: "deferred",
    reason: `platform_throttled:${throttledBy}`,
  };
}

export interface PlatformDeferralOptions {
  minIntervalMs?: number;
  /** Injected in tests so a tick never actually waits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface PlatformSource {
  id: string;
  providerFamily: string | null;
}

// Deliberately a ref'd timer. The batch awaits this wait, and an unref'd timer with no other handle alive
// never resumes it: Node just exits 0 in the middle of the run. `npm run crawler:once` passes no sleep and,
// on SQLite, has no socket or child process open between two sources of one platform, so it would end
// silently during the spacing wait. The wait is bounded by the spacing window (default 5 s), so keeping the
// process alive for it is harmless inside a long-lived server too.
function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-tick state: which platforms are throttled, and when each was last contacted. One instance
 * per batch — never shared across ticks, so a deferral never outlives the run that observed it.
 */
export class PlatformDeferralTracker {
  private readonly throttledFamilies = new Map<string, string>();
  private readonly lastContactedAt = new Map<string, number>();
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: PlatformDeferralOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? platformMinIntervalMs();
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
  }

  /** The already-throttled source id that defers this source, or null when it may run. */
  deferredBy(source: PlatformSource): string | null {
    if (!source.providerFamily) return null;
    return this.throttledFamilies.get(source.providerFamily) ?? null;
  }

  /** Space two runs of the same platform by at least the configured minimum interval. */
  async waitForPlatformSlot(source: PlatformSource): Promise<void> {
    if (!source.providerFamily || this.minIntervalMs <= 0) return;
    const last = this.lastContactedAt.get(source.providerFamily);
    if (last !== undefined) {
      const elapsed = this.now() - last;
      if (elapsed < this.minIntervalMs) {
        await this.sleep(this.minIntervalMs - elapsed);
      }
    }
    this.lastContactedAt.set(source.providerFamily, this.now());
  }

  /** Record a finished run; a throttle signature defers the rest of that platform's sources. */
  observe(source: PlatformSource, result: RunCrawlerSourceOnceResult): void {
    if (!source.providerFamily) return;
    if (this.throttledFamilies.has(source.providerFamily)) return;
    if (isPlatformThrottleSignature(result)) {
      this.throttledFamilies.set(source.providerFamily, source.id);
    }
  }
}
