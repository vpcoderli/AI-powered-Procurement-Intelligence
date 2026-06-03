# P1-P3 Remaining Execution Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining Anonymous Boundary Cleanup, 50-State Source Validity Hardening, and Docs / Operations Handoff work without losing the P1 permission baseline.

**Architecture:** Execute in gated waves. P1 Anonymous Boundary Cleanup is first because it changes auth expectations for personal workspaces; P2 50-state hardening can run after the auth API tests are green because crawler/source files are mostly independent; P3 documentation runs after each wave and again at the end. Backend/API tests remain the source of truth, frontend/browser checks verify user-facing behavior, and live external source checks remain operator-run signals rather than deterministic CI blockers.

**Tech Stack:** Next.js App Router, Vitest, TypeScript, SQLite/MySQL-compatible server paths, `resolvePrincipal`, `authRequiredResponse`, `isAuthenticatedPrincipal`, `risk:check`, `source:health:check`, Python crawler tests, and Browser smoke checks.

---

## Current Baseline

- P0 Admin/User Auth Regression is done locally.
- Wave 1 / P1 Tier / Paid Feature Locking is done locally.
- Wave 2 / P1 Anonymous Boundary Cleanup is done locally.
- Wave 3 / P2 50-State Source Validity Hardening is done locally.
- Required baseline verification already passed: `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, `npm run risk:check`, high-severity audit, and `git diff --check`.

## Remaining Wave Schedule

| Wave | Priority | Target | Parallel Agents | Exit Gate |
|---|---|---|---|---|
| Wave 2 | P1 | Done locally: Anonymous Boundary Cleanup | Agent F for backend/API boundary, Agent B for page/context UI states | Public `/search`, `/bids`, bid detail, match, and safe attachment routes work anonymously; saved bids, intents, profile/settings, search alerts, and paid workspace APIs return `AUTH_REQUIRED` for anonymous requests. |
| Wave 3 | P2 | Done locally: 50-State Source Validity Hardening | Agent E for source/risk checks, crawler verifier for Python fixtures/live CLI | 50 states remain represented, non-empty, source-attributed, route-openable, and attachment-safe; live health output records unhealthy/skipped portals without hiding deterministic failures. |
| Wave 4 | P3 | Done locally for Wave 3 handoff | Agent F + coordinator | Status docs, next plan, runbook notes, and risk/source-health handoff are updated after every wave. |

## Parallelism Rules

1. Start Wave 2 first and do not change source/crawler fixtures until Wave 2 targeted auth tests are green.
2. Start Wave 3 once Wave 2 backend/API tests pass; Wave 2 browser smoke and Wave 3 source tests may run in parallel.
3. Run Wave 4 after Wave 2 and after Wave 3, not only at the end.
4. If a live government portal returns 403, timeout, bot-check, or CAPTCHA, record it as live-health `unhealthy` or `skipped`; do not weaken deterministic source-validity tests.

## Wave 2: P1 Anonymous Boundary Cleanup

**Purpose:** Remove old anonymous personal-workspace persistence while preserving public anonymous browsing.

**Files:**
- Modify: `frontend/src/server/auth/personal-route-coverage.test.ts`
- Modify: `frontend/src/server/auth/route-guards.ts`
- Modify: `frontend/src/context/SavedBidsContext.tsx`
- Modify: `frontend/src/context/SavedBidsContext.test.ts`
- Modify: `frontend/src/app/api/saved-bids/route.ts`
- Modify: `frontend/src/app/api/saved-bids/[id]/route.ts`
- Modify: `frontend/src/app/api/intents/route.ts`
- Modify: `frontend/src/app/api/intents/[id]/route.ts`
- Modify: `frontend/src/app/api/search-alerts/route.ts`
- Modify: `frontend/src/app/api/search-alerts/[id]/route.ts`
- Modify: `frontend/src/app/saved/page.test.ts`
- Modify: `frontend/src/app/intents/page.test.ts`
- Modify: `frontend/src/app/profile/page.test.ts`
- Modify: `frontend/src/app/settings/page.test.ts`

- [x] **Step 1: Write public vs personal route coverage**

Add or extend `frontend/src/server/auth/personal-route-coverage.test.ts` with the exact route groups:

```ts
const publicAnonymousRoutes = [
  "frontend/src/app/api/bids/route.ts",
  "frontend/src/app/api/bids/[id]/route.ts",
  "frontend/src/app/api/bids/[id]/match/route.ts",
  "frontend/src/app/api/bids/[id]/attachments/[attachmentId]/route.ts",
];

const personalWorkspaceRoutes = [
  "frontend/src/app/api/saved-bids/route.ts",
  "frontend/src/app/api/saved-bids/[id]/route.ts",
  "frontend/src/app/api/intents/route.ts",
  "frontend/src/app/api/intents/[id]/route.ts",
  "frontend/src/app/api/search-alerts/route.ts",
  "frontend/src/app/api/search-alerts/[id]/route.ts",
];
```

For each personal route, assert:

```ts
expect(source).toContain("authRequiredResponse");
expect(source).toContain("isAuthenticatedPrincipal");
```

For each public route, assert it does not call personal workspace writers:

```ts
expect(source).not.toContain("createSavedBid");
expect(source).not.toContain("createIntent");
expect(source).not.toContain("createSearchAlert");
```

- [x] **Step 2: Run RED for route coverage**

Run:

```bash
cd frontend
npm test -- src/server/auth/personal-route-coverage.test.ts
```

Expected: fail only on personal routes that still allow anonymous persistence or lack shared auth guards.

- [x] **Step 3: Update saved-bids API tests**

In `frontend/src/app/api/saved-bids/route.test.ts` and `frontend/src/app/api/saved-bids/[id]/route.test.ts`, replace anonymous persistence expectations with:

```ts
expect(response.status).toBe(401);
expect(await response.json()).toEqual({
  error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
});
expect(response.headers.get("Set-Cookie")).toBeNull();
```

Keep authenticated workspace sharing tests intact.

- [x] **Step 4: Implement saved-bids auth guard**

In `frontend/src/app/api/saved-bids/route.ts` and `frontend/src/app/api/saved-bids/[id]/route.ts`, require:

```ts
if (!isAuthenticatedPrincipal(principal)) {
  return authRequiredResponse();
}
```

Then use authenticated `principal.workspace?.organizationId` for workspace-scoped reads/writes.

- [x] **Step 5: Update intents and search-alerts anonymous tests**

For `frontend/src/app/api/intents/**/*.test.ts` and `frontend/src/app/api/search-alerts/**/*.test.ts`, assert anonymous GET/POST/PATCH/DELETE return `AUTH_REQUIRED` and do not set anonymous cookies.

- [x] **Step 6: Implement intent/search-alert guards**

Use the same shared helpers in personal workspace API routes:

```ts
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
```

Return `authRequiredResponse()` before quota checks, feature checks, or workspace writes when `principal.kind !== "authenticated"`.

- [x] **Step 7: Update frontend anonymous page tests**

For `/saved`, `/intents`, `/profile`, and `/settings`, assert the anonymous state includes:

```ts
expect(page).toContain("AuthRequiredState");
expect(page).toContain("accountRequiresLogin");
expect(page).toContain("login");
expect(page).toContain("register");
```

- [x] **Step 8: Browser smoke for Wave 2**

Use the in-app browser against local `http://localhost:3000`:

```text
/search                -> anonymous can browse/search
/bids/1                -> anonymous can open public bid detail if record exists
/saved                 -> anonymous sees sign-in/create-account state
/intents               -> anonymous sees sign-in/create-account state
/profile               -> anonymous sees sign-in/create-account state
/settings              -> anonymous sees sign-in/create-account state
```

- [x] **Step 9: Wave 2 verification**

Run:

```bash
cd frontend
npm test -- src/server/auth/personal-route-coverage.test.ts src/context/SavedBidsContext.test.ts src/app/api/saved-bids src/app/api/intents src/app/api/search-alerts src/app/saved/page.test.ts src/app/intents/page.test.ts src/app/profile/page.test.ts src/app/settings/page.test.ts
npm test
npm run lint
npm run build
npm run risk:check
git diff --check
```

Expected: all pass. `risk:check` must still report public state data and attachment safety as PASS.

## Wave 3: P2 50-State Source Validity Hardening

**Purpose:** Strengthen deterministic and operator-run evidence that all 50 state records are real, non-empty, route-openable, and download-safe.

**Files:**
- Modify: `frontend/src/lib/state-crawler-sources.ts`
- Modify: `frontend/src/lib/state-crawler-sources.test.ts`
- Modify: `frontend/src/server/risk/checklist.ts`
- Modify: `frontend/src/server/risk/checklist.test.ts`
- Modify: `frontend/src/server/source-validity/**`
- Modify: `frontend/scripts/source-health-check.ts`
- Modify: `frontend/scripts/source-health-check.test.ts`
- Modify: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/tests/test_state_sources.py`
- Modify: `crawler/tests/test_state_live_cli.py`
- Modify if needed: `crawler/tests/test_cli.py`

- [x] **Step 1: Add stricter source registry test**

In `frontend/src/lib/state-crawler-sources.test.ts`, assert every state source has:

```ts
expect(stateCodes).toHaveLength(50);
expect(source.baseUrl).toMatch(/^https?:\/\//);
expect(source.baseUrl).not.toContain("example.com");
expect(source.baseUrl).not.toContain("sam.gov/opp/12345");
expect(source.evidenceMode).toMatch(/official|aggregator|archived|manual_review/);
expect(source.trustStatus).toMatch(/verified|beta|fallback|needs_review/);
```

- [x] **Step 2: Add state bid fixture/data non-empty checks**

In `frontend/src/server/risk/checklist.test.ts`, require the risk report to fail if any active state bid has empty:

```ts
["title", "issuer", "description", "sourceUrl", "state"]
```

Expected risk check id:

```ts
expect(checkIds).toContain("state-content");
```

- [x] **Step 3: Add route-openable detail checks**

Extend `frontend/src/server/risk/checklist.test.ts` so every active state bid id can be encoded and resolved by the local detail lookup. Expected check id:

```ts
expect(checkIds).toContain("bid-detail-routes");
```

- [x] **Step 4: Add attachment safety checks**

Assert state attachments are either local API routes or explicitly unavailable:

```ts
expect(attachment.downloadUrl).toMatch(/^\/api\/bids\/[^/]+\/attachments\/[^/]+$/);
```

or:

```ts
expect(attachment.status).toBe("source_unavailable");
```

- [x] **Step 5: Implement or tighten risk-check rows**

Keep or add these deterministic rows in `frontend/src/server/risk/checklist.ts`:

```text
state-coverage
state-content
bid-detail-routes
attachment-downloads
source-ingestion-governance
source-validity-metadata
state-url-validity
global-url-validity
```

The implementation must fail on placeholder/demo URLs and raw unsafe external attachment URLs.

- [x] **Step 6: Add crawler-side non-empty source tests**

In `crawler/tests/test_state_sources.py`, assert each enabled state crawler result or fixture record has:

```py
assert opportunity.title.strip()
assert opportunity.source_url.startswith(("http://", "https://"))
assert opportunity.state and len(opportunity.state) == 2
assert opportunity.source_id
```

- [x] **Step 7: Run operator live source health check**

Run report-only first:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 5000 --report-only
```

Expected: command completes with healthy/unhealthy/skipped rows. Any 403/timeout/bot-check must be captured as health status, not silently converted into valid data.

Latest local run on 2026-06-02:
- `npm run source:health:check -- --all --timeout-ms 5000 --report-only`
- Completed with exit 0.
- Reported 28/50 healthy, 22 unhealthy, 0 skipped.
- Fixed hard 404 registry URLs for OH and WY: OH now points to the active BidNet fallback route; WY now points to the current Wyoming A&I Bid Opportunities page.
- Remaining unhealthy rows are external portal conditions such as HTTP 403, timeout/abort, or fetch failure and must stay visible as live-ops risk.

- [x] **Step 8: Wave 3 verification**

Run:

```bash
cd frontend
npm test -- src/lib/state-crawler-sources.test.ts src/server/risk/checklist.test.ts scripts/source-health-check.test.ts
npm run risk:check
cd ..
PYTHONPATH=crawler python3 -m pytest crawler/tests
cd frontend
npm test
npm run lint
npm run build
git diff --check
```

Expected: deterministic checks pass. Live health may report unhealthy/skipped public portals but must not hide deterministic data quality failures.

## Wave 4: P3 Docs / Operations Handoff

**Purpose:** Keep the project self-resuming after each phase and preserve the latest remaining backlog.

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`
- Modify: `docs/product-requirements/winbids-current-gap-analysis.md`
- Modify: `docs/superpowers/plans/2026-06-02-auth-tier-source-anonymous-alignment.md`
- Modify: `docs/superpowers/plans/2026-06-02-p1-p3-remaining-execution-schedule.md`
- Modify if needed: `docs/operations/source-health-check.md`
- Modify if needed: `docs/operations/mysql-cutover.md`

- [x] **Step 1: Update status after Wave 2**

Add a latest completed phase entry:

```md
### P1 Anonymous Boundary Cleanup

Completed locally:
- Public browsing remains anonymous.
- Saved bids, intents, profile/settings, search alerts, and paid workspace APIs require registered users.
- Personal APIs return shared `AUTH_REQUIRED` responses for anonymous access.

Remaining:
- 50-state source validity hardening.
- Docs / Operations final handoff.
```

- [x] **Step 2: Update status after Wave 3**

Add a latest completed phase entry:

```md
### P2 50-State Source Validity Hardening

Completed locally:
- 50-state deterministic source/content/detail/download checks pass.
- `risk:check` reports state coverage, content, detail routing, attachment safety, source governance, source-validity metadata, and URL validity.
- Operator live source health remains report-only for external portal availability.

Remaining:
- Production source approval history and deeper source governance operations.
```

- [x] **Step 3: Keep next plan pointed at the true next phase**

After Wave 2, next phase should be Wave 3.

After Wave 3, next phase should be either:

```text
Settings Reminder Center
Response Package format depth
Source approval workflow depth
```

Choose the one with the highest remaining risk based on the final verification result.

- [ ] **Step 4: Final verification and handoff**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
cd ..
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

Record any live external source-health failures separately with the portal URL, status code/error, and whether local deterministic coverage still passes.

## Completion Criteria

This remaining schedule is complete when:

- Anonymous users can browse public opportunities but cannot persist or open personal workspace resources.
- Registered Free / Pursuit Starter / Response Builder / Enterprise users keep the Wave 1 paid-feature behavior.
- All 50 states remain present with non-empty, source-attributed records.
- Public bid detail pages and local attachment download routes avoid placeholder, unsafe, and 404 demo URLs.
- `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, `npm run risk:check`, high-severity audit, crawler tests, and `git diff --check` pass.
- Product status docs name the latest completed phase and the next unfinished phase.
