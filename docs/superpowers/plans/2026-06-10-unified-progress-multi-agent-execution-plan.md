# Unified Progress Multi-Agent Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advance WinBids from the unified progress baseline toward a cleaner demoable MVP, production readiness, stronger commercial loop, deeper procurement workflow, and first real AI/Enterprise foundations.

**Architecture:** Work is split by product track so agents can operate independently with low merge conflict risk. Each track owns a disjoint primary file/code area and must end with focused tests plus the shared regression gate. The controller integrates status into `docs/product-requirements/winbids-implementation-status.md`, `docs/product-requirements/winbids-local-usable-mvp-plan.md`, and `docs/product-requirements/winbids-next-development-plan.md`.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, MySQL/SQLite runtime paths, local worker scripts, Stripe foundation, local file/object storage abstraction, Markdown documentation.

---

## Unified Progress Baseline

| Dimension | Completion | Working baseline | Main unfinished work |
|---|---:|---|---|
| Local usable MVP | 80% | Search, 50-state data, accounts, permissions, Intent workspace, Response Workspace, Artifact Vault, Quote, Deadline reminders can run locally. | Demo stability, real-page UI/UE, visible source-risk explanation, advanced package formats. |
| Production launch readiness | 60% | MySQL, AWS docs, worker/runbooks, production preflight, risk checks exist. | Real AWS dry run, real Stripe, email provider, backup/restore drill, production worker execution. |
| Commercialization loop | 65% | Registration/login, admin/user separation, tier gates, Stripe foundation. | Real Stripe sandbox/live E2E, portal/cancel/dunning operational validation, plan entitlement operations. |
| Procurement workflow depth | 65% | Submission, Compliance, Pursue/No-Bid, Response, Artifact, Quote, Deadline Lite modules exist. | Award, Win/Loss, advanced package formats, deeper submission evidence/history, production artifact storage. |
| AI/Enterprise depth | 20-30% | Deterministic/AI-like summaries, citations/freshness/Q&A surface, Knowledge Station Lite, credit metadata. | Real LLM extraction, embeddings/retrieval, credit metering, Product 6 intelligence datasets. |
| Full PRD / long-term platform | 50-55% | Foundation and major local workflows exist. | Long-term intelligence, production operations, enterprise governance, advanced workflow depth. |

## Agent Allocation

| Agent | Track | Primary ownership | Must not edit |
|---|---|---|---|
| Agent A | MVP Stabilization / UI | `frontend/src/app/page.tsx`, `frontend/src/app/search`, `frontend/src/app/bids/[id]`, `frontend/src/app/intents/[id]`, `frontend/src/app/settings`, `frontend/src/app/admin`, shared page tests only when assigned. | Billing, Stripe, production worker scripts, AI service internals. |
| Agent B | Production Readiness | `docs/operations/*`, `docs/transferability/*`, `frontend/scripts/production-readiness-check.ts`, worker runbook/preflight tests. | UI page implementation and billing business logic unless needed for env validation. |
| Agent C | Commercialization / Billing | `frontend/src/server/billing/*`, `frontend/src/app/api/account/subscription*`, `frontend/src/app/api/billing/webhook`, Settings Billing/Usage tests/docs. | 50-state crawler adapters and UI redesign. |
| Agent D | Procurement Workflow Depth | `frontend/src/server/submission`, `frontend/src/server/response-workspace`, `frontend/src/server/artifacts`, `frontend/src/server/quotes`, `frontend/src/server/deadlines`, new award/win-loss modules. | Stripe provider code and AWS runbooks. |
| Agent E | AI / Enterprise Depth | `frontend/src/server/knowledge`, `frontend/src/server/qualification`, credit metadata/ledger code, AI/Knowledge docs. | Production deployment scripts and broad UI restyling. |
| Controller | Integration / docs / verification | `docs/product-requirements/*`, plan tracking, final regression, conflict resolution. | No overlapping feature edits while workers own a slice. |

## P0: Demo Stabilization And Product Polish

**Target:** Raise local MVP from 80% toward 88% by making the current working system easier to demonstrate.

**Owner:** Agent A, with Controller integration.

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/search/page.tsx`
- Modify: `frontend/src/app/bids/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/settings/page.tsx`
- Modify: `frontend/src/app/admin/page.tsx`
- Test: existing colocated `*.test.ts` / `*.test.tsx` files under the same app areas.
- Docs: `docs/product-requirements/winbids-implementation-status.md`

- [ ] **Step 1: Browser audit real demo journey**

Run the app against MySQL and record visible issues for:

```bash
cd frontend
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run dev -- --port 3000
```

Expected result: anonymous home/search, login/register, bid detail, Intent auth gate, normal user settings, paid user Intent modules, and admin console can be opened without placeholder evidence links or confusing duplicate dashboard/search content.

- [ ] **Step 2: Dashboard/search separation**

Make dashboard focus on workspace summary, notifications, plan/source health, recent activity, and next actions. Keep bid list discovery on `/search`.

Run:

```bash
cd frontend
npm test -- src/app/page.test.ts
```

Expected: dashboard tests pass and do not assert duplicated search-result behavior.

- [ ] **Step 3: High-visibility UI consistency**

Normalize empty/loading/error/locked states on `/search`, `/bids/[id]`, `/intents/[id]`, `/settings`, and `/admin` using existing `UniversalState` and established shell components.

Run:

```bash
cd frontend
npm test -- src/app/local-mvp-auth-tier-boundaries.test.ts src/app/layout.test.ts src/components/layout/app-sidebar.test.ts
```

Expected: anonymous, signed-in, admin, and locked/upgrade boundaries still pass.

- [ ] **Step 4: Demo route smoke**

Use Browser to verify:

```text
http://localhost:3000/
http://localhost:3000/search
http://localhost:3000/bids/1
http://localhost:3000/intents
http://localhost:3000/settings
http://localhost:3000/admin
```

Expected: admin and ordinary user views differ; anonymous users see public browsing and sign-in/create-account states; no active evidence link points to known placeholder `sam.gov/opp/12345`.

## P0: Production Readiness Parallel Track

**Target:** Raise production readiness from 60% toward 70% without needing live launch credentials for code-only progress.

**Owner:** Agent B.

**Files:**
- Modify: `docs/operations/aws-deployment-runbook.md`
- Modify: `docs/operations/mysql-cutover.md`
- Modify: `docs/operations/production-billing-worker-runbook.md`
- Modify: `docs/operations/source-health-check.md`
- Modify: `docs/transferability/deployment-guide.md`
- Modify: `docs/transferability/environment-variables.md`
- Modify: `docs/transferability/secrets-and-access.md`
- Modify: `frontend/scripts/production-readiness-check.ts`
- Test: `frontend/src/server/billing/production-preflight.test.ts`

- [ ] **Step 1: Production external-dependency checklist**

Update docs to clearly list AWS, Stripe, email, backup, webhook, worker, and source-health owners as required external inputs.

Run:

```bash
cd frontend
npm test -- src/server/billing/production-preflight.test.ts
```

Expected: production preflight tests pass and no secret values are printed.

- [ ] **Step 2: AWS dry-run command path**

Document a dry-run sequence for MySQL migration, app build, worker checks, source-health report-only probe, backup/restore rehearsal, and rollback decision.

Run:

```bash
cd frontend
npm run build
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run workers:check
```

Expected: commands pass locally and docs clearly mark real AWS execution as external.

## P1: Commercialization Closure

**Target:** Raise commercial loop from 65% toward 75% by making sandbox billing validation repeatable and operationally clear.

**Owner:** Agent C.

**Files:**
- Modify: `frontend/src/server/billing/stripe-sandbox-verifier.ts`
- Modify: `frontend/src/server/billing/stripe-sandbox-verifier.test.ts`
- Modify: `frontend/src/server/billing/*`
- Modify: `frontend/src/app/settings/page.tsx`
- Modify: `docs/operations/stripe-sandbox-e2e.md`
- Modify: `frontend/README.md`

- [ ] **Step 1: Stripe sandbox readiness audit**

Ensure sandbox verifier validates:

```text
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test...
STRIPE_WEBHOOK_SECRET=whsec...
STRIPE_PRICE_PRO_MONTHLY
STRIPE_PRICE_BUSINESS_MONTHLY
```

Run:

```bash
cd frontend
npm test -- src/server/billing/stripe-sandbox-verifier.test.ts
```

Expected: missing keys, non-test keys, invalid tier, and secret-redaction cases are covered.

- [ ] **Step 2: Billing UI operational copy**

Settings Billing should make local fallback vs Stripe provider state obvious and should not imply live payment works without configured Stripe test/live keys.

Run:

```bash
cd frontend
npm test -- src/app/settings/page.test.ts src/lib/api/auth.test.ts
```

Expected: billing/usage UI tests pass.

## P1: Procurement Workflow Depth

**Target:** Raise workflow depth from 65% toward 75% by adding the most demo-valuable missing workflow states before large new systems.

**Owner:** Agent D.

**Files:**
- Modify: `frontend/src/server/submission/*`
- Modify: `frontend/src/server/response-workspace/*`
- Modify: `frontend/src/server/artifacts/*`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Potential create: `frontend/src/server/awards/*`
- Potential create: `frontend/src/server/win-loss/*`

- [ ] **Step 1: Submission evidence/history depth**

Extend current Submission Lite with clearer evidence/history display before building new award modules.

Run:

```bash
cd frontend
npm test -- src/server/submission/service.test.ts src/server/submission/repository.test.ts 'src/app/api/intents/[id]/submission/route.test.ts' 'src/app/api/intents/[id]/submission/confirm/route.test.ts'
```

Expected: submission status, confirmation history, and recovery states remain guarded and visible.

- [ ] **Step 2: Award / Win-Loss thin design**

Create a short design note before implementation with tables, APIs, UI surface, and how outcome data feeds future recommendations.

Docs:

```text
docs/product-requirements/winbids-implementation-status.md
docs/superpowers/plans/2026-06-10-award-win-loss-lite.md
```

Expected: design is narrow enough for a follow-up worker to implement without touching billing or AI internals.

## P2: AI / Enterprise Depth

**Target:** Raise AI/Enterprise depth from 20-30% toward 35% by preparing real LLM and retrieval seams while preserving deterministic fallback.

**Owner:** Agent E.

**Files:**
- Modify: `frontend/src/server/knowledge/*`
- Modify: `frontend/src/server/qualification/*`
- Modify: `frontend/src/server/auth/entitlements.ts`
- Modify: `frontend/src/server/billing/*credit*`
- Docs: `docs/product-requirements/winbids-implementation-status.md`

- [ ] **Step 1: AI provider seam design**

Document how real LLM extraction will plug into existing deterministic brief/citation/Q&A flows with fallback, prompt/version logging, confidence, and cost metadata.

Expected docs output:

```text
AI unavailable state
Low confidence state
Prompt/model/version metadata
Cost/credit metadata
Deterministic fallback behavior
```

- [ ] **Step 2: Knowledge retrieval minimal slice**

Design a minimal retrieval-ready Knowledge Station extension: item source, embedding status, retrieval status, admin publishing state, and usage event hook.

Run existing tests:

```bash
cd frontend
npm test -- src/server/knowledge/service.mysql.test.ts src/server/auth/feature-gate-coverage.test.ts
```

Expected: Enterprise gate and existing Knowledge Station behavior stay intact.

## Shared Verification Gate

Every implementation batch must end with:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run db:mysql:migrate
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run db:mysql:smoke
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run workers:check
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all commands pass, or the status docs must explicitly list failing commands and known blockers.

## Stage-End User Reminder Format

After each stage, report:

```text
本阶段完成：
- ...

验证：
- ...

剩余未完成：
1. 本地 MVP：...
2. 生产发布：...
3. 商业化闭环：...
4. 采购工作流：...
5. AI/Enterprise：...

下一步建议：
- ...
```

## Current Recommended Execution Order

1. P0 Demo Stabilization: fix public bid-to-intent behavior, prepare local demo data, add browser smoke, and make Admin sections degrade independently.
2. P0 Commercialization Safety: lock down production webhook behavior, fix Settings checkout redirect, and then run Stripe sandbox with real test credentials.
3. P0 Production Readiness: make worker production warnings launch blockers, add AWS/staging dry-run checklist, and clarify backup/restore proof.
4. P1 Procurement Workflow: implement Award / Win-Loss Lite before larger package/storage depth because it closes the demo workflow loop.
5. P1 Response Package / Submission Depth: add local ZIP export and stronger submission evidence/history after Award / Win-Loss Lite.
6. P2 AI/Enterprise: add deterministic AI run metadata, Knowledge retrieval trace, and credit ledger dry-run before real LLM/RAG integration.

## Multi-Agent Audit Consolidation

Completed on 2026-06-10 by read-only parallel agents:

| Track | Main finding | First implementation slice |
|---|---|---|
| UI / MVP Stabilization | Public `/bids/[id]` can create an anonymous Intent that then lands on an auth-required Intent page; Admin demo data can show only 6 data sources even though 50-state bid data exists; tests are mostly static/source checks rather than real browser smoke. | Fix bid-to-intent anonymous UX/API, add demo data preparation script, add local browser smoke, and make Admin API sections fail independently. |
| Production Readiness | AWS/runbooks/preflight are strong but not executed in production-like AWS; worker `--check` can return `ok: true` with production-risk warnings; email provider and backup/restore are not proven. | Make production worker warnings fail launch preflight, document AWS staging dry run, and add backup/restore evidence requirements. |
| Commercialization | Billing foundation is strong, but production webhook can accept generic events without Stripe signature when no generic secret is configured; Settings checkout writes external URLs with history replacement instead of real navigation. | Harden webhook acceptance and fix Settings checkout redirect before Stripe sandbox/live validation. |
| Procurement Workflow | Submission/Compliance/Pursue/Response/Artifact/Quote/Deadline Lite exist; Award / Win-Loss is still only a placeholder. | Add Award / Win-Loss Lite with outcome status, award notice URL, winner/amount, loss reason taxonomy, and next action. |
| AI / Enterprise | Current value is deterministic/AI-like, not real LLM/RAG/credit consumption. | Add AI run metadata, lexical Knowledge retrieval trace, and credit usage dry-run events without requiring real model keys. |

## First Worker Batch After Audit

Use disjoint write scopes:

1. **Worker A - Demo Intent Boundary**
   - Owns: `frontend/src/app/bids/[id]/page.tsx`, `frontend/src/app/api/bids/[id]/intent/route.ts`, bid detail tests, i18n strings.
   - Must deliver: anonymous users get a clear login/register path before personal Intent creation; logged-in users can create/open Intent.

2. **Worker C - Billing Webhook / Checkout Safety**
   - Owns: `frontend/src/app/api/billing/webhook/route.ts`, billing webhook tests, `frontend/src/app/settings/page.tsx` checkout behavior, Settings tests.
   - Must deliver: production Stripe mode requires signed Stripe events; generic webhook requires configured generic secret or is disabled; checkout uses real browser navigation for hosted Stripe URLs.

3. **Worker B - Production Preflight Strictness**
   - Owns: worker `--check` scripts, production readiness preflight tests, production runbook docs.
   - Must deliver: production SQLite/file-provider warnings can be surfaced as launch blockers in `ops:production:check` or equivalent documented gate.

4. **Worker D - Award / Win-Loss Lite Plan**
   - Owns: new plan file `docs/superpowers/plans/2026-06-10-award-win-loss-lite.md` first; code implementation only after plan review.
   - Must deliver: DB/API/UI/test design narrow enough for a second implementation worker.

5. **Worker E - AI Metadata / Retrieval Plan**
   - Owns: new plan file `docs/superpowers/plans/2026-06-10-ai-enterprise-depth-lite.md` first; code implementation only after plan review.
   - Must deliver: deterministic metadata, retrieval trace, and dry-run credit ledger interfaces.

## First Worker Batch Results

Completed on 2026-06-10:

| Worker | Status | Delivered | Verification |
|---|---|---|---|
| Worker A - Demo Intent Boundary | Complete | Anonymous bid-detail users now see login/register before personal Intent creation; the API returns `AUTH_REQUIRED` before usage checks or intent creation; logged-in users still create/open Intent workspaces. | `npm test -- 'src/app/bids/[id]/page.test.ts' 'src/app/api/bids/[id]/intent/route.test.ts' src/app/local-mvp-auth-tier-boundaries.test.ts` passed. |
| Worker C - Billing Webhook / Checkout Safety | Complete | Production Stripe mode requires signed Stripe events; generic billing events require `BILLING_WEBHOOK_SECRET` in production; Settings checkout uses real `window.location.assign(...)` navigation. | `npm test -- src/app/api/billing/webhook/route.test.ts src/server/billing/production-preflight.test.ts src/app/settings/page.test.ts src/app/api/account/subscription/checkout/route.test.ts` passed. |
| Worker B - Production Preflight Strictness | Complete | Production/staging worker checks fail closed for SQLite runtime and local notification providers; runbooks explain warnings vs blockers. | `npm test -- src/server/operations/production-readiness.test.ts src/server/billing/production-preflight.test.ts scripts/notification-worker.test.ts` passed; `npm run lint` passed after integration cleanup. |
| Worker D - Award / Win-Loss Lite Plan | Plan complete | Created `docs/superpowers/plans/2026-06-10-award-win-loss-lite.md` with DB/API/UI/TDD implementation tasks. | `git diff --check` passed. |
| Worker E - AI / Enterprise Depth Lite Plan | Plan complete | Created `docs/superpowers/plans/2026-06-10-ai-enterprise-depth-lite.md` with deterministic metadata, retrieval trace, and dry-run credit ledger tasks. | `git diff --check` passed. |

Controller integration cleanup:

- Removed stale `refreshSubscription` from Settings after hosted checkout switched to real browser navigation.
- Combined focused verification passed: `9` files and `45` tests.
- Full regression gate passed: `npm test` (219 files / 1,041 tests), `npm run lint`, `npm run build`, and `git diff --check`.

Next worker batch:

1. Local demo data preparation script and 50-state Admin source visibility.
2. Admin section-level degradation for partial API failures.
3. Award / Win-Loss Lite implementation from the new plan.
4. AI metadata / Knowledge retrieval lite implementation from the new plan.
5. Stripe sandbox E2E once real test credentials are available.

## Second Worker Batch

Started on 2026-06-10:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Worker A - Demo Data / Source Visibility | P0 local demo stability | Complete | Added `demo:prepare` and `demo:check`; verifies/prepares 50-state source visibility, rejects placeholder URLs and empty/unsafe demo blockers, and supports SQLite/MySQL. | Focused tests passed; controller verified SQLite/MySQL `demo:check`. |
| Worker B - Award / Win-Loss API | P1 procurement workflow depth | Backend/API complete | Added `award_outcomes`, SQLite/MySQL repository/service, `GET/PATCH /api/intents/[id]/award`, feature gate coverage, and client helpers. | Focused awards/API/schema tests passed; controller full regression passed. |
| Worker C - AI / Enterprise Lite Backend | P2 AI/Enterprise foundation | Complete | Added deterministic AI run metadata, lexical Knowledge retrieval trace, zero-charge credit ledger dry-run, and Q&A route usage reporting. | Focused AI/Knowledge/Credit/Q&A tests passed; controller full regression passed. |
| Worker D - Admin Partial Degradation | P0 admin demo stability | Complete | Converted `/admin` main loading to section-level degradation so one failed admin API does not blank successful sections. | Focused Admin tests passed; controller full regression passed. |

Controller integration rules:

- Do not let workers modify the same Intent detail UI file in this batch; page-level wiring happens after backend/API surfaces are stable.
- After workers return, run focused tests per track, then shared regression: `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.
- Update `winbids-implementation-status.md` only after integration verification, so progress percentages reflect tested code rather than partial worker output.

Controller verification after integration:

- Focused second-batch suite: 17 files / 105 tests passed.
- Full `npm test`: 226 files / 1,077 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode.
- `DATABASE_URL='mysql://...' npm run demo:check`: passed in MySQL mode.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed.
- `npm run risk:check`: passed.
- `git diff --check`: passed.

Next worker batch:

1. Wire Award / Win-Loss Lite into Intent detail UI with bilingual labels and locked states.
2. Add local ZIP response package export from the existing Markdown manifest and linked artifacts.
3. Add browser smoke coverage for the full demo journey.
4. Continue AWS staging dry-run / backup-restore evidence docs.
5. Run Stripe sandbox E2E when real test credentials are available.

## Third Worker Batch

Started on 2026-06-10:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Worker A - Award / Win-Loss UI | P1 procurement workflow close-out | Complete | Added `AwardWinLossPanel`, Intent detail page wiring, bilingual labels, editable outcome fields, locked state, and local error/save state. | Focused page/client tests passed; controller full regression passed. |
| Worker B - Response Package ZIP Export | P1 response package depth | Complete | Implemented local ZIP export with `README.md`, `manifest.json`, readable linked artifacts, and manifest `missing: true` records for unavailable artifacts; Markdown export unchanged. | Focused response package tests passed; controller full regression passed. |
| Worker C - Demo Browser/API Smoke | P0 demo stability | Complete | Added `npm run demo:smoke`, mock tests, and local HTTP smoke coverage for anonymous, ordinary user, admin, paid gated workspace, bid detail, and attachment safety. | Unit tests passed; controller ran smoke against temporary `localhost:3010`. |
| Worker D - AWS Staging Dry-Run Evidence | P0/P3 production handoff | Complete with external-risk note | Strengthened AWS staging dry-run docs, backup/restore evidence checklist, secrets ownership, and production readiness preflight evidence requirements. | Focused production-readiness tests passed; real AWS evidence remains external. |

Controller integration rules:

- Worker A is the only batch owner for `frontend/src/app/intents/[id]/page.tsx`.
- Worker B is the only batch owner for response package ZIP behavior.
- Worker C must not start or mutate long-running dev servers without reporting the port.
- Worker D must not claim production deployment is complete; it only strengthens dry-run readiness.
- Stripe sandbox E2E remains blocked on real `sk_test...`, `whsec...`, and price ids.

Controller verification after integration:

- Focused third-batch suite: 9 files / 81 tests passed.
- Full `npm test`: 227 files / 1,085 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode.
- `npm run demo:smoke -- --origin=http://localhost:3010`: passed against a temporary local dev server.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed.
- `npm run risk:check`: passed.
- `git diff --check`: passed.

Next worker batch:

1. Surface AI metadata / Knowledge retrieval trace in a constrained Enterprise or operator UI without implying real LLM execution.
2. Add submission evidence/history links to response package artifacts and award outcomes.
3. Add production object storage adapter design/first implementation for exports/artifacts.
4. Continue source-health live operations: persist/classify 403/timeout/bot-check evidence from real source probes.
5. Execute Stripe sandbox E2E when real `sk_test...`, `whsec...`, and price ids are available.

## Fourth Worker Batch

Started on 2026-06-10:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Worker A - AI Metadata UI | P2 AI/Enterprise surfacing | Complete | Intent detail now surfaces deterministic provider/model/rules/prompt/cost/fallback/credit dry-run facts plus Knowledge retrieval trace in the Knowledge-enabled area. | Focused page/client tests passed; controller full regression passed. |
| Worker B - Submission Evidence Links | P1 submission/history depth | API/read-model complete | Submission responses now hydrate package export links, linked supplier artifacts, and existing award outcome evidence without cross-intent leakage. | Focused submission/API/client tests passed; controller full regression passed. |
| Worker C - Object Storage Adapter Seam | P1/P3 production artifact/export storage | Seam complete with external-risk note | Added object storage abstraction, local provider, S3-compatible fail-fast stub, production/staging preflight rules, and service wiring for artifacts/exports. | Focused storage/service/preflight tests passed; controller full regression passed. |
| Worker D - Live Source Health Classification | P2 source operations | Complete | Live source checks classify 403/timeout/bot-check/login/empty/network/http outcomes and persist short redacted evidence snippets into snapshots/Admin projection. | Focused source-health/Admin tests passed; controller full regression passed. |

Controller integration rules:

- Worker A is the only fourth-batch owner for Intent AI/Knowledge metadata UI.
- Worker B owns submission evidence/history read models and must avoid response ZIP internals.
- Worker C owns storage/preflight seam and must avoid rewriting artifact/export business logic.
- Worker D owns source-health classification and must not touch UI except existing Admin projection fields if needed.
- Stripe sandbox E2E remains externally blocked on real test credentials.

Controller verification after integration:

- Focused fourth-batch suite: 20 files / 141 tests passed.
- Full `npm test`: 228 files / 1,102 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode.
- `npm run demo:smoke -- --origin=http://localhost:3011`: passed against a temporary local dev server.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed.
- `npm run risk:check`: passed.
- `git diff --check`: passed.

## Fifth Worker Batch

Started on 2026-06-10:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Worker A - Submission Evidence UI | P1 submission/history depth | Complete | Intent Submission panel now displays package exports, linked supplier artifacts, award outcome evidence, and an empty-state explanation from existing `evidenceLinks`. | Focused page/submission/client tests passed; controller full regression passed. |
| Worker B - Admin Source Health Filters | P2 source operations / Admin UX | Complete | Admin Data Sources now supports client-side classification filtering for all live health classifications, filtered counts, empty state, reason, and evidence snippets. | Focused Admin tests passed; controller full regression passed. |
| Worker C - Source Health Operations Handoff | P0/P3 operations | Complete with external-risk note | Added `source:health:ops` and `source:health:scheduled` aliases, help text, `--write-snapshot`, and runbook coverage for cadence, release acceptance, and escalation. | Focused script tests and help command passed; real scheduled/cloud execution remains external. |
| Controller - S3-Compatible Object Storage | P1/P3 production artifact/export storage | Complete with external-risk note | Replaced the S3 fail-fast stub with a SigV4 REST provider for PUT/GET/HEAD/DELETE, runtime-secret credential checks, checksum validation, and fail-closed behavior when credentials are missing. | Storage/service tests passed; controller full regression passed. |

Controller integration rules:

- Worker A owned the Intent Submission evidence UI and i18n additions.
- Worker B owned Admin Data Source classification filters and i18n additions.
- Worker C owned source-health script/runbook additions and avoided UI/database changes.
- Controller owned storage provider implementation and doc/status integration.
- No real AWS/S3/Stripe/LLM credentials were used; all external provider execution remains a staging/production task.

Controller verification after integration:

- Focused fifth-batch suite: 12 files / 91 tests passed.
- Full `npm test`: 228 files / 1,110 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode.
- `npm run demo:smoke -- --origin=http://localhost:3012`: passed against a temporary local dev server.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed.
- `npm run risk:check`: passed.
- `git diff --check`: passed before final status edits; rerun after this plan update before handoff.

Next worker batch:

1. Continue real-page UI/UE polish on `/search`, `/bids/[id]`, `/intents/[id]`, `/admin`, and `/settings` with the established product style.
2. Done in sixth batch: add lightweight PDF/DOCX response package generation and per-format Intent export controls.
3. Done in sixth batch: add deterministic local/noop malware-scanning and retention-policy seams around artifact object storage.
4. Done in sixth batch: expand audit/event writes for response package export/download and submission confirmation.
5. Done in seventh implementation slice: add response package approve/request-changes actions, review notes, PATCH API/client/UI, and redacted `response_package.review_updated` audit events.
6. Done in eighth implementation slice: add adjacent response package snapshot version summaries/change comparisons in service/API/UI without adding schema fields.
7. Done in ninth implementation slice: add full version-history totals and expandable all-version list in service/API/UI without adding schema fields.
8. Done in tenth implementation slice: add any-version side-by-side response package comparison in service/API/UI without adding schema fields.
9. Done in eleventh/Wave 1 slice: add versioned submission package evidence on submission confirmations and sync source-health baseline/ops safeguards.
10. Next: add richer response package review history and UI/UE Wave 1 polish; run real AWS/S3 staging smoke, external malware scanning, scheduled source probes, and Stripe sandbox E2E when the required credentials and operator network are available.

## Eighth Implementation Slice

Completed on 2026-06-10:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Controller - Response Package Version / Comparison Lite | P1 response package depth | Complete | Added computed snapshot `versionNumber`, `previousSnapshotId`, `changeCount`, and adjacent `changes` for created/readiness/outline-status/linked-artifact differences; Intent UI shows version and change summaries. | Focused tests, full regression, build, demo readiness, smoke, SQLite/MySQL migrations, MySQL smoke, risk check, audit, and `git diff --check` passed. |

Remaining after eighth slice:

1. Full multi-version package history/comparison view and richer review history.
2. Versioned submission package evidence.
3. Real AWS/S3 staging validation and signed URL/CDN posture.
4. External malware scanning and configurable retention execution.
5. Stripe sandbox E2E with real test credentials and Stripe CLI webhook forwarding.

## Ninth Implementation Slice

Completed on 2026-06-10:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Controller - Response Package Full History / Comparison View Lite | P1 response package depth | Complete | Added computed `versionHistory` totals/entries to `ResponsePackageWorkspace`; Intent UI now shows total versions, latest version, total changes, and can expand from recent snapshots to all package versions while preserving per-version adjacent change summaries. | Focused tests, full regression, build, demo readiness, smoke, SQLite/MySQL migrations, MySQL smoke, risk check, audit passed. |

Remaining after ninth slice:

1. Side-by-side package comparison for any two versions.
2. Versioned submission package evidence.
3. Real AWS/S3 staging validation and signed URL/CDN posture.
4. External malware scanning and configurable retention execution.
5. Stripe sandbox E2E with real test credentials and Stripe CLI webhook forwarding.

## Tenth Implementation Slice

Completed on 2026-06-10:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Controller - Response Package Side-by-Side Comparison Lite | P1 response package depth | Complete | Added computed `versionComparisons` and `defaultVersionComparison` to `ResponsePackageWorkspace`; comparisons cover readiness, outline status, outline notes, and linked artifacts for every older/newer version pair; Intent UI lets users select any version pair and compare source/target values. | Focused tests, full regression, build, demo readiness, smoke, SQLite/MySQL migrations, MySQL smoke, risk check, audit passed. |

Remaining after tenth slice:

1. Versioned submission package evidence.
2. Richer response package review history and reviewer timeline.
3. Real AWS/S3 staging validation and signed URL/CDN posture.
4. External malware scanning and configurable retention execution.
5. Stripe sandbox E2E with real test credentials and Stripe CLI webhook forwarding.

## Eleventh Implementation Slice / Wave 1

Completed on 2026-06-11:

| Worker | Track | Status | Delivered | Verification |
|---|---|---|---|---|
| Controller - Versioned Submission Package Evidence Lite | P1 submission/response evidence depth | Complete | Added `submission_confirmations.evidence_snapshot_json` with SQLite/MySQL migration coverage; submission confirmations now freeze current response package export id/format/snapshot id/title/version/review status, linked artifacts, award outcome, and captured timestamp; Intent confirmation history displays frozen package version evidence. | Focused submission/schema/response workspace/API/client/UI tests passed; lint/build passed. |
| Controller - Source Health Baseline Sync | P2 source operations | Complete | Wrapped source-health snapshot persistence in `try/finally`, locked `source:health:ops` timeout coverage, and synchronized deterministic 50-state baseline to 1,146 state bids / 216 attachments / 1,147 active URLs. | Focused source-health/risk/source tests passed; `npm run risk:check` passed. |

Remaining after eleventh slice:

1. Richer response package review history and reviewer timeline.
2. UI/UE Wave 1 polish: `/search` button feedback, anonymous save sign-in guidance, mobile bid-detail overflow, and ResponseWorkspacePanel error-state consistency.
3. Real AWS/S3 staging validation and signed URL/CDN posture.
4. External malware scanning and configurable retention execution.
5. Stripe sandbox E2E with real test credentials and Stripe CLI webhook forwarding.

## Self-Review

- Spec coverage: covers all unified progress dimensions supplied on 2026-06-10.
- Placeholder scan: no TBD/TODO/fill-later language is used.
- Conflict control: each agent has a primary ownership set and must not edit unrelated domains.
- Verification: each track has focused commands plus the shared regression gate.
