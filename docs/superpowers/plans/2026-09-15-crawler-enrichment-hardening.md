# Crawler Enrichment Hardening Implementation Plan

> **For agentic workers:** Use subagent-driven-development and test-driven-development. The user authorized parallel implementation of the reviewed defects. Work in this shared checkout with explicit file ownership; preserve existing user artifacts and documentation. Do not commit or operate on business data.

**Goal:** Make the existing list-to-detail-to-database flow preserve useful data, report truthful outcomes, and run safely in local and container environments.

**Architecture:** Retain the Python fetch-task contract and parser-only sidecar. Repair content quality and provenance at normalization/merge boundaries, make database persistence atomic and observable, and unify execution controls. Verify with offline portal fixtures, isolated SQLite/MySQL, runtime smoke checks, full tests, lint and build.

**Tech Stack:** Python/pytest, Scrapling, TypeScript/Vitest, Next.js, SQLite/MySQL, Docker Compose, GitHub Actions.

## Shared contract

- Existing `raw_payload.enrichment.fields` remains extraction diagnostics.
- Add `raw_payload.enrichment.applied_fields` containing exact snake_case bid fields applied by enrichment (including intentional null clears), including `attachments` when applicable. Use this to distinguish parsed fields from enriched values. Preserve provenance across list-only reimports.
- Missing/placeholder long descriptions must not hide useful short descriptions; newer actual detail content may update previous detail values, but list-only content must not downgrade them.
- An extraction failure remains fail-open. A persistence failure makes the whole source result unsuccessful; never notify or mark source success before durable persistence.
- Retain valid date-filtered zero-row successes with a log; raw empty fetch remains failure.

## Task A — extraction and content correctness (agent)

**Ownership:** `crawler/`, `services/scrapling-extractor/`, frontend bid display helper and detail page only.

- [x] Add failing tests using the IL list fixture and captured detail HTML for placeholder descriptions, contact subfields, incremental attachments, two-digit dates, lost query IDs and same-URL login content.
- [x] Repair normalization and merge rules, retain parser-only behavior, emit applied-field provenance and meaningful diagnostics.
- [x] Add a shared display rule that handles legacy title echoes and duplicate short/long descriptions; verify it in frontend tests.
- [x] Run crawler and extractor suites plus focused frontend tests.

## Task B — atomic persistence and truthful results (agent)

**Ownership:** JSON importers, shared persistence module, associated tests and new persistence helper modules.

- [x] Add failing regressions for nonempty list downgrades, full-description title echoes, attachment shrinkage/archive metadata, diagnostics loss, partial write rollback, import failures, and date-filtered empty results.
- [x] Merge bid content by field provenance; merge attachments by stable identity/URL while preserving archive data; make bid/attachment/log persistence transactional in both dialects.
- [x] Return explicit persistence errors and preserve a queryable failure log when possible; accept explained empty successes consistently.
- [x] Run importer and persistence suites and report MySQL connection requirements for integration tests.

## Task C — execution controls and scheduling (agent)

**Ownership:** orchestrator, lock repository, state runner, source registry, scheduler, health/failure modules, configured runner, crawler run routes, crawler-worker script, related tests.

- [x] Add failing tests for long tasks/lock renewal, runtime timeout, missing run credentials, county/city approval parity, manual health writeback, first-failure backoff, batch isolation and retry classification.
- [x] Add lease renewal/cancellation behavior and finite task timeout; use consistent authorization and governance at both manual and scheduled entry points.
- [x] Unify health outcome recording and error classification; preserve partial enrichment as observable metadata without treating it as failed list ingestion.
- [x] Run affected tests and report interfaces needed by integration work.

## Task D — runtime, CI, integration and final review (root)

**Ownership:** Dockerfiles/Compose/root Docker ignore, CI, new integration tests and verification scripts, documentation. Coordinate any additional edits to owned files.

- [x] Provide crawler Python/source dependencies in the app runtime and a runnable worker service; isolate extractor binding appropriately for host/container modes.
- [x] Add Python/extractor CI and an offline cross-language regression that uses actual list/detail fixtures and verifies database/display behavior after a repeat list import.
- [x] Verify real MySQL behavior in an isolated disposable database where the local environment supports it; never seed or alter business databases.
- [x] Run full frontend tests, lint, production build, crawler/extractor tests, type checks and container smoke where available. (2026-09-16: see `docs/operations/crawler-hardening-verification.md`.)
- [x] Perform independent spec and code review, address findings, and update the logic document to distinguish fixed behavior from external validation limits. (2026-09-16: three parallel Opus 5 reviewers — Python enrichment, TS persistence/lease, container/CI — 11 defects fixed, remaining boundaries recorded in `docs/architecture/crawler-enrichment-flow.md` §7.)
