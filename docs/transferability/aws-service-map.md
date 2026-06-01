# AWS Service Map

This is the target AWS-first production map for WinBids / APSI. It is not an assertion that all services are already provisioned.

## Current Local To AWS Mapping

| Capability | Local implementation | AWS production target | Owner notes |
|---|---|---|---|
| Web app | `cd frontend && npm run dev` or `npm run start` | AWS Amplify, ECS/Fargate, App Runner, or another approved Node.js runtime | Deploy owner chooses one runtime and documents rollback. |
| Database | SQLite at `frontend/data/apsi.sqlite`; MySQL migration dry-run tooling exists | RDS MySQL for managed production storage, or durable SQLite volume only for early limited deployment | Data owner must document backup/restore and complete async repository cutover before declaring MySQL runtime active. |
| Attachments | Local `CRAWLER_ATTACHMENT_DIR` | S3 bucket with least-privilege access | Source owner controls retention and legal-use policy. |
| Notifications | File/console/generic HTTP provider | SES, Pinpoint, or approved external provider behind Secrets Manager | Operations owner monitors bounce/complaint handling. |
| Billing | Stripe test/live integration | Stripe plus Secrets Manager and CloudWatch alarms | Billing owner controls live keys and webhook rotation. |
| Workers | Local npm scripts | ECS scheduled tasks, EventBridge Scheduler, Lambda, or platform worker processes | Worker owner ensures singleton or idempotent scheduling. |
| Secrets | `.env.local` placeholders | AWS Secrets Manager or SSM Parameter Store with KMS | Security owner reviews access. |
| Logs | Local stdout/files | CloudWatch Logs or centralized log platform | Incident owner needs retention and search access. |
| Metrics/alerts | Manual checks | CloudWatch metrics, alarms, uptime checks, provider alerts | Production launch requires alert routing. |
| Backups | Manual SQLite `.backup` | RDS snapshots, S3 versioning/lifecycle, or volume snapshots | Restore drills must be scheduled. |

## Minimal AWS Deployment Boundary

For the smallest production-safe AWS deployment:

1. Node.js web runtime with `NODE_ENV=production`.
2. Persistent database path or managed database.
3. Secrets loaded from AWS Secrets Manager or SSM Parameter Store.
4. Separate notification and crawler worker tasks.
5. S3 or durable volume for crawler attachments.
6. CloudWatch logs for web and workers.
7. Backup job and restore drill.
8. Rollback runbook and deploy owner.

## Example Operational Commands

Local build before packaging:

```bash
cd frontend
npm install
npm run build
```

Production smoke check after AWS deploy:

```bash
curl -I https://<production-host>/
curl -I https://<production-host>/search
```

AWS operators should replace placeholders with their environment-specific CLI, pipeline, or console workflow. Do not place AWS access keys in this repository.
