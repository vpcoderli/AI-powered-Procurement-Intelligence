# Cross-Org Isolation Coverage (P1-1 / ORG-005)

Status: initial coverage landed 2026-07-01 on branch `codex/p1-1-org-isolation-tests`.

This note documents the survey performed for P1-1 (multi-tenant cross-org
access isolation), what the new test suite actually verifies, what was found
to be safe vs. broken, and what is still unverified. It complements —
doesn't replace — the many pre-existing tests that reference
`organizationMembership` incidentally (e.g. `workspace.test.ts`,
`knowledge/service.test.ts`, various `route.test.ts` files under
`src/app/api/account/`).

## 1. How authorization actually works in this codebase

Each authenticated user belongs to exactly one **active** organization via
`organizationMemberships` (`organizationId`, `userId`, `role`, `status`).
`ensureUserWorkspace` / `listWorkspaceMemberUserIds`
(`frontend/src/server/account/workspace.ts`) resolve a user's own
organization and, from there, every other active member's `userId`.

Two different scoping strategies exist in the schema, and it's important not
to conflate them:

- **User-set scoping.** Tables like `intent_to_bid`, `response_workspace_items`,
  `supplier_artifacts`, `pursuit_decisions`, `compliance_manifest_items`,
  `submission_paths`, `response_package_snapshots`/`exports` store a
  `userId` (the creator), not an `organizationId` column. Access to these is
  gated by **`getUserIntent`** (`frontend/src/server/intents/service.ts`),
  which resolves `scopeUserIds = listWorkspaceMemberUserIds(db, callerId)`
  and does `WHERE user_id IN (scopeUserIds) AND id = ?`. Practically: this
  means **any active member of the same organization as the resource's
  creator can read/act on that resource** — that is intentional workspace
  sharing, not a bug. The real security boundary is: a caller from a
  **different** organization is never in `scopeUserIds`, so `getUserIntent`
  returns `undefined` and every route maps that to HTTP 404
  (`INTENT_NOT_FOUND`).
- **Native `organizationId` scoping.** Tables `knowledge_items`,
  `sourcing_partners`, `quote_requests`, `award_outcomes`,
  `deadline_reminders`, `workspace_invitations`, `credit_balances`,
  `organization_feature_overrides` have their own `organization_id` column
  and are filtered directly by it (e.g. `listKnowledgeItems`,
  `loadQuoteWorkspace`). `principal.workspace.organizationId` (from
  `resolvePrincipal` → session token → `ensureUserWorkspace`) is
  session-derived only; nothing in the request body/query/header can
  influence it.

## 2. Survey: org-scoped endpoints found

Grepped `frontend/src/app/api/**/route.ts` and `frontend/src/server/**/service.ts`
for `organizationId`, `organizationMembership`, `intentToBid`,
`responseWorkspaceItems`, `supplierProfiles`, `quoteRequests`, and related
schema tables. Endpoints below are grouped by risk area; all funnel through
either `getUserIntent` or a direct `organizationId` filter as described above.

| Area | Route(s) | Service | Scoping mechanism |
|---|---|---|---|
| Intents | `/api/intents`, `/api/intents/[id]` | `intents/service.ts` | `getUserIntent` / `listUserIntents` / `updateIntentStatus` via `listWorkspaceMemberUserIds` |
| Response workspace | `/api/intents/[id]/response-workspace`, `.../comments`, `.../package`, `.../package/exports/[id]` | `response-workspace/service.ts` | `getOrCreateResponseWorkspace` → `getUserIntent` gate; comments via `requireWorkspaceItem` → same gate |
| Quotes / sourcing partners | `/api/intents/[id]/quotes` | `quotes/service.ts` | `getUserIntent` gate + `workspace.organizationId` filter on `quote_requests`/`sourcing_partners` (defense in depth) |
| Supplier artifacts | `/api/intents/[id]/artifacts`, `.../artifacts/[artifactId]` | `artifacts/service.ts` | `getUserIntent` gate before any storage read/write |
| Pursuit decisions | `/api/intents/[id]/decision` | `pursuit/service.ts` | `getUserIntent` gate |
| Compliance manifest | `/api/intents/[id]/compliance` | `compliance/service.ts` | `getUserIntent` gate |
| Deadlines | `/api/intents/[id]/deadlines`, `/api/account/deadline-reminders` | `deadlines/service.ts` | `getUserIntent` gate (per-intent) + `workspace.organizationId` (account-level reminder center) |
| Citations / qualification freshness | `/api/intents/[id]/citations`, `.../qualification/freshness` | `qualification/citations.ts`, `qualification/freshness.ts` | Explicit `listWorkspaceMemberUserIds` + `getUserIntent(..., { scopeUserIds })` |
| Knowledge base | `/api/knowledge` | `knowledge/service.ts` | Direct `organizationId` filter + `findActiveKnowledgeOrganizationMembership` check on writes |
| Workspace / org administration | `/api/account/workspace/*` | `account/workspace.ts` | `requireOwner` → caller's own `ensureUserWorkspace` org only; membership mutations scoped by `workspace.organizationId` |
| Awards | `/api/intents/[id]/award` (see `awards/service.ts`) | `awards/repository.ts`, `awards/service.ts` | `loadContext` → `getUserIntent` gate, same pattern as pursuit/compliance; has a native `organizationId` column too (defense in depth). Covered by the new test suite. |

## 3. What the new test suite covers

New file: `frontend/src/server/auth/cross-org-isolation.test.ts`.

Unlike the existing `route.test.ts` files (which mock the service layer
entirely via `vi.mock(...)` and therefore cannot catch an authorization
regression inside the service/repository layer itself), this suite runs
against a real temp-file SQLite database (`createTestDatabase`) and calls
the actual service functions the route handlers call. It:

1. Registers two real users via `registerUser`, each of which provisions its
   own distinct organization (confirmed distinct as a sanity check).
2. Has "Org A" create one resource of each kind below, then asserts "Org B"
   is rejected (`IntentNotFoundError`, `KnowledgeValidationError`, or an
   empty/filtered list — never Org A's data) when attempting to read or
   mutate it via the real service function:
   - Intents: get, list, status update.
   - Response workspace: get/create workspace, update item, comments
     (list + create), package snapshot creation, package workspace read.
   - Supplier artifacts: vault read, file metadata read, upload, replace,
     delete.
   - Quotes / sourcing partners: workspace read, request create/update.
   - Pursuit decisions: board read, decision create.
   - Compliance manifest: read/create, item update.
   - Knowledge base: list/search exclusion, rejecting a knowledge item that
     links to another org's intent, and rejecting a direct write attempt
     using another org's `organizationId` even though that org and its
     membership table both genuinely exist (this specifically guards
     against a "trust the caller-supplied organizationId" regression).
   - Deadline reminders: generated reminders scoped to the triggering org
     stay out of the other org's account-level reminder center.
   - Award outcomes: read (auto-provision-on-first-read) and update.
   - Raw membership/organization table isolation as a defense-in-depth
     sanity check (not routed through any service function).
3. Includes one explicit **control case** (not a cross-org test): a second
   *active* member added to Org A's membership table (with a real `users`
   row + email, matching what an accepted workspace invitation actually
   produces) can see Org A's intent. This documents the intended
   same-organization sharing behavior described in Section 1 so it isn't
   mistaken for a leak in future changes.

All assertions use the real exception classes/behavior the routes already
map to HTTP status codes (`IntentNotFoundError` → 404
`INTENT_NOT_FOUND`, `KnowledgeValidationError` → 400 `INVALID_REQUEST`,
`ResponseWorkspaceValidationError` → 400), rather than re-implementing
route-level HTTP assertions — the route-level mapping itself is already
exercised by the existing mocked `route.test.ts` files, and re-testing it
here would be redundant. The gap this suite closes is specifically
"does the service/repository layer under the route actually enforce
org isolation," which the mocked route tests structurally cannot verify.

## 4. Findings

### No missing/broken authorization checks found and fixed

Every org-scoped code path investigated (Section 2) was already correctly
gated by `getUserIntent`'s org-scoped `listWorkspaceMemberUserIds` lookup or
by a direct, session-derived `organizationId` filter. No route or service
function was found silently trusting a client-supplied `organizationId`,
and `resolvePrincipal`'s `workspace.organizationId` is derived exclusively
from the session token server-side (no body/query/header influence). **No
production code changes were required or made in this branch** — this is a
test-coverage-only change. If this changes in a future audit, treat it as a
P0 finding, not a P1 one.

### Non-blocking design note found during the survey (not fixed, out of scope)

`frontend/src/server/artifacts/repository.ts` (`listSupplierArtifactRows`,
`findSupplierArtifactRow`, and the equivalent artifact-linking lookups in
`response-workspace/repository.ts` and `quotes/repository.ts`) filter
supplier artifacts by `eq(supplierArtifacts.userId, callerId)` — the
*calling* principal's own user id — rather than by the intent's full
`listWorkspaceMemberUserIds` set. Net effect: even though `getUserIntent`
correctly confirms the caller shares an organization with the intent, a
teammate who did **not personally upload** a given artifact currently sees
an artifact vault that appears to exclude a colleague's uploads, and cannot
download/replace/delete a colleague's artifact via the same intent. This is
an **under-sharing bug, not a cross-org leak** — it cannot be used to reach
another organization's data — so it is out of scope for this security task
and was intentionally left unfixed. Flagging here for a follow-up product/
engineering decision: is per-uploader artifact privacy intentional, or
should artifacts be shared org-wide like everything else under an intent?

### Not covered by the new suite (unverified — flagged for follow-up)

- **Submission paths / confirmations** (`submission_paths`,
  `submission_confirmations` — user-keyed, no direct org column). Referenced
  by deadlines generation but not directly exercised cross-org in this
  suite.
- **Admin routes** (`/api/admin/**`) were out of scope — these are
  platform-admin-gated (not org-scoped) and rely on a separate auth
  mechanism (`role`/`ADMIN_UI_LOCAL_BYPASS`), not organization membership.
- **MySQL code paths.** Every service function reviewed has a parallel
  MySQL implementation (`isMysqlDatabaseUrlConfigured()` branch,
  e.g. `getMysqlUserIntent`, `listMysqlWorkspaceMemberUserIds`) that
  mirrors the SQLite logic. The new test suite only runs against SQLite
  (matching all other `*.test.ts` files in this repo, which use
  `createTestDatabase`/SQLite exclusively). The MySQL query strings were
  read and appear structurally equivalent (same `WHERE organization_id = ?`
  / `WHERE user_id IN (...)` predicates), but are **not executed** by any
  automated test in this repo today. This is a pre-existing gap, not one
  introduced here.
- **HTTP-layer/route-handler behavior** (exact status codes, response body
  shape, cookie handling) for the specific flows added here relies on the
  pre-existing mocked `route.test.ts` files continuing to pass; this suite
  does not re-verify the HTTP mapping layer itself.
- **Rate limiting / brute-force guessing of resource IDs** across orgs is a
  P0-2 concern (already delivered in Wave 1), not retested here.

## 5. Recommended follow-ups (human/product decisions, not urgent security fixes)

1. Decide whether supplier artifacts should be org-wide shared (like
   intents/response-workspace) or intentionally private to the uploader,
   and align `listSupplierArtifactRows`/`findSupplierArtifactRow` (and the
   linking helpers in `response-workspace/repository.ts` and
   `quotes/repository.ts`) accordingly. Currently inconsistent with the
   rest of the intent-scoped sharing model.
2. Add a cross-org isolation test for submission paths/confirmations.
3. Consider adding a MySQL-backed run of this suite (or a subset) once a
   MySQL test harness exists in CI — today all Vitest suites in this repo
   run against SQLite only.
