/**
 * Structured JSON logger shared by Next.js server code (API routes, src/server/**)
 * and the standalone worker scripts (frontend/scripts/*-worker.ts).
 *
 * The three worker scripts already emit `console.log(JSON.stringify(...))` for their
 * run summaries; this module generalizes that pattern into a single, reusable shape
 * so log lines are consistently structured and greppable/parseable by a log
 * aggregator (Datadog, CloudWatch Logs, etc.) regardless of where they're emitted from.
 *
 * Design notes:
 * - Zero required dependencies: works before `@sentry/nextjs` (or any APM agent) is
 *   installed. When Sentry is configured (see `frontend/src/lib/observability/sentry.ts`),
 *   `error()` calls are also forwarded there automatically via a fire-and-forget dynamic
 *   `import("./sentry")` (see `forwardToSentryIfConfigured` below) — callers just use
 *   `logger.error(...)` and never need to import Sentry themselves. This module has no
 *   static/top-level dependency on `@sentry/nextjs`, so it stays safe to import from any
 *   runtime (edge, node, worker) even before the package is installed.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Logical component/service name, e.g. "api:auth", "worker:crawler". */
  service: string;
  /** Fields merged into every log entry emitted by this logger. */
  context?: LogFields;
  /** Minimum level to emit; defaults to "debug" (emit everything). */
  minLevel?: LogLevel;
  /** Override the sink used to write entries; defaults to console. Mainly for tests. */
  sink?: (entry: StructuredLogEntry) => void;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields | Error): void;
  /** Returns a child logger with additional context merged in. */
  child(context: LogFields): Logger;
}

function normalizeErrorFields(fields?: LogFields | Error): LogFields {
  if (fields instanceof Error) {
    return {
      errorName: fields.name,
      errorMessage: fields.message,
      stack: fields.stack,
    };
  }

  if (fields && fields.error instanceof Error) {
    const { error, ...rest } = fields;
    return {
      ...rest,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
    };
  }

  return fields ?? {};
}

function defaultSink(entry: StructuredLogEntry) {
  const line = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(line);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Lazily forwards error-level entries to Sentry when it is configured. Implemented as a
 * dynamic `import()` (fire-and-forget, matching the lazy-import pattern already used by
 * `frontend/scripts/notification-worker.ts`) so this module has no hard, synchronous
 * dependency on `@sentry/nextjs` and can be imported from edge/worker runtimes where the
 * package may not be resolvable or desired. Never awaited by callers — logging must stay
 * synchronous and must never throw because error reporting failed.
 */
function forwardToSentryIfConfigured(entry: StructuredLogEntry) {
  if (entry.level !== "error") return;
  if (!process.env.SENTRY_DSN?.trim()) return;

  void import("./sentry")
    .then((sentryIntegration) => sentryIntegration.captureObservabilityError(entry))
    .catch(() => {
      // Sentry integration module unavailable or not installed yet — structured logs on
      // stdout remain the source of truth regardless.
    });
}

export function createLogger(options: LoggerOptions): Logger {
  const { service, context = {}, minLevel = "debug", sink = defaultSink } = options;

  function log(level: LogLevel, message: string, fields?: LogFields) {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[minLevel]) return;

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service,
      ...context,
      ...fields,
    };

    sink(entry);

    if (sink === defaultSink) {
      forwardToSentryIfConfigured(entry);
    }
  }

  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, normalizeErrorFields(fields)),
    child: (childContext) =>
      createLogger({
        service,
        context: { ...context, ...childContext },
        minLevel,
        sink,
      }),
  };
}

/** Default application-wide logger. Prefer `logger.child({ ... })` for a scoped logger. */
export const logger = createLogger({ service: "apsi" });
