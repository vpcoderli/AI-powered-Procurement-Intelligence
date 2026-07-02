/**
 * Thin wrapper around `@sentry/nextjs` that no-ops cleanly when the package is not
 * installed yet and/or `SENTRY_DSN` is not configured.
 *
 * IMPORTANT (human follow-up): `@sentry/nextjs` is declared in `frontend/package.json`
 * but has NOT been installed in this environment (see task constraints — `npm install`
 * could not be run here). Until `npm install` is run, `require("@sentry/nextjs")` below
 * will throw a module-not-found error; every call site in this file catches that and
 * falls back to console logging, so the app keeps working either way. Once installed,
 * this module activates automatically as soon as `SENTRY_DSN` is set — no code changes
 * needed.
 */

import type { StructuredLogEntry } from "./logger";

type SentryModule = typeof import("@sentry/nextjs");

let cachedSentry: SentryModule | null | undefined;

function isSentryConfigured() {
  return Boolean(process.env.SENTRY_DSN?.trim());
}

/**
 * Resolves the `@sentry/nextjs` module if it is installed and configured. Returns
 * `null` (and caches that result) when the package is missing or SENTRY_DSN is unset,
 * so we only pay the `require` cost once per process.
 */
function resolveSentry(): SentryModule | null {
  if (!isSentryConfigured()) return null;
  if (cachedSentry !== undefined) return cachedSentry;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedSentry = require("@sentry/nextjs") as SentryModule;
  } catch {
    // @sentry/nextjs is declared in package.json but not yet installed in this
    // environment, or failed to load for another reason. Fail closed to console-only
    // logging rather than crashing the app/worker.
    cachedSentry = null;
  }

  return cachedSentry;
}

/**
 * Idempotent Sentry.init() guarded by SENTRY_DSN. Safe to call multiple times and
 * safe to call when the SDK is not installed (no-ops).
 */
export function initSentry(runtime: "server" | "edge" | "worker" = "server") {
  const sentry = resolveSentry();
  if (!sentry) return;

  sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0") || 0,
    // Keep default PII scrubbing behavior; do not opt into `sendDefaultPii`.
    initialScope: {
      tags: { runtime },
    },
  });
}

/** Forwards a structured error log entry (see logger.ts) to Sentry as an exception/message. */
export function captureObservabilityError(entry: StructuredLogEntry) {
  const sentry = resolveSentry();
  if (!sentry) return;

  const { message, errorName, errorMessage, stack, ...extra } = entry as StructuredLogEntry & {
    errorName?: string;
    errorMessage?: string;
    stack?: string;
  };

  if (errorMessage) {
    const reconstructed = new Error(errorMessage);
    reconstructed.name = errorName || "Error";
    if (stack) reconstructed.stack = stack;
    sentry.captureException(reconstructed, { extra });
    return;
  }

  sentry.captureMessage(message, { level: "error", extra });
}

/** Directly reports an unhandled/top-level error (e.g. a worker crash) to Sentry. */
export function captureException(error: unknown, context?: Record<string, unknown>) {
  const sentry = resolveSentry();
  if (!sentry) return;

  sentry.captureException(error, context ? { extra: context } : undefined);
}

export { isSentryConfigured };
