# AWS Deployment Runbook

Updated: 2026-06-10

This runbook explains how to publish WinBids / APSI to AWS and how to run a staging dry-run before launch. It is documentation/checklist-only: it does not provision infrastructure, does not create AWS credentials, and does not store real secrets.

Current status: dry-run readiness only. Completing this checklist proves that operators have captured the required local/staging evidence; it does not mean a real AWS production deployment has happened.

## Recommended AWS Shape

Use this path for the first AWS release:

| Layer | Recommended service | Why |
|---|---|---|
| Web runtime | AWS App Runner source deployment for the first web release, or ECS/Fargate when a container image is introduced | App Runner is simpler for a Node.js web service; ECS/Fargate is better once web and workers share one image. |
| Database | Amazon RDS for MySQL | The app has MySQL migration and smoke tooling; production should not depend on local SQLite. |
| Secrets | AWS Secrets Manager or SSM Parameter Store with KMS | Production secrets must not live in `.env.local`, git, screenshots, tickets, or chat. |
| Workers | ECS/Fargate scheduled tasks through EventBridge Scheduler | The app has crawler, event, and notification worker commands that should run outside the web process. |
| Attachments / generated files | S3 for production object storage, or a documented temporary volume boundary | Current code has a local provider and an S3-compatible SigV4 REST provider. Real AWS staging must still validate bucket policy, IAM/Secrets Manager injection, CloudFront/signed URL posture, malware scanning boundary, and restore/retention policy. |
| Logs / alarms | CloudWatch Logs and CloudWatch alarms | Operators need log search, health visibility, and alert routing. |
| Billing | Stripe live mode + AWS-managed environment secrets | Webhook endpoint must be unique per environment. |
| Backups | RDS automated backups plus manual pre-migration snapshots | Restore drill is required before launch signoff. |

Official AWS references:

- [AWS App Runner application development](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html): App Runner supports managed runtimes, configurable port behavior, environment variables, Secrets Manager / SSM references, and instance roles.
- [AWS App Runner service configuration](https://docs.aws.amazon.com/apprunner/latest/dg/manage-configure.html): service configuration, CLI/API, console setup, and observability settings.
- [Amazon ECS scheduled tasks with EventBridge Scheduler](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html): recurring and one-time ECS task schedules.
- [Amazon RDS automated backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ManagingAutomatedBackups.html): backup windows, retention, and backup behavior.
- [Amazon RDS backup and recovery guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/backup-recovery/rds.html): backup windows, snapshots, cross-account/Region options, and restore planning.

## Deployment Modes

### Mode A: First AWS Web Release

Use when the goal is to expose the web app in AWS quickly and safely.

Includes:

- App Runner web service.
- RDS MySQL.
- Secrets Manager / SSM environment values.
- CloudWatch logs.
- Stripe webhook endpoint.
- Manual or staging-only worker execution until ECS scheduled tasks are ready.

Limit:

- This is not a complete production operations model because crawler/event/notification workers are not continuously scheduled in AWS yet.

### Mode B: Production-Complete AWS Release

Use when the goal is a launchable production environment.

Includes everything in Mode A, plus:

- ECS/Fargate task definition for the app image.
- ECS service for the web process or App Runner for web plus ECS for workers.
- EventBridge schedules for crawler, event outbox, and notification/dunning workers.
- RDS backup/restore drill.
- Source health operations run.
- Stripe live checkout/webhook smoke.

Limit:

- The repository currently has no Dockerfile. If the team chooses ECS/Fargate, add a container build step before executing this path.

## AWS Staging Dry-Run Evidence Protocol

Every staging dry-run must create an evidence folder before commands start. Keep the folder outside git unless the output is deliberately redacted.

```bash
export DRY_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-aws-staging"
export EVIDENCE_ROOT="${EVIDENCE_ROOT:-../ops-evidence/aws-staging-dry-run}"
export EVIDENCE_DIR="$EVIDENCE_ROOT/$DRY_RUN_ID"
mkdir -p "$EVIDENCE_DIR"
printf "dry_run_id=%s\nstarted_at=%s\nrelease_sha=%s\noperator=%s\n" \
  "$DRY_RUN_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse HEAD)" "${USER:-unknown}" \
  | tee "$EVIDENCE_DIR/00-manifest.txt"
```

Evidence rules:

- Save every command output with `2>&1 | tee "$EVIDENCE_DIR/<step>.log"`.
- Each evidence file needs owner, UTC timestamp, command, exit status, and pass/fail decision in the dry-run notes.
- Do not save raw secret values, `.env.local`, AWS keys, Stripe secrets, webhook payload signatures, OpenAI keys, RDS passwords, or notification tokens.
- If a command must run with real provider secrets, capture only sanitized output and store it in the internal artifact store. Put the internal evidence URL in the readiness environment, not the secret itself.
- A non-zero command is a failed evidence item unless this runbook explicitly labels it an expected no-credential blocker.

Recommended evidence ledger:

| Step | Evidence file | Owner | Pass condition | Fail condition |
|---|---|---|---|---|
| Build | `01-build.log` | Release owner | `npm run build` exits 0. | Build, type, or Next.js compile error. |
| Env validation | `02-env-validation.log` | Security owner | `ops:production:check` exits 0 with configured owners/evidence. | Missing owner, MySQL, notification, billing, backup, or restore evidence field. |
| RDS/MySQL migration | `03-mysql-migrate.log`, `04-mysql-smoke.log` | Data owner | Migration and smoke exit 0 against staging MySQL. | SQLite target, migration error, failed smoke domain. |
| Workers check | `05-workers-check.log` | Operations owner | `workers:check` exits 0 in production-like worker env. | SQLite runtime or local notification provider in staging/production mode. |
| Source health report-only | `06-source-health-report-only.log` | Source owner | Report is generated and access failures are classified. | Command crash, missing report, unclassified source failures. |
| Demo/risk smoke | `07-demo-check.log`, `08-risk-check.log` | QA/release owner | Demo readiness and risk gate exit 0. | Missing demo data, unsafe attachment, risk/audit blocker. |
| Backup snapshot | `09-backup-snapshot.log`, `10-logical-dump.log` | Backup owner | Snapshot id and logical dump checksum recorded. | No snapshot id, dump failed, checksum missing. |
| Restore rehearsal | `11-restore-rehearsal.log`, `12-restored-db-smoke.log` | Backup/data owner | Restored staging DB migrates/smokes cleanly. | Restore target unavailable or restored DB fails smoke. |
| Rollback decision | `13-rollback-decision.txt` | Deploy owner | Proceed/rollback decision and owner recorded. | No named decision owner or no previous revision/restore target. |

## Executable Staging Dry-Run Checklist

Run the steps in this order. The order is intentional: do not take backup/restore signoff before the build, environment, migration, worker, source, and smoke evidence is known.

### 1. Build

```bash
cd frontend
npm ci 2>&1 | tee "$EVIDENCE_DIR/01a-npm-ci.log"
npm run build 2>&1 | tee "$EVIDENCE_DIR/01-build.log"
```

Pass if both commands exit 0. Fail if install/build output includes unresolved dependency, TypeScript, lint-blocking, or Next.js compile errors.

### 2. Environment Validation

Populate the staging/deploy runner environment from the secret manager. Do not source a committed env file.

Required non-secret readiness metadata:

```bash
PRODUCTION_OWNER_BILLING=<billing owner mailbox>
PRODUCTION_OWNER_WORKERS=<worker owner mailbox>
PRODUCTION_OWNER_BACKUPS=<backup owner mailbox>
PRODUCTION_BACKUP_RUNBOOK_URL=<internal backup runbook URL>
PRODUCTION_BACKUP_EVIDENCE_URL=<internal backup evidence URL>
PRODUCTION_RESTORE_EVIDENCE_URL=<internal restore rehearsal evidence URL>
PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP=<ISO-8601 UTC timestamp>
```

Object storage readiness is fail-closed in production/staging. Use `OBJECT_STORAGE_PROVIDER=s3` with configured `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BASE_URL`, and `OBJECT_STORAGE_CREDENTIALS_REF`; the app prints only configured markers. Runtime upload/download also requires `OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY` to be injected from the secret manager, with optional `OBJECT_STORAGE_SESSION_TOKEN` for temporary credentials. Production-like S3 posture also requires:

```bash
OBJECT_STORAGE_PUBLIC_ACCESS=private
OBJECT_STORAGE_SIGNED_URL_MODE=app-proxy # or s3-presigned / cloudfront-signed
OBJECT_STORAGE_CDN_URL=https://<cloudfront-or-cdn-host> # required when OBJECT_STORAGE_SIGNED_URL_MODE=cloudfront-signed
OBJECT_STORAGE_MALWARE_SCANNER=external
OBJECT_STORAGE_RETENTION_POLICY=<approved retention policy id>
OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL=<internal staging upload/download evidence URL>
```

`OBJECT_STORAGE_MALWARE_SCANNER` must point to an external production scanner boundary; `local`, `noop`, and `none` are rejected in strict S3 posture. `PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE=1` is a temporary explicit acknowledgement for a documented local-volume boundary, not a production S3 substitute.

Then run:

```bash
NODE_ENV=production npm run ops:production:check 2>&1 | tee "$EVIDENCE_DIR/02-env-validation.log"
```

Pass if the command exits 0 and only prints `configured` markers for secrets/evidence. Fail if it prints missing owner/evidence fields, SQLite runtime, local notification provider, placeholder Stripe config, or malformed evidence URLs/timestamps.

For a no-credential documentation dry-run, record the expected blocker in `02-env-validation.log`; that is not launch signoff.

### 3. RDS/MySQL Migration

Use the staging RDS MySQL endpoint, never production and never SQLite:

```bash
DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids \
  npm run db:mysql:migrate 2>&1 | tee "$EVIDENCE_DIR/03-mysql-migrate.log"
DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids \
  npm run db:mysql:smoke 2>&1 | tee "$EVIDENCE_DIR/04-mysql-smoke.log"
```

Pass if migrations apply or skip cleanly and smoke verifies expected domains. Fail if the resolved database is SQLite, the connection string targets production during staging, a migration fails, or smoke leaves required tables/domains unverified.

### 4. Workers Check

Run in the same production-like worker environment planned for ECS/Fargate or the deploy runner:

```bash
NODE_ENV=production DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids \
  NOTIFICATION_PROVIDER=http npm run workers:check 2>&1 | tee "$EVIDENCE_DIR/05-workers-check.log"
```

Pass if crawler, event, and notification preflights exit 0. Fail closed on SQLite, `NOTIFICATION_PROVIDER=file`, `NOTIFICATION_PROVIDER=console`, or missing worker ownership.

### 5. Source Health Report-Only

Run report-only health from the AWS runtime boundary or a runner with the same network egress:

```bash
npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body \
  2>&1 | tee "$EVIDENCE_DIR/06-source-health-report-only.log"
```

Pass if the report is produced and every 403, CAPTCHA/login, timeout, 404/410, TLS, DNS, or 5xx case is classified for owner review. Fail if the command crashes, no report is saved, or failures are left unclassified.

### 6. Demo And Risk Smoke

```bash
npm run demo:check 2>&1 | tee "$EVIDENCE_DIR/07-demo-check.log"
npm run risk:check 2>&1 | tee "$EVIDENCE_DIR/08-risk-check.log"
```

Pass if both exit 0. Fail if demo data is incomplete, source placeholders appear, attachment checks fail, or risk/audit gates block the release.

### 7. Backup Snapshot

For a real staging rehearsal, take both an RDS snapshot and a logical dump before migration signoff:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier <staging-rds-instance> \
  --db-snapshot-identifier "winbids-staging-prelaunch-$DRY_RUN_ID" \
  2>&1 | tee "$EVIDENCE_DIR/09-backup-snapshot.log"

mysqldump --single-transaction --routines --triggers \
  --host=<staging-rds-endpoint> --user=<staging-user> --password \
  winbids > "$EVIDENCE_DIR/winbids-staging-$DRY_RUN_ID.sql"
shasum -a 256 "$EVIDENCE_DIR/winbids-staging-$DRY_RUN_ID.sql" \
  2>&1 | tee "$EVIDENCE_DIR/10-logical-dump.log"
```

Pass if the RDS snapshot id, logical dump file, checksum, owner, and timestamp are recorded. Fail if either backup path is missing. In this repository-only dry-run, do not run these AWS commands; record the exact commands and expected owner in the evidence notes.

### 8. Restore Rehearsal

Restore to a new non-production RDS instance or cluster, then point staging at the restored database:

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier "winbids-staging-restore-$DRY_RUN_ID" \
  --db-snapshot-identifier "winbids-staging-prelaunch-$DRY_RUN_ID" \
  2>&1 | tee "$EVIDENCE_DIR/11-restore-rehearsal.log"

DATABASE_URL=mysql://<restore-user>:<redacted>@<restored-rds-endpoint>:3306/winbids \
  npm run db:mysql:migrate 2>&1 | tee "$EVIDENCE_DIR/12a-restored-db-migrate.log"
DATABASE_URL=mysql://<restore-user>:<redacted>@<restored-rds-endpoint>:3306/winbids \
  npm run db:mysql:smoke 2>&1 | tee "$EVIDENCE_DIR/12-restored-db-smoke.log"
```

Pass if the restored database can migrate forward and pass smoke without touching production. Fail if restore cannot complete, staging cannot connect, smoke fails, or the team cannot identify the replacement database endpoint.

### 9. Rollback Decision

Before launch or traffic shift, write:

```bash
cat > "$EVIDENCE_DIR/13-rollback-decision.txt" <<EOF
dry_run_id=$DRY_RUN_ID
decision=<proceed|rollback|blocked>
decision_owner=<name or team mailbox>
decided_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
previous_revision=<app-runner-or-ecs-revision>
pre_migration_snapshot=<snapshot id>
restore_target=<restored staging db endpoint or planned replacement>
notes=<short reason>
EOF
```

Pass only if a named owner chooses proceed/rollback/blocked with previous revision and restore target known. Block launch if the evidence folder, backup snapshot, restore rehearsal, or rollback owner is missing.

## Pre-Deployment Checklist

Run locally before any AWS handoff:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

If crawler code changed:

```bash
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

If MySQL is the production target:

```bash
cd frontend
DATABASE_URL=mysql://winbids:REPLACE_ME@127.0.0.1:3306/winbids npm run db:mysql:migrate
DATABASE_URL=mysql://winbids:REPLACE_ME@127.0.0.1:3306/winbids npm run db:mysql:smoke
```

Use a real non-production MySQL endpoint for staging; do not point local tests at production.

## Consolidated Launch Handoff Report

Use this after the individual checks above have evidence, or during a no-credential dry-run to show the remaining blockers:

```bash
cd frontend
npm run ops:launch-handoff -- --allow-blocked
```

Use strict mode for launch signoff:

```bash
cd frontend
npm run ops:launch-handoff -- --format=json --output="$EVIDENCE_DIR/14-launch-handoff.json"
```

The report covers six launch tracks:

| Track | Required evidence marker |
|---|---|
| Stripe sandbox E2E | `STRIPE_SANDBOX_SECRET_KEY`, `STRIPE_SANDBOX_WEBHOOK_SECRET`, `STRIPE_SANDBOX_PRICE_PRO_MONTHLY`, `STRIPE_SANDBOX_PRICE_BUSINESS_MONTHLY` |
| Production readiness preflight | `NODE_ENV=production npm run ops:production:check` passes with configured owner/backup/object-storage markers |
| AWS staging dry run | `AWS_STAGING_OWNER`, `AWS_STAGING_DRY_RUN_EVIDENCE_URL`, `AWS_STAGING_DEPLOYMENT_URL`, `AWS_STAGING_RELEASE_SHA` |
| Live source health operations | `SOURCE_HEALTH_OWNER`, `SOURCE_HEALTH_OPS_EVIDENCE_URL` or `SOURCE_HEALTH_OPS_EVIDENCE_FILE`, plus `SOURCE_HEALTH_ACCESS_REVIEW_URL` or `SOURCE_HEALTH_ACCESS_REVIEW_FILE` |
| Browser demo evidence | `DEMO_BROWSER_EVIDENCE_URL` or `DEMO_BROWSER_EVIDENCE_FILE` |
| Risk gate | `RISK_CHECK_EVIDENCE_URL` or `RISK_CHECK_EVIDENCE_FILE` |

Do not put raw secret values into these evidence variables. Use internal evidence URLs, sanitized log paths, or artifact references. For source-health handoff, generate the local evidence bundle with `npm run source:health:evidence -- --format=json --output=../ops-evidence/source-health/source-health-evidence.json` after running `npm run source:health:ops`, then generate the access-review packet with `npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json`. When `SOURCE_HEALTH_OPS_EVIDENCE_FILE` is set, `ops:launch-handoff` reads the JSON file and requires `ok=true`, full expected state coverage, a non-stale snapshot, zero critical unhealthy sources, and no missing owner/disposition/next-review blockers. Set `SOURCE_HEALTH_ACCESS_REVIEW_URL` or `SOURCE_HEALTH_ACCESS_REVIEW_FILE` as well; local access-review JSON is validated for review coverage, `reviewMode`, and `requiredEvidence`.
The handoff report prints configured markers and blocker names only; it must not be used as a secret inventory.

## AWS Account Preparation

Create or confirm these AWS resources:

1. AWS account and Region.
2. IAM deploy role with least-privilege access to App Runner, RDS, Secrets Manager/SSM, CloudWatch, ECR/ECS/EventBridge if workers are deployed.
3. VPC and subnets for RDS and any ECS worker tasks.
4. RDS MySQL instance or cluster.
5. Secrets Manager secret or SSM parameters for app runtime variables.
6. CloudWatch log groups for web and workers.
7. Domain name and TLS certificate if using a custom domain.
8. S3 bucket for future attachment/export object storage, with versioning and lifecycle policy if production storage is enabled.

Do not create long-lived AWS access keys for application runtime. Prefer IAM roles attached to the service or task.

## RDS MySQL Setup

Recommended production defaults:

- Engine: MySQL-compatible RDS.
- Multi-AZ: enabled for production, optional for staging.
- Public access: disabled.
- Backups: automated backups enabled with a retention window approved by the operator.
- Snapshot: manual snapshot before each production migration.
- Security group: allow database access only from App Runner VPC connector / ECS tasks / controlled bastion or deploy job.

Create application database and user:

```sql
CREATE DATABASE winbids CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'winbids'@'%' IDENTIFIED BY 'REPLACE_ME_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON winbids.* TO 'winbids'@'%';
FLUSH PRIVILEGES;
```

Store the connection string in Secrets Manager or SSM:

```text
DATABASE_URL=mysql://winbids:REPLACE_ME_STRONG_PASSWORD@<rds-endpoint>:3306/winbids
```

Do not put the RDS password in this repository.

## Runtime Environment Variables

Minimum production runtime values:

```bash
NODE_ENV=production
DATABASE_URL=mysql://winbids:REPLACE_ME@<rds-endpoint>:3306/winbids
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_PRICE_PRO_MONTHLY=price_REPLACE_ME
STRIPE_PRICE_BUSINESS_MONTHLY=price_REPLACE_ME
PRODUCTION_OWNER_BILLING=billing-owner@example.com
PRODUCTION_OWNER_WORKERS=ops-owner@example.com
PRODUCTION_OWNER_BACKUPS=data-owner@example.com
PRODUCTION_BACKUP_RUNBOOK_URL=https://internal.example.com/winbids-backup-runbook
PRODUCTION_BACKUP_EVIDENCE_URL=https://internal.example.com/winbids/evidence/backup-YYYYMMDD
PRODUCTION_RESTORE_EVIDENCE_URL=https://internal.example.com/winbids/evidence/restore-YYYYMMDD
PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP=2026-06-10T00:00:00Z
ADMIN_UI_LOCAL_BYPASS=false
```

Recommended worker values:

```bash
CRAWLER_OWNER=prod-crawler-worker
CRAWLER_WORKER_INTERVAL_MS=900000
STATE_CRAWLER_LIMIT=25
NOTIFICATION_PROVIDER=http
NOTIFICATION_HTTP_ENDPOINT=https://notifications.example.com/send
NOTIFICATION_HTTP_TOKEN=REPLACE_ME
NOTIFICATION_WORKER_INTERVAL_MS=900000
NOTIFICATION_WORKER_DUNNING_LIMIT=100
NOTIFICATION_WORKER_DELIVERY_LIMIT=25
NOTIFICATION_WORKER_MAX_ATTEMPTS=3
```

Optional source/billing values:

```bash
SAM_API_KEY=REPLACE_ME
CRAWLER_RUN_TOKEN=REPLACE_ME
BILLING_WEBHOOK_SECRET=REPLACE_ME
```

Production must not set:

```bash
ADMIN_UI_LOCAL_BYPASS=true
NOTIFICATION_PROVIDER=file
NOTIFICATION_PROVIDER=console
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
```

## App Runner Web Deployment

Use this path for Mode A.

### Console Configuration

1. Create an App Runner service from the repository or connected source provider.
2. Set source directory to `frontend` if the provider asks for a root directory.
3. Runtime: Node.js.
4. Build command:

```bash
npm ci && npm run build
```

5. Start command:

```bash
npm run start -- -p 8080
```

6. Port: `8080`.
7. Add runtime environment variables from Secrets Manager or SSM Parameter Store.
8. Configure VPC access if App Runner needs to connect to private RDS.
9. Enable CloudWatch logs.
10. Deploy.

Do not define a custom environment variable named `PORT` in App Runner; configure the service port and use the start command above.

### App Runner Post-Deploy Commands

From a controlled deploy runner or one-off maintenance environment with the same secrets:

```bash
cd frontend
NODE_ENV=production npm run ops:production:check
npm run db:mysql:migrate
npm run db:mysql:smoke
```

If App Runner is the only runtime available, run the migration command from a separate CI/deploy job before shifting traffic.

## ECS/Fargate Worker Deployment

Use this path for Mode B.

### Container Image Requirement

The repository currently has no Dockerfile. Before running ECS workers, create one production image that can run:

```bash
npm run start -- -p 8080
npm run worker:crawler
npm run worker:events
npm run worker:notifications
npm run crawler:once
```

After the image exists:

1. Push the image to ECR.
2. Create one task definition for web or one shared task definition with command overrides.
3. Attach the same Secrets Manager / SSM values used by App Runner.
4. Send logs to CloudWatch.
5. Run worker preflight in ECS:

```bash
NODE_ENV=production npm run workers:check
```

Interpret the worker preflight strictly in ECS:

- Non-zero exit is a blocker for production and staging.
- `DATABASE_URL resolves to SQLite` means the task will use SQLite because runtime resolution checks `DATABASE_URL` before `MYSQL_DATABASE_URL`; set `DATABASE_URL` itself to the RDS MySQL URL.
- `NOTIFICATION_PROVIDER=file` and `NOTIFICATION_PROVIDER=console` are local/dev fallbacks. Staging and production ECS tasks must use `NOTIFICATION_PROVIDER=http` with the appropriate endpoint.
- Warnings on an otherwise successful check are advisory and must be owned, but they are not the same as blockers.

### EventBridge Schedules

Create separate EventBridge schedules:

| Schedule | ECS command override | Suggested cadence |
|---|---|---|
| Crawler one-shot | `npm run crawler:once` | Every 15 minutes or per source policy |
| Event outbox one-shot | `EVENT_WORKER_RUN_ONCE=1 npm run worker:events` | Every 5-15 minutes |
| Notification/dunning one-shot | `NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications` | Every 15 minutes |

Keep these schedules separate. They have different failure modes and should be paused independently during incidents.

## Stripe Production Setup

Create a production Stripe webhook endpoint:

```text
https://<production-host>/api/billing/webhook
```

Subscribe to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Store the endpoint signing secret as:

```bash
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
```

Before live launch:

```bash
cd frontend
NODE_ENV=production npm run billing:production:check
NODE_ENV=production npm run ops:production:check
```

Production must not run:

```bash
npm run billing:stripe:sandbox
```

That command is for test-mode credentials only.

## Source Health And Crawler Operations

Run release-grade live source health from the AWS runtime or an environment with the same network boundary:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body
npm run source:health:evidence -- --allow-blocked --format=json --output=../ops-evidence/source-health/source-health-evidence.json
npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json
```

Classify results:

| Result | Action |
|---|---|
| `200` with meaningful body | Source OK. |
| `404` / `410` | Registry fix required. |
| `403`, login, CAPTCHA, bot-check | Access review required; do not bypass restrictions. |
| Timeout / DNS / TLS / fetch failed | Network retry or AWS egress review. |

Then run:

```bash
cd frontend
npm run risk:check
```

## Smoke Test After AWS Deploy

Run from an operator machine:

```bash
curl -I https://<production-host>/
curl -I https://<production-host>/search
curl -I https://<production-host>/login
```

Manual browser checks:

1. Public anonymous user can open `/search` and a bid detail page.
2. Ordinary user can register or log in.
3. Ordinary free user sees locked/upgrade states for paid features.
4. Admin can log in and open `/admin`.
5. Non-admin user cannot open `/admin`.
6. Business-tier test user can open an Intent, upload/download/delete an Artifact Vault item in staging.
7. Response Workspace and Quote Workspace do not show a deleted artifact.

API/ops checks:

```bash
cd frontend
NODE_ENV=production npm run ops:production:check
NODE_ENV=production npm run workers:check
npm run risk:check
```

## Backup And Restore

Backup/restore is a launch blocker, not an optional operations task.

Before production migration:

1. Create a manual RDS snapshot.
2. Create a logical dump with `mysqldump --single-transaction --routines --triggers`.
3. Record snapshot id, dump checksum, owner, UTC timestamp, and evidence URL.
4. Confirm automated backups are enabled and retention matches the approved data policy.
5. Confirm restore target naming convention.
6. Confirm `PRODUCTION_BACKUP_RUNBOOK_URL`, `PRODUCTION_BACKUP_EVIDENCE_URL`, `PRODUCTION_RESTORE_EVIDENCE_URL`, and `PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP` are set in the staging/production readiness environment.

RDS snapshot strategy:

- Use RDS automated backups for point-in-time recovery within the approved retention window.
- Take a manual snapshot before every production migration and before any risky data repair.
- Keep staging restore snapshots separate from production snapshots.
- Do not delete a manual snapshot until the release owner and backup owner confirm rollback is no longer needed.

Logical dump strategy:

- Use logical dumps as human-inspectable backup evidence and migration-diff insurance.
- Store dumps in an encrypted internal location with restricted data-operator access.
- Record a SHA-256 checksum, row-count notes when available, and the dump command without the password.
- Do not commit dumps to this repository.

Restore drill:

1. Restore a snapshot into a non-production RDS instance.
2. Point a staging deployment at the restored database.
3. Run migrations forward against the restored database, then smoke:

```bash
cd frontend
npm run db:mysql:migrate
npm run db:mysql:smoke
npm run risk:check
```

4. Record drill result, owner, timestamp, restored endpoint, and evidence URL.

Migration rollback/forward strategy:

- Prefer forward fixes for application migrations once production traffic has seen the new schema.
- If the migration fails before traffic shift, restore the pre-migration snapshot to a replacement database and repoint staging/production after validation.
- If the migration partially applied, stop workers, keep logs, identify the last successful migration, and choose either forward repair or replacement restore under data-owner approval.
- Never run ad hoc destructive SQL in production as the first rollback action.

Data retention and redaction boundary:

- Production snapshots and dumps can contain customer, supplier, bid, billing, and attachment metadata.
- Store evidence summaries separately from raw dumps; evidence should prove id/checksum/status without exposing records.
- Redact customer emails, Stripe identifiers, webhook payloads, OpenAI prompts/outputs, and source credentials from shared screenshots or logs.
- Follow the approved retention period for backups and delete temporary staging restore instances after the drill is signed off.

Do not overwrite production directly during rollback. Restore into a replacement database, validate, then repoint the service.

## Rollback

Rollback owner must be named before deploy starts.

Recommended sequence:

1. Pause EventBridge worker schedules.
2. Keep the failed task/service logs.
3. Revert App Runner/ECS service to the previous known-good revision.
4. Restore previous environment variables if secrets/config changed.
5. If migration caused the incident, restore the pre-migration RDS snapshot into a replacement database.
6. Repoint `DATABASE_URL` only after validation.
7. Restart web and workers.
8. Run smoke checks again.

Never run destructive SQL or delete a production database until the replacement restore has been validated.

## Launch Signoff

Use this table before switching real users to the AWS environment.

| Area | Required evidence | Owner |
|---|---|---|
| Web | App Runner/ECS URL returns 200 and login works. | Deploy owner |
| DB | RDS migration and smoke passed. | Data owner |
| Backups | Manual snapshot and restore drill complete. | Backup owner |
| Secrets | Secrets are in Secrets Manager/SSM and not in repo. | Security owner |
| Billing | Stripe live endpoint configured and preflight passed. | Billing owner |
| Workers | Worker preflight passed; schedules are documented. | Operations owner |
| Source health | Live source health report reviewed. | Source owner |
| Risk | `npm run risk:check` passed. | Release owner |
| Rollback | Previous revision and restore target are known. | Deploy owner |

## Open Production Gaps

These are known gaps to resolve or explicitly accept before a full production launch:

- Real AWS S3/CloudFront upload, download, signing URL/CDN behavior, IAM policy review, and staging smoke are not complete; the current S3-compatible provider is implemented locally but has not been proven against a real AWS environment.
- External production malware scanning for supplier uploads is not complete; local deterministic test-signature blocking exists only as a development guard.
- Artifact replacement/version history is implemented locally, but production retention/legal-hold approval and real object lifecycle policy validation are not complete.
- ECS/Fargate worker deployment needs a container image or equivalent production task runtime.
- Live Stripe checkout/webhook must be tested with a low-risk production transaction.
- Real notification provider, bounce handling, and delivery monitoring must be configured.
- Live source portal failures may require access review; do not bypass CAPTCHA/login/bot restrictions.
