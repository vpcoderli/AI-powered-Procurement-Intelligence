# Qualification Evidence Citations v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted, read-only evidence citations for Intent workspace qualification outputs.

**Architecture:** Store a small `evidence_citations_json` snapshot on `intent_to_bid`, generated from existing bid fields, source/detail archive metadata, attachments, and deterministic output sections. Expose it through a read-only Intent API and show it in the Intent detail page without introducing LLM dependencies or changing existing Submission/Compliance/Decision wire shapes.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle SQLite, Vitest, existing WinBids API client and bilingual dictionaries.

---

### Task 1: Data Model And Service

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`
- Modify: `frontend/src/server/intents/repository.ts`
- Create: `frontend/src/server/qualification/types.ts`
- Create: `frontend/src/server/qualification/citations.ts`
- Create: `frontend/src/server/qualification/citations.test.ts`

- [ ] Add `intent_to_bid.evidence_citations_json` with default `[]`.
- [ ] Write schema and service tests first.
- [ ] Implement citation generation, persistence, and safe JSON parsing.

### Task 2: API And Client

**Files:**
- Create: `frontend/src/app/api/intents/[id]/citations/route.ts`
- Create: `frontend/src/app/api/intents/[id]/citations/route.test.ts`
- Modify: `frontend/src/lib/api/intents.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`

- [ ] Add `GET /api/intents/[id]/citations`.
- [ ] Reuse the current principal/session pattern.
- [ ] Return `INTENT_NOT_FOUND` for inaccessible or missing intents.

### Task 3: Intent UI

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] Load citations alongside the intent workspace.
- [ ] Render a compact evidence panel near the generated brief.
- [ ] Keep the panel read-only and resilient to empty citations.

### Task 4: Verification And Backlog

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [ ] Mark Citation v1 as complete after tests pass.
- [ ] Set next recommended slice to document-grounded Q&A or alert history.
- [ ] Run focused tests, full `npm test`, lint, build, db migrate, audit, and diff check.
