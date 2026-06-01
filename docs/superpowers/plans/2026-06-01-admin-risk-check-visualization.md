# Admin Risk Check Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing risk-check report inside the Admin console.

**Architecture:** Reuse `frontend/src/server/risk/checklist.ts` as the single source of truth. Add one read-only Admin API, one typed client helper, and a compact dashboard section in `frontend/src/app/admin/page.tsx`.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, existing Admin auth, existing i18n dictionaries.

---

### Task 1: Admin Risk Check API

**Files:**
- Create: `frontend/src/app/api/admin/risk-check/route.ts`
- Create: `frontend/src/app/api/admin/risk-check/route.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`

- [ ] Write a failing route test that mocks `requireAdminAccess()` and `createRiskChecklistReport()` and expects `GET /api/admin/risk-check` to return `{ report }`.
- [ ] Run `npm test -- src/app/api/admin/risk-check/route.test.ts` and confirm the route module is missing.
- [ ] Implement the route with `requireAdminAccess(db, request)` and `createRiskChecklistReport(db)`.
- [ ] Add exported client types and `getAdminRiskChecklist()` to `frontend/src/lib/api/admin.ts`.
- [ ] Run the route test and a focused admin API client/static test if one exists.

### Task 2: Admin Page Integration

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/app/admin/page.test.ts` if present; otherwise create static assertions in the nearest admin page test.
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] Write a failing static test that asserts the Admin page imports/calls `getAdminRiskChecklist`, includes `riskReport` in ready state, and renders `admin.riskCheck`.
- [ ] Run the focused page test and confirm failure.
- [ ] Add `riskReport` to `LoadState`, fetch it in `Promise.all`, and render the risk panel above Bid QA.
- [ ] Add English and Chinese Admin dictionary keys for title, pass/fail labels, checked timestamp, and empty detail text.
- [ ] Run focused admin page/i18n tests.

### Task 3: Verification and Docs

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`

- [ ] Update implementation status to mark Admin risk-check visualization done locally and move the recommended next phase to Response Workspace Lite or Artifact Vault Lite.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm run risk:check`.
- [ ] Run `git diff --check`.
- [ ] Verify `/admin` in the browser and commit the implementation.
