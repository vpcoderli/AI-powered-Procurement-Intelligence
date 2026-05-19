# APSi State Crawler Fixture Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live-first bundled fixture fallback for CA/TX/NY/FL/IL state crawlers so local runs import demo data when public portals fail.

**Architecture:** Extend the Python `fetch-state` command with an explicit fallback flag and source-to-fixture resolver. Extend the TypeScript state runner to pass that flag from the Admin/API flow, keeping current live-only behavior available for tests and future production use.

**Tech Stack:** Python 3, pytest, SQLite, TypeScript, Vitest, Next.js route runner.

---

## File Structure

- Modify `crawler/apsi_crawler/cli.py`: add bundled fallback fixture resolution and retry-on-live-error behavior.
- Modify `crawler/tests/test_state_live_cli.py`: add red/green CLI tests for JSON and HTML fallback.
- Modify `frontend/src/server/crawler/state-runner.ts`: add `allowFixtureFallback` option and CLI argument.
- Modify `frontend/src/server/crawler/state-runner.test.ts`: assert fallback flag is passed only when enabled.
- Modify `frontend/src/app/api/crawler/state/run/route.ts`: enable fallback for Admin-triggered local state runs.
- Modify `frontend/src/app/api/crawler/state/run/route.test.ts`: cover route runner options.

## Tasks

### Task 1: Python CLI Fallback

- [ ] Add failing tests in `crawler/tests/test_state_live_cli.py`:
  - CA live failure with `--fallback-fixture` imports the bundled CA fixture.
  - IL live failure with `--fallback-fixture` imports the bundled IL HTML fixture.
  - Existing failure test without fallback still writes a failure log.
- [ ] Run `cd crawler && python3 -m pytest tests/test_state_live_cli.py`.
- [ ] Implement fixture resolver and fallback retry in `crawler/apsi_crawler/cli.py`.
- [ ] Run `cd crawler && python3 -m pytest tests/test_state_live_cli.py`.
- [ ] Commit with `feat: add state crawler fixture fallback`.

### Task 2: Frontend Runner Wiring

- [ ] Add a failing Vitest expectation that `runStateCrawler({ allowFixtureFallback: true })` includes `--fallback-fixture`.
- [ ] Implement `allowFixtureFallback` in `frontend/src/server/crawler/state-runner.ts`.
- [ ] Enable it from `frontend/src/app/api/crawler/state/run/route.ts` for Admin-triggered runs.
- [ ] Run `cd frontend && npm test -- src/server/crawler/state-runner.test.ts src/app/api/crawler/state/run/route.test.ts`.
- [ ] Commit with `feat: enable state crawler fallback from admin runs`.

### Task 3: Full Verification

- [ ] Run `cd crawler && python3 -m pytest`.
- [ ] Run `cd frontend && npm test`.
- [ ] Run `cd frontend && npm run lint`.
- [ ] Run `cd frontend && npm run build`.
- [ ] Trigger the local state crawler flow and verify bids/crawler logs in SQLite.
