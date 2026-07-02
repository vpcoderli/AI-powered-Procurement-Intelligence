import { emitWorkerFailureAlert, type WorkerName } from "@/lib/resilience/failure-alerts";
import { retryResultWithBackoff, type RetryOptions } from "@/lib/resilience/retry";
import type { EventOutboxHandler, EventOutboxRow } from "./event-log";

export interface RetryingEventOutboxHandlerOptions {
  /** Which worker is delivering through this handler, for failure-alert context. */
  worker: WorkerName;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: RetryOptions["isRetryable"];
  sleep?: RetryOptions["sleep"];
  random?: RetryOptions["random"];
}

function handlerError(result: Awaited<ReturnType<EventOutboxHandler>>) {
  return result.ok ? new Error("unreachable") : new Error(result.error);
}

/**
 * Wraps an `EventOutboxHandler` so each row's delivery attempt is retried in-process with
 * exponential backoff before `deliverPendingEventOutboxRows` / `...FromMysql` record the
 * final outcome for that tick. Like `createRetryingNotificationProvider`, this wraps only
 * the single `handler(row)` invocation for one row per tick — the caller still increments
 * `event_outbox.attempt_count` by exactly one per tick regardless of how many in-process
 * attempts happened here, preserving the existing durable cross-tick retry semantics
 * (governed by `EVENT_WORKER_MAX_ATTEMPTS` / `listDeliverableEventOutboxRows`'s
 * `attempt_count < maxAttempts` filter).
 *
 * When in-process retries are exhausted for a row, emits a structured failure alert before
 * returning the failed result, so the caller's existing `markNotificationFailed`-equivalent
 * bookkeeping (`UPDATE event_outbox SET status = 'failed', attempt_count = attempt_count + 1 ...`)
 * proceeds unchanged.
 */
export function createRetryingEventOutboxHandler(
  handler: EventOutboxHandler,
  options: RetryingEventOutboxHandlerOptions,
): EventOutboxHandler {
  return async (row: EventOutboxRow) => {
    const maxAttempts = options.maxAttempts ?? 3;
    let attemptsMade = 0;

    const result = await retryResultWithBackoff<Awaited<ReturnType<EventOutboxHandler>>>(
      () => handler(row),
      {
        maxAttempts,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        isRetryable: options.isRetryable,
        sleep: options.sleep,
        random: options.random,
        isOk: (attemptResult) => attemptResult.ok,
        toError: handlerError,
        onAttemptFailure: (info) => {
          attemptsMade = info.attempt;
        },
      },
    );

    if (!result.ok) {
      emitWorkerFailureAlert({
        worker: options.worker,
        reason: "event_outbox_delivery_retries_exhausted",
        itemId: row.id,
        // `attemptsMade` reflects the actual number of handler attempts made — this is 1
        // when `isRetryable` rejected the first failure outright, not the configured
        // `maxAttempts`.
        attempts: attemptsMade || maxAttempts,
        error: result.error,
        context: { eventLogId: row.eventLogId, destination: row.destination },
      });
    }

    return result;
  };
}
