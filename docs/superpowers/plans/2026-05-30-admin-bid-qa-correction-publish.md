# Admin Bid QA Correction Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin/operator users correct limited bid fields, preserve original crawler values, and publish or suppress bid records from the Admin QA queue.

**Architecture:** Add a `display_status` column to `bids` and a `bid_field_corrections` audit table. Extend the existing Admin Bid QA repository and routes instead of creating a second workflow. Public bid repository queries filter out suppressed records so hidden QA records stop appearing in search/detail.

**Tech Stack:** Next.js App Router handlers, Drizzle SQLite schema/migrations, Vitest TDD tests, existing Admin auth and Admin page patterns.

---

### Task 1: Correction And Display Schema

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`

- [x] **Step 1: Write RED schema test**
  - Assert `bids` includes `display_status`.
  - Assert `bid_field_corrections` table includes `id`, `bid_id`, `field_name`, `original_value`, `corrected_value`, `note`, `corrected_by`, `corrected_at`.
  - Run: `npm test -- src/server/db/schema.test.ts`
  - Expected: FAIL.

- [x] **Step 2: Implement schema/migration**
  - Add `bids.displayStatus = text("display_status").notNull().default("published")`.
  - Add `bidFieldCorrections` table with bid foreign key and audit fields.
  - Add migration create table and idempotent `display_status` column guard.

- [x] **Step 3: Run GREEN**
  - Run: `npm test -- src/server/db/schema.test.ts`
  - Expected: PASS.

### Task 2: Repository Correction And Publish Behavior

**Files:**
- Modify: `frontend/src/server/admin/bid-qa-repository.ts`
- Modify: `frontend/src/server/admin/bid-qa-repository.test.ts`
- Modify: `frontend/src/server/bids/repository.ts`
- Modify: `frontend/src/server/bids/repository.test.ts`

- [x] **Step 1: Write RED repository tests**
  - Admin QA item exposes `displayStatus` and `correctionCount`.
  - `updateAdminBidQaCorrection()` updates allowed fields and writes one correction row per changed field with original/corrected values.
  - `updateAdminBidQaDisplayStatus()` changes display status to `published`, `pending_qa`, or `suppressed`.
  - Public `listBids()` and `getBidByIdFromRepository()` exclude suppressed records.

- [x] **Step 2: Implement repository**
  - Add types:
    - `AdminBidQaDisplayStatus = "pending_qa" | "published" | "suppressed"`
    - `AdminBidQaCorrectionField = "title" | "deadlineDate" | "issuerName" | "amount" | "originalCategory" | "sourceUrl" | "contactName" | "contactEmail" | "contactPhone"`
  - Validate allowed fields in repository, not in UI.
  - On correction, update normalized bid columns and insert audit rows.
  - On display status update, update `display_status`, review metadata, and `updated_at`.
  - In public bid repository, add `display_status != 'suppressed'` to list/detail reads.

- [x] **Step 3: Run GREEN**
  - Run: `npm test -- src/server/admin/bid-qa-repository.test.ts src/server/bids/repository.test.ts`
  - Expected: PASS.

### Task 3: Admin Routes And API Client

**Files:**
- Modify: `frontend/src/app/api/admin/bids/qa/[id]/route.ts`
- Modify: `frontend/src/app/api/admin/bids/qa/[id]/route.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`
- Modify: `frontend/src/lib/api/admin.test.ts`

- [x] **Step 1: Write RED route/client tests**
  - PATCH accepts `{ displayStatus }` and calls display-status updater.
  - PATCH accepts `{ corrections, note }` and calls correction updater.
  - PATCH rejects unsupported correction fields and invalid display statuses.
  - API client can send review, display status, and correction inputs.

- [x] **Step 2: Implement route/client**
  - Keep route roles as admin/operator.
  - Allow exactly one action family per PATCH: review status, display status, or corrections.
  - Reuse existing response shape `{ item }`.

- [x] **Step 3: Run GREEN**
  - Run: `npm test -- src/app/api/admin/bids/qa/[id]/route.test.ts src/lib/api/admin.test.ts`
  - Expected: PASS.

### Task 4: Admin UI Thin Controls

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/app/admin/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [x] **Step 1: Write RED UI source test**
  - Assert Admin page contains correction controls and publish/suppress labels.
  - Assert page uses `displayStatus`, `correctionCount`, and `updateAdminBidQaReview` for display/correction updates.

- [x] **Step 2: Implement compact controls**
  - Add display status badge and Publish/Suppress buttons.
  - Add inline correction controls for `title` and `deadlineDate` only in this thin slice.
  - Support role remains read-only.
  - After an update, reload QA items so summary/counts stay current.

- [x] **Step 3: Run GREEN**
  - Run: `npm test -- src/app/admin/page.test.ts`
  - Expected: PASS.

### Task 5: Verification And Commit

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] **Step 1: Update status docs**
  - Mark correction/publish thin slice complete.
  - Remaining work: batch actions, richer filters, original/corrected comparison UI, correction history panel.

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
  - `git commit -m "feat: add bid qa correction publish controls"`
