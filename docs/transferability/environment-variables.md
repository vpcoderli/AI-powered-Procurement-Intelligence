# Environment Variables

This document describes configuration boundaries. It lists variable names and example placeholders only; it must not contain real secrets.

## Local Files

Local developers may create `frontend/.env.local`. Keep it untracked and use placeholder values:

```bash
cd frontend
cp .env.example .env.local 2>/dev/null || touch .env.local
```

Check for accidental secret-looking values before sharing a patch:

```bash
git diff -- . ':!frontend/.env.local'
rg -n "sk_live_|whsec_|secret|password|token" docs frontend/.env.local 2>/dev/null
```

## Core Runtime

| Variable | Local boundary | Production boundary |
|---|---|---|
| `NODE_ENV` | Usually unset or `development`. | `production`. |
| `DATABASE_PATH` | Optional; defaults to `data/apsi.sqlite` from `frontend`. | Required unless replaced by a managed database integration. Use persistent storage. |
| `DATABASE_URL` | Optional MySQL URL for migration dry runs, for example `mysql://USER:PASSWORD@HOST:3306/winbids`. | Required when MySQL becomes the active runtime; store in secret manager. |
| `MYSQL_DATABASE_URL` | Optional alternative MySQL URL used by `npm run db:mysql:migrate`. | Same boundary as `DATABASE_URL`; do not set both unless intentionally overriding. |
| `MYSQL_CONNECTION_LIMIT` | Optional local MySQL pool size for migration tooling. | Set according to runtime and RDS capacity after cutover. |
| `ADMIN_UI_LOCAL_BYPASS` | May be `true` for local admin testing only. | Must be unset or false. |
| `CRAWLER_RUN_TOKEN` | Optional local token for protected crawler run APIs. | Required if crawler run APIs are exposed; store in secret manager. |
| `CRAWLER_ATTACHMENT_DIR` | Optional local attachment path. | Persistent storage path or object storage handoff. |
| `APP_ORIGIN` | Optional; not required when running on `localhost:3000` (dev origins are trusted automatically). | Set to the canonical HTTPS origin (for example `https://app.apsi.example.com`). Used by the CSRF Origin/Referer check in `frontend/src/server/security/csrf.ts`. |
| `CSRF_ALLOWED_ORIGINS` | Optional comma-separated list, only needed when testing multiple origins locally. | Set when more than one origin legitimately calls state-changing APIs with the session cookie (for example a staging origin kept alongside production, or a separate marketing subdomain). Comma-separated absolute origins, for example `https://app.apsi.example.com,https://staging.apsi.example.com`. |

## Object Storage

| Variable | Local boundary | Production boundary |
|---|---|---|
| `OBJECT_STORAGE_PROVIDER` | Defaults to `local`; set `s3` only for integration testing with a safe bucket. | Set to `s3`; production/staging preflight rejects local storage unless `PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE=1` is explicitly documented. |
| `OBJECT_STORAGE_LOCAL_ROOT` | Optional local directory; defaults to `frontend/data/object-storage`. | Not suitable for normal production storage. |
| `OBJECT_STORAGE_BUCKET` | Placeholder or test bucket when `OBJECT_STORAGE_PROVIDER=s3`. | Required S3 bucket name. |
| `OBJECT_STORAGE_REGION` | Placeholder or test region when `OBJECT_STORAGE_PROVIDER=s3`. | Required bucket region. |
| `OBJECT_STORAGE_BASE_URL` | Example: `https://s3.us-east-1.amazonaws.com` or a test S3-compatible endpoint. | Required S3/S3-compatible endpoint base URL. |
| `OBJECT_STORAGE_CREDENTIALS_REF` | Placeholder reference only, for example `aws-secrets-manager:dev/object-storage`. | Required secret-manager reference; this value is printed only as `configured` by preflight. |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | Test/integration credential only; do not commit. | Inject from Secrets Manager/SSM or the approved runtime secret source. |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Test/integration credential only; do not commit. | Inject from Secrets Manager/SSM or the approved runtime secret source. |
| `OBJECT_STORAGE_SESSION_TOKEN` | Optional temporary test token. | Optional temporary credential token when the runtime uses session credentials. |
| `PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE` | Usually unset. | Emergency/documented override only; not a substitute for S3 production storage. |

## Billing

| Variable | Local boundary | Production boundary |
|---|---|---|
| `BILLING_PROVIDER` | `local` or `stripe` for sandbox. | `stripe` when live billing is enabled. |
| `BILLING_CHECKOUT_URL_TEMPLATE` | Optional hosted checkout fallback. | Use only if the production billing flow intentionally delegates checkout. |
| `BILLING_CUSTOMER_PORTAL_URL_TEMPLATE` | Optional hosted portal fallback. | Use only if the production portal flow intentionally delegates portal access. |
| `BILLING_WEBHOOK_SECRET` | Generic webhook secret for non-Stripe providers. | Secret manager only. |
| `STRIPE_SECRET_KEY` | Test key only, for example `sk_test_REPLACE_ME`. | Live key only, for example `sk_live_REPLACE_ME`; never store in repo. |
| `STRIPE_WEBHOOK_SECRET` | Stripe CLI or test endpoint secret, for example `whsec_REPLACE_ME`. | Production endpoint signing secret. |
| `STRIPE_PRICE_PRO_MONTHLY` | Test-mode price ID. | Live-mode price ID. |
| `STRIPE_PRICE_BUSINESS_MONTHLY` | Test-mode price ID. | Live-mode price ID. |

Local billing sandbox verification:

```bash
cd frontend
npm run billing:stripe:sandbox
```

## Notifications

| Variable | Local boundary | Production boundary |
|---|---|---|
| `NOTIFICATION_PROVIDER` | `file` or `console`; `http` for integration testing. | `http` or a future provider-specific adapter. |
| `NOTIFICATION_OUTBOX_DIR` | Local file output directory. | Not suitable for live email delivery. |
| `NOTIFICATION_HTTP_ENDPOINT` | Local/staging provider endpoint. | Production provider endpoint. |
| `NOTIFICATION_HTTP_TOKEN` | Placeholder or test token only. | Secret manager only. |
| `NOTIFICATION_WORKER_RUN_ONCE` | `1` for local one-pass runs. | Use only for scheduler-based production jobs. |
| `NOTIFICATION_WORKER_INTERVAL_MS` | Optional local tuning. | Set explicitly for continuous worker. |
| `NOTIFICATION_WORKER_DUNNING_LIMIT` | Optional local tuning. | Set according to production volume. |
| `NOTIFICATION_WORKER_DELIVERY_LIMIT` | Optional local tuning. | Set according to provider rate limits. |
| `NOTIFICATION_WORKER_MAX_ATTEMPTS` | Optional local tuning. | Set according to incident recovery policy. |

Notification preflight:

```bash
cd frontend
npm run worker:notifications:check
```

## Crawlers

| Variable | Local boundary | Production boundary |
|---|---|---|
| `SAM_API_KEY` | Optional test/developer key for SAM.gov API checks. | Secret manager only; respect SAM.gov terms. |
| `STATE_CRAWLER_LIMIT` | Small local batch size. | Explicit operational limit. |
| `CRAWLER_OWNER` | Optional owner label. | Required owner/process label for auditability. |
| `CRAWLER_WORKER_INTERVAL_MS` | Optional local tuning. | Set explicitly for scheduled worker. |

Crawler one-shot:

```bash
cd frontend
STATE_CRAWLER_LIMIT=5 npm run crawler:once
```

## Secret Handling Rule

Use placeholders such as `REPLACE_ME`, `sk_test_REPLACE_ME`, or `whsec_REPLACE_ME` in docs. Real values belong in the deployment platform secret manager or AWS Secrets Manager.

## AWS Runtime Notes

For AWS deployment, store production values in AWS Secrets Manager or SSM Parameter Store and reference them from App Runner, ECS task definitions, or the deploy job. Do not put these values in `.env.local`:

```bash
DATABASE_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_PRO_MONTHLY
STRIPE_PRICE_BUSINESS_MONTHLY
NOTIFICATION_HTTP_TOKEN
SAM_API_KEY
CRAWLER_RUN_TOKEN
OBJECT_STORAGE_ACCESS_KEY_ID
OBJECT_STORAGE_SECRET_ACCESS_KEY
OBJECT_STORAGE_SESSION_TOKEN
```

For App Runner first web release:

```bash
Build command: npm ci && npm run build
Start command: npm run start -- -p 8080
Service port: 8080
```

Do not define a custom App Runner variable named `PORT`; configure the service port and start command instead.

Production must not set:

```bash
ADMIN_UI_LOCAL_BYPASS=true
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
NOTIFICATION_PROVIDER=file
NOTIFICATION_PROVIDER=console
OBJECT_STORAGE_PROVIDER=local
PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE=1
```

Production should set:

```bash
APP_ORIGIN=https://app.apsi.example.com
```

Without `APP_ORIGIN`, the CSRF Origin/Referer check (`frontend/src/server/security/csrf.ts`) falls back to trusting the request's own `Host` header. That still blocks cross-site requests, but it depends on the reverse proxy/load balancer rejecting or normalizing spoofed `Host` headers before they reach the app. Setting `APP_ORIGIN` explicitly removes that dependency and is the safer production default. See `docs/qa/csrf-and-response-sanitization-audit.md` for the full design rationale.
