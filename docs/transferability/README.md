# WinBids Transferability Pack

Updated: 2026-06-01

This pack is the handoff index for running, deploying, operating, and transferring WinBids / APSI. It is intentionally documentation-only: it does not create infrastructure, change the database, or store secrets.

## Start Here

1. [Setup Guide](./setup-guide.md) - local developer bootstrap and test commands.
2. [Environment Variables](./environment-variables.md) - local, staging, and production configuration boundaries.
3. [Deployment Guide](./deployment-guide.md) - build, deploy, smoke test, and rollback flow.
4. [Data Model and Migrations](./data-model-and-migrations.md) - current SQLite model, migration commands, backup and restore.
5. [Runbook](./runbook.md) - operational checks, incidents, observability, and recovery.
6. [Known Limitations](./known-limitations.md) - current product and production gaps.
7. [AWS Service Map](./aws-service-map.md) - target AWS service ownership map.
8. [Secrets and Access](./secrets-and-access.md) - secret handling and access boundaries.

## Local Boundary

Local development uses the repository checkout, `frontend/data/apsi.sqlite`, file or console notification delivery, crawler fixture/live commands, and optional Stripe test-mode credentials. Local commands are safe to run against disposable developer data:

```bash
cd frontend
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Run the baseline before handing off a local change:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
```

## Production Boundary

Production must use environment-scoped secrets, a persistent database path or managed database, separate web and worker processes, explicit backup/restore procedures, and monitored deploy/rollback ownership. Do not copy production secrets into `.env.local`, screenshots, tickets, logs, or this documentation.

## Transfer Checklist

- Repository URL and branch policy are documented for the receiving team.
- The receiving team can run the local setup commands.
- Environment variables are provided through a secret manager, not through committed files.
- Deployment target, production database, worker process model, and rollback owner are named.
- Backup and restore have been tested with non-production data.
- Observability links, incident owner, and escalation path are known.
