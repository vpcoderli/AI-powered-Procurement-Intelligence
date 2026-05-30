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

Valid provider names are `file`, `console`, and `http`. Unknown names fail during provider creation instead of silently falling back to local file delivery.

When `NODE_ENV=production` uses `file` or `console`, the config resolver returns a warning so deploy checks can flag that live email delivery is not active.

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
- Provider-specific adapters for a chosen mail platform instead of the generic HTTP gateway.
- Deploy-time invocation of `resolveNotificationProviderConfig` that fails production rollout on warnings when live email is required.
