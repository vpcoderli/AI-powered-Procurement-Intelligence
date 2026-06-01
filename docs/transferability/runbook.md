# Operations Runbook

This runbook gives first responders a minimal operating path for local checks, production incidents, backup/restore, and observability.

## Daily Local Health Check

```bash
cd frontend
npm test
npm run lint
npm run build
npm run risk:check
```

Worker checks:

```bash
cd frontend
npm run worker:notifications:check
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
STATE_CRAWLER_LIMIT=5 npm run crawler:once
```

## Production Health Check

Run from the production runtime or deploy console:

```bash
curl -I https://<production-host>/
curl -I https://<production-host>/search
```

Then confirm:

- Web process is serving `2xx` or expected redirects.
- Notification worker is running or scheduled.
- Crawler worker is running or scheduled only when approved sources are enabled.
- Recent logs are free of repeated `database`, `secret`, `environment`, `deploy`, `notification`, `crawler`, `billing`, or `webhook` failures.
- Backup job succeeded within the expected recovery point objective.

## Observability Basics

Until a dedicated observability stack exists, use:

- Deployment platform web logs.
- Worker process logs.
- Stripe webhook delivery logs for billing.
- Notification provider dashboard/logs for outbound delivery.
- Application database tables for notification outbox, billing events, crawler logs, and source status.
- `npm run risk:check` for local P0 guardrail drift.

Production should add centralized logs, metrics, uptime checks, alert routing, and dashboard ownership before high-volume launch.

## Incident Flow

1. Declare the incident and name an incident owner.
2. Identify affected environment: local, preview, staging, or production.
3. Preserve logs and current environment variable versions.
4. Stop or pause workers if they are amplifying the failure.
5. Apply the smallest safe mitigation.
6. If deployment caused the incident, use the rollback process in [Deployment Guide](./deployment-guide.md).
7. If data is corrupted or unavailable, use backup/restore guidance in [Data Model and Migrations](./data-model-and-migrations.md).
8. Record timeline, root cause, customer impact, and follow-up actions.

## Common Incidents

| Symptom | First check | Likely action |
|---|---|---|
| App returns `5xx` after deploy. | Web logs and migration output. | Rollback app version or restore database from backup. |
| Login fails for all users. | Session cookie settings and database access. | Check `NODE_ENV`, host, and session table availability. |
| Notifications are not sent. | `npm run worker:notifications:check`. | Fix provider environment, then run one worker pass. |
| Stripe events do not apply. | Stripe Dashboard webhook delivery and `STRIPE_WEBHOOK_SECRET`. | Rotate or restore webhook secret and replay missed events. |
| Crawler imports fail. | Worker logs, source status, `STATE_CRAWLER_LIMIT`, and source access policy. | Disable blocked sources and run a smaller approved batch. |
| Database migration fails. | Migration error and pre-migration backup status. | Stop deploy, keep failed state copy, restore or patch forward. |

## Backup And Restore Drill

Run quarterly for production-like data and after changing database infrastructure:

```bash
cd frontend
sqlite3 data/apsi.sqlite ".backup 'data/backups/restore-drill.sqlite'"
DATABASE_PATH=data/backups/restore-drill.sqlite npm run db:migrate
```

The drill is complete only when a restored copy can run migrations and support a smoke test without touching production data.
