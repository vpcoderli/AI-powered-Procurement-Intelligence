# Admin Bid QA Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal Admin Bid QA queue so operators can find crawler records with archive/data-quality issues and mark review status without re-reading raw database rows.

**Architecture:** Reuse existing `bids.admin_review_status` and `bids.quality_flags_json`, add review note/audit timestamp columns, and build a focused admin repository plus GET/PATCH routes under `/api/admin/bids/qa`. The Admin page will load the QA queue with the existing console data and show a compact review table above source health.

**Tech Stack:** Next.js App Router route handlers, Drizzle SQLite schema/migration helpers, Vitest route/repository tests, existing Admin auth helpers and Admin UI patterns.

---

### Task 1: Bid QA Persistence

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`

- [x] **Step 1: Write failing schema test**
  - Assert `bids` has `admin_review_note`, `admin_reviewed_at`, and `admin_reviewed_by` columns.
  - Run: `npm test -- src/server/db/schema.test.ts`
  - Expected: FAIL because the columns do not exist yet.

- [x] **Step 2: Implement schema/migration**
  - Add nullable text columns:
    - `adminReviewNote`
    - `adminReviewedAt`
    - `adminReviewedBy`
  - Add idempotent migration guards with `addBidColumn`.

- [x] **Step 3: Run GREEN**
  - Run: `npm test -- src/server/db/schema.test.ts`
  - Expected: PASS.

### Task 2: Admin Bid QA Repository

**Files:**
- Create: `frontend/src/server/admin/bid-qa-repository.ts`
- Create: `frontend/src/server/admin/bid-qa-repository.test.ts`

- [x] **Step 1: Write failing repository tests**
  - Seed bids with archived, failed, and unavailable attachment/detail states.
  - Assert list response includes:
    - `summary.total`
    - `summary.needsReview`
    - `summary.archiveIssues`
    - item `qualityScore`
    - item `archiveIssueCount`
  - Assert filters work for `archiveStatus=failed`, `reviewStatus=needs_review`, `stateCode=CA`, and text query.
  - Assert update changes `adminReviewStatus`, `adminReviewNote`, `adminReviewedAt`, and `adminReviewedBy`.
  - Run: `npm test -- src/server/admin/bid-qa-repository.test.ts`
  - Expected: FAIL because repository does not exist.

- [x] **Step 2: Implement repository**
  - Export `AdminBidQaReviewStatus = "unreviewed" | "needs_review" | "reviewed" | "suppressed"`.
  - Export `listAdminBidQaItems(db, filters)` and `updateAdminBidQaReview(db, id, input)`.
  - Compute score from 100 down:
    - missing deadline: -20
    - low source confidence: -20
    - medium source confidence: -10
    - each quality flag: -5, max -20
    - each failed archive artifact: -15
    - each unavailable archive artifact: -8
  - Clamp score between 0 and 100.
  - Keep filtering in repository for this MVP; avoid complex SQL until the queue is larger.

- [x] **Step 3: Run GREEN**
  - Run: `npm test -- src/server/admin/bid-qa-repository.test.ts`
  - Expected: PASS.

### Task 3: Admin Bid QA Routes And API Client

**Files:**
- Create: `frontend/src/app/api/admin/bids/qa/route.ts`
- Create: `frontend/src/app/api/admin/bids/qa/route.test.ts`
- Create: `frontend/src/app/api/admin/bids/qa/[id]/route.ts`
- Create: `frontend/src/app/api/admin/bids/qa/[id]/route.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`

- [x] **Step 1: Write failing route tests**
  - GET denies unauthenticated requests without local bypass.
  - GET returns QA summary/items with local bypass.
  - PATCH denies support/non-admin mutation by using `requireAdminAccess(..., { roles: ["admin", "operator"] })`.
  - PATCH validates review status and returns `INVALID_REQUEST` for unknown values.
  - PATCH updates review status/note.
  - Run: `npm test -- src/app/api/admin/bids/qa/route.test.ts src/app/api/admin/bids/qa/[id]/route.test.ts`
  - Expected: FAIL because routes do not exist.

- [x] **Step 2: Implement route handlers**
  - Follow existing admin route error shape.
  - GET query params: `limit`, `q`, `stateCode`, `reviewStatus`, `archiveStatus`.
  - PATCH body: `{ reviewStatus, note }`.
  - Local bypass principal should write reviewer as `local-bypass`; admin/operator principal writes user id.

- [x] **Step 3: Add API client helpers**
  - Export repository response/item types.
  - Add `listAdminBidQaItems(filters)` and `updateAdminBidQaReview(id, input)`.

- [x] **Step 4: Run GREEN**
  - Run route tests plus `npm test -- src/lib/api/admin.test.ts` if that file exists.

### Task 4: Admin UI QA Queue

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/app/admin/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [x] **Step 1: Write failing UI source test**
  - Assert Admin page imports/uses `listAdminBidQaItems` and `updateAdminBidQaReview`.
  - Assert page contains `admin.bidQa`, `admin.qualityScore`, `admin.archiveIssues`, and `admin.markReviewed`.
  - Run: `npm test -- src/app/admin/page.test.ts`
  - Expected: FAIL.

- [x] **Step 2: Implement compact QA section**
  - Load QA queue in existing `Promise.all`.
  - Add QA summary cards or badges.
  - Render rows with title, source/state, quality score, review status, archive issue count, and due date.
  - Add action buttons for `Reviewed` and `Needs review` for admin/operator only.
  - Keep support role read-only.

- [x] **Step 3: Run GREEN**
  - Run: `npm test -- src/app/admin/page.test.ts`
  - Expected: PASS.

### Task 5: Verification And Commit

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] **Step 1: Update status docs**
  - Mark Admin Bid QA Console thin slice complete.
  - Remaining work: correction editing, publish/unpublish controls, original-vs-corrected field preservation, deeper quality filters.

- [x] **Step 2: Run full verification**
  - `npm test`
  - `PYTHONPATH=crawler python3 -m pytest crawler/tests`
  - `npm run lint`
  - `npm run build`
  - `npm run db:migrate`
  - `npm audit --omit=dev --audit-level=high`
  - `git diff --check`

- [x] **Step 3: Commit**
  - `git add -A`
  - `git commit -m "feat: add admin bid qa queue"`
