# Deployment Guide

This guide defines the current deployment boundary for WinBids / APSI. It does not provision infrastructure; it gives the receiving operator a repeatable build, deploy, smoke test, and rollback path.

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

For production, take a database backup before migrations. See [Data Model and Migrations](./data-model-and-migrations.md).

## Worker Deployment

Run workers separately from the web process.

Notification worker:

```bash
cd frontend
npm run worker:notifications:check
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
- `npm run worker:notifications:check` passes in the worker environment.
- Stripe webhook endpoint returns `2xx` for the relevant staging or production test.
- Recent logs contain no repeated database, notification, crawler, or billing errors.

## Rollback

Rollback owner must be named before production deploy begins.

Recommended rollback sequence:

1. Stop or pause workers.
2. Re-deploy the previous known-good application version.
3. Restore previous environment variables if the deploy changed secrets or provider settings.
4. If a database migration caused the incident, restore from the pre-migration backup into a replacement database or file path.
5. Restart web and worker processes.
6. Run the smoke test again.

Do not run destructive rollback commands against production until the database backup and restore target have been confirmed.
