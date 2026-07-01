# Secrets And Access

This policy defines how WinBids / APSI secrets, credentials, and operational access should be handled during handoff.

## Rules

- Do not commit real secrets.
- Do not paste real secrets into docs, tickets, screenshots, chat, tests, or logs.
- Use placeholders such as `REPLACE_ME`, `sk_test_REPLACE_ME`, `sk_live_REPLACE_ME`, and `whsec_REPLACE_ME`.
- Keep local `.env.local` untracked.
- Store production secrets in the deployment platform secret manager or AWS Secrets Manager / SSM Parameter Store.
- Separate local, preview, staging, and production credentials.

## Secret Categories

| Category | Examples | Storage boundary |
|---|---|---|
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs | Secret manager; price IDs may be config but keep environment-scoped. |
| Webhooks | Stripe endpoint signing secrets, internal webhook tokens | Secret manager; one endpoint secret per environment. |
| Notifications / email | `NOTIFICATION_HTTP_TOKEN`, SMTP/API provider credentials, bounce webhooks | Secret manager. |
| Crawlers | `SAM_API_KEY`, `CRAWLER_RUN_TOKEN`, source account credentials | Secret manager or future APSI Registration Vault; never in docs. |
| Database | `DATABASE_PATH` or future database URL/password | Secret manager for connection strings; durable storage ACLs for files. |
| Object storage | `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, optional `OBJECT_STORAGE_SESSION_TOKEN`, bucket access policy | Secret manager / IAM-controlled runtime injection; never in docs or logs. |
| OpenAI / model providers | `OPENAI_API_KEY`, embedding/model provider credentials | Secret manager; never in frontend bundles or screenshots. |
| Admin access | Admin user accounts, support roles, local bypass flag | Application role management; production must not use local bypass. |
| AWS access | IAM roles, deploy credentials, KMS keys | IAM roles and AWS account policy; never local files committed to repo. |
| Production ownership | `PRODUCTION_OWNER_BILLING`, `PRODUCTION_OWNER_WORKERS`, `PRODUCTION_OWNER_BACKUPS`, `PRODUCTION_BACKUP_RUNBOOK_URL`, `PRODUCTION_BACKUP_EVIDENCE_URL`, `PRODUCTION_RESTORE_EVIDENCE_URL`, `PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP` | Non-secret owner/evidence metadata; keep environment-scoped and point to internal runbook/artifact URLs only. |

## Ownership And Rotation

Each secret must have a named rotation owner before staging dry-run signoff:

| Secret area | Rotation owner | Required handoff evidence |
|---|---|---|
| Stripe API key | Billing owner | Secret manager path, last rotation timestamp, low-risk checkout/webhook smoke evidence. |
| Stripe webhook secret | Billing owner | Endpoint URL, subscribed events, active signing secret version, rollback endpoint plan. |
| Email/notification provider | Operations owner | Provider account owner, sending domain status, token rotation date, delivery smoke evidence. |
| Object storage access | Platform/security owner | Bucket name, IAM/secret manager path, least-privilege policy review, upload/download smoke evidence, retention/malware scanning owner. |
| OpenAI/model provider | AI/platform owner | Project/account owner, model access boundary, spending limit owner, key rotation timestamp. |
| AWS deploy access | Platform/security owner | IAM role names, break-glass owner, CloudTrail/log owner, no long-lived keys in repo. |
| RDS/database password | Data owner | Secret manager path, backup owner, restore rehearsal evidence URL. |

Rotation owners must be team mailboxes or durable operational roles when possible. Avoid personal-only ownership for launch-critical secrets.

## Production Handoff Matrix

Before launch, staging rehearsal, webhook rotation, or worker deployment signoff, run:

```bash
cd frontend
NODE_ENV=production npm run ops:production:check
```

This verifies live-shaped Stripe billing variables, MySQL runtime configuration, production ownership fields, and backup/restore evidence metadata. It does not print secret values or evidence URLs. Owner fields should identify accountable teams or named operational mailboxes; do not use personal local-only accounts.

Handoff checklist:

1. Confirm every secret is stored in AWS Secrets Manager, SSM Parameter Store, or the deployment platform secret manager.
2. Confirm no real secret appears in `.env.local`, docs, tickets, screenshots, command output, or git history.
3. Confirm Stripe, webhook, email, object storage, OpenAI, AWS, and RDS secrets have rotation owners and last-rotation timestamps.
4. Confirm staging/prod use separate provider credentials, webhook endpoints, databases, and evidence URLs.
5. Confirm `ops:production:check` exits 0 with only configured markers before launch signoff.
6. Record the internal backup and restore evidence URLs in the deployment checklist, not raw dump/snapshot contents.

## Local Access

Local developer setup:

```bash
cd frontend
touch .env.local
chmod 600 .env.local
```

Local secret scan before sharing:

```bash
rg -n "sk_live_|AKIA|whsec_|password|secret|token" docs frontend crawler
```

Review every match. Placeholder examples in docs are acceptable; real values are not.

## Production Access

Production access should be least-privilege:

- Deploy operators can deploy and rollback, but should not need to view all secrets.
- Billing operators can rotate Stripe secrets and inspect webhook delivery.
- Data operators can run backup/restore under change control.
- Source operators can manage crawler source access and approval status.
- Support users should use application support/admin roles, not database write access.

## Rotation

Rotate a secret when an operator leaves, a value is suspected to be exposed, a provider requires rotation, or production endpoints are rebuilt.

Generic rotation flow:

1. Create the replacement secret in the provider.
2. Add it to the matching environment in the secret manager.
3. Deploy or restart the affected process.
4. Run the relevant smoke test.
5. Disable the old secret.
6. Record the rotation timestamp and owner.

Stripe webhook rollback and rotation details are in `docs/operations/production-billing-worker-runbook.md`.

## Emergency Revocation

If a production secret is exposed:

1. Revoke or disable it at the provider.
2. Stop affected workers if they are failing or leaking data.
3. Create and deploy a replacement secret.
4. Review logs for unauthorized use.
5. Open an incident review with timeline, blast radius, and prevention tasks.
