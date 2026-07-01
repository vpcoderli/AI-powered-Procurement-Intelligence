# Deployment Guide

This guide defines the current deployment boundary for WinBids / APSI. It does not provision infrastructure; it gives the receiving operator a repeatable build, deploy, smoke test, and rollback path.

Current AWS status: dry-run readiness only. The repository has runbooks and local/staging preflight gates, but this document does not assert that real AWS infrastructure has been created or that production traffic has been shifted.

## Local Release Candidate Check

Before a deploy candidate is handed to staging or production:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
```

For a production-like handoff environment, also run:

```bash
cd frontend
NODE_ENV=production npm run ops:production:check
NODE_ENV=production npm run workers:check
```

For staging, run the same commands with a production-like worker environment. The checks fail closed when `DATABASE_URL` resolves to SQLite or when notification delivery uses `file`/`console`; those are launch blockers. Warnings on a zero-exit check are diagnostic and must be reviewed by the named owner, but they are not a substitute for clearing blockers.

`ops:production:check` also requires non-secret owner and backup/restore evidence metadata:

```bash
PRODUCTION_OWNER_BILLING=<billing owner>
PRODUCTION_OWNER_WORKERS=<worker owner>
PRODUCTION_OWNER_BACKUPS=<backup owner>
PRODUCTION_BACKUP_RUNBOOK_URL=<internal runbook URL>
PRODUCTION_BACKUP_EVIDENCE_URL=<internal backup evidence URL>
PRODUCTION_RESTORE_EVIDENCE_URL=<internal restore evidence URL>
PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP=<ISO-8601 timestamp>
```

The check prints only configured markers for these fields. Missing owner/evidence fields are blockers for staging and production handoff.

Crawler tests, when crawler behavior changed:

```bash
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

## Build Artifact

The current app is deployed from `frontend`:

```bash
cd frontend
npm install
npm run build
npm run start
```

Production process managers should run `npm run start` only after the build completes successfully.

## AWS Deployment

For AWS-specific publishing steps, use [AWS Deployment Runbook](../operations/aws-deployment-runbook.md).

Staging dry-run order:

1. Build.
2. Environment validation.
3. RDS/MySQL migration and smoke.
4. Workers check.
5. Source health report-only run.
6. Demo/risk smoke.
7. Backup snapshot and logical dump.
8. Restore rehearsal to staging.
9. Rollback decision.

Create an evidence folder before step 1 and save each command output with owner, UTC timestamp, exit status, and pass/fail decision. Recommended local evidence root is `../ops-evidence/aws-staging-dry-run/<timestamp>/`; publish a sanitized internal artifact URL for backup and restore evidence before running `ops:production:check`.

Recommended first AWS web release:

1. Deploy the web service from `frontend` to AWS App Runner.
2. Use build command `npm ci && npm run build`.
3. Use start command `npm run start -- -p 8080`.
4. Set service port to `8080`.
5. Store runtime values in AWS Secrets Manager or SSM Parameter Store.
6. Use RDS MySQL through `DATABASE_URL`; production should not rely on local SQLite.

Production-complete AWS release additionally needs ECS/Fargate scheduled tasks or an equivalent worker runtime for crawler, event outbox, and notification/dunning workers.

## Environment Promotion

Use separate environments:

| Environment | Purpose | Data boundary |
|---|---|---|
| Local | Developer iteration and tests. | Disposable SQLite and test secrets only. |
| Preview | Branch validation. | Disposable or isolated database; no live secrets. |
| Staging | Release rehearsal. | Production-like config with test or staging provider credentials. |
| Production | Customer-facing runtime. | Live secrets, durable storage, backups, monitored workers. |

## Database Migration Step

Run migrations before starting the new web process against the target database:

```bash
cd frontend
npm run db:migrate
```

For staging and production, take a database backup before migrations. Required evidence includes an RDS snapshot id, logical dump checksum, owner, UTC timestamp, and restore target. See [Data Model and Migrations](./data-model-and-migrations.md) and the AWS runbook backup/restore section.

## Worker Deployment

Run workers separately from the web process.

Production and staging worker environments must use `DATABASE_URL=mysql://...` or `mysql2://...` and `NOTIFICATION_PROVIDER=http`. Local/dev runs may keep SQLite and `NOTIFICATION_PROVIDER=file` or `console`.

Notification worker:

```bash
cd frontend
NODE_ENV=production npm run worker:notifications:check
npm run worker:notifications
```

Scheduler-only notification worker:

```bash
cd frontend
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
```

Crawler worker:

```bash
cd frontend
NODE_ENV=production npm run worker:crawler:check
npm run worker:crawler
```

Scheduler-only crawler job:

```bash
cd frontend
npm run crawler:once
```

## Smoke Test

After deployment:

```bash
curl -I https://<production-host>/
curl -I https://<production-host>/search
```

Then verify:

- Login and session creation work.
- `/search`, `/settings`, and `/admin` render for appropriate users.
- `NODE_ENV=production npm run workers:check` passes in the worker environment with no blockers.
- Stripe webhook endpoint returns `2xx` for the relevant staging or production test.
- Recent logs contain no repeated database, notification, crawler, or billing errors.

## Rollback

Rollback owner must be named before production deploy begins.

Recommended rollback sequence:

1. Stop or pause workers.
2. Re-deploy the previous known-good application version.
3. Restore previous environment variables if the deploy changed secrets or provider settings.
4. If a database migration caused the incident, restore from the pre-migration RDS snapshot into a replacement database, or use the logical dump only under data-owner approval.
5. Restart web and worker processes.
6. Run the smoke test again.

Do not run destructive rollback commands against production until the database backup and restore target have been confirmed.
