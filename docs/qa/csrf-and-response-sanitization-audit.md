# CSRF Protection & Response Body Sanitization Audit (P1-6)

Date: 2026-07-01
Scope: `frontend/src/app/api/`, `frontend/src/server/auth/`, `frontend/src/server/security/`

This document summarizes the P1-6 work item from `docs/product-requirements/apsi-p0-p1-execution-plan.md`:
CSRF protection for state-changing API routes, plus a response-body sensitive-field audit.

## 1. Current CSRF exposure (before this change)

Confirmed by direct inspection of `frontend/src/server/auth/session.ts`:

- Session cookie name: `apsi_session`.
- Attributes: `HttpOnly` (always), `SameSite=Lax` (hardcoded), `Path=/`, `Secure` only when
  `NODE_ENV === "production"`, `Max-Age=2592000` (30 days) on create / `0` on clear.
- Built via a hand-rolled `cookieParts()` header-string builder, not `next/headers` or
  `NextResponse.cookies.set()`.
- No `frontend/src/middleware.ts` exists anywhere in the app — all auth/authorization checks
  happen inline inside individual route handlers (`resolvePrincipal`, `requireAdmin`,
  `requireAdminAccess`, or ad hoc `readSessionToken` + service lookups).
- No CSRF-related code existed anywhere in the repository prior to this change (verified by
  grepping for `csrf`, `double-submit`, `x-csrf`, `sec-fetch-site`, etc. — zero hits in code,
  only planning-doc mentions of the gap).

**`SameSite=Lax` assessment:** this does meaningfully reduce CSRF risk today — it prevents the
`apsi_session` cookie from being attached to cross-site `POST`/`PUT`/`PATCH`/`DELETE` requests
(form submissions, `fetch`/XHR) originating from another origin, which is the mechanism most
classic CSRF exploits rely on. Per OWASP's CSRF Prevention Cheat Sheet, however,
`SameSite=Lax` alone is **not** considered a complete defense:

- It does not protect state-changing `GET` requests (this codebase does not have any identified
  as a result of the audit below, but a future regression could reintroduce one).
- Older browsers that predate `SameSite` enforcement, or browsers with cookie policies disabled,
  ignore the attribute entirely.
- It is a single control with no defense-in-depth: a future change that weakens the cookie
  attribute (a subdomain takeover, a proxy that strips `Set-Cookie` attributes, a regression that
  flips `SameSite` to `None`) would silently remove all CSRF protection with no second layer to
  catch it.

Conclusion: `SameSite=Lax` is real, existing mitigation, but this change adds a second,
independent layer for state-changing endpoints as defense-in-depth, per the task's directive.

## 2. CSRF protection implemented

**New module:** `frontend/src/server/security/csrf.ts` — `verifyCsrfSafe(request)` and
`csrfRejectedResponse()`.

**Pattern chosen:** Origin/Referer header validation (not double-submit-cookie). Rationale,
also documented in the module's doc comment:

- The codebase has no shared client-side fetch wrapper and no `middleware.ts` to inject a CSRF
  token header on every mutating request. Introducing one would be a much larger, riskier change
  than this task's scope.
- Origin/Referer validation requires zero frontend changes and no new cookie. It fits the
  existing convention of a guard function called at the top of each handler (mirroring
  `requireAdmin(db, request)` / `requireAdminAccess(db, request, opts)` in
  `frontend/src/server/admin/auth.ts`), rather than requiring new middleware.

**Behavior:**

- Safe methods (`GET`, `HEAD`, `OPTIONS`) always pass — they must not mutate state per HTTP
  semantics.
- For unsafe methods, if an `Origin` header is present it must normalize to an allowed origin, or
  the request is rejected with `403 CSRF_VALIDATION_FAILED`.
- Else if a `Referer` header is present, the same check applies to its origin.
- Else (neither header present), the request is **allowed through**. This is a deliberate,
  documented trade-off (see "Known trade-off" below) — it is not a gap discovered after the fact.
- The allowlist is built from `APP_ORIGIN` (single canonical origin) + `CSRF_ALLOWED_ORIGINS`
  (comma-separated list, for multi-origin deployments) + hardcoded localhost dev origins
  (disabled in `NODE_ENV=production`). If neither env var is set, the check falls back to
  trusting the request's own `Host` header as same-origin, so the protection is active
  out-of-the-box even before `APP_ORIGIN` is configured for a new deployment.

**Known trade-off — missing Origin/Referer is allowed, not rejected.** Modern browsers always
send `Origin` on cross-site mutating `fetch`/XHR/form requests, so a genuine CSRF attempt will
carry a (mismatched) `Origin` header and will be rejected. Rejecting on a *missing* Origin/Referer
was considered and deliberately not chosen because it would also reject: legitimate same-origin
requests from clients/proxies that strip these headers, and non-browser server-to-server callers
(health checks, `CRAWLER_RUN_TOKEN`-gated crawler endpoints) that never send them and do not rely
on the ambient session cookie anyway. This mirrors default behavior in mainstream frameworks
(e.g. Django's `CsrfViewMiddleware`, Rails' forgery protection) which treat an absent Origin as
inconclusive. It also avoids retroactively breaking the ~90 existing `route.test.ts` files, none
of which set an Origin/Referer header on their `new Request(...)` calls (verified by direct
inspection before implementing this trade-off). If a stricter fail-closed posture is wanted later,
flip the final `return true` in `verifyCsrfSafe` to `return false` once a shared test helper is
introduced to inject a default same-origin header across the suite.

**Routes wired with `verifyCsrfSafe` (21 route files, called as the first line of each
state-changing handler, before body parsing and before the session/admin auth check):**

Account / billing (cookie-session auth):
- `frontend/src/app/api/account/subscription/cancel/route.ts` (POST)
- `frontend/src/app/api/account/subscription/checkout/route.ts` (POST)
- `frontend/src/app/api/account/billing/portal/route.ts` (POST)
- `frontend/src/app/api/account/route.ts` (DELETE — account deletion)
- `frontend/src/app/api/account/profile/route.ts` (PATCH)
- `frontend/src/app/api/account/password/route.ts` (POST)
- `frontend/src/app/api/account/notification-preferences/route.ts` (PATCH)
- `frontend/src/app/api/account/deadline-reminders/route.ts` (PATCH)

Workspace / invitations (cookie-session auth):
- `frontend/src/app/api/account/workspace/route.ts` (PATCH)
- `frontend/src/app/api/account/workspace/ownership/route.ts` (POST — ownership transfer)
- `frontend/src/app/api/account/workspace/members/route.ts` (POST — invite member)
- `frontend/src/app/api/account/workspace/members/[userId]/route.ts` (PATCH, DELETE)
- `frontend/src/app/api/account/workspace/invitations/[userId]/route.ts` (DELETE — revoke)
- `frontend/src/app/api/account/workspace/invitations/[userId]/resend/route.ts` (POST)

Admin (cookie-session auth via `requireAdmin`/`requireAdminAccess`):
- `frontend/src/app/api/admin/users/route.ts` (POST)
- `frontend/src/app/api/admin/users/[id]/route.ts` (PATCH)
- `frontend/src/app/api/admin/users/[id]/feature-overrides/route.ts` (PATCH)
- `frontend/src/app/api/admin/data-sources/[id]/route.ts` (PATCH)
- `frontend/src/app/api/admin/data-sources/batch/route.ts` (POST)
- `frontend/src/app/api/admin/data-sources/[id]/health-check/route.ts` (POST)
- `frontend/src/app/api/admin/subscriptions/reconcile/route.ts` (POST)
- `frontend/src/app/api/admin/billing/dunning/route.ts` (POST)
- `frontend/src/app/api/admin/notifications/deliver/route.ts` (POST)
- `frontend/src/app/api/admin/bids/qa/[id]/route.ts` (PATCH)
- `frontend/src/app/api/admin/bids/qa/batch/route.ts` (POST)
- `frontend/src/app/api/admin/config/route.ts` (POST)
- `frontend/src/app/api/admin/config/[id]/route.ts` (PATCH)

**Deliberately out of scope (not cookie-session CSRF-relevant):**

- `frontend/src/app/api/billing/webhook/route.ts` — authenticated via Stripe signature
  verification, not the ambient session cookie.
- `frontend/src/app/api/account/workspace/invitations/accept/route.ts` — the caller has no
  session yet; authorization is the invite token in the request body, not an ambient credential a
  browser attaches automatically. CSRF does not apply to this pattern.
- `frontend/src/app/api/auth/login`, `/register`, `/logout`,
  `/password-reset/{request,confirm}` — same reasoning: these establish or destroy the session
  rather than acting on an existing one, and are gated by credentials/tokens in the request body,
  not the cookie.
- `frontend/src/app/api/crawler/**/run` — gated by `CRAWLER_RUN_TOKEN`, a bearer-style secret, not
  the session cookie.
- All read-only (`GET`) routes — CSRF does not apply to safe methods.

## 3. Response body sensitive-field audit

Grepped `frontend/src/app/api/**/route.ts` and `frontend/src/server/**/*.ts` for `passwordHash`,
`tokenHash`, and related identifiers, cross-referenced against the sensitive columns in
`frontend/src/server/db/schema.ts` (`users.passwordHash`, `sessions.tokenHash`,
`passwordResetTokens.tokenHash`, `workspaceInvitations.tokenHash`).

**Result: zero occurrences of `passwordHash` or `tokenHash` in any `route.ts` file.** Every
route response is already built from either an explicit allowlisted object literal (e.g.
`NextResponse.json({ ok: true })`, `NextResponse.json({ user })`) or a mapped DTO type
(`toPublicUser()`, `toAdminUser()`, `PublicUser`, `AccountWorkspaceResponse`, etc.) rather than a
raw DB row. These fields only ever appear inside `frontend/src/server/**` internal
query/insert/update code (`db.select({...})`, `db.insert(users).values({...})`,
`eq(sessions.tokenHash, ...)`), which is correct and expected.

**One confirmed leak, fixed by this change:** `frontend/src/app/api/auth/password-reset/request/route.ts`.
`requestPasswordReset()` (`frontend/src/server/auth/password-reset.ts`) returns the plaintext,
single-use `resetToken` and its `expiresAt` unconditionally — this exists because the codebase
has no email delivery wired for the password-reset flow specifically (see
`frontend/src/app/forgot-password/page.tsx`, which renders the token as a clickable "local reset
link" for local/dev convenience when no provider fronts this flow). Returning an account-takeover
credential in an API response to an unauthenticated caller (the endpoint takes only an email
address) is unacceptable in a real deployment.

**Fix:** added a response-body allowlist function, `toSafeResponseBody()`, in the route file
itself. In `NODE_ENV=production` the response is stripped down to `{ ok: true }`; in all other
environments (dev/test) the existing `{ ok: true, resetToken, expiresAt }` shape is preserved
unchanged, so the documented local-dev flow and the existing test suite
(`frontend/src/server/auth/password-reset.test.ts`, which asserts on `result.resetToken` at the
service layer, not the route layer) continue to work exactly as before. A new test case was added
to `frontend/src/app/api/auth/password-reset/request/route.test.ts` asserting the token never
appears in the production response body.

This fix is a stopgap at the response-shaping boundary, not a redesign of the reset flow — see
"Open items" below for the real fix.

**Verified-safe, no change needed:**
- `frontend/src/app/api/admin/users/route.ts` `POST` returns `{ user, temporaryPassword }`. `user`
  is the allowlisted `toAdminUser()` DTO; `temporaryPassword` is a freshly generated plaintext
  password intentionally handed to the admin caller as a one-time credential handoff (only its
  hash is persisted, per `frontend/src/server/admin/users-repository.ts`). This is an
  admin-only, one-time, by-design handoff, not an unauthenticated leak — left unchanged.
- All `auth/login`, `auth/register`, `auth/session`, `account/workspace/invitations/accept`
  responses already return allowlisted DTOs (`PublicUser`, `AccountWorkspaceResponse`, etc.) with
  no raw DB row fields.

## 4. Tests added

- `frontend/src/server/security/csrf.test.ts` — unit tests for `verifyCsrfSafe` covering: safe
  methods always pass; missing-Origin/Referer trade-off; same-origin Origin allowed; cross-site
  Origin rejected; Referer fallback; Origin takes precedence over Referer; `APP_ORIGIN` and
  `CSRF_ALLOWED_ORIGINS` allowlist configuration; explicit `options.allowedOrigins` override;
  malformed Origin header treated as untrusted; `csrfRejectedResponse()` shape.
- `frontend/src/app/api/account/subscription/cancel/route.test.ts` — added cross-site-Origin
  rejection test and same-origin-allowed test (existing tests for auth/business-logic behavior
  were preserved unchanged).
- `frontend/src/app/api/account/workspace/ownership/route.test.ts` — added cross-site-Origin
  rejection test for the ownership-transfer endpoint.
- `frontend/src/app/api/account/password/route.test.ts` — added cross-site-Origin rejection test.
- `frontend/src/app/api/account/notification-preferences/route.test.ts` — added cross-site-Origin
  rejection test for the `PATCH` handler.
- `frontend/src/app/api/admin/config/route.test.ts` — added cross-site-Origin rejection test,
  confirming the CSRF check runs (and rejects) before `requireAdminConfigAccess` and before the
  audit-log write for access-denied events.
- `frontend/src/app/api/auth/password-reset/request/route.test.ts` — added a production-mode
  test asserting `resetToken`/`expiresAt` never appear in the response body.

**Not touched:** the remaining ~20 pre-existing `route.test.ts` files for the other CSRF-guarded
routes were left as-is. They construct requests with no Origin/Referer header, which continues to
pass under the documented fail-open trade-off, so no existing test needed to change. Verified by
inspection (not by running the suite — this environment could not run `npm test`; see "Human
follow-ups" below).

## 5. What's still open (human follow-ups)

1. **Run the full test suite locally.** This change was implemented and self-reviewed by
   re-reading every modified file, but could not be executed in this sandbox (`npm run lint`,
   `npx vitest run`, `npm run build` were explicitly out of scope for this environment). Please
   run at minimum:
   ```bash
   cd frontend
   npx vitest run src/server/security/csrf.test.ts
   npx vitest run src/app/api/account/subscription/cancel/route.test.ts
   npx vitest run src/app/api/account/workspace/ownership/route.test.ts
   npx vitest run src/app/api/account/password/route.test.ts
   npx vitest run src/app/api/account/notification-preferences/route.test.ts
   npx vitest run src/app/api/admin/config/route.test.ts
   npx vitest run src/app/api/auth/password-reset/request/route.test.ts
   npm run lint
   npm run test
   ```
2. **Set `APP_ORIGIN` in every production/staging environment** (App Runner / ECS task
   definition env vars, per `docs/transferability/environment-variables.md`). Without it, the
   CSRF check falls back to trusting the request's `Host` header, which is functional but depends
   on the reverse proxy rejecting spoofed `Host` headers.
2b. **Decide whether to eventually flip the fail-open trade-off to fail-closed** (reject
   requests with no Origin/Referer at all) once there is appetite to update the ~90 existing
   route tests to send a default same-origin header. Not done in this change to avoid mixing a
   test-infrastructure change into a security hardening change.
3. **Fix the password-reset delivery flow properly**, not just the response-body symptom. The
   real fix is wiring the password-reset flow through the existing SendGrid/SES notification
   adapters (`frontend/src/server/notifications/providers/`) the same way workspace invitations
   already are, so the reset link is delivered out-of-band by email instead of ever appearing in
   an API response or being rendered directly in the browser
   (`frontend/src/app/forgot-password/page.tsx`). This is a larger change (touches the
   notification worker and the forgot-password UI) and was intentionally left out of this task's
   scope, which was response-body sanitization, not the reset-flow redesign.
4. **Consider a repo-wide double-submit-cookie or shared fetch-wrapper CSRF token** if/when a
   shared client-side API wrapper or `middleware.ts` is introduced for other reasons (e.g. to
   support future non-cookie auth). Origin/Referer validation is a reasonable, low-friction
   defense-in-depth layer today, but a token-based scheme is the stronger long-term primitive per
   OWASP's ranked recommendations.
5. **Two stray `.tmp2` files** were noticed in `frontend/src/app/api/auth/login/`,
   `frontend/src/app/api/auth/password-reset/{request,confirm}/` (both `.ts` and `.test.ts`
   variants) — these are untracked leftovers from an earlier, unrelated task per the orchestrator
   instructions for this push, and were left untouched as out of scope for this item.
6. **`account/workspace/invitations/accept`** was deliberately left without a CSRF check since it
   has no ambient session yet — but note it does still call `createSessionCookie()` on success,
   meaning a successful call already sets a new session. If this endpoint is ever changed to also
   accept an already-authenticated caller (e.g. accepting an invite while logged in as a
   different user), it should be re-evaluated for CSRF at that time.
