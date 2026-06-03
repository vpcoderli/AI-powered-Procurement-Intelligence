# MySQL Runtime Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the WinBids runtime from local synchronous SQLite to MySQL as one coherent cutover, with all production API paths either using MySQL directly or explicitly marked as unsupported before release.

**Architecture:** Keep SQLite tests as fast unit coverage while adding a MySQL runtime adapter and MySQL-backed smoke/E2E checks. Migrate production services by domain from sync Drizzle/SQLite calls to async MySQL helpers, using raw SQL for the current cutover to avoid a second schema DSL migration blocking runtime work.

**Tech Stack:** Next.js route handlers, TypeScript, `mysql2/promise`, existing SQLite Drizzle schema as migration source, Vitest, Docker MySQL 8 smoke verification.

---

## Current Inventory

- Production files still touching SQLite-style database APIs: 122.
- Already MySQL-aware: migration runner, smoke verifier, repeatable SQLite-to-MySQL data import, auth/session/logout/register/login/password reset, admin auth gate, admin users/feature overrides/audit logs, admin config registry/audit writes/event outbox delivery, admin data source list/update, admin bid QA list/review/display/correction/batch writes, account profile/password/delete/export/usage/notification preferences, workspace read/update/invitations/member management/ownership transfer, billing subscription/checkout/portal/cancel/webhook/invoices/dunning scheduling, supplier profile, bid search/detail/saved-bids/attachment metadata, search alerts CRUD/quota/digest history, notification outbox/admin recent/delivery, intent create/list/detail/status, compliance manifest, submission guidance/confirmation, response workspace, pursuit decision, qualification citations/freshness/Q&A, `/api/health/scrapers`, `/api/admin/crawler-logs`, crawler locks/source enablement orchestration, direct JSON crawler result import/upsert, crawler search-alert matching/digest notification, worker preflight, and production billing credential preflight.
- Remaining high-risk signoff domains:
  - Operator-assisted Stripe sandbox verifier run with real Stripe test credentials against MySQL.
  - Final low-risk live checkout/webhook execution after MySQL sandbox and production billing preflight.

## Execution Rules

- Do not remove SQLite test utilities until equivalent MySQL integration tests exist.
- New production MySQL paths must use async functions only.
- Every migrated domain needs:
  - Unit tests with fake MySQL reader/writer where useful.
  - At least one real MySQL smoke or integration assertion when the path is user-critical.
  - No secret values printed in logs.
- Final acceptance requires:
  - `npm test`
  - `npm run lint`
  - `npm run build`
  - `npm audit --omit=dev --audit-level=high`
  - `git diff --check`
  - Docker MySQL 8 `npm run db:mysql:smoke`

## Task 1: Runtime Adapter Foundation

**Files:**
- Create: `frontend/src/server/db/mysql-runtime.ts`
- Modify: `frontend/src/server/db/mysql.ts`
- Test: `frontend/src/server/db/mysql-runtime.test.ts`

- [x] Add typed helpers: `mysqlSelectOne`, `mysqlSelectMany`, `mysqlExecute`, `mysqlTransaction`.
- [x] Add placeholder expansion helper for `IN (?)` style queries.
- [x] Add date/string/number normalization helpers.
- [x] Add tests for empty row handling, affected row handling, placeholder generation, and credential-safe errors.

## Task 2: Auth And Session Runtime

**Files:**
- Modify: `frontend/src/server/auth/service.ts`
- Modify: `frontend/src/server/auth/password-reset.ts`
- Modify: `frontend/src/server/auth/principal.ts`
- Modify: `frontend/src/server/admin/auth.ts`
- Modify: auth route tests and add MySQL runtime tests.

- [x] Implement MySQL register/login/session/logout.
- [x] Implement MySQL password reset request/confirm.
- [x] Implement MySQL admin access check.
- [x] Extend smoke to register/login/read session/logout against MySQL.

## Task 3: Account, Workspace, Tier, Billing Runtime

**Files:**
- Modify: `frontend/src/server/account/*.ts`
- Modify: `frontend/src/server/billing/*.ts`
- Modify: account and billing route tests.

- [x] Implement MySQL account profile, password change, delete.
- [x] Implement MySQL account export, notification preferences, and usage.
- [x] Implement MySQL workspace membership/invites/ownership.
- [x] Implement MySQL workspace read/update.
- [x] Implement MySQL subscription, tier, invoice, checkout, portal, cancel, webhook updates.
- [x] Extend Stripe sandbox verifier to work with MySQL runtime.

## Task 4: Bid Detail, Saved Bids, Attachments

**Files:**
- Modify: `frontend/src/server/bids/repository.ts`
- Modify: `frontend/src/server/bids/service.ts`
- Modify: `frontend/src/server/bids/attachments.ts`
- Modify: `frontend/src/app/api/bids/[id]/route.ts`
- Modify: `frontend/src/app/api/saved-bids/**/*.ts`

- [x] Implement MySQL bid detail read.
- [x] Implement MySQL saved bid list/save/delete/merge.
- [x] Implement MySQL attachment metadata lookup while preserving local file download behavior.
- [x] Extend smoke to verify search, detail, and saved bid lifecycle.
- [x] Extend smoke to verify attachment metadata lookup.

## Task 5: Intent And Pursuit Workflow Runtime

**Files:**
- Modify: `frontend/src/server/intents/*.ts`
- Modify: `frontend/src/server/compliance/*.ts`
- Modify: `frontend/src/server/submission/*.ts`
- Modify: `frontend/src/server/response-workspace/*.ts`
- Modify: `frontend/src/server/pursuit/*.ts`
- Modify: `frontend/src/server/qualification/*.ts`

- [x] Implement MySQL intent create/list/detail/status.
- [x] Implement MySQL compliance manifest CRUD.
- [x] Implement MySQL submission guidance/confirmation.
- [x] Implement MySQL response workspace CRUD.
- [x] Implement MySQL pursuit decision and qualification freshness/citations/Q&A.
- [x] Extend smoke to create/list/update an intent from a bid.
- [x] Extend smoke to read/update compliance, submission, and response workspace intent panels.
- [x] Extend smoke to read all remaining pursuit/qualification dependent intent panels.

## Task 6: Admin, Config, Event, Notification Runtime

**Files:**
- Modify: `frontend/src/server/admin/*.ts`
- Modify: `frontend/src/server/config/registry.ts`
- Modify: `frontend/src/server/events/event-log.ts`
- Modify: `frontend/src/server/notifications/*.ts`
- Modify: `frontend/src/server/search-alerts/*.ts`

- [x] Implement MySQL admin users, audit logs, feature overrides.
- [x] Implement MySQL admin bid QA read/write/batch/corrections.
- [x] Implement MySQL config registry list/upsert/patch with audit events.
- [x] Implement MySQL event log writes and audit outbox enqueue helper.
- [x] Implement MySQL search alert CRUD and quota enforcement.
- [x] Implement MySQL notification outbox and search alert digest history.
- [x] Implement MySQL event worker and billing dunning scheduling.
- [x] Implement MySQL crawler search-alert matching after crawler imports.
- [x] Extend smoke to validate event write and notification outbox lifecycle.

## Task 7: Crawler Runtime Writes

**Files:**
- Modify: `frontend/src/server/crawler/*.ts`
- Modify: crawler routes and worker scripts.

- [x] Implement MySQL crawler locks.
- [x] Implement MySQL source enablement orchestration for crawler routes/scripts.
- [x] Implement native MySQL crawler log writes or direct JSON/MySQL ingestion.
- [x] Implement MySQL bid upsert/import path from crawler results.
- [x] Wire crawler routes/workers to run MySQL alert matching and digest notification after successful imports.
- [x] Extend smoke to verify non-empty crawler import, crawler control lifecycle, and crawler alert matching into MySQL.

## Task 8: Seed, Scripts, Risk Check, Docs

**Files:**
- Modify: `frontend/src/server/db/seed.ts`
- Modify: `frontend/scripts/*.ts`
- Modify: `frontend/src/server/risk/checklist.ts`
- Modify: `frontend/README.md`
- Modify: `docs/operations/mysql-cutover.md`
- Modify: `docs/product-requirements/*.md`

- [x] Add repeatable SQLite-to-MySQL data import command.
- [x] Make notification/event/crawler worker scripts provider-aware for the migrated MySQL runtime.
- [ ] Run risk checklist against MySQL runtime.
- [x] Update docs with final runtime instructions and remaining production credential notes.

## Current Status

- [x] MySQL migration script.
- [x] SQLite-to-MySQL data import script.
- [x] MySQL smoke verifier.
- [x] MySQL schema smoke on Docker MySQL 8.
- [x] `/api/health/scrapers` MySQL read path.
- [x] `/api/admin/crawler-logs` MySQL read path.
- [x] `/api/bids` search MySQL read path.
- [x] Auth/session/account profile/password/delete MySQL runtime.
- [x] Password reset MySQL runtime.
- [x] Account export/usage/notification preferences MySQL runtime.
- [x] Workspace read/update/invitations/member management/ownership transfer and admin auth gate MySQL runtime.
- [x] Billing subscription/checkout/portal/cancel/webhook/invoice MySQL runtime.
- [x] Supplier profile, bid detail, attachment metadata, saved bids, search alerts/digest history, notification outbox/delivery, event outbox delivery, billing dunning scheduling, intent create/list/detail/status, compliance manifest, submission guidance/confirmation, response workspace, pursuit decision, qualification citations/freshness/Q&A, crawler locks/source enablement, direct JSON crawler result import/upsert, and crawler search-alert matching MySQL runtime.
- [x] Docker MySQL smoke covers schema, crawler health/admin logs, crawler import/upsert, crawler control, crawler alert matching/digest notification, bid search/detail, attachment metadata, saved bids, supplier profile, search alerts/digest history, notification outbox delivery, event outbox delivery, intent, compliance, submission, response workspace, pursuit decision, qualification, admin users/feature overrides/audit logs, admin config registry/audit writes, admin bid QA, billing, billing dunning, workspace/member lifecycle, account usage/export/preferences, password reset, and auth session.
- [ ] Full MySQL runtime cutover.
