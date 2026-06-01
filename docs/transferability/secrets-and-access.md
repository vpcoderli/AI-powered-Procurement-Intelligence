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
| Notifications | `NOTIFICATION_HTTP_TOKEN`, provider credentials | Secret manager. |
| Crawlers | `SAM_API_KEY`, `CRAWLER_RUN_TOKEN`, source account credentials | Secret manager or future APSI Registration Vault; never in docs. |
| Database | `DATABASE_PATH` or future database URL/password | Secret manager for connection strings; durable storage ACLs for files. |
| Admin access | Admin user accounts, support roles, local bypass flag | Application role management; production must not use local bypass. |
| AWS access | IAM roles, deploy credentials, KMS keys | IAM roles and AWS account policy; never local files committed to repo. |

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
