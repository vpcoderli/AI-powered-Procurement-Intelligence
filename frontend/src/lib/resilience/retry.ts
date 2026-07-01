/**
 * Shared exponential-backoff retry utility for the three long-running worker scripts
 * (`frontend/scripts/crawler-worker.ts`, `event-worker.ts`, `notification-worker.ts`) and
 * any other code that calls a flaky, I/O-bound operation (subprocess invocation, HTTP
 * notification provider, outbound webhook/adapter call, etc.).
 *
 * Design notes:
 * - Retries happen **within a single call site**, before the caller's own durable
 *   bookkeeping (crawler lock release, `notification_outbox.attempt_count`,
 *   `event_outbox.attempt_count`) records the final outcome for that tick. This utility
 *   does not know about — and must never duplicate — that bookkeeping; it only decides
 *   whether to re-invoke `fn` again in-process before giving up and letting the caller
 *   record one terminal success/failure per tick. This preserves the existing
 *   idempotency/dedupe guarantees (`crawlerLocks`, `notification_outbox.dedupeKey`,
 *   `event_outbox` attempt tracking) because those are untouched by this module — it only
 *   changes how many times the underlying side-effecting call is attempted before the
 *   caller's single record-the-outcome step runs.
 * - `isRetryable` lets callers distinguish transient failures (network/timeout/5xx) from
 *   permanent ones (validation errors, 4xx, disabled/blocked sources) so we don't waste
 *   attempts (or worse, retry something that will never succeed and delay alerting).
 * - Jitter is "full jitter" (`random(0, backoff)`) per the AWS backoff-and-jitter guidance,
 *   to avoid synchronized retry storms across worker instances.
 * - `sleep` is injectable so tests can run with zero real delay.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Must be >= 1. Default 3. */
  maxAttempts?: number;
  /** Base delay in ms used for exponential backoff. Default 200. */
  baseDelayMs?: number;
  /** Upper bound for any single backoff delay in ms. Default 30_000. */
  maxDelayMs?: number;
  /**
   * Decide whether a thrown/caught error should be retried. Return `false` to fail fast
   * (e.g. validation errors, malformed input, 4xx-style permanent failures). Defaults to
   * `isLikelyTransientError`, which retries network/timeout/5xx-shaped errors and treats
   * everything else as non-retryable.
   */
  isRetryable?: (error: unknown) => boolean;
  /** Injectable sleep implementation; defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable delay-jitter random source in [0, 1); defaults to `Math.random`. */
  random?: () => number;
  /** Called after every failed attempt (retryable or not), before any sleep/rethrow. */
  onAttemptFailure?: (info: RetryAttemptFailureInfo) => void;
}

export interface RetryAttemptFailureInfo {
  attempt: number;
  maxAttempts: number;
  error: unknown;
  retryable: boolean;
  delayMs: number | null;
}

export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: unknown,
  ) {
    super(message);
    this.name = "RetryExhaustedError";
  }
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 30_000;

/** Error names/codes that Node's http/fetch/dns stack uses for transient network failures. */
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_NAME_PATTERN = /timeout|abort|network|econn|fetch failed/i;
const NON_RETRYABLE_NAME_PATTERN = /validation|typeerror(?!.*fetch)|syntaxerror|rangeerror/i;

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * Default retryability classifier: treats network/timeout errors and 5xx/429 HTTP-shaped
 * errors as transient (retry), and everything else — including validation errors and
 * 4xx-shaped errors other than 429 — as permanent (do not retry).
 */
export function isLikelyTransientError(error: unknown): boolean {
  const code = errorCode(error);
  if (code && TRANSIENT_ERROR_CODES.has(code)) return true;

  const status = httpStatus(error);
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500) return true;
    if (status >= 400) return false;
  }

  if (error instanceof Error) {
    if (NON_RETRYABLE_NAME_PATTERN.test(error.name)) return false;
    if (TRANSIENT_NAME_PATTERN.test(error.name) || TRANSIENT_NAME_PATTERN.test(error.message)) {
      return true;
    }
  }

  // Unknown-shaped errors: default to retryable so a transient hiccup we didn't recognize
  // still gets a second chance, matching this project's bias toward not losing crawler
  // runs / notifications / event deliveries to a single flaky attempt.
  return true;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt: number, options: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs">>, random: () => number) {
  const exponential = options.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, options.maxDelayMs);
  // Full jitter: uniform random in [0, capped].
  return Math.floor(random() * capped);
}

/**
 * Runs `fn`, retrying with exponential backoff + full jitter on retryable failures.
 * Resolves with `fn`'s return value on success. Rejects with a `RetryExhaustedError`
 * (wrapping the last error) once `maxAttempts` is reached, or rejects immediately with
 * the original error when `isRetryable` returns `false`.
 */
export async function retryWithBackoff<T>(fn: (attempt: number) => Promise<T> | T, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const isRetryable = options.isRetryable ?? isLikelyTransientError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error);
      const attemptsRemaining = attempt < maxAttempts;
      const delayMs = retryable && attemptsRemaining
        ? backoffDelayMs(attempt, { baseDelayMs, maxDelayMs }, random)
        : null;

      options.onAttemptFailure?.({ attempt, maxAttempts, error, retryable, delayMs });

      if (!retryable) {
        throw error;
      }

      if (!attemptsRemaining) {
        break;
      }

      if (delayMs !== null && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw new RetryExhaustedError(
    `Operation failed after ${maxAttempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    maxAttempts,
    lastError,
  );
}

/**
 * Convenience wrapper for operations that signal failure via a return value (e.g.
 * `{ ok: false, error }`) instead of throwing. `isOk` extracts success/failure from the
 * result; `toError` extracts a retry-classifiable error from a failed result. Returns the
 * last result (success or failure) rather than throwing when retries are exhausted, so
 * callers that already have "record ok:false and move on" handling can keep it — this
 * just gives that final ok:false result more chances to become ok:true first.
 */
export async function retryResultWithBackoff<T>(
  fn: (attempt: number) => Promise<T> | T,
  options: RetryOptions & {
    isOk: (result: T) => boolean;
    toError: (result: T) => unknown;
  },
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const isRetryable = options.isRetryable ?? isLikelyTransientError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fn(attempt);
    lastResult = result;

    if (options.isOk(result)) {
      return result;
    }

    const error = options.toError(result);
    const retryable = isRetryable(error);
    const attemptsRemaining = attempt < maxAttempts;
    const delayMs = retryable && attemptsRemaining
      ? backoffDelayMs(attempt, { baseDelayMs, maxDelayMs }, random)
      : null;

    options.onAttemptFailure?.({ attempt, maxAttempts, error, retryable, delayMs });

    if (!retryable || !attemptsRemaining) {
      return result;
    }

    if (delayMs !== null && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  // Unreachable in practice (loop always returns), but keeps TypeScript satisfied.
  return lastResult as T;
}
