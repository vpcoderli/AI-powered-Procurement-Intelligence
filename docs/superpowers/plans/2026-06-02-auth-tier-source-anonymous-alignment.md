# Auth, Tier, Source Validity, and Anonymous Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining commercial/account readiness work by validating admin vs ordinary-user behavior, connecting tier/paid-feature states end to end, hardening 50-state source validity, and removing old anonymous personal-workspace behavior.

**Architecture:** Treat this as four coordinated tracks with strict test gates after each track. Backend permission and entitlement checks are the source of truth; frontend states only mirror those decisions. Source validity remains deterministic in normal tests, with operator-run live health checks kept separate from CI/local unit tests.

**Tech Stack:** Next.js App Router, Vitest, TypeScript, SQLite/MySQL-compatible server modules, existing `resolvePrincipal`, `requireFeature`, `UniversalState`, risk-check, source-health, crawler tests, and Browser verification for local UI flows.

---

## Overall Schedule

| Phase | Track | Duration Target | Parallelism | Exit Gate |
|---|---|---:|---|---|
| P0 | Admin/User Auth Regression | 0.5-1 day | 2 subagents | Admin and ordinary user pages/API behave differently in automated tests and browser smoke checks. |
| P1 | Tier / Paid Feature Locking | 1-1.5 days | 3 subagents | Free/Pro/Business/Enterprise feature access matches backend entitlements and frontend locked states. |
| P1 | Anonymous Boundary Cleanup | 0.5-1 day | 2 subagents | Personal workspace APIs/pages no longer depend on anonymous saved state; public browsing remains intact. |
| P2 | 50-State Validity Hardening | Done locally | 3 subagents | 50 states have non-empty, source-attributed, accessible opportunity/detail/download validation with risk-check coverage. |
| P3 | Docs + Operations Handoff | In progress | 1 subagent | Product status, runbooks, risk checklist, and next-step backlog are updated. |

## Parallel Agent Map

| Subagent | Scope | Primary Files |
|---|---|---|
| Agent A | Admin vs ordinary user route/API regression | `frontend/src/app/admin/**`, `frontend/src/components/layout/**`, `frontend/src/server/admin/**`, `frontend/src/app/api/admin/**` |
| Agent B | Ordinary user auth flows and personal workspace pages | `frontend/src/app/login/**`, `frontend/src/app/register/**`, `frontend/src/app/page.tsx`, `frontend/src/app/saved/**`, `frontend/src/app/intents/**`, `frontend/src/app/settings/**` |
| Agent C | Tier/paid feature backend enforcement | `frontend/src/server/auth/entitlements.ts`, `frontend/src/server/auth/feature-gate*.ts`, `frontend/src/app/api/intents/**`, `frontend/src/app/api/knowledge/**`, `frontend/src/app/api/search-alerts/**` |
| Agent D | Tier/paid feature frontend states | `frontend/src/lib/features/useFeature.ts`, `frontend/src/app/settings/page.tsx`, `frontend/src/app/intents/[id]/**`, `frontend/src/components/intents/**`, `frontend/src/components/universal-state/**` |
| Agent E | 50-state source validity and crawler output quality | `frontend/src/lib/state-crawler-sources.ts`, `frontend/src/server/source-validity/**`, `frontend/scripts/source-health-check.ts`, `crawler/apsi_crawler/**` |
| Agent F | Anonymous boundary cleanup and docs | `frontend/src/server/auth/principal.ts`, `frontend/src/context/SavedBidsContext.tsx`, `frontend/src/app/api/saved-bids/**`, `docs/product-requirements/**`, `docs/operations/**` |

## Post-P0 Parallel Execution Schedule

P0 is complete locally. Continue in waves so backend permission truth lands before frontend copy/states, and so crawler/source checks can run without blocking account work.

Detailed remaining execution plan: `docs/superpowers/plans/2026-06-02-p1-p3-remaining-execution-schedule.md`.

| Wave | Priority | Parallel agents | Scope | Exit gate |
|---|---|---|---|---|
| Wave 1 | P1 | Agent C + Agent D | Done locally: Tier / Paid Feature Locking. Backend entitlement/API gate coverage and frontend locked/upgrade states now align across Settings and Intent paid modules. | Free/Pro/Business/Enterprise matrix passes backend and frontend tests; paid routes return authenticated + feature-gated responses; locked modules use `UniversalState` or `plan_limit`. |
| Wave 2 | P1 | Agent F + local coordinator | Done locally: Anonymous Boundary Cleanup. Public bid/search routes still work anonymously; saved bids, intents, profile, settings, search alerts, and paid workflow APIs require registered users. | Public bid/search routes still work anonymously; saved bids, intents, profile, settings, alerts, and paid workflow APIs require registered users. |
| Wave 3 | P2 | Agent E + optional crawler verifier | Done locally: 50-State Source Validity Hardening. Deterministic metadata, state content, local download/detail safety, and risk/source-health integration are in place. | 50 states are represented, no placeholder/demo URLs remain, state content is non-empty, detail pages route to real/local-safe records, and attachments are downloadable or explicitly unavailable. |
| Wave 4 | P3 | Agent F + coordinator | In progress: Docs / Operations Handoff. Update status, next plan, source-health/risk runbooks, and remaining backlog after each wave. | `winbids-implementation-status.md` and `winbids-next-development-plan.md` show the latest completed phase and the next actionable phase. |

Recommended execution order:

1. Wave 1 is done locally with two parallel workers: backend gates and frontend locked states.
2. Wave 2 is done locally; keep it as the registered-user boundary baseline.
3. Wave 3 is done locally; keep deterministic source/risk checks as the source-validity baseline.
4. Continue Wave 4 documentation handoff so the next session can resume without re-reading the codebase.

Shared verification gate after each wave:

```bash
cd frontend
npm test
npm run lint
npm run build
git diff --check
```

Additional P2 verification:

```bash
cd frontend
npm run risk:check
npm run source:health:check -- --all --timeout-ms 5000 --report-only
cd ..
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

## P0: Admin / Ordinary User Full-Chain Regression

**Purpose:** Prove that logged-in ordinary users and admin/operator/support users see different UI, receive different API permissions, and cannot cross boundaries.

**Files:**
- Modify: `frontend/src/app/admin/page.test.ts`
- Modify: `frontend/src/app/page.test.ts`
- Modify: `frontend/src/components/layout/app-sidebar.test.ts`
- Modify: `frontend/src/server/auth/feature-gate-coverage.test.ts`
- Add if needed: `frontend/src/server/auth/role-route-coverage.test.ts`

- [x] **Step 1: Write failing role coverage tests**

Add or extend tests so they assert:

```ts
expect(source).toContain("requireAdminAccess");
expect(source).toContain("roles");
expect(source).not.toContain("resolvePrincipal");
```

Target admin routes:

```ts
[
  "frontend/src/app/api/admin/users/route.ts",
  "frontend/src/app/api/admin/config/route.ts",
  "frontend/src/app/api/admin/data-sources/route.ts",
  "frontend/src/app/api/admin/risk-check/route.ts",
  "frontend/src/app/api/admin/notifications/route.ts",
]
```

- [x] **Step 2: Run RED**

Run:

```bash
cd frontend
npm test -- src/app/admin/page.test.ts src/app/page.test.ts src/components/layout/app-sidebar.test.ts src/server/auth/role-route-coverage.test.ts
```

Expected: fail only where a route/page lacks explicit role separation coverage.

- [x] **Step 3: Implement missing role assertions or route guards**

Use existing patterns:

```ts
await requireAdminAccess(db, request, { roles: ["admin", "operator"] });
```

For full user-management APIs, keep:

```ts
await requireAdminAccess(db, request, { roles: ["admin"] });
```

- [x] **Step 4: Browser smoke**

Use Browser to check:

```text
http://localhost:3000/
http://localhost:3000/admin
http://localhost:3000/settings
```

Expected:

- Anonymous: sees public marketing/registration/login entry, no command center.
- Ordinary user: sees command center/personal workspace, no Admin navigation.
- Admin/operator/support: sees Admin entry; controls differ by role.

- [x] **Step 5: Verification**

Run:

```bash
cd frontend
npm test -- src/app/admin src/app/page.test.ts src/components/layout/app-sidebar.test.ts src/server/auth
npm run lint
npm run build
git diff --check
```

## P1: Tier / Paid Feature Locking End-to-End

**Purpose:** Make backend entitlement, API responses, frontend locked states, Settings plan overview, and upgrade prompts tell one consistent story.

**Files:**
- Modify: `frontend/src/server/auth/entitlements.test.ts`
- Modify: `frontend/src/server/auth/feature-gate-coverage.test.ts`
- Modify: `frontend/src/lib/features/useFeature.ts`
- Modify: `frontend/src/app/settings/page.test.ts`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/components/intents/*.tsx`

- [x] **Step 1: Write entitlement matrix test**

Add table assertions for:

```ts
[
  ["free", "saved_bids", true],
  ["free", "submission_guidance", false],
  ["pro", "submission_guidance", true],
  ["pro", "compliance_manifest", false],
  ["business", "compliance_manifest", true],
  ["business", "quote_workflow", true],
  ["business", "deadline_notifications", true],
  ["enterprise", "knowledge_station", true],
]
```

- [x] **Step 2: Write API feature gate coverage checks**

For every paid API in `FEATURE_API_COVERAGE`, assert:

```ts
expect(source).toContain("requireFeature");
expect(source).toContain(feature);
expect(source).toContain("FeatureAccessError");
```

Also assert every intent paid route imports:

```ts
authRequiredResponse
isAuthenticatedPrincipal
```

- [x] **Step 3: Write frontend locked-state coverage checks**

For the intent page and component files, assert paid modules render one of:

```ts
lockedFeatureMessage
UniversalState
code="plan_limit"
```

Required modules:

```text
Submission Guidance
Compliance Manifest
Response Workspace
Artifact Vault
Quote Workspace
Deadline Notifications
Knowledge Station
```

- [x] **Step 4: Implement missing locked states**

Use:

```ts
const allowed = canUseFeature(user, "quote_workflow");
const message = lockedFeatureMessage("quote_workflow");
```

Render:

```tsx
<UniversalState
  code="plan_limit"
  title={t("common.upgradeRequired")}
  message={message}
/>
```

- [x] **Step 5: Verification**

Run:

```bash
cd frontend
npm test -- src/server/auth src/lib/features src/app/settings/page.test.ts src/app/intents/[id]/page.test.ts src/components/intents
npm test
npm run lint
npm run build
git diff --check
```

## P1: Anonymous Boundary Cleanup

**Purpose:** Keep anonymous access for public search/bid browsing where intended, but remove anonymous personal-workspace state from saved bids, intents, settings, profile, and paid workflow APIs.

**Files:**
- Modify: `frontend/src/server/auth/principal.ts`
- Modify: `frontend/src/server/auth/principal.test.ts`
- Modify: `frontend/src/context/SavedBidsContext.tsx`
- Modify: `frontend/src/context/SavedBidsContext.test.ts`
- Modify: `frontend/src/app/api/saved-bids/**`
- Modify: `frontend/src/app/api/intents/**`
- Add if needed: `frontend/src/server/auth/personal-route-coverage.test.ts`

- [ ] **Step 1: Classify public vs personal routes**

Document this matrix in test data:

```ts
const publicRoutes = [
  "/api/bids",
  "/api/bids/1",
  "/api/bids/1/attachments/a1",
  "/api/bids/1/match",
];

const personalRoutes = [
  "/api/saved-bids",
  "/api/intents",
  "/api/intents/intent_1",
  "/api/account",
  "/api/account/usage",
  "/api/search-alerts",
];
```

- [ ] **Step 2: Add coverage test**

Assert personal routes use:

```ts
isAuthenticatedPrincipal
authRequiredResponse
```

Assert public routes may use anonymous user only when they do not persist personal workspace data.

- [ ] **Step 3: Clean old anonymous tests**

Replace tests that expect anonymous saved/intents persistence with authenticated-user isolation tests:

```ts
expect(saveBid).toHaveBeenCalledWith("user_1", "bid_1");
expect(response.status).toBe(401);
```

- [ ] **Step 4: Validate UI behavior**

Browser checks:

```text
/saved
/intents
/profile
/settings
```

Expected anonymous result:

```text
Sign in to continue
Sign in
Create account
```

- [ ] **Step 5: Verification**

Run:

```bash
cd frontend
npm test -- src/server/auth src/context/SavedBidsContext.test.ts src/app/api/saved-bids src/app/api/intents src/app/saved src/app/intents src/app/profile src/app/settings
npm test
npm run lint
npm run build
git diff --check
```

## P2: 50-State Source Validity / Download Hardening

**Purpose:** Ensure every state has non-empty, source-attributed records, and every local opportunity/detail/download link avoids demo, placeholder, or unsafe 404 URLs.

**Files:**
- Modify: `frontend/src/lib/state-crawler-sources.ts`
- Modify: `frontend/src/lib/state-crawler-sources.test.ts`
- Modify: `frontend/src/server/source-validity/**`
- Modify: `frontend/scripts/source-health-check.ts`
- Modify: `frontend/scripts/source-health-check.test.ts`
- Modify: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/tests/test_state_sources.py`
- Modify: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Add deterministic 50-state validity test**

Assert:

```ts
expect(allStates).toHaveLength(50);
expect(source.url).not.toContain("sam.gov/opp/12345");
expect(source.url).not.toContain("example.com");
expect(source.trustStatus).toMatch(/verified|beta|fallback|needs_review/);
```

- [ ] **Step 2: Add non-empty crawler output test**

For each enabled state source fixture:

```py
assert opportunity.title.strip()
assert opportunity.source_url.startswith("http")
assert opportunity.source_id
```

- [ ] **Step 3: Add attachment/detail safety test**

Assert any stored external attachment URL is either proxied through:

```text
/api/bids/:id/attachments/:attachmentId
```

or explicitly marked unavailable with source state:

```text
source_unavailable
```

- [ ] **Step 4: Expand risk-check**

Add risk report rows:

```text
state_source_url_validity
state_bid_detail_accessibility
state_attachment_download_accessibility
state_non_empty_content
```

- [ ] **Step 5: Operator live check**

Run:

```bash
cd frontend
npm run source:health:check -- --all
```

Expected: generates a report with healthy/unhealthy/skipped states without failing deterministic CI tests for bot-check or remote 403 conditions.

- [ ] **Step 6: Python verification**

Run:

```bash
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

Expected: all crawler fixture and CLI tests pass.

## P3: Documentation / Handoff Update

**Purpose:** Make the updated schedule and completed phases visible so the next session can continue without re-reading the whole codebase.

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`
- Modify as needed: `docs/operations/source-health-check.md`
- Modify as needed: `docs/operations/mysql-cutover.md`

- [ ] **Step 1: Update implementation status**

Add a latest phase entry after each completed slice:

```md
## Last Completed Phase

Completed:
- API auth guard coverage for personal intent workspace routes.
- Anonymous personal workspace access returns 401.

Remaining:
- Admin/user full-chain browser regression.
- Tier locked-state UI coverage.
- 50-state live source health follow-up.
```

- [ ] **Step 2: Update next-development plan**

Keep recommended order:

```md
1. Admin/User Auth Regression
2. Tier / Paid Feature Locking
3. Anonymous Boundary Cleanup
4. 50-State Source Validity Hardening
```

- [ ] **Step 3: Final verification**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
PYTHONPATH=../crawler python3 -m pytest ../crawler/tests
```

If `source:health:check` or live crawler checks fail because a public portal returns 403, timeout, CAPTCHA, or bot-check, record it as `unhealthy` or `skipped` with notes; do not replace deterministic tests with live-network assumptions.

## Completion Criteria

This plan is complete when:

- Admin/operator/support/user/anonymous UI and API differences are verified.
- Free/Pro/Business/Enterprise gates match backend entitlements and frontend locked states.
- Personal workspace APIs consistently return 401 for anonymous access.
- Public browsing remains available where intended.
- 50-state data has deterministic non-empty/source-validity/download safety checks.
- `npm test`, `npm run lint`, `npm run build`, `npm run risk:check`, dependency audit, crawler tests, and `git diff --check` pass or any external live-source failures are explicitly documented as portal/network conditions.
