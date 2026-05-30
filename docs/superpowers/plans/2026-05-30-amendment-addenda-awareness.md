# Product 2 Amendment/Addenda Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect amendment/addenda signals for an intent, show whether qualification evidence may be stale, and let users refresh deterministic qualification output.

**Architecture:** Add a focused qualification freshness read model that inspects current bid fields and attachments, compares signal timestamps against persisted citation timestamps, and exposes GET/POST APIs. Refresh regenerates the intent brief, match snapshot, and evidence citations while leaving user-edited submission/compliance/decision records untouched.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle SQLite, existing Intent service/repository, existing qualification citations, Vitest.

---

### Task 1: Freshness Model And RED Tests

**Files:**
- Create: `frontend/src/server/qualification/freshness.ts`
- Create: `frontend/src/server/qualification/freshness.test.ts`
- Modify: `frontend/src/server/qualification/types.ts`

- [x] Write tests that detect addendum/amendment signals in bid title, description, full description, and attachments.
- [x] Write tests that report `not_refreshed` when no citation snapshot exists.
- [x] Write tests that report `stale` when an addendum attachment was fetched after the latest citation `generatedAt`.
- [x] Write tests that report `current` when citations are newer than all amendment signals.

### Task 2: Refresh Service And Repository Update

**Files:**
- Modify: `frontend/src/server/intents/repository.ts`
- Modify: `frontend/src/server/qualification/citations.ts`
- Modify: `frontend/src/server/qualification/freshness.ts`
- Test: `frontend/src/server/qualification/freshness.test.ts`

- [x] Add a repository helper that updates `ai_bid_brief`, `key_dates_json`, `initial_checklist_json`, `risk_flags_json`, `match_score_snapshot_json`, and `evidence_citations_json` together.
- [x] Export the citation generator as a safe builder for refresh reuse.
- [x] Implement `refreshQualificationEvidence()` to regenerate brief, match, and citations for the scoped intent.
- [x] Verify refresh does not create or modify submission/compliance/decision rows.

### Task 3: API And Client

**Files:**
- Create: `frontend/src/app/api/intents/[id]/qualification/freshness/route.ts`
- Create: `frontend/src/app/api/intents/[id]/qualification/freshness/route.test.ts`
- Modify: `frontend/src/lib/api/intents.ts`

- [x] Add `GET /api/intents/[id]/qualification/freshness`.
- [x] Add `POST /api/intents/[id]/qualification/freshness` to refresh.
- [x] Preserve principal cookie behavior and `INTENT_NOT_FOUND` error handling.
- [x] Add API client helpers `fetchQualificationFreshness` and `refreshQualificationEvidence`.

### Task 4: Intent Detail UI

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [x] Load freshness state beside existing citations.
- [x] Show a compact status panel in the evidence area with current/stale/not refreshed labels and signal count.
- [x] Add a refresh button that calls the POST API, updates intent/citations/freshness state, and clears Q&A answers so new questions use the refreshed snapshot.
- [x] Add English and Chinese copy.

### Task 5: Documentation And Verification

**Files:**
- Modify: `docs/product-requirements/README.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] Mark Amendment/Addenda Awareness v1 completed.
- [x] Update next recommended phase.
- [x] Run focused tests, `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, crawler pytest, npm audit high threshold, and `git diff --check`.
