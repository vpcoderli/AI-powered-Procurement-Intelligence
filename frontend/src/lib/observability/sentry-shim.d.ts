/**
 * Ambient module fallback for `@sentry/nextjs`.
 *
 * `@sentry/nextjs` is declared as a dependency in `frontend/package.json` (see P0-3
 * observability work) but has not been installed in this environment — `npm install`
 * could not be run here (see repo/task constraints). Without a real
 * `node_modules/@sentry/nextjs` package, TypeScript cannot resolve
 * `typeof import("@sentry/nextjs")` under `strict` mode, which would otherwise break
 * `tsc`/`next build` type-checking across the whole project.
 *
 * This shim provides a minimal structural type for the handful of Sentry APIs this
 * codebase calls (see `frontend/src/lib/observability/sentry.ts`), so type-checking
 * succeeds today. TypeScript prefers a real package's own types over an ambient
 * `declare module` shim, so once a human runs `npm install` and the real
 * `@sentry/nextjs` types are present in `node_modules`, this shim is automatically
 * superseded — no code changes required. At that point this file can be deleted (or
 * left in place harmlessly).
 *
 * Human follow-up: run `npm install` in `frontend/` to pull in the real package.
 */
declare module "@sentry/nextjs" {
  export interface SentryInitOptions {
    dsn?: string;
    environment?: string;
    release?: string;
    tracesSampleRate?: number;
    sendDefaultPii?: boolean;
    initialScope?: {
      tags?: Record<string, string>;
    };
    [key: string]: unknown;
  }

  export interface SentryCaptureContext {
    level?: "fatal" | "error" | "warning" | "log" | "info" | "debug";
    extra?: Record<string, unknown>;
    tags?: Record<string, string>;
  }

  export function init(options: SentryInitOptions): void;
  export function captureException(error: unknown, context?: SentryCaptureContext): string;
  export function captureMessage(message: string, context?: SentryCaptureContext | string): string;
}
