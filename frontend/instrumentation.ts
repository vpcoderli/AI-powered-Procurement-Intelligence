/**
 * Next.js instrumentation hook (project root, sibling to next.config.ts).
 *
 * Next.js automatically loads this file once per server runtime instance and calls
 * `register()` before the runtime starts handling requests. See:
 * `docs/transferability/environment-variables.md` for the SENTRY_DSN env var this
 * depends on, and `frontend/src/lib/observability/sentry.ts` for the guarded
 * init/no-op wrapper.
 *
 * This project pins Next.js 16.x (pre-release/canary). The `instrumentation.ts`
 * `register()` convention and the `onRequestError` hook used below have been stable
 * since Next.js 13.4 and 15 respectively; `node_modules/next/dist/docs/` was not
 * present/readable in the sandbox this file was authored in, so this was NOT verified
 * against this exact 16.2.6 canary's docs. Human follow-up: confirm against
 * `node_modules/next/dist/docs/` (per CLAUDE.md guidance) or the deployed Next.js
 * version's release notes before relying on this in production, and re-check if a
 * future canary bump changes the signature.
 */

export async function register() {
  const { initSentry } = await import("@/lib/observability/sentry");

  if (process.env.NEXT_RUNTIME === "nodejs") {
    initSentry("server");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    initSentry("edge");
  }
}

export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
  },
  context: Record<string, unknown>,
) {
  const [{ captureException }, { logger }] = await Promise.all([
    import("@/lib/observability/sentry"),
    import("@/lib/observability/logger"),
  ]);

  logger.error("unhandled_request_error", {
    error,
    path: request.path,
    method: request.method,
    routerKind: (context as { routerKind?: string }).routerKind,
    routeType: (context as { routeType?: string }).routeType,
  });

  captureException(error, {
    path: request.path,
    method: request.method,
  });
}
