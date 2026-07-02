/**
 * Structured failure-alert emission for worker retry exhaustion.
 *
 * This is intentionally NOT a real alert-channel integration (no Slack/PagerDuty/webhook
 * call here). It standardizes the *shape* of the log line emitted when a worker gives up
 * retrying an item (or an entire tick), so that shape can be reliably matched by a log
 * pipeline/alert rule later and wired to a real alert channel. Wiring an actual paging
 * integration is a human follow-up — see docs/product-requirements/apsi-p0-p1-execution-plan.md
 * (P1-3) and the note in docs/transferability/environment-variables.md.
 *
 * This module deliberately uses the same `console.error(JSON.stringify(...))` pattern the
 * three worker scripts already use for their run-summary logs (this branch's base does not
 * have a shared structured logger yet). A separate, parallel P0-3 observability task adds
 * `frontend/src/lib/observability/logger.ts` (structured logger + Sentry forwarding) on
 * branch `codex/p0-3-observability`, not merged into this branch's base at the time this
 * was written. NOTE for whoever merges the two branches: once `@/lib/observability/logger`
 * is available here, `emitWorkerFailureAlert` below is the single call site to swap over to
 * `logger.child({ service: "worker:<name>" }).error(...)` so failure alerts also get
 * Sentry forwarding — the `StructuredFailureAlert` shape here was kept close to that
 * logger's `StructuredLogEntry` shape (timestamp/level/message-ish fields) specifically to
 * make that swap mechanical.
 */

export type WorkerName = "crawler-worker" | "event-worker" | "notification-worker";

export interface WorkerFailureAlertInput {
  /** Which worker script raised this alert. */
  worker: WorkerName;
  /** Short machine-readable reason code, e.g. "retries_exhausted", "tick_failed". */
  reason: string;
  /** Identifier of the item that failed (source name, notification id, outbox row id, ...). */
  itemId?: string | null;
  /** Number of attempts made before giving up. */
  attempts: number;
  /** The last error observed. */
  error: unknown;
  /** Arbitrary extra context (owner, destination, channel, etc.). */
  context?: Record<string, unknown>;
}

export interface StructuredFailureAlert {
  timestamp: string;
  level: "error";
  alert: true;
  worker: WorkerName;
  reason: string;
  itemId: string | null;
  attempts: number;
  errorMessage: string;
  errorName?: string;
  errorStack?: string;
  [key: string]: unknown;
}

function errorFields(error: unknown): { errorMessage: string; errorName?: string; errorStack?: string } {
  if (error instanceof Error) {
    return { errorMessage: error.message, errorName: error.name, errorStack: error.stack };
  }
  return { errorMessage: typeof error === "string" ? error : JSON.stringify(error ?? null) };
}

function buildAlertEntry(input: WorkerFailureAlertInput): StructuredFailureAlert {
  return {
    timestamp: new Date().toISOString(),
    level: "error",
    alert: true,
    worker: input.worker,
    reason: input.reason,
    itemId: input.itemId ?? null,
    attempts: input.attempts,
    ...errorFields(input.error),
    ...(input.context ?? {}),
  };
}

/**
 * Emits a structured failure-exhausted alert log line. Never throws — alerting must not
 * crash the worker tick that triggered it. This is the single call site a future
 * Slack/PagerDuty/webhook integration should hook into (e.g. by replacing/augmenting the
 * sink below), so it is kept small and side-effect-isolated on purpose.
 */
export function emitWorkerFailureAlert(input: WorkerFailureAlertInput): void {
  const entry = buildAlertEntry(input);

  try {
    // See module doc comment above: this is the call site to swap to the shared
    // structured logger (`@/lib/observability/logger`) once the P0-3 branch is merged.
    console.error(JSON.stringify(entry));
  } catch {
    // Last-resort: never let alert emission itself throw.
  }
}
