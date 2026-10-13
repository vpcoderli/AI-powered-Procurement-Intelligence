/**
 * Next.js instrumentation hook (project root, sibling to next.config.ts).
 *
 * Next.js automatically loads this file once per server runtime instance and calls
 * `register()` before the runtime starts handling requests. See:
 * `docs/transferability/environment-variables.md` for the SENTRY_DSN env var this
 * depends on, and `frontend/src/lib/observability/sentry.ts` for the guarded
 * init/no-op wrapper.
 *
 * This project pins Next.js 16.3.8. The `instrumentation.ts` `register()` convention
 * and the `onRequestError` hook used below have been stable since Next.js 13.4 and 15
 * respectively. They were checked against the bundled docs of the pinned version
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`),
 * where `error` is typed `unknown` as it is here. Re-check them when the pin moves
 * (per CLAUDE.md guidance).
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
