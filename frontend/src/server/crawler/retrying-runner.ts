import { retryResultWithBackoff, type RetryOptions } from "@/lib/resilience/retry";
import { classifyCrawlerFailure, shouldRetry } from "./failure-classifier";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { isPlatformThrottleSignature } from "./platform-deferral";
import { buildCrawlerFailureInput } from "./source-health-outcome";

export type CrawlerRetryOptions = Omit<RetryOptions, "isRetryable"> & {
  /** Stop before backoff when the caller cannot admit another real attempt. */
  canRetry?: () => boolean;
};

/**
 * Retry only structured transient ingestion failures; successful ingestion is terminal.
 *
 * A platform throttle signature (a challenge, or a 403/429/202 answer) is never retried, even though source
 * health reads a 403/429/202 from the HTML fetcher as a network failure: the response to a throttle is the platform
 * pause (the rest of the platform is deferred for this tick and paused afterwards), not hitting the platform again.
 * Other network failures (transport errors, 5xx) keep their retries.
 */
export function retryCrawlerSourceResult(
  run: () => Promise<RunCrawlerSourceOnceResult>,
  options?: CrawlerRetryOptions,
): Promise<RunCrawlerSourceOnceResult>;
export function retryCrawlerSourceResult(
  run: () => Promise<RunCrawlerSourceOnceResult | null>,
  options?: CrawlerRetryOptions,
): Promise<RunCrawlerSourceOnceResult | null>;
export function retryCrawlerSourceResult(
  run: () => Promise<RunCrawlerSourceOnceResult | null>,
  options: CrawlerRetryOptions = {},
): Promise<RunCrawlerSourceOnceResult | null> {
  let attempts = 0;
  let lastResult: RunCrawlerSourceOnceResult | null = null;
  let stopped = false;
  return retryResultWithBackoff(async () => {
    const result = await run();
    // The caller may stop admission after a spacing/backoff wait. No actual attempt
    // occurred: keep the last real result and do not count another attempt or failure.
    if (result === null) {
      stopped = true;
      return lastResult;
    }
    attempts += 1;
    lastResult = result;
    return result;
  }, {
    ...options,
    isOk: (result) => stopped || result?.status !== "failure",
    toError: (result) => result,
    isRetryable: (error) => {
      const result = error as RunCrawlerSourceOnceResult;
      if (result.status !== "failure") return false;
      if (isPlatformThrottleSignature(result)) return false;
      if (!shouldRetry(classifyCrawlerFailure(buildCrawlerFailureInput(result.runner)))) return false;
      // The final attempt never needs another reservation, even when it is transient.
      return attempts >= Math.max(1, options.maxAttempts ?? 3) || (options.canRetry?.() ?? true);
    },
  });
}
