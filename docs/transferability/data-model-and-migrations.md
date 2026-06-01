# Data Model and Migrations

WinBids / APSI currently uses a local SQLite-backed data model in the frontend application. Schema and migration logic live under `frontend/src/server/db` and `frontend/scripts`. A MySQL migration entry point now exists for cutover preparation, but SQLite remains the active runtime until repository calls are converted to async MySQL operations.

## Local Database

Default local path:

```text
frontend/data/apsi.sqlite
```

Run migrations:

```bash
cd frontend
npm run db:migrate
```

Run MySQL migration dry run against a MySQL database:

```bash
cd frontend
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:migrate
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:smoke
```

The MySQL cutover runbook is in `docs/operations/mysql-cutover.md`. The current compatibility migration has been validated against MySQL 8 for fresh schema creation, idempotent re-run behavior, and long bid content storage, but it is not yet the active application runtime.

Seed local development data:

```bash
cd frontend
npm run db:seed
```

Run a local database smoke test through the app test suite:

```bash
cd frontend
npm test
```

## Production Boundary

Production must use persistent storage. If SQLite remains the production store for an early deployment, `DATABASE_PATH` must point to a durable volume and must be included in the backup schedule. If the platform moves to MySQL, `DATABASE_URL` or `MYSQL_DATABASE_URL` must point to the managed database secret and `npm run db:mysql:migrate` must be part of the release checklist.

## Migration Ownership

- Application migrations are owned by the backend/application maintainer for the release.
- Production migration execution is owned by the deploy operator.
- A pre-migration backup is required before production deployment.
- Migrations must not be run manually from an untracked local checkout against production.

## Backup

For local SQLite:

```bash
cd frontend
mkdir -p data/backups
sqlite3 data/apsi.sqlite ".backup 'data/backups/apsi-$(date +%Y%m%d-%H%M%S).sqlite'"
```

For production SQLite on a durable volume, run the same `.backup` command from the production host or maintenance job, writing to a backup location outside the live database directory. The production backup process must record:

- Source database path.
- Backup object or file path.
- Timestamp.
- Operator or job identity.
- Restore test status.

## Restore

Local restore to a disposable copy:

```bash
cd frontend
cp data/backups/apsi-YYYYMMDD-HHMMSS.sqlite data/apsi-restore-test.sqlite
DATABASE_PATH=data/apsi-restore-test.sqlite npm run db:migrate
```

Production restore boundary:

1. Stop web and worker processes or redirect them to a maintenance page.
2. Restore into a new database file or managed database target.
3. Run `npm run db:migrate` against the restored target.
4. Start a single web process and run smoke tests.
5. Point production traffic and workers to the restored target only after validation.

Do not overwrite the live production database file without a second copy of the failed state for incident analysis.

## Data Areas

Current durable areas include:

- Users, sessions, organizations, workspace membership, invitations, and account self-service state.
- Saved bids and pursuit intents.
- Billing subscriptions, invoices, checkout sessions, and provider event history.
- Notification outbox and delivery history.
- Crawler source metadata, crawler logs, bid imports, attachments, and QA state.
- Qualification, compliance, evidence, Knowledge Station, and Response Workspace records.

The exact schema is source-controlled in `frontend/src/server/db/schema.ts`.
