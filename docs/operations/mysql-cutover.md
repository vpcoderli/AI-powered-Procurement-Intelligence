# MySQL Cutover Runbook

Updated: 2026-06-01

This runbook tracks the migration from local SQLite to MySQL. The current implementation provides a MySQL runtime for the highest-traffic local user paths while preserving SQLite test utilities and unmigrated deep-admin/workflow modules until their repositories are converted.

## Current State

- SQLite remains available for fast unit tests and unmigrated modules through `frontend/src/server/db/client.ts`.
- MySQL dependency and migration tooling are available through `mysql2`.
- `npm run db:mysql:migrate` creates the MySQL schema from the existing SQLite migration source with compatibility conversion.
- The compatibility migration has been smoke-tested against a disposable MySQL 8 container: a fresh schema created 37 tables, recorded `sqlite-ddl-compat-v1`, and accepted a bid row with a 5,000-character `description`.
- MySQL-aware runtime paths now cover: auth register/login/session/logout, account profile/password/delete, workspace read/update, admin auth gate, billing subscription/checkout/portal/cancel/webhook/invoices, supplier profile, bid search/detail/saved-bids, intent create/list/detail/status, crawler health, and admin crawler logs.
- The repeatable smoke verifier now inserts crawler/bid rows and confirms scraper-health, admin crawler-log, bid search/detail, saved bid lifecycle, supplier profile lifecycle, intent lifecycle, billing lifecycle, workspace lifecycle, and auth session lifecycle on MySQL.
- Full runtime cutover is still blocked by remaining synchronous repository calls in deeper modules such as password reset, workspace invitations/member management, account export/usage/preferences, attachment metadata download lookup, search alerts, compliance/submission/response-workspace/pursuit/qualification panels, admin users/config/bid QA writes, notification/event workers, and crawler write/import paths.

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

Run the repeatable smoke verifier:

```bash
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:smoke
```

Expected result:

```text
MySQL smoke target: mysql://winbids:***@127.0.0.1:3306/winbids
MySQL smoke passed: 37 tables, bids.description=longtext, bids.source=varchar(191), long content length=5000, scraper health sources=1, admin crawler logs=1, bid search results=1.
Migration check: <n> statements applied, <m> statements skipped.
```

Current expanded smoke output includes:

```text
bid detail verified=true, saved bid verified=true, profile verified=true, intent verified=true, billing verified=true, workspace verified=true, auth session verified=true
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

1. Finish MySQL repository coverage for the remaining account/workspace APIs: password reset, export, notification preferences, usage, invitations, members, and ownership transfer.
2. Finish MySQL coverage for attachment metadata download lookup and crawler bid upsert/import writes.
3. Finish MySQL coverage for search alerts, notification/event workers, config registry, admin users, admin bid QA, feature overrides, and audit logs.
4. Finish MySQL coverage for compliance, submission, response workspace, pursuit decisions, qualification freshness, and evidence citations.
5. Replace SQLite raw SQL and `PRAGMA` usage in MySQL-mode tests/scripts.
6. Add a seeded-data migration/import path from `frontend/data/apsi.sqlite` into MySQL.
7. Run full tests against MySQL, not only static migration tests, before production cutover.
8. Export SQLite data, import into MySQL, and run `npm run risk:check` against the MySQL runtime.

## Known Compatibility Notes

- MySQL does not support SQLite `PRAGMA`.
- The compatibility converter sizes text columns used by primary keys or indexes as `VARCHAR(191)` and preserves non-key long content columns as `LONGTEXT`. This prevents InnoDB row-size failures while still allowing large bid descriptions, raw payloads, and archived metadata.
- MySQL index creation behavior differs; duplicate index errors are treated as idempotent in the migration runner.
- SQLite expression indexes such as `COALESCE(scope_id, '')` need a dedicated MySQL strategy before production use.
- MySQL drivers are async; this is the largest code-level cutover from the current synchronous SQLite implementation.
