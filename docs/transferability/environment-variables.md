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
| `NOTIFICATION_WORKER_MAX_ATTEMPTS` | Optional local tuning. | Set according to incident recovery policy. This is the durable, cross-tick retry limit tracked in `notification_outbox.attempt_count` — a notification stops being retried across future ticks once its attempt count reaches this value. |
| `NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS` | Optional; defaults to `3`. | Number of fast in-process retries (with exponential backoff) for a single `provider.send()` call within one delivery attempt, before that attempt is recorded as failed (incrementing `attempt_count` by one, same as before this existed). Independent from `NOTIFICATION_WORKER_MAX_ATTEMPTS`. |
| `NOTIFICATION_WORKER_SEND_RETRY_BASE_DELAY_MS` | Optional; defaults to `200`. | Base delay (ms) for the in-process send retry backoff; actual delay is exponential with full jitter, capped by `NOTIFICATION_WORKER_SEND_RETRY_MAX_DELAY_MS`. |
| `NOTIFICATION_WORKER_SEND_RETRY_MAX_DELAY_MS` | Optional; defaults to `10000`. | Upper bound (ms) on any single in-process send retry delay. |

Notification preflight:

```bash
cd frontend
npm run worker:notifications:check
```

## Event Outbox Worker

| Variable | Local boundary | Production boundary |
|---|---|---|
| `EVENT_WORKER_RUN_ONCE` | `1` for local one-pass runs. | Use only for scheduler-based production jobs. |
| `EVENT_WORKER_INTERVAL_MS` | Optional local tuning. | Set explicitly for continuous worker. |
| `EVENT_WORKER_DELIVERY_LIMIT` | Optional local tuning. | Set according to destination throughput. |
| `EVENT_WORKER_MAX_ATTEMPTS` | Optional local tuning. | Durable, cross-tick retry limit tracked in `event_outbox.attempt_count`, mirroring `NOTIFICATION_WORKER_MAX_ATTEMPTS`. |
| `EVENT_WORKER_DELIVERY_RETRY_MAX_ATTEMPTS` | Optional; defaults to `3`. | Number of fast in-process retries (with exponential backoff) for a single outbox row's destination handler call within one delivery attempt, before that attempt is recorded as failed. Independent from `EVENT_WORKER_MAX_ATTEMPTS`. |
| `EVENT_WORKER_DELIVERY_RETRY_BASE_DELAY_MS` | Optional; defaults to `200`. | Base delay (ms) for the in-process delivery retry backoff. |
| `EVENT_WORKER_DELIVERY_RETRY_MAX_DELAY_MS` | Optional; defaults to `10000`. | Upper bound (ms) on any single in-process delivery retry delay. |

Event worker preflight:

```bash
cd frontend
npm run worker:events:check
```

## Crawlers

| Variable | Local boundary | Production boundary |
|---|---|---|
| `SAM_API_KEY` | Optional test/developer key for SAM.gov API checks. | Secret manager only; respect SAM.gov terms. |
| `STATE_CRAWLER_LIMIT` | Small local batch size. | Explicit operational limit. |
| `CRAWLER_OWNER` | Optional owner label. | Required owner/process label for auditability. |
| `CRAWLER_WORKER_INTERVAL_MS` | Optional local tuning. | Set explicitly for scheduled worker. |
| `CRAWLER_WORKER_RETRY_MAX_ATTEMPTS` | Optional; defaults to `3`. | Number of times a single configured crawler source (one state portal or SAM.gov) is retried, with exponential backoff, within one worker tick before it's recorded as failed for that tick. The `crawlerLocks` acquire/release cycle repeats on each retry and already prevents duplicate concurrent runs of the same source, so this is safe to raise for flaky sources. |
| `CRAWLER_WORKER_RETRY_BASE_DELAY_MS` | Optional; defaults to `500`. | Base delay (ms) for the per-source retry backoff. |
| `CRAWLER_WORKER_RETRY_MAX_DELAY_MS` | Optional; defaults to `30000`. | Upper bound (ms) on any single per-source retry delay. |
| `CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS` | Optional; defaults to `3`. | Number of fast in-process retries for a single search-alert notification send triggered after a crawler run, mirroring `NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS`. |
| `CRAWLER_WORKER_SEND_RETRY_BASE_DELAY_MS` | Optional; defaults to `200`. | Base delay (ms) for that notification send retry backoff. |
| `CRAWLER_WORKER_SEND_RETRY_MAX_DELAY_MS` | Optional; defaults to `10000`. | Upper bound (ms) on that notification send retry delay. |

Crawler one-shot:

```bash
cd frontend
STATE_CRAWLER_LIMIT=5 npm run crawler:once
```

## Worker Reliability (Retry/Backoff and Failure Alerting)

All three worker scripts (`crawler-worker.ts`, `event-worker.ts`, `notification-worker.ts`) now retry individual items (one crawler source, one notification send, one event outbox row) with exponential backoff + jitter before recording that item as failed for the current tick — see `frontend/src/lib/resilience/retry.ts`. This is layered on top of, not a replacement for, each worker's existing durable cross-tick retry mechanism (`crawlerLocks`, `notification_outbox.attempt_count`, `event_outbox.attempt_count`): the new in-process retries only affect how many times the underlying send/run/handler call is attempted before one outcome is recorded per tick, the same as before.

When an item exhausts its in-process retries, the worker emits a structured JSON failure-alert log line (`frontend/src/lib/resilience/failure-alerts.ts`) with the worker name, item id, attempt count, and error, tagged `"alert": true`. This is log-only today — wiring these alerts to a real paging channel (Slack/PagerDuty/email) is a human follow-up; match on `"alert": true` in your log pipeline to build that alert rule.

**Reconciliation note:** a parallel P0-3 observability task adds `frontend/src/lib/observability/logger.ts` (structured logger + Sentry forwarding) on a different branch. Once both branches are merged, `emitWorkerFailureAlert` in `failure-alerts.ts` should be updated to route through that shared logger instead of `console.error` directly, so failure alerts also get Sentry forwarding.

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
