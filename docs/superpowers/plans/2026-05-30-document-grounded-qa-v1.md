# Document-Grounded Q&A v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user ask a question inside an intent workspace and receive an answer grounded only in that intent's evidence citations.

**Architecture:** Add a small deterministic Q&A layer under `frontend/src/server/qualification` that reuses `getOrCreateQualificationCitations`, ranks citation excerpts against the question, and returns an answer plus the cited evidence. Add a POST API under the intent route and wire the intent detail page to submit questions, display the answer, and show the supporting citations.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Drizzle SQLite, existing feature gates and i18n dictionaries.

---

### Task 1: Qualification Q&A Service

**Files:**
- Create: `frontend/src/server/qualification/qa.ts`
- Modify: `frontend/src/server/qualification/types.ts`
- Test: `frontend/src/server/qualification/qa.test.ts`

- [x] Write failing tests for deadline-focused grounded answers and suppressed-bid access denial.
- [x] Implement question validation, token scoring, citation selection, and answer formatting.
- [x] Reuse `getOrCreateQualificationCitations` so workspace scope and suppressed-bid checks stay centralized.

### Task 2: Intent Q&A API

**Files:**
- Create: `frontend/src/app/api/intents/[id]/qa/route.ts`
- Create: `frontend/src/app/api/intents/[id]/qa/route.test.ts`
- Modify: `frontend/src/lib/api/intents.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`

- [x] Write failing route tests for success, invalid question, feature gate, and missing intent.
- [x] Add `postQualificationQuestion(id, input)` client helper and encoded-id test.
- [x] Implement POST route with anonymous cookie handling, `bid.brief.full.generate` feature gate, and existing error response shapes.

### Task 3: Intent Detail UI

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [x] Write failing static UI test for the Q&A state, API helper, feature gate, and i18n keys.
- [x] Add a compact Q&A panel below evidence citations with textarea, ask button, loading/error states, answer text, and cited evidence list.
- [x] Keep links sanitized through the existing `safeEvidenceUrl` helper.

### Task 4: Docs And Verification

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] Mark Document-Grounded Q&A v1 complete and move the recommended next phase to Search Alerts notification history or crawler beta monitoring.
- [x] Run focused tests, then full `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, crawler tests, audit, and `git diff --check`.
