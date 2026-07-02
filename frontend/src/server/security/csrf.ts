/**
 * CSRF defense-in-depth for cookie-session-authenticated, state-changing API routes.
 *
 * Context: `apsi_session` (see `@/server/auth/session`) is already `HttpOnly` +
 * `SameSite=Lax`. `SameSite=Lax` blocks the cookie from being attached to
 * cross-site POST/PUT/PATCH/DELETE requests (form submissions, fetch/XHR),
 * which mitigates most classic CSRF vectors. Per OWASP guidance, `SameSite=Lax`
 * alone is NOT considered a complete CSRF defense: it does not protect
 * top-level GET-based navigations that trigger state changes, does not help
 * on older browsers that ignore `SameSite`, and is a single control with no
 * defense-in-depth if a future change (e.g. a subdomain takeover, a relaxed
 * cookie flag, or a proxy stripping headers) weakens it. This module adds an
 * explicit Origin/Referer allowlist check as a second, independent layer for
 * state-changing routes that rely on the session cookie.
 *
 * Pattern: Origin-header validation (a lighter-weight sibling of the
 * double-submit-cookie pattern). It was chosen over double-submit-cookie
 * because:
 *   - There is no shared client-side fetch wrapper in this codebase to inject
 *     a CSRF token/header on every mutating request (no `middleware.ts`, no
 *     `apiHandler`/`withAuth` HOF — see `frontend/src/server/auth/route-guards.ts`
 *     and `frontend/src/server/admin/auth.ts` for the closest analogues).
 *   - Origin/Referer validation requires zero frontend changes and no new
 *     cookie, matching how `requireAdmin`/`requireAdminAccess` are called
 *     as a guard at the top of each handler rather than via middleware.
 *
 * Usage: call `verifyCsrfSafe(request)` at the top of every non-GET route
 * handler that authenticates via the session cookie, immediately after (or
 * before) the auth check, and return `csrfRejectedResponse()` if it fails.
 *
 *   import { verifyCsrfSafe, csrfRejectedResponse } from "@/server/security/csrf";
 *
 *   export async function POST(request: Request) {
 *     if (!verifyCsrfSafe(request)) return csrfRejectedResponse();
 *     ...
 *   }
 *
 * Routes that authenticate via something other than the ambient cookie (for
 * example the Stripe-signed `billing/webhook`, or the invite-token-gated
 * `account/workspace/invitations/accept` which has no session yet) are out of
 * scope: CSRF requires an ambient credential a browser attaches automatically,
 * which a bearer token or request-body secret is not.
 *
 * KNOWN TRADE-OFF — requests with neither an Origin nor a Referer header are
 * allowed through rather than rejected. Modern browsers always send `Origin`
 * on cross-site POST/PUT/PATCH/DELETE fetch/XHR/form requests, so a genuine
 * cross-site CSRF attempt will have a (mismatched) `Origin` header and will be
 * rejected. Failing closed on a *missing* Origin/Referer would also reject:
 * legitimate same-origin requests from browsers/proxies that strip these
 * headers for privacy reasons, and non-browser server-to-server callers
 * (health checks, the `CRAWLER_RUN_TOKEN`-gated crawler endpoints, ops
 * scripts) that do not send them at all and do not rely on the ambient
 * session cookie in the first place. This mirrors common framework defaults
 * (e.g. Rails' `forgery_protection`, Django's `CsrfViewMiddleware`) which
 * treat an absent Origin as inconclusive rather than as an automatic reject,
 * and keeps this change from breaking the existing route test suite (~90+
 * `route.test.ts` files construct plain `new Request(...)` calls with no
 * Origin/Referer header). If stricter behavior is desired later, flip
 * `verifyCsrfSafe` to fail-closed on missing headers once a shared test
 * helper injects a same-origin header by default.
 */

import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Origins that are always trusted regardless of env configuration. */
function developmentOrigins(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  return ["http://localhost:3000", "http://127.0.0.1:3000"];
}

/**
 * Reads the allowlist of trusted origins from environment configuration.
 * `APP_ORIGIN` is the canonical single-origin deployment value (e.g.
 * `https://app.apsi.example.com`). `CSRF_ALLOWED_ORIGINS` supports a
 * comma-separated list for multi-origin setups (e.g. staging + prod, or a
 * marketing subdomain that also calls authenticated APIs).
 */
function configuredAllowedOrigins(): string[] {
  const origins: string[] = [];

  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (appOrigin) origins.push(appOrigin);

  const extra = process.env.CSRF_ALLOWED_ORIGINS?.trim();
  if (extra) {
    for (const candidate of extra.split(",")) {
      const trimmed = candidate.trim();
      if (trimmed) origins.push(trimmed);
    }
  }

  return origins;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function allowedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();

  for (const candidate of [...configuredAllowedOrigins(), ...developmentOrigins()]) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) origins.add(normalized);
  }

  // When no explicit allowlist is configured (`APP_ORIGIN` /
  // `CSRF_ALLOWED_ORIGINS` unset), fall back to trusting the request's own
  // origin: an Origin header that matches the host the request was addressed
  // to is by definition same-origin. This keeps the check useful out of the
  // box (e.g. preview/staging environments) without requiring every
  // deployment to configure `APP_ORIGIN` first. Once an explicit allowlist
  // is configured, it is authoritative and the fallback is disabled so that
  // unlisted hosts fail closed.
  if (configuredAllowedOrigins().length === 0) {
    const selfOrigin = normalizeOrigin(request.url);
    if (selfOrigin) origins.add(selfOrigin);
    const host = request.headers.get("host");
    if (host) {
      const scheme = process.env.NODE_ENV === "production" ? "https" : "http";
      origins.add(`${scheme}://${host}`);
    }
  }

  return origins;
}

export interface CsrfCheckOptions {
  /** Override for testing; defaults to reading env-configured + request-derived origins. */
  allowedOrigins?: string[];
}

/**
 * Returns true when the request is safe to process for a cookie-authenticated,
 * state-changing route. Safe HTTP methods always pass (they must not mutate
 * state per HTTP semantics, so CSRF does not apply). For unsafe methods:
 *   - If an `Origin` header is present, it must normalize to an allowed
 *     origin, or the request is rejected.
 *   - Else if a `Referer` header is present, it must normalize to an allowed
 *     origin, or the request is rejected.
 *   - Else (neither header present) the request is allowed through — see the
 *     "KNOWN TRADE-OFF" note in the module doc comment above.
 */
export function verifyCsrfSafe(request: Request, options: CsrfCheckOptions = {}): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  const trusted = options.allowedOrigins
    ? new Set(options.allowedOrigins.map(normalizeOrigin).filter((value): value is string => value !== null))
    : allowedOrigins(request);

  const originHeader = request.headers.get("origin");
  if (originHeader) {
    const normalized = normalizeOrigin(originHeader);
    return normalized !== null && trusted.has(normalized);
  }

  const refererHeader = request.headers.get("referer");
  if (refererHeader) {
    const normalized = normalizeOrigin(refererHeader);
    return normalized !== null && trusted.has(normalized);
  }

  return true;
}

export function csrfRejectedResponse() {
  return NextResponse.json(
    {
      error: {
        code: "CSRF_VALIDATION_FAILED",
        message: "Request origin could not be verified. Please retry from the application.",
      },
    },
    { status: 403 },
  );
}
