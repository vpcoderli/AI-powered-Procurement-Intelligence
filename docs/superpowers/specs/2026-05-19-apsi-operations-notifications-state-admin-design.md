# APSi Operations, Notifications, State Sources, and Admin Design

## Goal

Build the next local-development stage for APSi by adding the shared operational foundation needed for scheduled crawling, email-style notifications, state procurement sources, and an admin/operator workspace.

## Confirmed Direction

Use the staged foundation-first approach:

1. Add a shared crawler run orchestrator with SQLite locking.
2. Add notification outbox infrastructure with a local file provider.
3. Add a state source registry and first fixture-backed state source imports.
4. Add an admin/operator UI and APIs for data source health, enablement, and manual runs.

This keeps the four requested feature areas moving together while avoiding four separate implementations of crawler state, locking, source metadata, and operator visibility.

## Current Context

The project already has:

- Python crawler CLI commands for fixture import and real SAM.gov import.
- SQLite upsert and crawler log writing.
- Next.js backend route for manual SAM.gov runs.
- Saved search alert matching that updates `lastMatchedAt`.
- `alerts.lastNotifiedAt` and `notificationChannel` fields reserved for notifications.
- `data_sources` table with source metadata and enablement fields.
- `crawler_logs` table and `/api/health/scrapers`.
- User records with a `role` column, but no complete admin authorization helper yet.
- English and Chinese dictionaries plus a sidebar-driven app shell.

## Scope

This stage will add local functional coverage for four areas:

### 1. Scheduler and Worker Foundation

Add a TypeScript crawler orchestrator that is used by both the manual route and a local worker script.

The orchestrator will:

- Acquire a per-source SQLite lock before starting a crawler run.
- Skip or return a locked status if another run owns the source lock.
- Call the existing SAM.gov runner.
- Run alert matching and notification enqueue/send after successful import.
- Release locks in success and failure cases.
- Allow stale locks to be replaced after expiry.

The local worker will:

- Support a one-shot script for local cron and testing.
- Support a simple loop script for local development.
- Avoid running long-lived scheduling logic inside a Next.js request handler.

### 2. Notification Outbox

Add a DB-backed `notification_outbox` table and local notification service.

The notification service will:

- Build alert digest payloads from matched alerts and matching bids.
- Skip anonymous users and users without email.
- Insert deduplicated outbox rows before sending.
- Use a provider interface with local `file` and `console` providers.
- Update outbox status and `alerts.lastNotifiedAt` after successful send.

This stage will not require live SMTP credentials. The `file` provider writes structured notification payloads under `frontend/data/notification-outbox` so the notification chain is testable and inspectable locally.

### 3. State Procurement Source Foundation

Add state source metadata and fixture-backed import support for the first five state sources:

- California / Cal eProcure
- Texas / ESBD
- New York / NYS Contract Reporter
- Florida / MyFloridaMarketPlace
- Illinois / BidBuy

The first implementation will use fixtures and shared state normalizers, not brittle live scraping. This creates stable field mapping, source IDs, and tests before real state-specific API or HTML adapters are added.

State imports must produce:

- `issuer_type = "state"`
- two-letter `state_code`
- stable human-readable `source`
- machine-stable `dedupe_key`
- original `source_url`
- crawler logs per source

### 4. Admin and Operator UI

Add `/admin` as a local operator workspace.

The admin UI will show:

- Source summary cards.
- Data source table with enabled status, cadence, latest run state, counts, and failures.
- SAM.gov manual “Run now” action.
- Recent crawler logs.
- English and Chinese labels.

Admin APIs will:

- List data sources with latest health/log summary.
- Patch source enablement.
- List recent crawler logs.
- Trigger crawler run through the shared orchestrator.

Authorization will be conservative:

- Server-side admin helper checks authenticated user role from SQLite.
- Local development may allow an explicit `ADMIN_UI_LOCAL_BYPASS=true`.
- Production defaults to denying non-admin access.
- APIs must not return secrets or raw environment values.

## Non-Goals

This stage will not add:

- Production queue infrastructure such as BullMQ, Redis, Celery, or hosted cron.
- Live SMTP delivery to real recipients.
- Real HTML/API scraping for the five state portals.
- Full role management UI.
- Source-specific browser automation.
- Production deployment, monitoring, or secret rotation.

## Data Model Additions

### `crawler_locks`

Purpose: prevent duplicate runs per source.

Fields:

- `source`
- `owner`
- `acquired_at`
- `expires_at`

Rules:

- One row per source.
- A lock is acquired if no row exists or `expires_at` is in the past.
- Only the owner may release its lock.

### `notification_outbox`

Purpose: persist notification attempts and prevent duplicate alert emails.

Fields:

- `id`
- `alert_id`
- `user_id`
- `channel`
- `recipient`
- `frequency`
- `dedupe_key`
- `subject`
- `body_text`
- `matched_bid_ids`
- `status`
- `attempt_count`
- `last_error`
- `created_at`
- `sent_at`

Rules:

- `dedupe_key` is unique.
- Daily digest dedupe key uses `alert_id + date + channel`.
- Weekly digest dedupe key uses `alert_id + ISO week + channel`.
- Immediate notifications use `alert_id + bid_id + channel` when that frequency is enabled.

## Data Flow

1. Admin clicks “Run now” or local worker starts a scheduled run.
2. Orchestrator attempts to acquire `crawler_locks[source]`.
3. If locked, returns skipped/locked status.
4. If acquired, runner imports source data and writes crawler logs.
5. On success, matcher finds enabled alerts with matching bids.
6. Notification service inserts deduplicated outbox rows.
7. Provider writes local notification payloads or logs to console.
8. Outbox rows and `alerts.lastNotifiedAt` are updated after send.
9. Orchestrator releases the lock.
10. Admin UI refreshes source health and recent logs.

## Error Handling

- Lock acquisition failure is not treated as system failure; it returns a controlled locked result.
- Runner failure releases the lock and skips matcher/notifications.
- Notification failure marks the outbox row as `failed` with `last_error`.
- Admin APIs return generic errors and avoid stack traces.
- File provider creates its target directory if missing.
- State fixture imports write failure crawler logs if a source loader or normalizer fails.

## Testing

Tests must cover:

- Lock acquire, stale replacement, and owner-only release.
- Orchestrator success, failure, and lock-skipped cases.
- Manual route uses the orchestrator rather than directly calling the SAM.gov runner.
- Notification outbox dedupe and status transitions.
- File provider writes stable payloads.
- Anonymous/no-email users are skipped for email notifications.
- State fixtures import CA/TX/NY/FL/IL with correct source, issuer type, state code, and dedupe key.
- Admin APIs enforce admin/bypass authorization.
- Admin page renders source health, run action, and i18n text without layout regressions.

## Acceptance Criteria

- `cd crawler && python3 -m pytest` passes.
- `cd frontend && npm test` passes.
- `cd frontend && npm run lint` passes.
- `cd frontend && npm run build` passes.
- A local developer can run one crawler pass from a script.
- A local developer can open `/admin`, view source health, toggle source enablement, and trigger SAM.gov.
- Matching alerts can produce local outbox notifications without duplicate sends.
- State fixture imports produce searchable state bids.

## Remaining After This Stage

After this stage, the major remaining functions will be:

1. Replace state fixtures with live state API/HTML adapters.
2. Add real SMTP or email service provider delivery.
3. Add production worker deployment and managed scheduling.
4. Add full admin role management.
5. Add operational monitoring, retries, and alerting for production incidents.
