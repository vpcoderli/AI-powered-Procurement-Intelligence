import { retryResultWithBackoff, type RetryOptions } from "@/lib/resilience/retry";
import { classifyCrawlerFailure, shouldRetry } from "./failure-classifier";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { isPlatformThrottleSignature } from "./platform-deferral";
import { buildCrawlerFailureInput } from "./source-health-outcome";

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
  options: Omit<RetryOptions, "isRetryable"> = {},
): Promise<RunCrawlerSourceOnceResult> {
  return retryResultWithBackoff(run, {
    ...options,
    isOk: (result) => result.status !== "failure",
    toError: (result) => result,
    isRetryable: (error) => {
      const result = error as RunCrawlerSourceOnceResult;
      if (result.status !== "failure") return false;
      if (isPlatformThrottleSignature(result)) return false;
      return shouldRetry(classifyCrawlerFailure(buildCrawlerFailureInput(result.runner)));
    },
  });
}
