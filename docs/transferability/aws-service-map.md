# AWS Service Map

This is the target AWS-first production map for WinBids / APSI. It is not an assertion that all services are already provisioned.

## Recommended Release Modes

| Mode | Use when | AWS shape | Limit |
|---|---|---|---|
| First AWS web release | Need a quick hosted web environment for staging or early production validation. | App Runner web service, RDS MySQL, Secrets Manager/SSM, CloudWatch, Stripe webhook. | Worker scheduling is not complete until ECS/Fargate or an equivalent task runtime is added. |
| Production-complete AWS release | Need a launchable production environment with background operations. | App Runner or ECS web runtime, RDS MySQL, ECS/Fargate scheduled tasks via EventBridge Scheduler, S3, Secrets Manager/SSM, CloudWatch, RDS backups. | Requires a production container image or equivalent worker task runtime; this repo currently has no Dockerfile. |

Detailed steps are in [AWS Deployment Runbook](../operations/aws-deployment-runbook.md).

## Current Local To AWS Mapping

| Capability | Local implementation | AWS production target | Owner notes |
|---|---|---|---|
| Web app | `cd frontend && npm run dev` or `npm run start` | App Runner for first web release; ECS/Fargate when a shared app image exists | App Runner start command should be `npm run start -- -p 8080` with service port `8080`. |
| Database | SQLite at `frontend/data/apsi.sqlite`; MySQL migration/smoke tooling exists | RDS MySQL for managed production storage | Data owner must document backup/restore and run `npm run db:mysql:migrate` plus `npm run db:mysql:smoke`. |
| Attachments | Local `CRAWLER_ATTACHMENT_DIR` and local artifact/package export paths | S3 bucket through the S3-compatible object-storage provider with least-privilege access | Source/platform owner controls retention, malware scanning boundary, legal-use policy, and real AWS staging validation; local file storage is not final production storage. |
| Notifications | File/console/generic HTTP provider | SES, Pinpoint, or approved external provider behind Secrets Manager | Operations owner monitors bounce/complaint handling. |
| Billing | Stripe test/live integration | Stripe plus Secrets Manager and CloudWatch alarms | Billing owner controls live keys and webhook rotation. |
| Workers | Local npm scripts | ECS/Fargate scheduled tasks via EventBridge Scheduler, or an approved equivalent | Worker owner ensures singleton or idempotent scheduling; worker tasks are separate from web. |
| Secrets | `.env.local` placeholders | AWS Secrets Manager or SSM Parameter Store with KMS | Security owner reviews access. |
| Logs | Local stdout/files | CloudWatch Logs or centralized log platform | Incident owner needs retention and search access. |
| Metrics/alerts | Manual checks | CloudWatch metrics, alarms, uptime checks, provider alerts | Production launch requires alert routing. |
| Backups | Manual SQLite `.backup` | RDS snapshots, S3 versioning/lifecycle, or volume snapshots | Restore drills must be scheduled. |

## Minimal AWS Deployment Boundary

For the smallest production-safe AWS deployment:

1. Node.js web runtime with `NODE_ENV=production`.
2. RDS MySQL through `DATABASE_URL`.
3. Secrets loaded from AWS Secrets Manager or SSM Parameter Store.
4. Separate notification, event, and crawler worker tasks when production operations are enabled.
5. S3-backed object storage, or a documented temporary file-storage boundary for crawler attachments and generated exports.
6. CloudWatch logs for web and workers.
7. Backup job and restore drill.
8. Rollback runbook and deploy owner.

## App Runner First Release Settings

Use these values when deploying from the `frontend` directory:

```bash
Build command: npm ci && npm run build
Start command: npm run start -- -p 8080
Port: 8080
```

Do not define a custom App Runner environment variable named `PORT`; configure the runtime port and start command instead.

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
