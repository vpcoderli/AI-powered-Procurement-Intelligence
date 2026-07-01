# MySQL Cutover Runbook

Updated: 2026-06-03

This runbook tracks the migration from local SQLite to MySQL. The current implementation provides a MySQL runtime for the main local user, admin, billing, crawler, knowledge, dashboard, and workflow paths while preserving SQLite as the default no-URL local runtime and fast test utility.

## Current State

- SQLite remains available for fast unit tests and explicit data import/rollback tasks. When a MySQL URL is configured, the runtime `db` singleton in `frontend/src/server/db/client.ts` is a throwing guard so unmigrated paths cannot silently write to `frontend/data/apsi.sqlite`.
- MySQL dependency and migration tooling are available through `mysql2`.
- `npm run db:mysql:migrate` creates the MySQL schema from the existing SQLite migration source with compatibility conversion.
- The compatibility migration has been smoke-tested against a disposable MySQL 8 container: the local schema currently exposes 50 tables, records `sqlite-ddl-compat-v1`, and accepts a bid row with a 5,000-character `description`.
- MySQL-aware runtime paths now cover: auth register/login/session/logout/password reset, local admin password reset, account profile/password/delete/export/usage/notification preferences, workspace read/update/invitations/member management/ownership transfer, admin auth gate, admin users/feature overrides/audit logs, admin config registry list/upsert/patch with audit events, event outbox delivery worker, admin data source list/update, admin bid QA list/review/display/correction/batch writes, billing subscription/checkout/portal/cancel/webhook/invoices/dunning scheduling, supplier profile, bid search/detail/saved-bids/attachment metadata, search alerts CRUD/quota/digest history, notification outbox/admin recent/delivery, intent create/list/detail/status, deadline reminders, compliance manifest, submission guidance/confirmation, response workspace, pursuit decision, qualification citations/freshness/Q&A, crawler health/admin crawler logs, crawler locks/source enablement orchestration, direct JSON crawler result import/upsert into MySQL, crawler search-alert matching plus digest notification after successful crawler runs, and repeatable SQLite-to-MySQL data import.
- The repeatable smoke verifier now inserts crawler/bid rows and confirms scraper-health, admin crawler-log, bid search/detail, attachment metadata fallback, saved bid lifecycle, supplier profile lifecycle, intent lifecycle, deadline reminder lifecycle, compliance manifest lifecycle, submission guidance/confirmation lifecycle, response workspace lifecycle, pursuit decision lifecycle, qualification citations/freshness/Q&A lifecycle, admin users/feature overrides/audit logs lifecycle, admin config registry lifecycle, event outbox delivery lifecycle, admin bid QA lifecycle, crawler import/upsert lifecycle, crawler control lifecycle, crawler search-alert matching/digest lifecycle, billing lifecycle, billing dunning lifecycle, billing subscription reconcile, workspace lifecycle, workspace member lifecycle, account usage/export/preferences lifecycle, search alert lifecycle, Knowledge Station lifecycle, notification outbox delivery with digest history, password reset lifecycle, and auth session lifecycle on MySQL.
- Route-level MySQL guard coverage now scans API route imports, and the local browser/API smoke covers admin versus ordinary-user separation, paid-feature locked states, dashboard summary, admin source governance, `/search`, bid detail, and safe attachment downloads.
- Full production signoff is still blocked by running the operator-assisted Stripe sandbox verifier with real test credentials against MySQL and executing the production webhook/low-risk live checkout runbook. Worker deployment preflight is scriptable through `npm run workers:check`; production billing credential preflight is scriptable through `npm run billing:production:check`.

## Environment

Use one of these variables:

```bash
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids
MYSQL_DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids
```

Do not commit credentials. Use `.env.local` locally and a secret manager in production.

## Local MySQL Smoke Setup

Example disposable MySQL container:

```bash
docker run --name winbids-mysql \
  -e MYSQL_DATABASE=winbids \
  -e MYSQL_USER=winbids \
  -e MYSQL_PASSWORD=winbids_dev_password \
  -e MYSQL_ROOT_PASSWORD=root_dev_password \
  -p 3306:3306 \
  -d mysql:8
```

Run the migration:

```bash
cd frontend
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:migrate
```

Expected result:

```text
MySQL migrated: <n> statements applied, <m> statements skipped.
```

Optionally import the local SQLite data set:

```bash
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:import-sqlite
```

The import command defaults to `frontend/data/apsi.sqlite`, or `DATABASE_PATH` when set. It upserts each copied row and is safe to re-run. Use `--source=/absolute/path/to/apsi.sqlite`, `--tables=users,bids,bid_attachments`, or `--batch-size=200` for scoped imports.

Run the repeatable smoke verifier:

```bash
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:smoke
```

Expected result:

```text
MySQL smoke target: mysql://winbids:***@127.0.0.1:3306/winbids
MySQL smoke passed: 50 tables, bids.description=longtext, bids.source=varchar(191), long content length=5000, scraper health sources=1, admin crawler logs=1, bid search results=1, ...
Migration check: <n> statements applied, <m> statements skipped.
```

Current expanded smoke output includes:

```text
bid detail verified=true, attachment verified=true, saved bid verified=true, profile verified=true, intent verified=true, deadline reminder verified=true, compliance verified=true, submission verified=true, response workspace verified=true, pursuit decision verified=true, qualification verified=true, billing verified=true, billing dunning verified=true, billing reconcile verified=true, workspace verified=true, workspace member verified=true, admin users verified=true, admin config verified=true, event outbox verified=true, admin bid QA verified=true, crawler import verified=true, crawler control verified=true, crawler alert matching verified=true, knowledge station verified=true, account usage verified=true, notification preferences verified=true, account export verified=true, notification outbox verified=true, search alert verified=true, password reset verified=true, auth session verified=true
```

The migration is safe to re-run. Existing indexes are skipped on duplicate-name errors while `CREATE TABLE IF NOT EXISTS` statements remain no-op table checks.

Useful validation queries:

```sql
SELECT COUNT(*) AS tables_created
FROM information_schema.tables
WHERE table_schema = 'winbids';

SHOW COLUMNS FROM bids LIKE 'description';
SHOW COLUMNS FROM bids LIKE 'source';
SHOW COLUMNS FROM organization_feature_overrides LIKE 'organization_id';
SELECT * FROM mysql_migrations;
```

## Runtime Cutover Checklist

The migration entry point alone does not switch the app runtime. Complete these before declaring MySQL as the active database:

0. Before import or browser smoke, create a timestamped SQLite backup in `frontend/data/backups/` and keep `frontend/data/apsi.sqlite*` until MySQL browser smoke, `npm run db:mysql:smoke`, and `npm run risk:check` have passed.
1. Local cutover verification has passed: SQLite backup, MySQL migration/import, admin reset, MySQL smoke, `risk:check`, `workers:check`, full regression tests, browser smoke, admin/user role separation, and 50-state detail/download HTTP checks.
2. Run Stripe sandbox verification in MySQL mode with real Stripe test credentials before production billing signoff.
3. Execute `npm run workers:check` plus one-shot worker dry runs for crawler, notifications/dunning, and event outbox in staging/production-like environments.
4. Execute `NODE_ENV=production npm run billing:production:check` in the production deployment environment before live webhook rotation or launch.
5. Preserve a MySQL dump after each cutover rehearsal. The local post-cutover dump is `frontend/data/backups/winbids-mysql-post-cutover-20260603.sql`.
6. Replace any remaining SQLite raw SQL and `PRAGMA` usage in MySQL-mode tests/scripts only as those paths are promoted to production gates.

Rollback to the preserved local SQLite runtime:

```bash
unset DATABASE_URL
unset MYSQL_DATABASE_URL
cd frontend
npm run dev
```

Keep `frontend/data/apsi.sqlite` and `frontend/data/backups/` until the production MySQL environment has its own verified backup/restore process.

## Known Compatibility Notes

- MySQL does not support SQLite `PRAGMA`.
- The compatibility converter sizes text columns used by primary keys or indexes as `VARCHAR(191)` and preserves non-key long content columns as `LONGTEXT`. This prevents InnoDB row-size failures while still allowing large bid descriptions, raw payloads, and archived metadata.
- MySQL index creation behavior differs; duplicate index errors are treated as idempotent in the migration runner.
- SQLite expression indexes such as `COALESCE(scope_id, '')` need a dedicated MySQL strategy before production use.
- MySQL drivers are async; this is the largest code-level cutover from the current synchronous SQLite implementation.
