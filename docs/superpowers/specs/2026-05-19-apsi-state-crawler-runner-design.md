# APSi State Crawler Runner Design

## Goal

Connect the existing state-source Python crawler adapters into the frontend "run crawler" flow so an operator can trigger CA, TX, NY, FL, and IL imports from the admin experience instead of running Python CLI commands manually.

## Confirmed Direction

Use approach A: add a reusable frontend state crawler runner that shells out to the existing Python CLI, then expose a single admin-triggered flow for the supported state sources.

This keeps the Python crawler as the source of truth for source-specific fetching and normalization. The frontend remains responsible for orchestration, locking, admin authorization, logs visibility, alert matching, and notifications.

## Current Context

The Python crawler already supports these live state sources:

- `ca_caleprocure`
- `tx_esbd`
- `ny_contract_reporter`
- `fl_mfmp`
- `il_bidbuy`

Each can be run through:

```bash
python3 -m apsi_crawler.cli fetch-state --database <database> --source <source> --limit <limit>
```

The frontend currently has:

- `runSamGovCrawler` in `frontend/src/server/crawler/sam-gov-runner.ts`.
- `runCrawlerSourceOnce` orchestration with source enablement checks, locks, matcher, and notifier.
- `POST /api/crawler/sam-gov/run`.
- Admin UI button that only calls the SAM.gov route.
- `crawler_logs` and data source admin views.

## Scope

This delivery will add state crawler execution into the frontend run path.

### State Runner

Create a state crawler runner module that runs the Python CLI with:

- `fetch-state`
- frontend SQLite database path
- source id
- optional `query`
- optional `limit`
- optional fixture args for tests only if useful

The runner should return the same shape expected by the existing orchestrator: `ok`, source label/id, status, stdout, stderr.

### Batch Run API

Add an API route that triggers the supported state crawler sources as one operator action.

Recommended route:

```text
POST /api/crawler/state/run
```

Default source order:

1. `ca_caleprocure`
2. `tx_esbd`
3. `ny_contract_reporter`
4. `fl_mfmp`
5. `il_bidbuy`

Each source should run through `runCrawlerSourceOnce` so existing enablement, locking, matcher, and notifier behavior remains consistent. A source failure should be represented in the response for that source without hiding results from sources that already ran.

### Admin UI Flow

Update the Admin page run action from a SAM.gov-only action to a state crawler action.

The UI can keep one main button. The button label should become a generic crawler run label such as "Run state crawlers" / "运行州级爬虫". The page should refresh data sources and logs after completion.

SAM.gov should not be removed. Its existing route and runner remain available, but this delivery focuses on adding the state crawler runner and connecting the admin button to the state batch route.

## Non-Goals

This delivery will not add:

- Browser-backed Playwright fetching.
- PDF/DOCX downloading or parsing.
- AI document summaries.
- Real SMTP changes.
- Production scheduler changes.
- A per-source run button UI.
- A full crawler queue system.
- SAM.gov API key setup or SAM.gov behavior changes.

## Architecture

### State Runner Module

Create:

```text
frontend/src/server/crawler/state-runner.ts
```

Responsibilities:

- Map frontend/admin source labels to Python crawler source ids.
- Build `python3 -m apsi_crawler.cli fetch-state ...` arguments.
- Use the same database path convention as `sam-gov-runner`.
- Run from the Python crawler directory.
- Return structured success/failure metadata.

The runner should not parse crawler output for counts. Counts are already persisted by the Python crawler into `crawler_logs`, and the admin view reads logs from the database.

### Batch Route

Create:

```text
frontend/src/app/api/crawler/state/run/route.ts
```

Responsibilities:

- Reuse the same authorization pattern as the SAM.gov run route.
- Parse optional JSON body:
  - `sources?: string[]`
  - `limit?: number`
  - `query?: string`
- Default to all five supported state sources.
- For each requested source:
  - Create a source-specific state runner.
  - Call `runCrawlerSourceOnce`.
  - Continue to the next source even if one source fails or is disabled/locked.
- Return a multi-source JSON result with per-source statuses.

### API Client

Update:

```text
frontend/src/lib/api/admin.ts
```

Add a state crawler client function, for example:

```ts
runStateCrawlersNow()
```

It should call:

```text
POST /api/crawler/state/run
```

### Admin Page

Update:

```text
frontend/src/app/admin/page.tsx
```

Replace the SAM.gov-only run button call with `runStateCrawlersNow`.

The run message should be generic enough for batch state runs. The existing table/log refresh behavior should remain.

### Worker Script

Do not change the recurring worker in this delivery unless tests reveal a small shared helper is needed. The worker can continue to run SAM.gov only until a later scheduling phase decides the production cadence for state crawlers.

## Error Handling

The state batch API should:

- Return `401` for unauthorized requests using the existing token/admin pattern.
- Return `200` if the batch route itself executed and produced per-source results, even when one or more sources failed.
- Include each source result with a status such as `success`, `failure`, `locked`, or `disabled`.
- Return `500` only for route-level unexpected errors that prevent the batch from running.

This makes the admin UI able to show partial completion instead of treating one flaky portal as total failure.

## Testing

Tests should cover:

- `state-runner` builds the expected Python CLI args for each source.
- `state-runner` returns failure metadata when `execFile` errors.
- State batch route authorizes the same way as the SAM.gov run route.
- State batch route defaults to the five supported state sources.
- State batch route passes `limit` and `query` into each source runner.
- State batch route continues after a source failure and returns per-source results.
- Admin API client calls `/api/crawler/state/run`.
- Admin page run button uses the state crawler client and refreshes after completion.
- Existing SAM.gov route tests continue to pass.

## Acceptance Criteria

- An operator can click the Admin page run button and trigger CA/TX/NY/FL/IL state imports.
- The route response includes per-source results.
- Existing source enablement and locking still apply.
- Crawler logs are written by the underlying Python crawler and remain visible in the admin log table.
- Existing SAM.gov run route remains available.
- Frontend tests pass.
- Frontend lint passes.
- Frontend build passes.
- Crawler tests pass.

## Remaining After This Delivery

After this delivery, remaining crawler/product work will be:

1. Add scheduled state crawler execution to the worker.
2. Add per-source run controls if operators need finer manual control.
3. Add Playwright/browser-backed fetching for portals where public HTTP/HTML is insufficient.
4. Add PDF/DOCX downloading and text extraction.
5. Add AI summaries and compliance/risk extraction from documents.
6. Add real SMTP/email delivery.
7. Add production retry policy and crawler health alerting.
