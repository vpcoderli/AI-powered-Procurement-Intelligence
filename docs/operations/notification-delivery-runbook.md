# Notification Delivery Runbook

This runbook covers the notification outbox delivery path used by the admin deliver API and the notification worker.

## Delivery Path

1. Application code enqueues rows in `notification_outbox`.
2. `deliverPendingNotifications` reads `pending` and `failed` rows whose `attemptCount` is below the configured limit.
3. `createNotificationProvider` resolves and validates the provider from environment variables.
4. The provider sends the payload.
5. The outbox row is marked `sent` on provider success, or `failed` with `lastError` on provider failure or throw.

The admin endpoint `POST /api/admin/notifications/deliver` and `npm run worker:notifications` use the same delivery service.

## Provider Environment

Default local fallback:

```bash
NOTIFICATION_PROVIDER=file
NOTIFICATION_OUTBOX_DIR=data/notification-outbox
```

`NOTIFICATION_PROVIDER` is optional. When it is not set, delivery uses the `file` provider and writes JSON payloads to `frontend/data/notification-outbox`.

Console fallback:

```bash
NOTIFICATION_PROVIDER=console
```

Production HTTP/email provider path:

```bash
NODE_ENV=production
NOTIFICATION_PROVIDER=http
NOTIFICATION_HTTP_ENDPOINT=https://mail-provider.example.com/send
NOTIFICATION_HTTP_TOKEN=replace-with-provider-token
```

`NOTIFICATION_HTTP_ENDPOINT` must be an absolute `http` or `https` URL. The token is optional because some provider gateways authenticate with network policy or signed URLs, but production deployments should set it when the gateway requires bearer authentication.

Valid provider names are `file`, `console`, `http`, `ses`, and `sendgrid`. Unknown names fail during provider creation instead of silently falling back to local file delivery.

When `NODE_ENV=production` uses `file` or `console` (i.e. not one of the live-delivery providers `http`, `ses`, `sendgrid`), the config resolver returns a warning so deploy checks can flag that live email delivery is not active.

## Production Email Provider Setup

Two provider-specific adapters exist in addition to the generic `http` gateway: Amazon SES (`ses`) and SendGrid (`sendgrid`). Both are implemented in `frontend/src/server/notifications/providers/` against the `NotificationProvider` interface and both tag/annotate every outbound send with the originating `notification_outbox.id` so the corresponding webhook route can correlate async bounce/complaint/delivery events back to the correct row.

### Amazon SES (`NOTIFICATION_PROVIDER=ses`)

Implementation: `frontend/src/server/notifications/providers/ses.ts`, built on `@aws-sdk/client-sesv2` (SendEmail API). Requires `npm install` to pull the dependency — see the human follow-up section below.

Setup steps (human/operator, requires an AWS account with SES access):

1. In the SES console, verify the sending domain (or a single sender address for early testing) and configure DKIM (SES-managed or BYODKIM) and an SPF-aligned `MAIL FROM` domain. Sending from an unverified identity fails closed.
2. If the account is still in the SES sandbox, request production access, or verify each individual recipient address for sandbox testing.
3. Create an SNS topic for bounce/complaint/delivery events (an SES configuration set with "Event publishing" -> SNS destination, or classic identity-level notifications). Subscribe the topic to `https://<your-app-host>/api/notifications/webhooks/ses` as an HTTPS(S) endpoint.
4. Set environment variables:
   ```bash
   NOTIFICATION_PROVIDER=ses
   NOTIFICATION_SES_REGION=us-east-1
   NOTIFICATION_SES_FROM_ADDRESS=alerts@yourdomain.example.com
   NOTIFICATION_SES_CONFIGURATION_SET=apsi-notifications   # optional but recommended
   # Prefer the runtime's IAM role (ECS task role / App Runner instance role)
   # scoped to ses:SendEmail over explicit keys. Only set these for
   # environments without an attached role:
   # NOTIFICATION_SES_ACCESS_KEY_ID=...
   # NOTIFICATION_SES_SECRET_ACCESS_KEY=...
   ```
5. Confirm the SNS HTTPS subscription: the webhook route auto-confirms by fetching `SubscribeURL` from the `SubscriptionConfirmation` message SNS sends on first subscribe, so no manual click-through is required once the endpoint is live and reachable from the internet.
6. `POST /api/notifications/webhooks/ses` verifies every request's SNS message signature (RSA-SHA1 against the certificate at the envelope's `SigningCertURL`, restricted to genuine `sns.*.amazonaws.com` hosts) before applying anything. `NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION=1` disables this for local testing only; the route refuses the bypass whenever `NODE_ENV=production` regardless of this variable.

### SendGrid (`NOTIFICATION_PROVIDER=sendgrid`)

Implementation: `frontend/src/server/notifications/providers/sendgrid.ts`, built on `@sendgrid/mail`. Requires `npm install` to pull the dependency.

Setup steps (human/operator, requires a SendGrid account):

1. Verify a sender identity or authenticate a full sending domain (Settings > Sender Authentication) so SPF/DKIM pass.
2. Create an API key scoped to Mail Send (Settings > API Keys).
3. Enable the Event Webhook (Settings > Mail Settings > Event Webhook), point it at `https://<your-app-host>/api/notifications/webhooks/sendgrid`, select at minimum the Bounce, Dropped, Blocked, Spam Report, and Delivered event types, and enable "Signed Event Webhook Requests" to get the ECDSA verification public key.
4. Set environment variables:
   ```bash
   NOTIFICATION_PROVIDER=sendgrid
   NOTIFICATION_SENDGRID_API_KEY=SG.replace-with-real-key
   NOTIFICATION_SENDGRID_FROM_ADDRESS=alerts@yourdomain.example.com
   NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY=replace-with-base64-public-key
   ```
5. `POST /api/notifications/webhooks/sendgrid` verifies the `X-Twilio-Email-Event-Webhook-Signature`/`-Timestamp` headers against `NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY` before applying anything. In production the route fails closed (401) if the public key is not configured, rather than accepting unsigned events.

## Bounce/Complaint/Delivery Webhook Handling

`POST /api/notifications/webhooks/ses` and `POST /api/notifications/webhooks/sendgrid` (`frontend/src/app/api/notifications/webhooks/`) receive asynchronous delivery outcome events from the configured provider and apply them to the matching `notification_outbox` row via `@/server/notifications/delivery-events.ts` and `recordNotificationDeliveryEvent(FromMysql)` in `@/server/notifications/outbox-repository.ts`.

Key behavior:

- Correlation is by `notification_outbox.id`, round-tripped through SES `EmailTags` (`apsi_notification_id`) or SendGrid `custom_args` (`apsi_notification_id`) — not by recipient address, which may not be unique per send.
- A bounce or complaint sets the row's `status` to `failed` and `lastError` to a structured `provider_event:bounce: ...` / `provider_event:complaint: ...` string, so it is visible in the admin notifications API/UI alongside ordinary send failures.
- This intentionally does **not** call the same code path as a synchronous send failure (`markNotificationFailed`): bounce/complaint events do not increment `attemptCount`, because they are a post-delivery signal that can arrive after the row was already marked `sent`, not a retryable delivery attempt. `sentAt` is left untouched for the same reason.
- A `delivered` confirmation event is a no-op if the row was already marked `failed` by an earlier bounce/complaint (delivery confirmations must not downgrade a bounce/complaint outcome).
- Both routes acknowledge with `200` even when an event does not match a known `notification_outbox` row (`notFound` in the response body), so the provider does not retry indefinitely for events APSi cannot act on.

The schema does not yet have dedicated `bounced`/`complained` `notification_outbox.status` enum values; this reuses the existing `failed` status with a structured `lastError` prefix. A future iteration could add first-class statuses and a suppression list (do-not-send) keyed by bounced/complained recipient address — see Production Hardening Gaps below.

## Worker Operation

Run continuously:

```bash
cd frontend
npm run worker:notifications
```

Run one pass:

```bash
cd frontend
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
```

Useful worker controls:

```bash
NOTIFICATION_WORKER_INTERVAL_MS=300000
NOTIFICATION_WORKER_DELIVERY_LIMIT=25
NOTIFICATION_WORKER_MAX_ATTEMPTS=3
NOTIFICATION_WORKER_DUNNING_LIMIT=50
```

`NOTIFICATION_WORKER_MAX_ATTEMPTS` controls the maximum outbox attempts for both `pending` and previously `failed` rows. Rows at or above the limit are skipped by delivery.

## Failure And Retry Behavior

Current behavior is attempt-count based:

- Successful sends mark the row `sent`, set `sentAt`, clear `lastError`, and increment `attemptCount`.
- Provider failures mark the row `failed`, clear `sentAt`, save `lastError`, and increment `attemptCount`.
- Provider exceptions are caught and recorded as failed outbox rows.
- Delivery retries `failed` rows while `attemptCount < maxAttempts`.
- Delivery does not yet apply time-based backoff between failures.

For a production incident:

1. Check worker output or admin deliver response for `attempted`, `sent`, `failed`, and `skipped`.
2. Inspect recent `notification_outbox` rows in the admin notifications API or database.
3. Check `lastError` for provider HTTP status, missing endpoint, or thrown provider errors.
4. Fix provider configuration or upstream provider availability.
5. Re-run `POST /api/admin/notifications/deliver` or restart the worker.

If rows are skipped because attempts are exhausted, reset or requeue them deliberately after confirming the provider issue is fixed. The current implementation has no automatic dead-letter queue.

## Production Hardening Gaps

The next production slice should add one of these before high-volume delivery:

- Time-based exponential backoff using an explicit `nextAttemptAt` column.
- A dead-letter status for exhausted rows.
- Deploy-time invocation of `resolveNotificationProviderConfig` that fails production rollout on warnings when live email is required.
- Dedicated `bounced`/`complained` `notification_outbox.status` enum values (currently reuses `failed` with a structured `lastError` prefix; see Bounce/Complaint/Delivery Webhook Handling above).
- A suppression list (do-not-send) keyed by bounced/complained recipient address, checked before enqueueing new notifications.
- SES/SendGrid account setup (verified sending domain, DKIM/SPF, production sending access) and `npm install` to pull `@aws-sdk/client-sesv2`/`@sendgrid/mail` are still required before either adapter can be used — see Production Email Provider Setup above.
