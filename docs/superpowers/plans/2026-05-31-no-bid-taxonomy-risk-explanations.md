# Product 2 No-Bid Taxonomy + Qualification Risk Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured pursue/no-bid reason taxonomy and deterministic risk explanations to make pursuit decisions more auditable.

**Architecture:** Extend the existing `PursuitRecommendation` response with additive `reasonDetails` that contain stable taxonomy categories, severity, evidence labels, and explanatory text. Keep `reasons: string[]` for backward compatibility, avoid schema changes, and render the details in the existing Intent detail Pursue / No-Bid panel.

**Tech Stack:** Next.js App Router, TypeScript, existing Pursuit service/generator, Vitest, current i18n dictionaries.

---

### Task 1: Taxonomy Types And RED Tests

**Files:**
- Modify: `frontend/src/server/pursuit/types.ts`
- Modify: `frontend/src/server/pursuit/service.test.ts`

- [x] Add failing tests proving recommendation responses include stable reason details with category, severity, summary, explanation, evidence label, and suggested action.
- [x] Add failing tests proving weak match / many risk flags produce no-bid oriented categories such as `fit`, `risk`, `deadline`, and `profile`.
- [x] Add failing tests proving saved decision history remains unchanged and only recommendation output gets enriched.

### Task 2: Deterministic Risk Explanation Generator

**Files:**
- Modify: `frontend/src/server/pursuit/types.ts`
- Modify: `frontend/src/server/pursuit/generator.ts`
- Test: `frontend/src/server/pursuit/service.test.ts`

- [x] Add `PursuitReasonCategory`, `PursuitReasonSeverity`, and `PursuitReasonDetail` types.
- [x] Generate reason details from match score, component scores, risk flags, missing profile hints, deadline availability, compliance/addenda hints, and buyer/source evidence.
- [x] Preserve existing `reasons` strings by deriving them from the detail summaries.
- [x] Keep existing recommendation thresholds unless the new taxonomy exposes an obvious deterministic no-bid risk.

### Task 3: API / Client Compatibility

**Files:**
- Modify: `frontend/src/app/api/intents/[id]/decision/route.test.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`

- [x] Update route/API client tests to assert `reasonDetails` is present in `decisionBoard.recommendation`.
- [x] Confirm PATCH decision payload and stored history still use `reasons` and `notes` without requiring taxonomy input.

### Task 4: Intent Detail UI

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [x] Render structured recommendation details in the Pursue / No-Bid panel using compact cards.
- [x] Show category, severity, evidence label, explanation, and suggested action.
- [x] Keep the existing free-form reason textarea and decision history unchanged.
- [x] Add English and Chinese labels for categories, severities, evidence, and actions.

### Task 5: Documentation And Verification

**Files:**
- Modify: `docs/product-requirements/README.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`
- Modify: `docs/product-requirements/winbids-current-gap-analysis.md`

- [x] Mark Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1 completed.
- [x] Update the next recommended phase to richer evidence/artifact links or Knowledge Station Lite.
- [x] Run focused tests, `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, crawler pytest, npm audit high threshold, and `git diff --check`.
