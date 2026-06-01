# MySQL Runtime Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the WinBids runtime from local synchronous SQLite to MySQL as one coherent cutover, with all production API paths either using MySQL directly or explicitly marked as unsupported before release.

**Architecture:** Keep SQLite tests as fast unit coverage while adding a MySQL runtime adapter and MySQL-backed smoke/E2E checks. Migrate production services by domain from sync Drizzle/SQLite calls to async MySQL helpers, using raw SQL for the current cutover to avoid a second schema DSL migration blocking runtime work.

**Tech Stack:** Next.js route handlers, TypeScript, `mysql2/promise`, existing SQLite Drizzle schema as migration source, Vitest, Docker MySQL 8 smoke verification.

---

## Current Inventory

- Production files still touching SQLite-style database APIs: 122.
- Already MySQL-aware: migration runner, smoke verifier, auth/session/logout/register/login, admin auth gate, account profile/password/delete, workspace read/update, billing subscription/checkout/portal/cancel/webhook/invoices, supplier profile, bid search/detail/saved-bids, intent create/list/detail/status, `/api/health/scrapers`, and `/api/admin/crawler-logs`.
- Remaining high-risk sync domains:
  - Auth password reset.
  - Account export/usage/preferences and workspace invites/member management/ownership.
  - Attachment metadata download lookup.
  - Compliance, submission, response workspace, pursuit, qualification.
  - Admin users, admin bid QA, config registry, events/outbox.
  - Notifications/search alerts/workers.
  - Crawler locks/log writes/orchestration.

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
- [ ] Implement MySQL password reset request/confirm.
- [x] Implement MySQL admin access check.
- [x] Extend smoke to register/login/read session/logout against MySQL.

## Task 3: Account, Workspace, Tier, Billing Runtime

**Files:**
- Modify: `frontend/src/server/account/*.ts`
- Modify: `frontend/src/server/billing/*.ts`
- Modify: account and billing route tests.

- [x] Implement MySQL account profile, password change, delete.
- [ ] Implement MySQL account export, notification preferences, usage, and password reset.
- [ ] Implement MySQL workspace membership/invites/ownership.
- [x] Implement MySQL workspace read/update.
- [x] Implement MySQL subscription, tier, invoice, checkout, portal, cancel, webhook updates.
- [ ] Extend Stripe sandbox verifier to work with MySQL runtime.

## Task 4: Bid Detail, Saved Bids, Attachments

**Files:**
- Modify: `frontend/src/server/bids/repository.ts`
- Modify: `frontend/src/server/bids/service.ts`
- Modify: `frontend/src/server/bids/attachments.ts`
- Modify: `frontend/src/app/api/bids/[id]/route.ts`
- Modify: `frontend/src/app/api/saved-bids/**/*.ts`

- [x] Implement MySQL bid detail read.
- [x] Implement MySQL saved bid list/save/delete/merge.
- [ ] Implement MySQL attachment metadata lookup while preserving local file download behavior.
- [x] Extend smoke to verify search, detail, and saved bid lifecycle.
- [ ] Extend smoke to verify attachment metadata lookup.

## Task 5: Intent And Pursuit Workflow Runtime

**Files:**
- Modify: `frontend/src/server/intents/*.ts`
- Modify: `frontend/src/server/compliance/*.ts`
- Modify: `frontend/src/server/submission/*.ts`
- Modify: `frontend/src/server/response-workspace/*.ts`
- Modify: `frontend/src/server/pursuit/*.ts`
- Modify: `frontend/src/server/qualification/*.ts`

- [x] Implement MySQL intent create/list/detail/status.
- [ ] Implement MySQL compliance manifest CRUD.
- [ ] Implement MySQL submission guidance/confirmation.
- [ ] Implement MySQL response workspace CRUD.
- [ ] Implement MySQL pursuit decision and qualification freshness/citations.
- [x] Extend smoke to create/list/update an intent from a bid.
- [ ] Extend smoke to read all dependent intent panels.

## Task 6: Admin, Config, Event, Notification Runtime

**Files:**
- Modify: `frontend/src/server/admin/*.ts`
- Modify: `frontend/src/server/config/registry.ts`
- Modify: `frontend/src/server/events/event-log.ts`
- Modify: `frontend/src/server/notifications/*.ts`
- Modify: `frontend/src/server/search-alerts/*.ts`

- [ ] Implement MySQL admin users, audit logs, feature overrides.
- [ ] Implement MySQL admin bid QA read/write/batch/corrections.
- [ ] Implement MySQL config registry list/upsert/patch with audit events.
- [ ] Implement MySQL event log/outbox.
- [ ] Implement MySQL notification outbox and search alert digest history.
- [ ] Extend smoke to validate event write and notification outbox lifecycle.

## Task 7: Crawler Runtime Writes

**Files:**
- Modify: `frontend/src/server/crawler/*.ts`
- Modify: crawler routes and worker scripts.

- [ ] Implement MySQL crawler locks.
- [ ] Implement MySQL crawler log writes.
- [ ] Implement MySQL bid upsert/import path from crawler results.
- [ ] Extend smoke to run one configured crawler source into MySQL with non-empty bid content.

## Task 8: Seed, Scripts, Risk Check, Docs

**Files:**
- Modify: `frontend/src/server/db/seed.ts`
- Modify: `frontend/scripts/*.ts`
- Modify: `frontend/src/server/risk/checklist.ts`
- Modify: `frontend/README.md`
- Modify: `docs/operations/mysql-cutover.md`
- Modify: `docs/product-requirements/*.md`

- [ ] Add MySQL seed command or make existing seed provider-aware.
- [ ] Make worker/sandbox scripts provider-aware.
- [ ] Run risk checklist against MySQL runtime.
- [ ] Update docs with final runtime instructions and remaining production credential notes.

## Current Status

- [x] MySQL migration script.
- [x] MySQL smoke verifier.
- [x] MySQL schema smoke on Docker MySQL 8.
- [x] `/api/health/scrapers` MySQL read path.
- [x] `/api/admin/crawler-logs` MySQL read path.
- [x] `/api/bids` search MySQL read path.
- [x] Auth/session/account profile/password/delete MySQL runtime.
- [x] Workspace read/update and admin auth gate MySQL runtime.
- [x] Billing subscription/checkout/portal/cancel/webhook/invoice MySQL runtime.
- [x] Supplier profile, bid detail, saved bids, and intent create/list/detail/status MySQL runtime.
- [x] Docker MySQL smoke covers schema, crawler health/admin logs, bid search/detail, saved bids, supplier profile, intent, billing, workspace, and auth session.
- [ ] Full MySQL runtime cutover.
