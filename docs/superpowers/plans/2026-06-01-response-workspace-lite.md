# Response Workspace Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin response workspace panel to Intent detail with tasks, checkpoints, artifact placeholders, and response outline items.

**Architecture:** Store all Lite workspace records in one `response_workspace_items` table keyed by intent/bid/user. Reuse existing intent lookup and feature-gate patterns; expose one GET/PATCH route; render the grouped rows in the existing Intent workspace page.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle SQLite, Vitest, existing feature gates and i18n dictionaries.

---

### Task 1: Schema and Service

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`
- Create: `frontend/src/server/response-workspace/types.ts`
- Create: `frontend/src/server/response-workspace/repository.ts`
- Create: `frontend/src/server/response-workspace/generator.ts`
- Create: `frontend/src/server/response-workspace/service.ts`
- Create: `frontend/src/server/response-workspace/service.test.ts`

- [ ] Write failing tests for table creation, default workspace seeding, summary counts, item update, and invalid status rejection.
- [ ] Add `responseWorkspaceItems` schema and migration SQL.
- [ ] Add response workspace types, deterministic generator, repository, and service.
- [ ] Run focused schema/service tests until green.

### Task 2: API and Client

**Files:**
- Create: `frontend/src/app/api/intents/[id]/response-workspace/route.ts`
- Create: `frontend/src/app/api/intents/[id]/response-workspace/route.test.ts`
- Modify: `frontend/src/lib/api/intents.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`
- Modify: `frontend/src/server/auth/feature-gate-routes.ts`

- [ ] Write failing route/client/coverage tests for `response.workspace.create`.
- [ ] Implement GET/PATCH route using `requireFeature(principal, "response.workspace.create")`.
- [ ] Add `fetchResponseWorkspace()` and `updateResponseWorkspaceItem()` client helpers.
- [ ] Register the route in `FEATURE_API_COVERAGE` and remove `response.workspace.create` from unimplemented coverage.
- [ ] Run focused API/client/coverage tests until green.

### Task 3: Intent Detail UI

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] Write failing static page test for `response.workspace.create`, `fetchResponseWorkspace`, `updateResponseWorkspaceItem`, and `responseWorkspace`.
- [ ] Add state/effect/handler for response workspace loading and item updates.
- [ ] Add grouped UI section with locked state, summary badges, status select, and notes editor.
- [ ] Add English/Chinese labels.
- [ ] Run focused page tests until green.

### Task 4: Verification and Status

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`

- [ ] Mark Response Workspace Lite done locally and move the next recommendation to Artifact Vault Lite or Quote / Supply Chain Lite.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm run risk:check`.
- [ ] Run `git diff --check`.
- [ ] Browser verify `/intents/[id]` as a business/enterprise user and commit.
