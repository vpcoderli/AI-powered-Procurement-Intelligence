import { retryResultWithBackoff, type RetryOptions } from "@/lib/resilience/retry";
import { classifyCrawlerFailure, shouldRetry } from "./failure-classifier";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { buildCrawlerFailureInput } from "./source-health-outcome";

/** Retry only structured transient ingestion failures; successful ingestion is terminal. */
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
      return result.status === "failure" && shouldRetry(classifyCrawlerFailure(buildCrawlerFailureInput(result.runner)));
    },
  });
}
