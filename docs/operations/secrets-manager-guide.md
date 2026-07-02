# Secrets Manager Injection Guide

Updated: 2026-07-01

This guide explains **how** to inject `STRIPE_SECRET_KEY`, `SAM_API_KEY`, database credentials, and other production secrets into the running APSi/WinBids app via AWS Secrets Manager or SSM Parameter Store, instead of plain environment variables in `.env.local` or a deploy console.

This is a companion to two existing docs and deliberately does not repeat their content:

- `docs/transferability/secrets-and-access.md` — the **policy**: which secret belongs in which category, who owns rotation, and the production handoff checklist. Read that first for "what" and "who."
- `docs/operations/aws-deployment-runbook.md` — the end-to-end **deployment runbook**, including the AWS resource shape (App Runner/ECS, RDS, Secrets Manager/SSM) and the full staging dry-run/launch-signoff checklist. Read that for the overall release process.

This guide is the missing "how" in between: concrete steps and commands for creating the secret in AWS and wiring it into the running service, for engineers who have never done this in this AWS account before.

## Which Secrets This Covers

Everything the app's own preflight/audit tooling already tracks as sensitive:

| Secret | Consumed by | Reference |
|---|---|---|
| `DATABASE_URL` | Web app, all three workers | `docs/transferability/environment-variables.md` |
| `STRIPE_SECRET_KEY` | Billing checkout/portal, `ops:production:check`, `billing:production:check` | `docs/operations/production-billing-worker-runbook.md` |
| `STRIPE_WEBHOOK_SECRET` | `/api/billing/webhook` signature verification | `docs/operations/production-billing-worker-runbook.md` |
| `SAM_API_KEY` | SAM.gov federal crawler adapter | `docs/transferability/environment-variables.md` |
| `CRAWLER_RUN_TOKEN` | Protected crawler run API routes | `docs/transferability/environment-variables.md` |
| `NOTIFICATION_HTTP_TOKEN` | `http` notification provider | `docs/transferability/environment-variables.md` |
| `OBJECT_STORAGE_ACCESS_KEY_ID` / `OBJECT_STORAGE_SECRET_ACCESS_KEY` / `OBJECT_STORAGE_SESSION_TOKEN` | S3-compatible object storage adapter | `docs/transferability/environment-variables.md` |

Non-secret readiness metadata (`PRODUCTION_OWNER_*`, `PRODUCTION_BACKUP_*`) does **not** need to go through Secrets Manager — those are internal URLs/mailboxes, not credentials, and can be set as plain environment variables per `docs/transferability/secrets-and-access.md`.

## Two AWS Options

| Option | Use when | Cost | Rotation |
|---|---|---|---|
| **AWS Secrets Manager** | The value is a real credential (DB password, Stripe key, API token) and you want built-in rotation support and versioning. | Per-secret monthly charge + API calls. | Native rotation Lambda support; also supports manual rotation. |
| **SSM Parameter Store (SecureString)** | The value is sensitive but lower-volume/lower-churn (a webhook secret, a small token), or the team wants to avoid Secrets Manager's per-secret cost. | Free for standard parameters; low cost for advanced. | Manual rotation (no built-in rotation Lambda integration). |

Either works with App Runner and ECS. This guide shows Secrets Manager as the primary path since `docs/operations/aws-deployment-runbook.md` recommends it, with SSM Parameter Store noted as the lower-cost alternative for the same steps.

## Step 1: Create The Secret

Never type the real value into the shell history in a way that gets logged. Prefer piping from a local password manager export or an interactive prompt.

### Secrets Manager

```bash
aws secretsmanager create-secret \
  --name "winbids/production/stripe-secret-key" \
  --description "WinBids production Stripe live secret key" \
  --secret-string "$(cat /dev/stdin)" <<< "sk_live_REPLACE_ME"
```

For a JSON blob covering multiple related values (e.g. the whole DB connection):

```bash
aws secretsmanager create-secret \
  --name "winbids/production/database" \
  --description "WinBids production RDS MySQL credentials" \
  --secret-string '{"username":"winbids","password":"REPLACE_ME","host":"<rds-endpoint>","port":3306,"dbname":"winbids"}'
```

Recommended naming convention: `winbids/<environment>/<logical-name>`, e.g. `winbids/staging/stripe-secret-key`, `winbids/production/sam-api-key`. Keep staging and production as fully separate secrets, per the environment-separation rule in `docs/operations/production-billing-worker-runbook.md`.

### SSM Parameter Store

```bash
aws ssm put-parameter \
  --name "/winbids/production/STRIPE_SECRET_KEY" \
  --type "SecureString" \
  --value "sk_live_REPLACE_ME" \
  --key-id "alias/winbids-secrets"
```

Use a customer-managed KMS key (`--key-id alias/winbids-secrets`) rather than the default `aws/ssm` key so key policy and audit trail are explicit and controllable by the security owner.

## Step 2: IAM — Grant The Runtime Read Access, Nothing Else

Create a dedicated IAM policy that only allows reading the specific secrets/parameters this service needs, and attach it to the App Runner instance role or ECS task role — never to a long-lived IAM user access key. `docs/operations/aws-deployment-runbook.md` already says not to create long-lived AWS access keys for application runtime; this is the policy that makes that possible.

Secrets Manager least-privilege policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": [
        "arn:aws:secretsmanager:<region>:<account-id>:secret:winbids/production/*"
      ]
    }
  ]
}
```

SSM Parameter Store least-privilege policy (also grant `kms:Decrypt` on the parameter's KMS key):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": [
        "arn:aws:ssm:<region>:<account-id>:parameter/winbids/production/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": ["arn:aws:kms:<region>:<account-id>:key/<key-id>"]
    }
  ]
}
```

Scope the `Resource` ARN prefix to the environment (`winbids/production/*` vs `winbids/staging/*`) so a compromised staging task role cannot read production secrets.

## Step 3: Wire The Secret Into The Runtime

### App Runner

App Runner supports referencing Secrets Manager secrets and SSM SecureString parameters directly as environment variable sources — the value is injected at container start and never appears in the App Runner console's plain environment variable list.

Console: Service settings → Configuration → Environment variables → "Add environment variable" → toggle **Value from** to "Secrets Manager" or "SSM Parameter Store" → pick the secret/parameter ARN.

CLI/infrastructure-as-code equivalent (`RuntimeEnvironmentSecrets` in the App Runner source/image configuration):

```json
{
  "RuntimeEnvironmentSecrets": {
    "STRIPE_SECRET_KEY": "arn:aws:secretsmanager:<region>:<account-id>:secret:winbids/production/stripe-secret-key",
    "DATABASE_URL": "arn:aws:secretsmanager:<region>:<account-id>:secret:winbids/production/database"
  },
  "RuntimeEnvironmentVariables": {
    "NODE_ENV": "production",
    "BILLING_PROVIDER": "stripe"
  }
}
```

Plain (non-secret) values like `NODE_ENV` and `PRODUCTION_OWNER_*` stay in `RuntimeEnvironmentVariables`; only credential-shaped values go in `RuntimeEnvironmentSecrets`. See the [AWS App Runner service configuration reference](https://docs.aws.amazon.com/apprunner/latest/dg/manage-configure.html) for the full secret-reference syntax, including how to reference a single JSON key inside a multi-value secret (`arn:...:secret:winbids/production/database:password::`).

### ECS/Fargate

ECS task definitions have a first-class `secrets` block (distinct from `environment`) that resolves Secrets Manager ARNs or SSM parameter names at task launch, injected by the ECS agent using the task's execution role (not the task role):

```json
{
  "containerDefinitions": [
    {
      "name": "winbids-web",
      "environment": [
        { "name": "NODE_ENV", "value": "production" }
      ],
      "secrets": [
        {
          "name": "STRIPE_SECRET_KEY",
          "valueFrom": "arn:aws:secretsmanager:<region>:<account-id>:secret:winbids/production/stripe-secret-key"
        },
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:<region>:<account-id>:secret:winbids/production/database:connectionString::"
        },
        {
          "name": "SAM_API_KEY",
          "valueFrom": "arn:aws:ssm:<region>:<account-id>:parameter/winbids/production/SAM_API_KEY"
        }
      ]
    }
  ],
  "executionRoleArn": "arn:aws:iam::<account-id>:role/winbids-ecs-execution-role"
}
```

Two IAM roles are involved and are easy to confuse:

- **Execution role** (`executionRoleArn`) needs `secretsmanager:GetSecretValue` / `ssm:GetParameter` (Step 2's policy) — it is what pulls the secret value into the container at launch.
- **Task role** (`taskRoleArn`) is what the running application code uses for any AWS API calls it makes itself (e.g. S3 object storage). Do not grant secrets-read permission here unless the app also reads secrets directly at runtime (it should not — inject via `secrets`/`RuntimeEnvironmentSecrets` instead of calling the Secrets Manager API from application code).

Reference: [Amazon ECS scheduled tasks with EventBridge Scheduler](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html) covers the same task-definition shape used for the crawler/event/notification worker schedules in `docs/operations/aws-deployment-runbook.md`.

## Step 4: Verify Before Traffic Shift

After deploying with secrets wired in, confirm the app actually received them without ever printing the raw value:

```bash
cd frontend
NODE_ENV=production npm run ops:production:check
NODE_ENV=production npm run workers:check
npm run risk:check
```

`ops:production:check` and `workers:check` only print `configured`/boolean markers for secret-backed fields (see `frontend/src/server/operations/production-readiness.ts`); they never print the secret value itself, so their output is safe to paste into a deploy log or evidence file. `risk:check` (as of this change) also runs `secrets-scan` (`frontend/scripts/secrets-scan.ts`) against the repository to catch accidentally-committed secret-shaped strings — that check runs against the *source tree*, not runtime, and is a separate concern from confirming the deployed service resolved its secrets correctly.

## Rotation

1. Create a new version of the secret in Secrets Manager (`aws secretsmanager put-secret-value`) or update the SSM parameter (`aws ssm put-parameter --overwrite`).
2. Redeploy or restart the App Runner service / ECS service so it picks up the new value — neither platform live-reloads a changed secret into a running container.
3. Run the Step 4 verification commands again.
4. Confirm the old credential is revoked at the provider (Stripe, RDS, SAM.gov, etc.) only after the new one is confirmed working.
5. Record the rotation timestamp and owner per `docs/transferability/secrets-and-access.md`.

This is the same generic rotation flow already documented in `docs/transferability/secrets-and-access.md#rotation`; the AWS-specific commands above are what fill in steps 1-2 for this stack. Stripe-specific webhook endpoint rotation (creating a new endpoint, dual-running, retiring the old one) is documented separately in `docs/operations/production-billing-worker-runbook.md#webhook-endpoint-rotation`.

## What This Guide Does Not Cover

- Local development: use `frontend/.env.local` as documented in `docs/transferability/environment-variables.md`. Do not create AWS Secrets Manager entries for local-only development.
- Deciding which secrets exist and who owns them: see `docs/transferability/secrets-and-access.md`.
- The full AWS deployment/staging dry-run sequence: see `docs/operations/aws-deployment-runbook.md`.
- Provisioning the KMS key, VPC, or IAM roles themselves from scratch: see the AWS account preparation section of `docs/operations/aws-deployment-runbook.md`.
