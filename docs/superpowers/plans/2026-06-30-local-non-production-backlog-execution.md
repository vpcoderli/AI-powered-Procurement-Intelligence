# Local Non-Production Backlog Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining local product backlog while explicitly excluding production launch preparation.

**Architecture:** Keep production integrations behind local deterministic seams. Each track must ship a tested, demoable local capability without requiring AWS, Stripe live/sandbox credentials, production email, external CRM credentials, real LLM keys, paid source credentials, or production-like source-health networks.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, SQLite/MySQL runtime paths, existing Admin/API/service repositories, superpowers TDD workflow.

---

## Excluded From This Plan

- Real AWS/S3/RDS/App Runner deployment or staging dry-run.
- Stripe sandbox/live checkout, webhook forwarding, real keys, or billing production signoff.
- Production email provider credentials or real outbound email.
- External CRM credentials or production sync acceptance.
- Real LLM, embedding provider, vector database, or real credit debit.
- CAPTCHA bypass, stored portal credentials, automatic login to restricted sources, paid/credentialed source crawling.
- Backup/restore drill, production worker owner signoff, Secrets Manager population.

## Track A: 50-State Data Operations Depth

### A1. State Quality Action Queue

**Status:** Done locally on 2026-06-30.

**Files:**
- Modified: `frontend/src/server/source-validity/state-data-quality.ts`
- Modified: `frontend/src/server/source-validity/state-data-quality.test.ts`
- Modified: `frontend/src/app/api/admin/risk-check/route.test.ts`
- Modified: `frontend/src/app/admin/page.tsx`
- Modified: `frontend/src/app/admin/page.test.ts`

- [x] **Step 1: Write failing server test**

Expected behavior: `createStateDataQualityReport()` exposes `actions[]` sorted by P0/P1/P2 with `stateCode`, `sourceId`, `reasonCode`, `recommendedAction`, `ownerHint`, `dueInHours`, and `evidence`.

- [x] **Step 2: Watch it fail**

Run: `npm test -- src/server/source-validity/state-data-quality.test.ts src/app/admin/page.test.ts`

Expected: FAIL because `report.actions` is undefined and Admin page lacks action queue text.

- [x] **Step 3: Implement action queue**

Implementation: derive actions from existing row reason codes. No new database table.

- [x] **Step 4: Add Admin UI display**

Implementation: show top 6 actions inside `StateDataQualityMatrix` with priority, owner hint, due hours, recommended action, and evidence.

- [x] **Step 5: Verify focused tests**

Run: `npm test -- src/server/source-validity/state-data-quality.test.ts src/app/api/admin/risk-check/route.test.ts src/app/admin/page.test.ts`

Expected: PASS.

### A2. Attachment Depth Worklist

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/source-validity/state-data-quality.ts`
- Modify: `frontend/src/server/source-validity/state-data-quality.test.ts`
- Modify: `frontend/scripts/state-data-quality-check.ts`
- Modify: `frontend/scripts/state-data-quality-check.test.ts`

- [x] **Step 1: Write failing test for attachment worklist**

Add a test that seeds two `not_archived` attachments and expects `report.attachmentWorklist[]` with `stateCode`, `sourceId`, `bidId`, `attachmentId`, `name`, `archiveStatus`, `recommendedAction`.

- [x] **Step 2: Watch it fail**

Run: `npm test -- src/server/source-validity/state-data-quality.test.ts scripts/state-data-quality-check.test.ts`

Expected: FAIL because `attachmentWorklist` does not exist.

- [x] **Step 3: Implement derived worklist**

Add a derived worklist from existing bid/attachment rows. Do not call external URLs.

- [x] **Step 4: Update CLI summary**

`formatStateDataQualityReport()` should include attachment worklist counts by state/source.

- [x] **Step 5: Verify**

Run: `npm test -- src/server/source-validity/state-data-quality.test.ts scripts/state-data-quality-check.test.ts`

Expected: PASS.

### A3. Admin Source Ops Filters

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/app/admin/page.test.ts`
- Modify: `frontend/src/app/admin/page.test.tsx`

- [x] **Step 1: Write failing tests**

Add tests for filtering Data Sources by triage status and recommended action.

- [x] **Step 2: Watch them fail**

Run: `npm test -- src/app/admin/page.test.ts src/app/admin/page.test.tsx`

Expected: FAIL because filters do not exist.

- [x] **Step 3: Implement filter helpers and UI controls**

Add triage status and recommended action segmented/select controls. Keep existing classification filter.

- [x] **Step 4: Verify**

Run: `npm test -- src/app/admin/page.test.ts src/app/admin/page.test.tsx`

Expected: PASS.

## Track B: Marketing CRM/CMS Depth

### B1. Local CRM Sync Adapter

**Status:** Done locally on 2026-06-30.

**Files:**
- Create: `frontend/src/server/marketing/crm.ts`
- Create: `frontend/src/server/marketing/crm.test.ts`
- Modify: `frontend/src/server/events/event-log.ts`
- Modify: `frontend/src/server/events/event-log.test.ts`
- Modify: `frontend/src/server/marketing/export.ts`
- Modify: `frontend/src/server/marketing/export.test.ts`

- [x] **Step 1: Write failing CRM adapter tests**

Expected behavior: pending `crm.marketing_leads` outbox rows can be delivered by a local fake adapter and failures update status/attempt/last_error.

- [x] **Step 2: Watch them fail**

Run: `npm test -- src/server/marketing/crm.test.ts src/server/events/event-log.test.ts src/server/marketing/export.test.ts`

Expected: FAIL because CRM delivery adapter does not exist.

- [x] **Step 3: Implement local fake adapter**

No real CRM credentials. Use event metadata and mark outbox delivered/failed through existing outbox delivery functions.

- [x] **Step 4: Verify**

Run focused command above plus `npm run worker:events:check` if the script exists.

### B2. Marketing Email Delivery Seam

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/marketing/ops.ts`
- Modify: `frontend/src/server/marketing/ops.test.ts`
- Modify: `frontend/src/server/notifications/*`
- Modify: `frontend/src/server/marketing/export.ts`
- Modify: `frontend/src/server/marketing/export.test.ts`

- [x] **Step 1: Write failing tests for marketing notification delivery status**

Expected behavior: Request Demo notification status can move pending -> sent/failed through local fake provider and is visible in CSV.

- [x] **Step 2: Watch them fail**

Run: `npm test -- src/server/marketing/ops.test.ts src/server/marketing/export.test.ts`

- [x] **Step 3: Implement local provider seam**

No real outbound email.

- [x] **Step 4: Verify**

Run focused command and notification worker check if available.

### B3. Config/CMS-backed Marketing Content

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/config/registry.ts`
- Create: `frontend/src/server/marketing/content-config.ts`
- Create: `frontend/src/server/marketing/content-config.test.ts`
- Modify: `frontend/src/lib/marketing/homepage-content.ts`
- Modify: `frontend/src/lib/marketing/resource-content.ts`
- Modify: `frontend/src/app/admin/page.tsx`

- [x] **Step 1: Write failing safe content resolver tests**

Expected behavior: active config can override safe marketing content; unsafe claims fall back or fail validation.

- [x] **Step 2: Watch tests fail**

Run: `npm test -- src/server/marketing/content-config.test.ts src/server/config/registry.test.ts src/lib/marketing/homepage-content.test.ts src/lib/marketing/resource-content.test.ts`

- [x] **Step 3: Implement config resolver**

No external CMS.

- [x] **Step 4: Verify**

Run focused command.

## Track C: Procurement Workflow Depth

### C1. Artifact Compliance Auto-link

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/response-workspace/service.ts`
- Modify: `frontend/src/server/response-workspace/service.test.ts`
- Modify: `frontend/src/server/submission/service.ts`
- Modify: `frontend/src/server/submission/service.test.ts`

- [x] **Step 1: Write failing test for auto-linking artifacts to compliance/submission evidence**
- [x] **Step 2: Watch it fail**
- [x] **Step 3: Implement deterministic local auto-linking**
- [x] **Step 4: Verify focused tests**

### C2. Quote Comparison Lite

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/quotes/service.ts`
- Modify: `frontend/src/server/quotes/service.test.ts`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`

- [x] **Step 1: Write failing test for comparison summary**
- [x] **Step 2: Watch it fail**
- [x] **Step 3: Implement deterministic comparison**
- [x] **Step 4: Verify focused tests**

### C3. Win/Loss Learning Loop Lite

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/awards/*`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`

- [x] **Step 1: Write failing test for outcome learning summary**
- [x] **Step 2: Watch it fail**
- [x] **Step 3: Implement local read model**
- [x] **Step 4: Verify focused tests**

## Track D: AI / Enterprise Lite

### D1. RAG-ready Knowledge Retrieval Contract

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/knowledge/types.ts`
- Modify: `frontend/src/server/knowledge/retrieval.ts`
- Modify: `frontend/src/server/knowledge/retrieval.test.ts`
- Modify: `frontend/src/app/api/knowledge/route.ts`
- Modify: `frontend/src/lib/api/knowledge.ts`

- [x] **Step 1: Write failing retrieval contract test**
- [x] **Step 2: Watch it fail**
- [x] **Step 3: Implement lexical mock RAG chunks and trace**
- [x] **Step 4: Verify focused tests**

### D2. Grounded QA v2 Mock

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/server/qualification/types.ts`
- Modify: `frontend/src/server/qualification/qa.ts`
- Modify: `frontend/src/server/qualification/qa.test.ts`
- Modify: `frontend/src/app/api/intents/[id]/qa/route.ts`
- Modify: `frontend/src/app/intents/[id]/page.tsx`

- [x] **Step 1: Write failing QA v2 tests**
- [x] **Step 2: Watch them fail**
- [x] **Step 3: Implement evidence coverage and limitations**
- [x] **Step 4: Verify focused tests**

### D3. Product 6 Intelligence Lite

**Status:** Done locally on 2026-06-30.

**Files:**
- Create: `frontend/src/server/intelligence/types.ts`
- Create: `frontend/src/server/intelligence/service.ts`
- Create: `frontend/src/server/intelligence/service.test.ts`
- Create: `frontend/src/app/api/dashboard/intelligence/route.ts`
- Create: `frontend/src/lib/api/intelligence.ts`

- [x] **Step 1: Write failing deterministic intelligence tests**
- [x] **Step 2: Watch them fail**
- [x] **Step 3: Implement local read model**
- [x] **Step 4: Verify focused tests**

## Track E: UI / Permissions / Account Experience

### E0. Browser Evidence Expected Signals Gate

**Status:** Done locally on 2026-06-30.

**Files:**
- Created/modified: `frontend/scripts/demo-browser-evidence.ts`
- Created/modified: `frontend/scripts/demo-browser-evidence.test.ts`

- [x] **Step 1: Write failing expected signal tests**
- [x] **Step 2: Watch them fail**
- [x] **Step 3: Include expected signals in route pass/fail and reports**
- [x] **Step 4: Verify focused tests**

Run: `npm test -- scripts/demo-browser-evidence.test.ts`

### E1. Locked / Upgrade State Audit

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/app/local-mvp-auth-tier-boundaries.test.ts`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/settings/page.tsx`

- [x] **Step 1: Write failing tests for locked/upgrade state consistency**
- [x] **Step 2: Watch them fail**
- [x] **Step 3: Implement consistent state display**
- [x] **Step 4: Verify focused tests**

### E2. Admin vs Ordinary User Navigation Polish

**Status:** Done locally on 2026-06-30.

**Files:**
- Modify: `frontend/src/components/layout/app-sidebar.tsx`
- Modify: `frontend/src/components/layout/app-sidebar.test.ts`
- Modify: `frontend/src/app/page.test.ts`

- [x] **Step 1: Write failing navigation tests**
- [x] **Step 2: Watch them fail**
- [x] **Step 3: Implement role-aware entries**
- [x] **Step 4: Verify focused tests**

## Final Verification

- [x] Run combined focused suite for all local non-production slices: 28 files / 171 tests passed.
- [x] Run E1/E2 focused suite: 8 files / 65 tests passed.
- [x] Run `npm test`: 254 files / 1,292 tests passed.
- [x] Run `npm run lint`: passed.
- [x] Run `npm run build`: passed.
- [x] Run `.env.local` loaded `npm run db:mysql:migrate`: 52 applied / 150 skipped.
- [x] Run `.env.local` loaded `npm run db:mysql:smoke`: 53 tables verified.
- [x] Run `.env.local` loaded `npm run demo:check`: runtime mysql, 50/50 states, 216 safe local routes, 0 placeholder URLs.
- [x] Run `npm run risk:check`: product gates passed and npm audit reported 0 vulnerabilities after dependency audit fix.
- [x] Run `git diff --check`: passed.
- [x] Update `docs/product-requirements/winbids-implementation-status.md`.
- [x] Update `docs/product-requirements/winbids-next-development-plan.md`.
