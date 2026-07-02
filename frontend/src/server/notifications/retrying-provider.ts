import { emitWorkerFailureAlert, type WorkerName } from "@/lib/resilience/failure-alerts";
import { retryResultWithBackoff, type RetryOptions } from "@/lib/resilience/retry";
import type { NotificationProvider, NotificationSendPayload, NotificationSendResult } from "./types";

export interface RetryingNotificationProviderOptions {
  /** Which worker is delivering through this provider, for failure-alert context. */
  worker: WorkerName;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: RetryOptions["isRetryable"];
  sleep?: RetryOptions["sleep"];
  random?: RetryOptions["random"];
}

function providerSendError(result: NotificationSendResult) {
  return result.ok ? new Error("unreachable") : new Error(result.error);
}

/**
 * Wraps a `NotificationProvider` so each `send()` call is retried with exponential backoff
 * before returning a final `ok`/`ok:false` result to the caller. This intentionally wraps
 * only the single `send()` invocation for one notification — the caller (`deliverPendingNotifications`
 * / `deliverPendingNotificationsFromMysql` / `sendMatchedAlertNotifications*`) still records
 * exactly one outcome (and increments `notification_outbox.attempt_count` by exactly one)
 * per delivery attempt for that tick, same as before this wrapper existed. That keeps the
 * durable, cross-tick retry semantics already implemented via `attempt_count` /
 * `NOTIFICATION_WORKER_MAX_ATTEMPTS` intact — this wrapper only adds fast, in-process
 * retries for transient failures (e.g. a single dropped connection) within one attempt,
 * so a blip doesn't burn one of the notification's limited cross-tick attempts.
 *
 * When all in-process retries are exhausted, emits a structured failure alert (see
 * `@/lib/resilience/failure-alerts`) before returning the failed result to the caller,
 * which then proceeds with its existing `markNotificationFailed` bookkeeping unchanged.
 */
export function createRetryingNotificationProvider(
  provider: NotificationProvider,
  options: RetryingNotificationProviderOptions,
): NotificationProvider {
  return {
    async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
      const maxAttempts = options.maxAttempts ?? 3;
      let attemptsMade = 0;

      const result = await retryResultWithBackoff<NotificationSendResult>(
        () => provider.send(payload),
        {
          maxAttempts,
          baseDelayMs: options.baseDelayMs,
          maxDelayMs: options.maxDelayMs,
          isRetryable: options.isRetryable,
          sleep: options.sleep,
          random: options.random,
          isOk: (attemptResult) => attemptResult.ok,
          toError: providerSendError,
          onAttemptFailure: (info) => {
            attemptsMade = info.attempt;
          },
        },
      );

      if (!result.ok) {
        emitWorkerFailureAlert({
          worker: options.worker,
          reason: "notification_send_retries_exhausted",
          itemId: payload.id,
          // `attemptsMade` reflects the actual number of send attempts made — this is 1 when
          // `isRetryable` rejected the first failure outright, not the configured `maxAttempts`.
          attempts: attemptsMade || maxAttempts,
          error: result.error,
          context: { recipient: payload.recipient, dedupeKey: payload.dedupeKey, channel: payload.channel },
        });
      }

      return result;
    },
  };
}
