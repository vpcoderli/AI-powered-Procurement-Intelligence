# SAM.gov Real Import and Alert Matching Design

## Goal

Build the next local-development stage for APSi procurement intelligence: import real SAM.gov opportunity data into SQLite, expose a controlled manual trigger from the frontend backend, and add the first alert matching pass that records when saved search alerts have matching bids.

## Current Context

The crawler package already imports SAM.gov fixture JSON into the shared SQLite schema. The frontend already reads bids, saved bids, scraper health logs, and saved search alerts from SQLite. The missing layer is the production-facing import path: fetching from SAM.gov, triggering it safely from the app backend, and connecting newly imported bids to saved alert metadata.

Official SAM.gov public opportunities documentation defines:

- Production endpoint: `https://api.sam.gov/opportunities/v2/search`
- Required API key parameter: `api_key`
- Required posted date range parameters: `postedFrom` and `postedTo`
- Date format: `MM/dd/yyyy`
- Pagination: `limit` and `offset`
- Maximum documented page limit: 1000

Source: https://open.gsa.gov/api/get-opportunities-public-api/

## Scope

This stage will add:

1. A Python SAM.gov API client/fetcher.
2. A crawler CLI command for real SAM.gov imports.
3. Failure and success crawler log entries for the real importer.
4. A frontend server route that manually starts the SAM.gov import.
5. A search alert matcher that evaluates enabled alerts against current bids and updates `lastMatchedAt`.
6. Tests for the Python importer, CLI behavior, frontend runner, manual route, and alert matcher.

## Non-Goals

This stage will not add:

- Email or SMS notification delivery.
- A production scheduler or background worker daemon.
- SAM.gov attachment downloading.
- State procurement crawlers.
- Admin role management or a full operations console.
- Deployment automation.

Those remain separate stages after the local functional foundation is complete.

## Architecture

### Python Crawler

Add a focused SAM.gov API module that knows how to call the public opportunities endpoint, paginate with `limit` and `offset`, validate the required API key/date inputs, and normalize each returned `opportunitiesData` record through the existing SAM.gov normalizer.

The existing fixture loader remains unchanged for tests and offline development. The new CLI command will share the same SQLite upsert and crawler log writer used by fixture imports.

### Frontend Manual Trigger

Add a backend-only Next.js route:

`POST /api/crawler/sam-gov/run`

The route starts the Python crawler command with the shared SQLite database path. It never returns or logs the SAM.gov API key. If `CRAWLER_RUN_TOKEN` is configured, the route requires either `Authorization: Bearer <token>` or `x-crawler-token: <token>`. If the token is not configured, the route remains available for local development.

The route returns structured run metadata:

- `ok`
- `source`
- `status`
- `stdout`
- `stderr`

### Alert Matching

Add a server-side matcher that:

1. Loads enabled alerts.
2. Parses each alert's stored bid query.
3. Reuses the same bid filtering semantics as search where practical.
4. Updates `lastMatchedAt` and `updatedAt` only for alerts with at least one match.
5. Returns counts for evaluated alerts, matched alerts, and updated alerts.

This is intentionally metadata-only. No notification is sent in this stage.

## Data Flow

1. Operator or local developer calls `POST /api/crawler/sam-gov/run`.
2. Next.js backend starts `python3 -m apsi_crawler.cli fetch-sam-gov`.
3. Python fetcher calls SAM.gov with `api_key`, `postedFrom`, `postedTo`, `limit`, and `offset`.
4. Returned opportunities are normalized and upserted into `bids`.
5. The crawler writes a `crawler_logs` row with success or failure status.
6. Alert matching evaluates enabled alerts against the updated bid table and updates `lastMatchedAt` for matching alerts.
7. Existing health endpoint can show the latest crawler log by source.

## Error Handling

- Missing SAM.gov API key fails before any network request.
- Invalid or failed SAM.gov responses raise a typed crawler error and write a failure crawler log.
- Manual trigger route returns generic API errors and does not expose secrets.
- Alert matching skips disabled alerts and treats malformed stored queries as keyword searches through the existing parsing fallback.

## Testing

Python tests:

- API fetcher builds the documented SAM.gov parameters.
- Fetcher paginates until the requested maximum or total records is reached.
- Fetcher raises a clear error for non-200 responses.
- CLI real import writes bids and success logs.
- CLI failure path writes a failure log.

Frontend tests:

- Runner builds the correct Python command and environment.
- Manual route enforces `CRAWLER_RUN_TOKEN` when configured.
- Manual route returns success metadata.
- Alert matcher updates enabled matching alerts.
- Alert matcher leaves disabled or non-matching alerts untouched.

## Acceptance Criteria

- `python3 -m pytest` passes in `crawler`.
- Frontend unit/route tests pass.
- `npm run lint` passes in `frontend`.
- `npm run build` passes in `frontend`.
- A developer can run real import locally with `SAM_API_KEY` configured.
- The app exposes a manual SAM.gov import endpoint without leaking the key.
- Matching saved alerts receive a fresh `lastMatchedAt`.

## Remaining After This Stage

After this stage, local functional development will still need:

1. Production scheduler or background job execution.
2. Real email notification delivery for matched alerts.
3. State procurement source crawlers.
4. Admin/operator UI for crawler runs and source management.
5. Deployment, monitoring, and production secret management.
