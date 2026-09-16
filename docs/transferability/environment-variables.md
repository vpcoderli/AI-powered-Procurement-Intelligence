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
| `CRAWLER_RUN_TOKEN` | Optional bearer / `x-crawler-token` for `POST /api/crawler/state/run` and `/api/crawler/sam-gov/run`. Without it, only an admin/operator session may trigger runs. | Required if crawler run APIs are exposed; store in secret manager. |
| `CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN` | `true` lets loopback requests trigger crawler run APIs without a token or session, only when `NODE_ENV` is `development`/`test` and no `*_ENV` variable names production or staging. | Must be unset. |
| `CRAWLER_TASK_TIMEOUT_MS` | Optional; defaults to `1800000` (30 min). Whole fetch-task budget including detail enrichment; the Python child is SIGKILLed past it and the run fails with `CrawlerTaskTimeoutError`. | Set explicitly from the largest configured `max_details_per_run` × `min_interval_seconds`. |
| `CRAWLER_PLATFORM_MIN_INTERVAL_MS` | Optional; defaults to `5000`. Minimum pause between two sources of the same `provider_family` inside one crawl tick. When one of them answers with a challenge/throttle (BidNet challenge, or HTTP 403/429/202), the remaining not-yet-run sources of that platform come back `status: "deferred"` for the tick instead of being run into the wall — no health write-back, no retry. | Raise it for platforms that rate-limit aggressively (BidNet Direct sits behind AWS WAF); never lower it below the portal's documented crawl delay. |
| `CRAWLER_PYTHON_BIN` | Optional; defaults to `python3` on `PATH`. | Set to the crawler venv interpreter (the container images bake `/opt/crawler-venv/bin/python`). |
| `CRAWLER_DIRECTORY` | Optional; defaults to `../crawler` relative to `frontend/`. | Set to the packaged crawler source directory (the container images bake `/crawler`). |
| `CRAWLER_ATTACHMENT_DIR` | Optional local attachment path; a path-separator-delimited list. The **first** entry is the archive write root used by the attachment repair worker; the remaining entries stay readable roots for already-archived files. Unset = `<cwd>/data/attachments`. | Persistent storage path or object storage handoff. |
| `APP_ORIGIN` | Optional; not required when running on `localhost:3000` (dev origins are trusted automatically). | Set to the canonical HTTPS origin (for example `https://app.apsi.example.com`). Used by the CSRF Origin/Referer check in `frontend/src/server/security/csrf.ts`. |
| `CSRF_ALLOWED_ORIGINS` | Optional comma-separated list, only needed when testing multiple origins locally. | Set when more than one origin legitimately calls state-changing APIs with the session cookie (for example a staging origin kept alongside production, or a separate marketing subdomain). Comma-separated absolute origins, for example `https://app.apsi.example.com,https://staging.apsi.example.com`. |

## Authentication Rate Limiting & Account Lockout

Applies to `/api/auth/login`, `/api/auth/password-reset/request`, and `/api/auth/password-reset/confirm`. Implementation is in-memory and process-local (`frontend/src/server/security/rate-limit.ts`, `frontend/src/server/security/login-guard.ts`) — see the "Known Limitations" note below before relying on this in a multi-instance deployment.

| Variable | Local boundary | Production boundary |
|---|---|---|
| `AUTH_LOGIN_LOCKOUT_MAX_ATTEMPTS` | Optional; defaults to `5`. | Set deliberately; lower values increase support load, higher values weaken brute-force protection. |
| `AUTH_LOGIN_LOCKOUT_WINDOW_MINUTES` | Optional; defaults to `15`. | Set deliberately alongside the max-attempts value. |
| `AUTH_LOGIN_RATE_LIMIT_PER_IP` | Optional; defaults to `20` login attempts per window. | Tune based on expected shared-IP traffic (offices, NAT). |
| `AUTH_LOGIN_RATE_LIMIT_PER_ACCOUNT` | Optional; defaults to `10` login attempts per window (looser than lockout, which is the primary defense). | Tune based on observed abuse patterns. |
| `AUTH_LOGIN_RATE_WINDOW_MINUTES` | Optional; defaults to `15`. Shared by both the per-IP and per-account login rate limits. | Set deliberately. |
| `AUTH_RESET_REQUEST_RATE_LIMIT_PER_IP` | Optional; defaults to `10` password-reset requests per window. | Tune based on expected shared-IP traffic. |
| `AUTH_RESET_REQUEST_RATE_LIMIT_PER_ACCOUNT` | Optional; defaults to `5` password-reset requests per window. | Tune based on observed abuse patterns. |
| `AUTH_RESET_REQUEST_RATE_WINDOW_MINUTES` | Optional; defaults to `15`. Shared by both the per-IP and per-account reset-request rate limits. | Set deliberately. |
| `AUTH_RESET_CONFIRM_RATE_LIMIT_PER_IP` | Optional; defaults to `20` password-reset confirm (token submission) attempts per window. | Tune based on expected shared-IP traffic. |
| `AUTH_RESET_CONFIRM_RATE_WINDOW_MINUTES` | Optional; defaults to `15`. | Set deliberately. |

Known limitation: rate-limit and lockout counters live in an in-process `Map`, not a shared store. Each app instance enforces its own independent window/counter, so a multi-instance deployment effectively multiplies the allowed attempt count by the instance count. `frontend/src/server/security/rate-limit.ts` defines a `RateLimitStore` interface specifically so this can be swapped for a distributed store (Redis/Upstash) later without changing call sites; this was not stood up in this pass.

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
| `OBJECT_STORAGE_S3_CLIENT` | Optional; defaults to `rest` (hand-rolled SigV4 REST client, zero extra runtime dependency). Set `aws-sdk` to use the `@aws-sdk/client-s3`-backed provider instead (`frontend/src/server/storage/s3-object-storage.ts`); requires `npm install` to pull `@aws-sdk/client-s3`. | Either value is acceptable; `aws-sdk` is recommended once the dependency has been installed and verified, for the SDK's credential-provider-chain and retry handling. |
| `OBJECT_STORAGE_S3_FORCE_PATH_STYLE` | Optional; set `1` for path-style addressing against non-AWS S3-compatible endpoints (e.g. MinIO) when using `OBJECT_STORAGE_S3_CLIENT=aws-sdk`. | Usually unset for real AWS S3 (virtual-hosted-style is the default). |
| `PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE` | Usually unset. | Emergency/documented override only; not a substitute for S3 production storage. |

Malware scanning (`OBJECT_STORAGE_MALWARE_SCANNER`, validated by `validateObjectStoragePreflight`) selects a scanner implementation via `resolveMalwareScanner` in `frontend/src/server/storage/malware-scan.ts`:

| Value | Local boundary | Production boundary |
|---|---|---|
| Unset, `local`, `local/noop`, `noop`, `none` | Default for local dev; always-clean except for deterministic EICAR-style test signatures. | Rejected by strict S3 production/staging preflight — must be set to a non-local value. |
| Any other value, e.g. `external` | Resolves to the built-in heuristic scanner (file-type allowlist + size limit + the same test signatures), labeled `engine: "heuristic-v1"`. This is **not** a real anti-malware engine. | Accepted by preflight today, but still only the heuristic scanner unless a real scanner is wired in — see the module doc comment in `malware-scan.ts` for how to integrate ClamAV or an AWS-native S3 malware-scanning service and replace this default. |

The malware scan hook is invoked automatically inside `@/server/artifacts/service.ts` before every artifact upload/replacement (fail-closed: a blocked scan throws before any bytes are written). It is also available at the object-storage layer via `createObjectStorageProvider({ enableMalwareScan: true })` for callers that have not already run their own scan.

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
| `NOTIFICATION_PROVIDER` | `file` or `console`; `http`, `ses`, or `sendgrid` for integration testing. | `ses`, `sendgrid`, or `http`. |
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

### Amazon SES provider (`NOTIFICATION_PROVIDER=ses`)

Requires `@aws-sdk/client-sesv2` to be installed (`npm install` after this dependency lands in `package.json`; see the human follow-up in the P0-5 delivery notes).

| Variable | Local boundary | Production boundary |
|---|---|---|
| `NOTIFICATION_SES_REGION` | Test/sandbox SES region, for example `us-east-1`. Falls back to `AWS_REGION` if unset. | Required production SES region. |
| `NOTIFICATION_SES_FROM_ADDRESS` | Verified sandbox sender address. | Required verified sender address on a domain with DKIM/SPF configured (see `docs/operations/notification-delivery-runbook.md`). |
| `NOTIFICATION_SES_CONFIGURATION_SET` | Optional; unset unless testing configuration-set-scoped event publishing. | Recommended: an SES configuration set with SNS event publishing enabled for bounce/complaint/delivery. |
| `NOTIFICATION_SES_ACCESS_KEY_ID` | Optional test/integration credential. | Prefer the runtime's default credential provider chain (IAM instance/task role) over explicit keys; if set, inject from Secrets Manager/SSM. |
| `NOTIFICATION_SES_SECRET_ACCESS_KEY` | Optional test/integration credential. | Same boundary as `NOTIFICATION_SES_ACCESS_KEY_ID`. |
| `NOTIFICATION_SES_SESSION_TOKEN` | Optional temporary test token. | Optional temporary credential token when using session credentials. |
| `NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION` | `1` only for local testing against unsigned SNS fixture payloads. | Must be unset; the webhook route refuses this bypass whenever `NODE_ENV=production` regardless of this value. |

### SendGrid provider (`NOTIFICATION_PROVIDER=sendgrid`)

Requires `@sendgrid/mail` to be installed (`npm install` after this dependency lands in `package.json`).

| Variable | Local boundary | Production boundary |
|---|---|---|
| `NOTIFICATION_SENDGRID_API_KEY` | Test-mode API key placeholder only. | Secret manager only; never commit. |
| `NOTIFICATION_SENDGRID_FROM_ADDRESS` | Verified sandbox sender address. | Required verified sender identity/domain. |
| `NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY` | Optional; only needed to test signature verification locally. | Required. Base64 ECDSA public key from SendGrid Event Webhook settings; the webhook route fails closed (401) in production if unset. |

Both adapters tag/annotate each outbound message with the originating `notification_outbox.id` (SES `EmailTags`, SendGrid `custom_args`) so the corresponding bounce/complaint/delivery webhook route can correlate the async event back to the correct row without depending on recipient address uniqueness.

## Observability

| Variable | Local boundary | Production boundary |
|---|---|---|
| `SENTRY_DSN` | Usually unset; logging falls back to structured console JSON only. | Required to enable error tracking; store in secret manager. Set on both the Next.js server runtime and the three worker processes. |
| `SENTRY_ENVIRONMENT` | Optional; defaults to `NODE_ENV` or `development`. | Set to `production` (or the specific deploy environment name). |
| `SENTRY_RELEASE` | Optional; usually unset locally. | Set to the deployed build/commit identifier for release tracking. |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional; defaults to `0` (tracing disabled). | Set a low sample rate (for example `0.1`) if performance tracing is desired; leave unset/`0` otherwise. |

Notes:

- `frontend/src/lib/observability/logger.ts` provides the shared structured JSON logger used by API routes, `src/server/**`, and the worker scripts. It requires no environment variables and always logs to stdout/stderr as JSON.
- `frontend/src/lib/observability/sentry.ts` and `frontend/instrumentation.ts` wire up `@sentry/nextjs`, guarded entirely by `SENTRY_DSN`. When `SENTRY_DSN` is unset, or when `@sentry/nextjs` is not yet installed (see `npm install` follow-up below), Sentry calls no-op and the app/workers continue to function on console-only logging.
- `GET /api/health` reports `checks.errorTracking.configured` as `true`/`false` based on whether `SENTRY_DSN` is set — it does not verify the DSN is a real, reachable Sentry project.
- `@sentry/nextjs` is declared in `frontend/package.json` but has not been installed in this environment; run `npm install` locally before relying on Sentry reporting (see human follow-ups).
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
## AI Cost & Confidence

See `frontend/src/server/ai/prompt-registry.ts`, `frontend/src/server/ai/confidence.ts`, and `frontend/src/server/ai/cost-tracking.ts`. Every AI feature call site (`intent_brief`, `qualification_qa`, and any future live-LLM action) logs its prompt version, confidence tier, and token/cost estimate to the `ai_call_logs` table via `recordAiCallCost` / `recordZeroCostAiCall`.

| Variable | Local boundary | Production boundary |
|---|---|---|
| `AI_COST_RATE_OVERRIDES_JSON` | Optional. JSON object mapping a model id to `{ "promptPer1k": number, "completionPer1k": number }` USD rates, for example `{"gpt-4o-mini":{"promptPer1k":0.00015,"completionPer1k":0.0006}}`. Overrides `MODEL_RATE_TABLE_USD` in `cost-tracking.ts` without a code change. | Set once real provider pricing is confirmed, or after a provider price change, until the built-in rate table is updated and redeployed. Malformed JSON is ignored (falls back to the built-in table), so validate with `JSON.parse` before setting. |
| `AI_COST_ALERT_THRESHOLD_USD` | Optional. A USD number; when set, `isOverCostAlertThreshold()` reports whether a summed cost total has crossed it. Unset means no threshold check. | Set to the desired per-period spend ceiling for whichever scope (org/global) calls `isOverCostAlertThreshold`. This only computes the boolean signal today — no alert channel (Slack/email/PagerDuty) is wired up; see human follow-up in the P1-4 task notes. |

**UNVERIFIED PRICING WARNING:** the default per-model rates baked into `MODEL_RATE_TABLE_USD` (`frontend/src/server/ai/cost-tracking.ts`) are illustrative placeholders for wiring the metering pipeline end to end. They are **not** guaranteed to match any provider's actual current published pricing. Verify and update them (or set `AI_COST_RATE_OVERRIDES_JSON`) against the real provider rate card before relying on `ai_call_logs` totals for billing, invoicing, or cost-alerting decisions.

## Crawlers

| Variable | Local boundary | Production boundary |
|---|---|---|
| `SAM_API_KEY` | Optional test/developer key for SAM.gov API checks. | Secret manager only; respect SAM.gov terms. |
| `SCRAPLING_EXTRACTOR_URL` | `http://localhost:8091` when running `services/scrapling-extractor/run-local.sh`; `http://scrapling-extractor:8091` under docker compose (compose publishes no host port for it — the sidecar is reachable only from the compose network). Unset = detail enrichment skipped (`reason: extractor_not_configured`). | Private network address of the extractor service; never expose publicly. |
| `STATE_CRAWLER_LIMIT` | Small local batch size. | Explicit operational limit. |
| `CRAWLER_OWNER` | Optional owner label. | Required owner/process label for auditability. |
| `CRAWLER_WORKER_INTERVAL_MS` | Optional local tuning. | Set explicitly for scheduled worker. |
| `CRAWLER_WORKER_RETRY_MAX_ATTEMPTS` | Optional; defaults to `3`. | Number of times a single configured crawler source (one state portal or SAM.gov) is retried, with exponential backoff, within one worker tick before it's recorded as failed for that tick. The `crawlerLocks` acquire/release cycle repeats on each retry and already prevents duplicate concurrent runs of the same source, so this is safe to raise for flaky sources. |
| `CRAWLER_WORKER_RETRY_BASE_DELAY_MS` | Optional; defaults to `500`. | Base delay (ms) for the per-source retry backoff. |
| `CRAWLER_WORKER_RETRY_MAX_DELAY_MS` | Optional; defaults to `30000`. | Upper bound (ms) on any single per-source retry delay. |
| `CRAWLER_WORKER_SEND_RETRY_MAX_ATTEMPTS` | Optional; defaults to `3`. | Number of fast in-process retries for a single search-alert notification send triggered after a crawler run, mirroring `NOTIFICATION_WORKER_SEND_RETRY_MAX_ATTEMPTS`. |
| `CRAWLER_WORKER_SEND_RETRY_BASE_DELAY_MS` | Optional; defaults to `200`. | Base delay (ms) for that notification send retry backoff. |
| `CRAWLER_WORKER_SEND_RETRY_MAX_DELAY_MS` | Optional; defaults to `10000`. | Upper bound (ms) on that notification send retry delay. |
| `ATTACHMENT_WORKER_INTERVAL_MS` | Optional; defaults to `21600000` (6 h). Loop interval of `npm run worker:attachments`. | Set explicitly for the scheduled attachment repair worker. |
| `ATTACHMENT_WORKER_RUN_ONCE` | Optional; `1`/`true` runs a single pass and exits (same as the `--once` flag, and what `npm run attachments:repair:once` sets). | Use for one-off/scheduled single passes (for example an ECS scheduled task). |
| `ATTACHMENT_REPAIR_MAX_PER_SOURCE` | Optional positive integer. Caps attachments attempted per source per run, **downward only** — it can lower but never raise each source's `fetch_config.attachments.max_per_run` (default 50). | Use to throttle a first backfill run; leave unset to honour per-source policy. |
| `BROWSER_DOWNLOADER_URL` | Optional http(s) URL of the headless-browser download sidecar. `http://localhost:8092` with `services/browser-downloader/run-local.sh`; `http://browser-downloader:8092` under docker compose (no host port is published — the sidecar is reachable only from the compose network). Unset = sources configured with `attachments.mode=browser` stay queued as `browser_unavailable`. | Private network address of the sidecar; it has no authentication and must never be exposed publicly. |
| `BROWSER_DOWNLOADER_HOST` | Sidecar-side. Optional; defaults to `127.0.0.1` so a locally run sidecar is not reachable off-box. | The container image sets `0.0.0.0` for the compose/private network; keep the service behind the private network. |
| `BROWSER_DOWNLOADER_PORT` | Sidecar-side. Optional; defaults to `8092`. | Set to match the port in `BROWSER_DOWNLOADER_URL`. |
| `BROWSER_DOWNLOADER_MAX_BYTES` | Sidecar-side. Optional; defaults to `52428800` (50 MB). Hard ceiling on a single download the sidecar will buffer. | Set at or above the largest per-source `attachments.max_bytes`. |

Attachment repair one-shot (operations guide: `docs/operations/attachment-repair.md`):

```bash
cd frontend
npm run worker:attachments:check                              # environment preflight only
ATTACHMENT_REPAIR_MAX_PER_SOURCE=3 npm run attachments:repair:once
```

Crawler one-shot:

```bash
cd frontend
STATE_CRAWLER_LIMIT=5 npm run crawler:once
```

## Worker Reliability (Retry/Backoff and Failure Alerting)

The three outbox/crawler worker scripts (`crawler-worker.ts`, `event-worker.ts`, `notification-worker.ts`) retry individual items (one crawler source, one notification send, one event outbox row) with exponential backoff + jitter before recording that item as failed for the current tick — see `frontend/src/lib/resilience/retry.ts`. This is layered on top of, not a replacement for, each worker's existing durable cross-tick retry mechanism (`crawlerLocks`, `notification_outbox.attempt_count`, `event_outbox.attempt_count`): the new in-process retries only affect how many times the underlying send/run/handler call is attempted before one outcome is recorded per tick, the same as before.

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
NOTIFICATION_SES_ACCESS_KEY_ID
NOTIFICATION_SES_SECRET_ACCESS_KEY
NOTIFICATION_SES_SESSION_TOKEN
NOTIFICATION_SENDGRID_API_KEY
NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY
SAM_API_KEY
CRAWLER_RUN_TOKEN
OBJECT_STORAGE_ACCESS_KEY_ID
OBJECT_STORAGE_SECRET_ACCESS_KEY
OBJECT_STORAGE_SESSION_TOKEN
SENTRY_DSN
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
NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION=1
OBJECT_STORAGE_PROVIDER=local
PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE=1
```

Production should set:

```bash
APP_ORIGIN=https://app.apsi.example.com
```

Without `APP_ORIGIN`, the CSRF Origin/Referer check (`frontend/src/server/security/csrf.ts`) falls back to trusting the request's own `Host` header. That still blocks cross-site requests, but it depends on the reverse proxy/load balancer rejecting or normalizing spoofed `Host` headers before they reach the app. Setting `APP_ORIGIN` explicitly removes that dependency and is the safer production default. See `docs/qa/csrf-and-response-sanitization-audit.md` for the full design rationale.
