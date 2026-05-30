# Production Billing and Worker Deployment Runbook

Updated: 2026-05-30

This runbook covers the production handoff for Stripe billing, webhook rotation, scheduled workers, and billing dunning notification operations. It assumes the application is deployed from `frontend` and that production and test environments have separate secrets, databases, and worker processes.

## Scope

Production readiness includes:

1. Stripe live-mode billing configuration.
2. Strict separation between test and production keys.
3. Webhook endpoint rotation without losing billing events.
4. Scheduled crawler and notification worker deployment.
5. Billing dunning and notification delivery checks.
6. Provider dashboard review before release.

Do not use this runbook to change Settings UI or Admin QA behavior.

## Environment Separation

Use separate environment groups for local, preview, staging, and production. Never copy Stripe live secrets into local `.env.local` or preview environments.

| Environment | Stripe secret key | Webhook secret | Price IDs | Verification command |
|---|---|---|---|---|
| Local sandbox | `sk_test_...` | Stripe CLI `whsec_...` | Test-mode `price_...` | `npm run billing:stripe:sandbox` |
| Staging | `sk_test_...` or isolated staging Stripe account | Staging endpoint `whsec_...` | Staging/test `price_...` | Staging checkout + webhook smoke test |
| Production | `sk_live_...` | Production endpoint `whsec_...` | Live-mode `price_...` | Production dashboard checklist + low-risk live checkout |

Required production billing variables:

```bash
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_PRICE_PRO_MONTHLY=price_REPLACE_ME
STRIPE_PRICE_BUSINESS_MONTHLY=price_REPLACE_ME
```

The current code still uses `pro` and `business` compatibility tiers. Product language may later migrate to Pursuit Starter, Response Builder, Growth, and Enterprise; until that migration lands, keep Stripe product names mapped to the current compatibility price variables.

Production guardrails:

- Local sandbox verification intentionally rejects non-`sk_test_...` keys.
- Production must not run `npm run billing:stripe:sandbox`.
- Do not reuse test webhook secrets with production endpoints.
- Keep live price IDs and test price IDs in separate secret stores.
- Rotate keys through the deployment platform secret manager, not source control.

## Stripe Webhook Endpoint Setup

Create one webhook endpoint per deployed environment:

```text
https://<production-host>/api/billing/webhook
https://<staging-host>/api/billing/webhook
```

Subscribe to these Stripe events:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

After creating the endpoint, copy its signing secret into `STRIPE_WEBHOOK_SECRET` for the matching environment and redeploy or restart the app process so the new secret is loaded.

## Webhook Endpoint Rotation

Use this when rotating a leaked secret, changing hosts, or rebuilding Stripe endpoints.

1. Create a new Stripe webhook endpoint for the same environment.
2. Add the same event list as the old endpoint.
3. Copy the new endpoint signing secret into the environment as `STRIPE_WEBHOOK_SECRET`.
4. Deploy the app with the new secret.
5. Trigger a low-risk billing event in that environment.
6. Confirm the new endpoint returns `2xx` in Stripe Dashboard.
7. Confirm local subscription or invoice state updated in the app.
8. Disable the old endpoint after the new endpoint has delivered successfully.

During the overlap window, Stripe may deliver the same event to both endpoints. The billing service stores provider event IDs and ignores duplicates, so duplicate delivery is acceptable while rotating. Do not leave both endpoints enabled after verification, because it makes future incident review noisy.

Rollback:

1. Re-enable the old endpoint if it was disabled.
2. Restore the old `STRIPE_WEBHOOK_SECRET`.
3. Redeploy or restart the app.
4. Replay the missed event from Stripe Dashboard if needed.

## Scheduled Worker Deployment

Run workers as separate processes from the web server. Use exactly one production instance of each continuous worker unless the deployment platform provides locking or singleton scheduling.

### Notification and Dunning Worker

Preferred continuous process:

```bash
cd frontend
npm run worker:notifications:check
npm run worker:notifications
```

Preferred scheduled process when the platform does not support always-on workers:

```bash
cd frontend
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
```

Schedule the one-shot command every 15 minutes. The worker is idempotent for dunning reminders through notification dedupe keys and is safe to retry after failures.

Production worker variables:

```bash
DATABASE_PATH=/var/lib/winbids/apsi.sqlite
NOTIFICATION_WORKER_INTERVAL_MS=900000
NOTIFICATION_WORKER_DUNNING_LIMIT=100
NOTIFICATION_WORKER_DELIVERY_LIMIT=25
NOTIFICATION_WORKER_MAX_ATTEMPTS=3
NOTIFICATION_PROVIDER=http
NOTIFICATION_HTTP_ENDPOINT=https://notifications.example.com/send
NOTIFICATION_HTTP_TOKEN=REPLACE_ME
```

Use `NOTIFICATION_PROVIDER=file` only for local development or staging smoke tests where file output is expected. Use `NOTIFICATION_PROVIDER=console` only for diagnostics.

### Crawler Worker

If scheduled source ingestion is part of the deployment, run the crawler worker separately from notifications:

```bash
cd frontend
npm run worker:crawler
```

For scheduler-only platforms, prefer the existing one-shot command:

```bash
cd frontend
npm run crawler:once
```

Recommended production starting point:

```bash
CRAWLER_WORKER_INTERVAL_MS=900000
STATE_CRAWLER_LIMIT=25
CRAWLER_OWNER=prod-crawler-worker
```

Do not co-locate crawler and notification workers in the same process manager entry. They have different failure modes and should be restarted, scaled, and observed independently.

## Dunning and Notification Worker Runbook

The notification worker does two jobs each cycle:

1. Schedules staged billing dunning reminders for failed invoices.
2. Delivers pending notification outbox rows through the configured provider.

Default dunning stages are:

- Day 2 after a failed invoice update: second reminder.
- Day 5 after a failed invoice update: final reminder.

Manual preflight:

```bash
cd frontend
npm run worker:notifications:check
```

Expected output:

```json
{
  "ok": true,
  "provider": "http",
  "databasePath": "/var/lib/winbids/apsi.sqlite",
  "warnings": []
}
```

Manual one-cycle run:

```bash
cd frontend
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
```

Expected cycle output:

```json
{
  "dunning": {
    "checkedInvoices": 100,
    "queued": 0,
    "skippedAlreadyQueued": 0,
    "skippedNotDue": 0,
    "skippedResolved": 100,
    "skippedNoRecipient": 0
  },
  "delivery": {
    "attempted": 0,
    "sent": 0,
    "failed": 0,
    "skipped": 0
  }
}
```

Triage:

| Symptom | Action |
|---|---|
| `NOTIFICATION_PROVIDER must be file, console, or http` | Fix the deployment variable and rerun `npm run worker:notifications:check`. |
| `NOTIFICATION_HTTP_ENDPOINT is required` | Add the provider endpoint or switch to `file`/`console` for non-production verification. |
| `failed` delivery count increases | Check provider logs, HTTP status, token validity, and whether the provider accepts the current payload schema. |
| `skippedNoRecipient` increases | Confirm affected users have emails and that billing invoice rows are attached to the intended user. |
| Dunning reminders do not queue | Confirm Stripe sent `invoice.payment_failed`, the invoice status is still `payment_failed`, and the failed invoice is older than the configured stage delay. |
| Worker exits after migrations | Confirm `DATABASE_PATH` points to a writable persistent database path and that the process has file permissions. |

Recovery:

1. Fix the environment or provider issue.
2. Run `NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications`.
3. Confirm failed rows eventually move to sent or remain failed with a new diagnostic message.
4. For provider outages, keep the worker running; retry limits are controlled by `NOTIFICATION_WORKER_MAX_ATTEMPTS`.

## Provider Dashboard Checklist

Complete this checklist before production launch and after any billing provider change.

Stripe Dashboard:

- Live mode is enabled when configuring production.
- Products and prices exist for the current compatibility tiers: Pro and Business.
- Price IDs match `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_BUSINESS_MONTHLY`.
- Billing Portal is configured and allows customers to view subscriptions and update/cancel payment methods.
- Production webhook endpoint points to `/api/billing/webhook`.
- Webhook event list matches this runbook.
- Recent webhook deliveries are `2xx`.
- Failed webhook retries have been replayed or acknowledged.
- Customer emails are collected in Checkout.
- Payment failure and retry behavior is configured in Stripe Billing settings.

Notification provider dashboard:

- Production endpoint is reachable from the worker environment.
- Auth token in the provider matches `NOTIFICATION_HTTP_TOKEN`.
- Provider logs include test sends from the production worker preflight or smoke test.
- Suppression/bounce handling is enabled if the provider supports it.
- Sender domain, SPF, DKIM, and DMARC are verified before using email delivery.

Deployment platform:

- Web process and worker process are separate entries.
- Worker has access to the same persistent database as the web process.
- Worker restart policy is enabled.
- At most one continuous notification worker is active.
- Secrets are scoped by environment.
- Logs are retained long enough to investigate billing events and notifications.

## Release Smoke Test

Use this sequence after deploying billing or worker changes:

1. Confirm app health.
2. Run `npm run worker:notifications:check` in the production worker environment.
3. Confirm Stripe production webhook endpoint returns `2xx` for a test or low-risk live event.
4. Create a low-risk live checkout using an internal account if the business process allows it.
5. Confirm subscription source becomes `billing_provider`.
6. Confirm Billing Portal opens for the internal account.
7. Run `NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications`.
8. Confirm the worker JSON output has no unexpected failures.

If a live checkout is not approved before launch, complete the dashboard checklist and run the same sequence in staging with test-mode keys.
