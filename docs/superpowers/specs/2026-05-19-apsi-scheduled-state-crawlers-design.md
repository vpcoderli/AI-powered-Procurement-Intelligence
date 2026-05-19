# APSi Scheduled State Crawlers Design

## Goal

Extend the local crawler worker so scheduled runs include CA, TX, NY, FL, and IL state crawlers in addition to SAM.gov.

## Context

The app already has:

- `runCrawlerSourceOnce`, which handles source enablement, locks, alert matching, and notification enqueueing.
- `runSamGovCrawler`, used by the manual SAM.gov route and worker scripts.
- `runStateCrawler` and `createStateCrawlerRunner`, which execute `python3 -m apsi_crawler.cli fetch-state`.
- `POST /api/crawler/state/run`, which manually runs CA/TX/NY/FL/IL through the same orchestrator.

The missing piece is local scheduled execution. `frontend/scripts/crawler-worker.ts` currently loops on SAM.gov only, and `frontend/scripts/run-crawler-once.ts` can only run SAM.gov once.

## Chosen Approach

Use Approach A: expand the existing crawler worker.

The worker will run the configured source list in this order:

1. `SAM.gov`
2. `ca_caleprocure`
3. `tx_esbd`
4. `ny_contract_reporter`
5. `fl_mfmp`
6. `il_bidbuy`

Each source runs through `runCrawlerSourceOnce`. A failure, disabled source, or lock for one source is recorded in that source result and does not prevent later sources from running. The worker sleeps only after a full pass completes.

## Architecture

Create a small shared TypeScript module under `frontend/src/server/crawler/` that defines configured crawler sources and exposes `runConfiguredCrawlerSourcesOnce`.

This helper will:

- Accept the app database, owner string, matcher, notifier, and optional runner options.
- Build a runner for SAM.gov and one runner for each state source.
- Run sources sequentially to avoid overloading public procurement portals.
- Return an array of `RunCrawlerSourceOnceResult` values.

The scripts will become thin wrappers:

- `frontend/scripts/run-crawler-once.ts` runs one full pass, prints JSON, and exits non-zero if any source fails.
- `frontend/scripts/crawler-worker.ts` loops full passes with the existing `CRAWLER_WORKER_INTERVAL_MS`.

## Configuration

Keep configuration minimal for this local-development stage.

- Default state crawler limit remains the state runner default.
- Allow `STATE_CRAWLER_LIMIT` to override the state runner limit for worker and one-shot script runs.
- Keep `CRAWLER_OWNER` and `CRAWLER_WORKER_INTERVAL_MS`.
- Do not introduce per-source cron schedules in this stage.

## Error Handling

The shared helper does not throw for ordinary source failures. It returns per-source results, matching the manual state route behavior.

The CLI scripts only exit non-zero when at least one returned result has `status: "failure"`. Locked or disabled sources are operational states, not process failures.

Unexpected script-level errors still print to stderr and set `process.exitCode = 1`.

## Testing

Add unit tests for the shared configured runner:

- Runs SAM.gov first, then CA/TX/NY/FL/IL.
- Continues after one source returns failure.
- Passes state crawler limit from options.

Add script-level or helper-export tests only if needed to keep behavior observable without sleeping loops.

Verification must include:

- Targeted Vitest tests for crawler configured runner and existing route/orchestrator coverage.
- Full frontend test suite.
- Frontend lint.
- Frontend build.
- Python crawler test suite.

## Out of Scope

- Hosted cron or production deployment configuration.
- Per-source scheduling cadence.
- Parallel source execution.
- UI controls for individual state crawler scheduling.
- Retry queues beyond existing lock and result handling.
