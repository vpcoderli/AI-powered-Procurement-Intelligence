# MySQL Default Runtime Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MySQL the active database for local/dev/staging/production runtime, while retaining SQLite only for explicit unit-test fixtures, data import, and rollback.

**Architecture:** Keep the existing MySQL adapters and smoke tooling, then close the remaining SQLite-only runtime gaps before enabling a MySQL-default environment. Add a runtime guard so `DATABASE_URL=mysql://...` cannot silently create or write `frontend/data/apsi.sqlite`; any unconverted path must fail loudly during verification instead of leaking data into SQLite.

**Tech Stack:** Next.js route handlers, TypeScript, `mysql2/promise`, existing SQLite-to-MySQL import tooling, Vitest, Docker/MySQL 8, local browser smoke, `npm run risk:check`.

---

## Current Baseline

- Current local app is still using SQLite when `DATABASE_URL` / `MYSQL_DATABASE_URL` is not set.
- Existing MySQL-aware runtime coverage is broad: auth/session, account/profile/password/export/usage/preferences, workspace, admin users/config/bid QA/data sources, billing/dunning, bids/search/saved bids/attachments, search alerts/digest history, notifications/outbox, event outbox, intents, compliance, submission, response workspace, pursuit, qualification, artifacts, quotes, deadline reminders, crawler import/control/alert matching.
- Progress update 2026-06-03:
  - `frontend/src/server/deadlines/*` now has MySQL repository/service coverage for intent deadline workspaces and account reminder center read/update.
  - `frontend/scripts/reset-admin-password.ts` and `frontend/src/server/auth/admin-reset.ts` now select the MySQL admin reset path when MySQL is configured.
  - `frontend/src/server/db/client.ts` no longer eagerly creates runtime SQLite when MySQL is configured; `db` becomes a throwing guard for unmigrated code paths.
  - Local MySQL 8 is running in Docker as `winbids-mysql` on `127.0.0.1:3306`, using `winbids / winbids_dev_password` for the disposable local database.
  - `.env.local` now points `DATABASE_URL` and `MYSQL_DATABASE_URL` at local MySQL.
  - MySQL migration, SQLite import, admin reset, MySQL smoke, admin/user HTTP auth smoke, admin risk-check API, and `risk:check` have passed against MySQL.
  - Route-level MySQL coverage guard, worker dry runs, dashboard summary, Knowledge Station, subscription lifecycle reconcile, admin pages, `/search`, `/bids/[id]`, ordinary-user locked states, admin-only denial, and 50-state detail/download HTTP checks have passed against MySQL.
  - Remaining before declaring production-ready "global MySQL": operator-assisted Stripe sandbox verification with real test credentials, low-risk live billing checkout/webhook signoff, production worker deployment signoff, and production credential/secret-manager ownership.
- Existing runbook: `docs/operations/mysql-cutover.md`.

## Cutover Acceptance Criteria

The cutover is complete only when all of these are true:

- `DATABASE_URL` or `MYSQL_DATABASE_URL` is set to a MySQL URL in the active runtime.
- Starting the app with MySQL configured does not create, mutate, or depend on `frontend/data/apsi.sqlite`.
- Admin and ordinary user login work against MySQL.
- Settings, search, bid detail, intents, artifacts, quotes, deadline reminders, crawler run controls, admin data sources, billing, and notification worker paths operate against MySQL or fail with an explicit MySQL-runtime error.
- 50-state risk checks pass in MySQL runtime.
- Rollback is documented and tested by unsetting `DATABASE_URL` and restarting against the preserved SQLite file.

---

## Task 1: Capture Pre-Cutover State And Backups

**Files:**
- Modify: `docs/operations/mysql-cutover.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`

- [x] **Step 1: Record current runtime env**

Run:

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence
printenv | rg '^(DATABASE_URL|MYSQL_DATABASE_URL|DATABASE_PATH)=' || true
```

Result on 2026-06-03: no `DATABASE_URL`, `MYSQL_DATABASE_URL`, or `DATABASE_PATH` was present in the active shell.

- [x] **Step 2: Back up SQLite before importing**

Run:

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence
mkdir -p frontend/data/backups
cp frontend/data/apsi.sqlite "frontend/data/backups/apsi-pre-mysql-$(date +%Y%m%d-%H%M%S).sqlite"
```

Expected: a timestamped backup exists in `frontend/data/backups/`.

Result on 2026-06-03: `frontend/data/backups/apsi-pre-mysql-20260603-105641.sqlite` was created.

- [x] **Step 3: Update runbook with backup location**

Add a short "Pre-cutover backup" note to `docs/operations/mysql-cutover.md` containing the backup directory and rollback rule: do not delete `frontend/data/apsi.sqlite` until MySQL browser smoke, `db:mysql:smoke`, and `risk:check` pass.

---

## Task 2: Finish Deadline Reminder MySQL Runtime

**Files:**
- Modify: `frontend/src/server/deadlines/repository.ts`
- Modify: `frontend/src/server/deadlines/service.ts`
- Modify: `frontend/src/server/deadlines/service.test.ts`
- Modify: `frontend/src/app/api/account/deadline-reminders/route.ts`
- Modify: `frontend/src/app/api/account/deadline-reminders/route.test.ts`
- Modify: `frontend/src/server/db/mysql-smoke.ts`

- [x] **Step 1: Add failing repository/service tests**

Add tests that set MySQL mode and assert account reminder center reads and updates go through MySQL helpers, not the SQLite `db` argument.

Run:

```bash
cd frontend
npm test -- src/server/deadlines/service.test.ts src/app/api/account/deadline-reminders/route.test.ts
```

Expected before implementation: tests fail because `getAccountDeadlineReminderCenter` only reads SQLite.

- [x] **Step 2: Add MySQL repository functions**

Add MySQL equivalents for the existing SQLite deadline repository operations:

```ts
export async function listOrganizationDeadlineReminderRowsFromMysql(mysql: MysqlDeadlineRepository, organizationId: string) { ... }
export async function findOrganizationDeadlineReminderRowFromMysql(mysql: MysqlDeadlineRepository, organizationId: string, reminderId: string) { ... }
export async function updateOrganizationDeadlineReminderRowFromMysql(mysql: MysqlDeadlineRepository, organizationId: string, reminderId: string, values: UpdateDeadlineReminderRowValues) { ... }
```

Use `mysqlSelectMany`, `mysqlSelectOne`, and `mysqlExecute` from `frontend/src/server/db/mysql-runtime.ts`.

- [x] **Step 3: Branch service by runtime**

In `frontend/src/server/deadlines/service.ts`, use:

```ts
const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
```

Then resolve workspace, list reminders, find reminder, and update reminder through MySQL helpers when `mysql` is present.

- [x] **Step 4: Extend MySQL smoke**

In `frontend/src/server/db/mysql-smoke.ts`, add a deadline reminder lifecycle:

```text
deadline reminder center verified=true
```

The smoke should create or reuse an intent, generate reminder rows, list the account center, acknowledge one reminder, and snooze one reminder.

- [x] **Step 5: Verify**

Run:

```bash
cd frontend
npm test -- src/server/deadlines/service.test.ts src/app/api/account/deadline-reminders/route.test.ts src/server/db/mysql-smoke.test.ts
```

Expected: all targeted tests pass.

---

## Task 3: Make Local Admin Reset MySQL-Aware

**Files:**
- Modify: `frontend/src/server/auth/admin-reset.ts`
- Modify: `frontend/src/server/auth/admin-reset.test.ts`
- Modify: `frontend/scripts/reset-admin-password.ts`

- [x] **Step 1: Add failing MySQL admin reset test**

Add a fake MySQL repository test proving `resetLocalAdminPasswordFromMysql` upserts:

- `users`
- `organizations`
- `organization_memberships`

Expected before implementation: test fails because the MySQL reset function does not exist.

- [x] **Step 2: Implement MySQL reset function**

Add:

```ts
export async function resetLocalAdminPasswordFromMysql(pool: Pool, input: ResetLocalAdminPasswordInput = {}) { ... }
```

It must:

- Hash the selected password with `hashPassword`.
- Upsert the admin user as `role='admin'`, `account_tier='enterprise'`, `is_disabled=0`.
- Upsert the organization as `account_tier='enterprise'`.
- Upsert membership as `role='owner'`, `status='active'`.

- [x] **Step 3: Update script runtime selection**

In `frontend/scripts/reset-admin-password.ts`, select MySQL when configured:

```ts
if (isMysqlDatabaseUrlConfigured()) {
  const result = await resetLocalAdminPasswordFromMysql(resolveMysqlPool(), input);
  await closeResolvedMysqlPool();
  return result;
}
return resetLocalAdminPassword(db, input);
```

- [x] **Step 4: Verify**

Run:

```bash
cd frontend
npm test -- src/server/auth/admin-reset.test.ts
```

Expected: SQLite and MySQL reset tests pass.

---

## Task 4: Add Runtime Guard Against Silent SQLite Fallback

**Files:**
- Modify: `frontend/src/server/db/client.ts`
- Create: `frontend/src/server/db/client.test.ts`
- Create: `frontend/src/server/db/mysql-route-coverage.test.ts`

- [x] **Step 1: Add runtime guard**

Implementation note: the runtime guard was implemented directly in `frontend/src/server/db/client.ts` instead of adding a separate `runtime-mode.ts` helper. When MySQL is configured, `db` is a throwing proxy, while explicit `createDatabase()` test fixtures still work.

- [x] **Step 2: Disable eager SQLite DB when MySQL is configured**

Modify `frontend/src/server/db/client.ts` so `export const db` becomes a throwing proxy when MySQL is configured:

```ts
function disabledSqliteDatabase(): AppDatabase {
  return new Proxy({}, {
    get(_target, property) {
      throw new Error(
        `SQLite runtime is disabled because MySQL is configured; attempted db.${String(property)}.`,
      );
    },
  }) as AppDatabase;
}

export const db = shouldDisableSqliteRuntime() ? disabledSqliteDatabase() : createDatabase();
```

Unit tests using `createDatabase()` keep working because they explicitly create SQLite.

- [x] **Step 3: Add coverage test for routes still importing `db`**

Create `mysql-route-coverage.test.ts` that scans `frontend/src/app/api/**/route.ts` and fails any route that imports `@/server/db/client` but has no MySQL-aware marker or intentionally documented exception.

Allowed exceptions must be explicit and reviewed in the test file. Do not use broad wildcard exceptions.

- [x] **Step 4: Verify guard**

Run:

```bash
cd frontend
npm test -- src/server/db/client.test.ts src/server/db/mysql-route-coverage.test.ts
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run build
```

Result on 2026-06-03: targeted guard tests passed. Full `npm run build` also passed with the existing Turbopack NFT trace warning for the response workspace export route.

---

## Task 5: Switch Local Runtime To MySQL

**Files:**
- Modify: `frontend/.env.local` locally only; do not commit
- Modify: `docs/operations/mysql-cutover.md`

- [x] **Step 1: Start local MySQL**

Run if there is no existing MySQL:

```bash
docker run --name winbids-mysql \
  -e MYSQL_DATABASE=winbids \
  -e MYSQL_USER=winbids \
  -e MYSQL_PASSWORD=winbids_dev_password \
  -e MYSQL_ROOT_PASSWORD=root_dev_password \
  -p 3306:3306 \
  -d mysql:8
```

If the container already exists:

```bash
docker start winbids-mysql
```

- [x] **Step 2: Write local environment**

Create or update `frontend/.env.local`:

```bash
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids
```

Do not commit `frontend/.env.local`.

- [x] **Step 3: Migrate and import**

Run:

```bash
cd frontend
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:migrate
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:import-sqlite
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run auth:reset-admin
```

Expected:

- MySQL schema exists.
- SQLite data imported.
- `admin@winbids.local` exists in MySQL as `admin / enterprise`.

Result on 2026-06-03:

- `npm run db:mysql:migrate`: 170 statements applied.
- `npm run db:mysql:import-sqlite`: 1905 rows copied across 49 tables.
- `npm run auth:reset-admin`: `admin@winbids.local / AdminLocal-2026!` reset as enterprise admin.

- [x] **Step 4: Create ordinary MySQL test user**

Run:

```bash
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@winbids.local","password":"UserLocal-2026!","displayName":"Local User"}'
```

Expected: response contains `"email":"user@winbids.local"` and `"tier":"free"`.

Result on 2026-06-03: HTTP registration smoke created a free ordinary user and verified session, usage, profile update, and admin API denial (`403`).

---

## Task 6: Full MySQL Verification

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] **Step 1: Run MySQL smoke**

Run:

```bash
cd frontend
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:smoke
```

Expected output includes:

```text
MySQL smoke passed
deadline reminder verified=true
auth session verified=true
```

Result on 2026-06-03: MySQL smoke passed with 50 tables and now verifies billing reconcile plus Knowledge Station in addition to the existing auth, account, workspace, crawler, billing, dunning, deadline, and workflow lifecycles.

- [x] **Step 2: Run normal regression without MySQL env**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all pass. This keeps SQLite unit-test utilities healthy.

Result on 2026-06-03: `npm test`, `npm run lint`, `npm run build`, `npm audit --omit=dev --audit-level=high`, and `git diff --check` passed. Build still reports the existing Turbopack NFT trace warning for the response workspace export route.

- [x] **Step 3: Run runtime checks with MySQL env**

Run:

```bash
cd frontend
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run risk:check
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run workers:check
```

Expected:

- `risk:check` still reports 50/50 states and safe details/downloads.
- Workers report `database: mysql`.

Result on 2026-06-03:

- `risk:check`: PASS, 50/50 states, 1096 state bids, 166 state attachments checked, 0 audit vulnerabilities.
- `workers:check`: crawler, event, and notification workers all reported `database: mysql`.

- [x] **Step 4: Browser smoke**

Start the app with MySQL configured:

```bash
cd frontend
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run dev
```

Verify in browser:

- Admin login: `admin@winbids.local` / `AdminLocal-2026!`
- Ordinary login: `user@winbids.local` / `UserLocal-2026!`
- `/settings` shows admin and ordinary user states differently.
- `/search` returns bids.
- A 50-state bid detail page opens.
- A safe attachment download route opens or explicitly reports unavailable.
- `/settings` Notifications shows Deadline Reminder Center.
- `/admin` source governance loads as admin and is inaccessible to ordinary user.

Result on 2026-06-03:

- Admin login works with `admin@winbids.local / AdminLocal-2026!`; `/admin` loads config, data sources, crawler logs, bid QA, notifications, risk checklist, and source-governance panels against MySQL.
- Ordinary login works with a local free user; `/settings` shows Free tier and paid features locked/upgrade, and `/admin` returns the permission-denied state.
- `/search` returns 1097 opportunities with all 50 state filters.
- A 50-state bid detail route opens successfully; match score and internal attachment download routes resolve without external 404s.
- HTTP 50-state check passed: 50 state codes, 1096 state bids, 50 sampled detail routes, 166 state attachments, 0 detail failures, 0 attachment failures.

---

## Task 7: Rollback And Production Signoff

**Files:**
- Modify: `docs/operations/mysql-cutover.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`

- [x] **Step 1: Document rollback**

Rollback steps:

```bash
unset DATABASE_URL
unset MYSQL_DATABASE_URL
cd frontend
npm run dev
```

Expected: app returns to `frontend/data/apsi.sqlite`.

Documented in `docs/operations/mysql-cutover.md`. Rollback was not executed after browser smoke because the local development server is intentionally kept running in MySQL mode for the next phase.

- [x] **Step 2: Preserve MySQL dump after verification**

Run:

```bash
docker exec winbids-mysql mysqldump --no-tablespaces -u winbids -pwinbids_dev_password winbids > frontend/data/backups/winbids-mysql-post-cutover-20260603.sql
```

Expected: SQL dump exists and is not committed.

Result on 2026-06-03: `frontend/data/backups/winbids-mysql-post-cutover-20260603.sql` exists locally and is not committed.

- [ ] **Step 3: Production readiness gate**

Do not declare production cutover complete until these run in a production-like environment:

```bash
NODE_ENV=production DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run billing:production:check
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run billing:stripe:sandbox -- --tier=pro
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run billing:stripe:sandbox -- --tier=business
```

Expected:

- Billing production preflight passes without printing secrets.
- Stripe sandbox verifier creates checkout, confirms webhook, updates subscription/tier/org tier, creates billing portal, and cancels cleanup subscription.

---

## Recommended Execution Mode

Use subagents in this order:

1. **Agent A / Deadline MySQL**：Task 2.
2. **Agent B / Admin reset + runtime guard**：Task 3 and Task 4.
3. **Agent C / Migration + smoke**：Task 5 and Task 6.
4. **Agent D / Docs + rollback**：Task 1 and Task 7.

Coordinator responsibility:

- Review each agent diff before merging into the shared worktree.
- Run final verification commands personally.
- Update `winbids-implementation-status.md` with exact pass/fail evidence and the remaining production signoff items.
