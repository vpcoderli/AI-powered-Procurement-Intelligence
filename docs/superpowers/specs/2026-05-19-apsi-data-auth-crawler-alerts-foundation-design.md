# APSi Data, Auth, Crawler, And Alerts Foundation Design

## 1. Purpose

This design defines the next APSi local development slice after the API-backed MVP and local saved-bids persistence work.

The goal is to move four remaining functional areas forward together without creating conflicting implementations:

- Real database foundation.
- User account system.
- Real data ingestion and crawler foundation.
- Saved search alerts.

These areas share the same core state: users, bids, saved bids, search alert definitions, and crawler run logs. The implementation should therefore start with a shared local database foundation, then let the other feature lines build against stable repository and service boundaries.

## 2. Current State

The project currently runs as a single Next.js application under `frontend/`.

Implemented behavior:

- Search, filters, bid detail, saved bids, and bilingual UI.
- Next.js API routes for bids and saved bids.
- Local JSON persistence for saved bids under `frontend/data/saved-bids.json`.
- Anonymous saved-bids isolation through the `apsi_user_id` cookie.

Current limitations:

- Bid data still comes from `frontend/src/lib/mock-data.ts`.
- There is no real database or migration system.
- There is no registration, login, logout, or authenticated session.
- `/search` saved search alerts are front-end mock state only.
- There is no crawler project, source registry, run log, or importer.

## 3. Design Principles

- Preserve the current front-end API response shapes where possible.
- Keep local development easy for one full-stack developer.
- Prefer a small, testable local database slice over a production infrastructure jump.
- Keep crawler work out of the Next.js request lifecycle.
- Keep authentication local-MVP scoped, not production-complete.
- Avoid promising email notification delivery until scheduling, users, and matching are stable.
- Keep data-source, crawler, and database boundaries replaceable so PostgreSQL can be adopted later.

## 4. Recommended Architecture

Use SQLite with Drizzle ORM for the local MVP database foundation.

Recommended local database file:

```text
frontend/data/apsi.sqlite
```

Recommended dependencies:

- `drizzle-orm`
- `drizzle-kit`
- `better-sqlite3`

Recommended scripts:

- `db:generate`
- `db:migrate`
- `db:seed`

SQLite is intentionally a local development choice. The production direction can still be PostgreSQL, especially once real crawler throughput, full-text search, and deployment infrastructure are ready.

## 5. Database Model

### 5.1 `users`

Stores both anonymous-local and registered users.

Fields:

- `id`
- `email`
- `password_hash`
- `display_name`
- `role`
- `created_at`
- `updated_at`
- `last_login_at`

Rules:

- Anonymous users may have no email or password hash.
- Registered users must have a normalized unique email and password hash.
- User IDs should use explicit prefixes such as `anon_` and `user_`.

### 5.2 `sessions`

Stores authenticated session metadata.

Fields:

- `id`
- `user_id`
- `token_hash`
- `expires_at`
- `created_at`
- `last_seen_at`

Rules:

- The browser stores only the raw session token in an HttpOnly cookie.
- The database stores only a hash of the token.
- Login and registration create a fresh session.
- Logout deletes the session and clears the cookie.

### 5.3 `bids`

Stores normalized bid records.

Fields:

- `id`
- `source`
- `source_bid_id`
- `dedupe_key`
- `title`
- `description`
- `full_description`
- `original_category`
- `amount`
- `amount_min`
- `amount_max`
- `currency`
- `published_date`
- `deadline_date`
- `issuer_name`
- `issuer_type`
- `state_code`
- `contact_name`
- `contact_email`
- `contact_phone`
- `source_url`
- `is_active`
- `raw_payload`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Rules:

- `source + source_bid_id` should be unique when `source_bid_id` exists.
- `dedupe_key` should always be unique.
- `saved` is not stored on the bid row; it is derived per user.

### 5.4 `bid_attachments`

Stores bid attachment links.

Fields:

- `id`
- `bid_id`
- `name`
- `url`
- `size_label`
- `mime_type`
- `sort_order`
- `created_at`

Rules:

- MVP stores source or direct download links only.
- MVP does not download, parse, summarize, or understand attachment files.

### 5.5 `saved_bids`

Replaces `frontend/data/saved-bids.json`.

Fields:

- `user_id`
- `bid_id`
- `created_at`

Rules:

- Primary key is `user_id + bid_id`.
- Save is idempotent.
- Unsave is idempotent.
- Users can only access their own saved bids.

### 5.6 `alerts`

Stores saved search alert definitions.

Fields:

- `id`
- `user_id`
- `name`
- `query`
- `states`
- `issuer_type`
- `deadline_preset`
- `published_preset`
- `frequency`
- `notification_channel`
- `is_enabled`
- `last_matched_at`
- `last_notified_at`
- `created_at`
- `updated_at`

Rules:

- `query` and `states` may be stored as JSON text in SQLite.
- MVP supports create, list, enable or disable, and delete.
- MVP does not send real email.
- Email-related fields are stored so notification delivery can be added later.

### 5.7 `crawler_logs`

Stores crawler/importer run status.

Fields:

- `id`
- `source`
- `run_id`
- `status`
- `started_at`
- `finished_at`
- `duration_ms`
- `fetched_count`
- `inserted_count`
- `updated_count`
- `skipped_count`
- `failed_count`
- `error_code`
- `error_message`
- `error_stack`
- `metadata`

Rules:

- Every importer run should write a log row.
- Failed source imports should not block other source imports.

### 5.8 `data_sources`

Stores procurement source metadata.

Fields:

- `id`
- `label`
- `issuer_type`
- `state_code`
- `base_url`
- `is_enabled`
- `cadence`
- `last_success_at`
- `last_failure_at`
- `consecutive_failures`
- `created_at`
- `updated_at`

Rules:

- Source metadata should eventually replace hard-coded state/source filters.
- MVP can seed SAM.gov and the currently mocked state sources first.

## 6. Data Seeding And Migration

The current `MOCK_BIDS` data should become seed input, not runtime source of truth.

Implementation requirements:

- Seed all current mock bids into `bids`.
- Seed all current mock attachments into `bid_attachments`.
- Preserve the current public bid IDs initially so routes like `/bids/1` keep working.
- Preserve display fields such as `amount` to avoid UI churn.
- Parse `amount_min` and `amount_max` when practical; leave them null when parsing is ambiguous.
- Do not store `saved` on bid rows.
- Create or preserve test/default users only through explicit seed logic.
- Repeat seed runs must not duplicate bids or attachments.

## 7. User Account System

### 7.1 Scope

Local MVP account features:

- Register with email and password.
- Log in with email and password.
- Log out.
- Fetch current session.
- Use authenticated session for saved bids and alerts.
- Merge anonymous saved bids into the account on register or login.

Out of scope:

- Email verification.
- Password reset.
- OAuth.
- 2FA.
- Admin roles and permissions UI.
- Production rate limiting.

### 7.2 Cookies

Session cookie:

```text
apsi_session
```

Requirements:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Secure` only in production

The existing anonymous cookie `apsi_user_id` should remain available for anonymous saved bids and anonymous alerts until the user authenticates.

### 7.3 Passwords

Use Node's built-in `crypto.scrypt` with per-user salt for the local MVP.

Rules:

- Never store plain text passwords.
- Do not return password hash or salt to clients.
- Login errors should not reveal whether the email exists.

### 7.4 Anonymous Migration

On successful register or login:

- Resolve the current anonymous user ID from `apsi_user_id` if present.
- Merge anonymous saved bids into the authenticated user's saved bids.
- Merge anonymous alerts into the authenticated user's alerts when alerts exist.
- Use set-union behavior to avoid duplicates.
- Clear the anonymous cookie after successful migration.

## 8. Saved Search Alerts

The `/search` page should become a persisted saved search alert management page.

Minimum behavior:

- Load alerts from `GET /api/search-alerts`.
- Create an alert from basic form inputs through `POST /api/search-alerts`.
- Enable or disable an alert through `PATCH /api/search-alerts/[id]`.
- Delete an alert through `DELETE /api/search-alerts/[id]`.
- Show loading, empty, and error states.
- Support English and Chinese UI text.

Email delivery is not included in this slice.

The UI should avoid promising that emails are already being sent. It can describe alerts as saved notification preferences or saved searches until delivery is implemented.

## 9. Crawler Foundation

### 9.1 Scope

The first crawler slice should build the smallest real ingestion loop:

- SAM.gov importer or fixture-backed importer.
- Source registry entry for SAM.gov.
- Normalization into the internal bid shape.
- Database UPSERT into `bids` and `bid_attachments`.
- Run log writing into `crawler_logs`.
- Manual CLI command.

The first slice should not attempt 40+ state portals.

### 9.2 Project Location

Crawler code should live outside the Next.js request code.

Recommended directory:

```text
crawler/
```

Recommended structure:

```text
crawler/
  requirements.txt
  apsi_crawler/
    config.py
    cli.py
    normalizers/
      bids.py
    sources/
      registry.py
    spiders/
      sam_gov.py
    storage/
      sqlite.py
  tests/
    fixtures/
    test_normalizers.py
    test_sam_gov.py
    test_storage.py
```

The crawler should target the same SQLite database during local MVP development. The database access layer should be narrow enough that PostgreSQL can replace it later.

### 9.3 State Portal Expansion

After SAM.gov works end to end, add:

- One static HTML state source.
- One JavaScript-rendered state source if needed.
- Per-source failure isolation.
- Source health summary endpoint.

## 10. API Design

### 10.1 Existing Bid APIs

Keep current response shapes:

- `GET /api/bids`
- `GET /api/bids/[id]`
- `GET /api/saved-bids`
- `POST /api/saved-bids`
- `DELETE /api/saved-bids/[id]`

The implementation can become async internally.

### 10.2 Auth APIs

Add:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

Optional account APIs in this slice:

- `PATCH /api/account/profile`
- `POST /api/account/password`

### 10.3 Search Alert APIs

Add:

- `GET /api/search-alerts`
- `POST /api/search-alerts`
- `PATCH /api/search-alerts/[id]`
- `DELETE /api/search-alerts/[id]`

All search alert APIs must be user-scoped. Anonymous user scope is allowed until full authentication is adopted by the UI.

### 10.4 Crawler Health API

Optional after crawler log storage exists:

- `GET /api/health/scrapers`

Returns recent source run status and failure summaries.

## 11. Parallel Development Plan

The four feature lines can run in parallel only after the shared database contract is established.

Recommended ordering:

1. Database foundation.
2. Bid repository and saved-bids migration to DB.
3. Auth server/API and anonymous migration.
4. Search alerts API and page integration.
5. Crawler scaffold and SAM.gov importer.
6. Full integration and browser acceptance.

Recommended agent ownership:

- Agent A owns database schema, migrations, seed, and DB client.
- Agent B owns bid repository and saved-bids DB migration.
- Agent C owns authentication and session flows.
- Agent D owns search alerts.
- Agent E owns crawler scaffold and importer.

To reduce conflicts:

- Only Agent A edits `frontend/src/server/db/*` and migration files during the first pass.
- Only one agent edits `frontend/src/server/bids/repository.ts` at a time.
- Search alerts should not modify auth internals.
- Auth should expose a stable current-principal helper for saved bids and alerts.
- Crawler should not edit UI pages.

## 12. Testing Strategy

### 12.1 Database

- Migration smoke test on empty temp SQLite database.
- Seed test verifies current six mock bids and attachments.
- Repeat seed test verifies no duplicate bids or attachments.
- Repository tests use isolated temp SQLite databases.

### 12.2 Bids And Saved Bids

- Search, filter, sort, and detail tests continue to pass with DB data.
- Saved bid save/unsave remains idempotent.
- Saved bids are isolated by user ID.
- API response shapes remain compatible.

### 12.3 Auth

- Password hash and verify tests.
- Register, login, logout, and session route tests.
- Invalid credentials do not leak whether email exists.
- Anonymous saved bids merge into account on register or login.

### 12.4 Alerts

- Alert create/list/toggle/delete tests.
- Owner isolation tests.
- Anonymous and authenticated principal tests.
- Client API tests for request shape and errors.
- `/search` loading, empty, error, and bilingual browser checks.

### 12.5 Crawler

- Normalizer fixture tests.
- SAM.gov fixture importer tests.
- UPSERT idempotency tests.
- Run log success and failure tests.

### 12.6 Final Verification

- `npm test`
- `npm run lint`
- `npm run build`
- Browser acceptance for:
  - Search and detail.
  - Save and saved page.
  - Register/login/logout.
  - Saved-bid migration after login.
  - Search alert create/toggle/delete.
  - Chinese and English switch.
  - Mobile width sanity check.

## 13. Risks

- Moving `queryBids` from synchronous mock data to async DB access touches API tests and route handlers.
- SQLite is sufficient for local MVP but not final production crawler throughput.
- Real SAM.gov access may require an API key and careful rate limits.
- State portal work is heterogeneous and should not be estimated from SAM.gov alone.
- Alert email delivery is intentionally deferred; UI copy must not overpromise.
- Authentication is local-MVP only and will need hardening before production.

## 14. Acceptance Criteria

- Database schema and seed exist and can recreate local data from scratch.
- Current bid APIs read from the database while preserving front-end behavior.
- Saved bids use the database instead of JSON file persistence.
- A user can register, log in, log out, and keep saved bids associated with their account.
- Anonymous saved bids merge into the account on register or login.
- `/search` uses persisted search alerts rather than front-end mock state.
- Crawler foundation can import or fixture-import SAM.gov-shaped data into the database and record run logs.
- Full tests, lint, build, and browser acceptance pass.
