# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

APSi (AI-powered Procurement Intelligence) is a monorepo with two subsystems:

- **`frontend/`** — Full-stack Next.js 16 app (TypeScript, React 19, Tailwind CSS v4, shadcn/ui, Drizzle ORM). Serves the web UI, all API routes, and the background worker scripts.
- **`crawler/`** — Python bid aggregation engine: 50 state portal sources plus a SAM.gov adapter. Only stdlib + `requests` + `pytest` (see `crawler/requirements.txt`).

The frontend is the primary active subsystem. It **invokes the crawler as a subprocess** (`python3 -m apsi_crawler.cli fetch-task`, fed a JSON task payload on stdin by `frontend/src/server/crawler/state-runner.ts` — not `fetch-state`/argv, which was retired), so the two are coupled at the JSON task-contract boundary, not just via the database. The crawler CLI can also be run standalone.

## Frontend Commands

All commands run from the `frontend/` directory.

```bash
npm run dev                      # Next.js dev server (localhost:3000)
npm run build && npm run start   # Production build (build also typechecks — there is no separate typecheck script)
npm run lint                     # ESLint (flat config, no path arg needed)
npm run test                     # Vitest suite (~300 test files; discovery limited to src/, scripts/ and the root so .next/standalone copies are skipped)
npm run test:crawler-integration # Opt-in offline cross-language pipeline test. Needs ONE Python >= 3.10 interpreter with BOTH crawler/requirements.txt and services/scrapling-extractor/requirements.txt installed (CRAWLER_INTEGRATION_PYTHON); CRAWLER_INTEGRATION_MYSQL_URL (root-level URL, no schema) adds the real-MySQL cases, which create and drop a random apsi_crawler_test_* database
npm run db:migrate               # Apply schema migrations to SQLite
npm run db:seed                  # Seed demo data
npm run auth:reset-admin         # Reset admin password
npm run crawler:once             # One-shot run of every configured source (SAM.gov + 50 states)
npm run worker:crawler           # Continuous crawler daemon
npm run worker:events            # Event outbox daemon
npm run worker:notifications     # Notification delivery daemon
npm run worker:attachments       # Attachment archive/repair daemon (6 h)
npm run attachments:repair:once  # One attachment repair pass, then exit
npm run workers:check            # Non-blocking health check of all four workers
npm run source:health:check      # Verify scraper source liveness
npm run i18n:check               # i18n coverage scan (see i18n section)
npm run billing:stripe:sandbox   # Stripe E2E sandbox test
npm run risk:check               # Data/entitlement risk gate + secrets scan + npm audit (also CI merge gate)
```

`STATE_CRAWLER_LIMIT=5` caps records fetched **per source**, not the number of sources — useful to keep `crawler:once` short.

Run a single Vitest file:
```bash
cd frontend && npx vitest run src/server/intents/service.test.ts
```

MySQL-specific commands (see `docs/operations/mysql-cutover.md`):
```bash
npm run db:mysql:migrate         # Apply the MySQL-translated schema
npm run db:mysql:smoke           # MySQL runtime smoke test
npm run db:mysql:import-sqlite   # Copy a local SQLite DB into MySQL
```

### Docker / CI

```bash
docker compose up --build                                        # Web app + Scrapling sidecar (repo root), http://localhost:3000
docker compose --profile workers up -d crawler-worker            # Opt-in scheduled crawler worker (SQLite dev topology)
docker compose --profile workers up -d browser-downloader attachment-worker  # Opt-in attachment archiving/repair + its headless-browser sidecar
docker build -f frontend/Dockerfile --target runner -t apsi-web .      # Build context is the REPO ROOT, not frontend/
docker build -f frontend/Dockerfile --target worker -t apsi-worker .
```

`.github/workflows/ci.yml` runs on every push/PR: the `frontend` job (`npm ci`, `lint`, `test`, `build`, seed a throwaway SQLite DB, `npm run risk:check` as a merge gate), a `crawler` job (pytest for `crawler/` and `services/scrapling-extractor/` on Python 3.12), a `crawler-runtime` job (builds the `worker` image and smoke-runs the Python CLI and `worker:crawler:check` inside it), and a `crawler-integration` job (`npm run test:crawler-integration` against a MySQL 8 service: real list fixture → real adapter → HTTP extractor → CLI JSON → both importers). CI deliberately does **not** set `NODE_ENV=production` — production mode makes `risk:check` additionally require real-world data-source legal/approval review, which seed data cannot satisfy (that stricter gate belongs to the release checklist).

`frontend/Dockerfile` is built from the repository root and has three useful targets: `crawler-runtime` (node:20-alpine + a Python venv with `crawler/requirements.txt`, `/crawler/apsi_crawler`, tzdata; bakes `CRAWLER_DIRECTORY=/crawler` and `CRAWLER_PYTHON_BIN`), `runner` (Next.js `output: "standalone"` web process on top of it, so API-triggered crawls work in the container) and `worker` (full `node_modules` + `tsx` + `src/` + `scripts/`; default command is the crawler worker, override for `worker:events` / `worker:notifications` / `crawler:once`). `.dockerignore` at the repo root keeps `.env*`, `node_modules`, `.next`, `.venv` and `frontend/data` out of the context. `docker-compose.yml` is local/demo parity only (SQLite, sidecar internal-only, worker behind the `workers` profile, no admin bypass); production topology lives in `docs/operations/aws-deployment-runbook.md`.

## Crawler Commands

```bash
cd crawler
pip install -r requirements.txt                  # requirements-runtime.txt (requests only) is what the container images install
pytest                                              # All tests
PYTHONPATH=. pytest tests/test_generic_state.py     # One test file
echo '{"task_id":"t1","source_id":"ca_caleprocure","label":"California Cal eProcure","state_code":"CA","provider_family":null,"fetch_config":{"base_url":"https://caleprocure.ca.gov"},"limit":25,"query":null}' \
  | python -m apsi_crawler.cli fetch-task           # reads a JSON task payload from stdin, writes a JSON result to stdout
python -m apsi_crawler.cli fetch-sam-gov --posted-from 2026-07-01 --posted-to 2026-07-28
python -m apsi_crawler.cli validate-state-live --source ca_caleprocure          # repeatable; defaults to all beta sources
python -m apsi_crawler.cli import-fixture --database <path> --fixture <path>
echo '{"base_url":"https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids","label":"Franklin County, OH (BidNet)","state_code":"OH","provider_family":"bidnet"}' \
  | python -m apsi_crawler.cli discover-tenant      # read-only tenant-path probe; suggests a base_url, never writes one
echo '{"base_url":"https://www.bidnetdirect.com/x"}' | python -m apsi_crawler.cli fetch-robots   # robots.txt via the crawler's HTTP client
echo '{"platform":"bidnet","states":["OH"],"max_pages":20}' \
  | python -m apsi_crawler.cli discover-sources > candidates.json   # read-only agency-directory walk; emits SourceCandidate JSON for `npm run source:register`
```

Those eight subcommands — `import-fixture`, `fetch-sam-gov`, `validate-state-live`, `fetch-task`, `archive-attachments`, `discover-tenant`, `fetch-robots`, `discover-sources` — are the complete CLI surface (`build_parser()` in `crawler/apsi_crawler/cli.py`). The last five all use the same stdin-JSON → stdout-JSON contract as `fetch-task`. `fetch-robots` exists because WAF-fronted portals (BidNet Direct) reject Node's `fetch` outright while serving the crawler's `requests` client, so the admin pre-check and `source:compliance:scan` fetch robots.txt through the crawler (`src/server/admin/crawler-robots-fetch.ts`; `--node-fetch` opts out in the script).

## Architecture

### The dual SQLite / MySQL runtime (read this first)

This is the single most important thing to understand before touching server code. The app runs on **two independent data-access paths**, chosen at runtime by `isMysqlDatabaseUrlConfigured()` (true when `DATABASE_URL`/`MYSQL_DATABASE_URL` starts with `mysql://`):

| | SQLite path | MySQL path |
|---|---|---|
| Access | Drizzle ORM query builder | Hand-written SQL strings |
| Entry point | `db` from `@/server/db/client` | `resolveMysqlPool()` from `@/server/db/mysql` |
| Helpers | Drizzle `select()/insert()/…` | `mysqlSelectMany/mysqlSelectOne/mysqlExecute/mysqlTransaction` from `@/server/db/mysql-runtime` |
| Naming | `listIntents(db, …)` | `listIntentsFromMysql(pool, …)` or a `mysql-*.ts` sibling module |

In MySQL mode the exported `db` is a **Proxy that throws `MysqlRuntimeDatabaseGuardError` on any property access** (`src/server/db/client.ts`). So a code path that only implements the Drizzle branch does not silently fall back — it hard-fails at runtime under MySQL.

**When you add or change a server feature, implement both branches.** The convention is a `Foo`/`FooFromMysql` function pair in the same module (see `src/server/events/event-log.ts`), or a dedicated `mysql-service.ts` / `mysql-*.ts` module (see `src/server/auth/mysql-service.ts`, `src/server/crawler/mysql-importer.ts`). Services branch on `isMysqlDatabaseUrlConfigured()` and pick the repository; routes generally stay dialect-agnostic.

`src/server/db/mysql-route-coverage.test.ts` enforces this: any `src/app/api/**/route.ts` that imports `@/server/db/client` must either reference MySQL itself or be listed in that test's `SERVICE_LEVEL_MYSQL_ROUTES` map with a written justification.

### Schema and migrations

- **Schema:** `frontend/src/server/db/schema.ts` — Drizzle table definitions (~54 tables: bids, users/auth/orgs, intents, response workspace, artifacts, quotes, notifications, billing, crawler state, source health/governance).
- **Migrations:** `frontend/src/server/db/migrate.ts` — hand-written idempotent SQL, **not** drizzle-kit output. `runMigrations(db)` executes one large `sqlite.exec(\`…\`)` block of `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements, followed by conditional `addXColumn(...)` helpers for later additive columns.
- **MySQL DDL is derived, not written:** `src/server/db/mysql.ts` reads `migrate.ts` as text, regex-extracts the **first** `sqlite.exec(\`…\`)` template literal, and translates it (INTEGER→INT, TEXT→VARCHAR(191) for keyed/indexed columns else LONGTEXT, inline `REFERENCES` stripped). **A new table or index must go inside that first block or it will never reach MySQL.**
- `frontend/drizzle/` holds a stale drizzle-kit snapshot that nothing reads at runtime. Do not rely on it. `drizzle.config.ts` exists for ad-hoc drizzle-kit use only.

### API route conventions

Every `src/app/api/**/route.ts` follows the same shape (see `src/app/api/intents/[id]/compliance/route.ts` as the reference):

1. `resolvePrincipal(db, request)` → `RequestPrincipal`, either `{kind: "authenticated"}` or `{kind: "anonymous"}` (anonymous users get a cookie that must be echoed back via `Set-Cookie` on the response).
2. `isAuthenticatedPrincipal(principal)` / `authRequiredResponse()` from `@/server/auth/route-guards` for auth.
3. `requireFeature(principal, "<feature_key>")` from `@/server/auth/feature-gate`; catch `FeatureAccessError` → 403.
4. Mutating routes verify CSRF via `verifyCsrfSafe`/`csrfRejectedResponse` (`src/server/security/csrf.ts`, Origin/Referer against `APP_ORIGIN` + `CSRF_ALLOWED_ORIGINS`).
5. Errors use the envelope `{ error: { code, message } }` with a stable SCREAMING_SNAKE code.
6. Request correlation via `createRequestContext(request)` (`x-request-id` / `x-correlation-id`, generated when absent) — passed into event logging.

Admin routes use `requireAdmin`/`requireAdminAccess` (`src/server/admin/auth.ts`) instead of the principal flow. `ADMIN_UI_LOCAL_BYPASS=true` only works when `NODE_ENV !== "production"`.

### Structural coverage tests — registries you must update

Several tests read the filesystem and fail when a new route isn't registered. Adding an API route usually means editing one of these:

- `src/server/auth/feature-gate-routes.ts` (`FEATURE_API_COVERAGE`) — asserted by `feature-gate-coverage.test.ts`: entitlement-gated route + methods.
- `src/server/auth/role-route-coverage.test.ts` — every `api/admin/**` route classified as admin-only / operator-mutation / console-read.
- `src/server/auth/personal-route-coverage.test.ts` — per-user data routes.
- `src/server/db/mysql-route-coverage.test.ts` — MySQL awareness (above).

### Entitlements

`src/server/auth/entitlements.ts` is the single source of truth:

- Roles: `user`, `admin`, `operator`, `support` (the last three are `ADMIN_CONSOLE_ROLES`).
- Tiers: `free`, `pro`, `business`, `enterprise` (ranked; `minimumTierByFeature` maps each feature to its floor).
- 23 `FEATURE_KEYS`. Per-user overrides live in a feature-override table and are applied by `applyFeatureOverrides`.

Client side: `useFeature` (`src/lib/features/useFeature.ts`).

### Frontend structure

`src/app/` is the App Router tree. Primary pages: `/search` (main bid search), `/bids/[id]`, `/intents/[id]` (bidding workspace), `/saved`, `/knowledge`, `/profile`, `/settings` (billing & preferences), `/admin` (crawler status, source health, config — admin only), plus auth pages and the public marketing/demo routes (`/`, `/request-demo`, `/resources`, `/winbids-demo`). All data access goes through `/api/*`.

`src/components/` — feature-grouped business components (`auth/`, `bids/`, `intents/`, `layout/`, `i18n/`) with shadcn wrappers in `components/ui/`. `src/lib/` — typed client-side API helpers (`lib/api/`), i18n, feature hooks, logging/Sentry (`lib/observability/`), retry & failure alerts (`lib/resilience/`), and the state source registry.

### Server module layout

`src/server/<domain>/` per business domain (35 domains: intents, response-workspace, artifacts, quotes, awards, compliance, submission, qualification, pursuit, deadlines, knowledge, billing, notifications, events, crawler, risk, source-validity, storage, …). Typical files: `types.ts` (domain types + error classes), `repository.ts` (Drizzle queries), `service.ts` (business logic, dialect branching), `mysql-*.ts` (MySQL twin), plus co-located `*.test.ts`.

### Crawler architecture

- `crawler/apsi_crawler/sources/state_sources.py` defines `STATE_SOURCES` (50 entries); `sources/registry.py` merges it with the SAM.gov source.
- `crawler/apsi_crawler/spiders/` — one module per dedicated portal (`ca_caleprocure.py`, `tx_esbd.py`, …); `generic_state.py` backs the remaining states, and `state_bidnet.py` maps every BidNet Direct-hosted state onto the shared `co_bidnet` fetcher.
- `normalizers/` converts raw portal payloads to normalized bid records; `storage/sqlite.py` upserts them and writes crawler logs; `storage/archive.py` downloads attachments.
- Fixtures (`tests/fixtures/`) back hermetic pytest coverage only — passed directly to spiders via `fixture_html=`/fixture-loader test helpers. There is no production fallback flag; a live `fetch-task` run either fetches for real or fails (no silent fixture replay).

**Cross-subsystem contract:** the source id travels in the `fetch-task` JSON payload's `source_id` field (built by `buildCrawlTaskPayload` in `state-runner.ts` from a `data_sources` row), not as a `--source` argv flag — `data_sources` is the runtime id universe for crawler execution, not the two hardcoded per-language files. `crawler/apsi_crawler/sources/state_sources.py` and `frontend/src/lib/state-crawler-sources.ts` still exist and still carry governance/validity metadata (approval status, legal review, access pattern, trust status) consumed by `risk:check`, the admin console, and `validate-state-live` — but they are no longer on the `fetch-task` execution path. See `docs/superpowers/specs/2026-07-29-crawler-source-registry-design.md`'s 2026-07-31 scope amendment for why their full retirement was descoped from phase 1.

**MySQL crawler flow:** `state-runner.ts`'s `runCrawlTask` always invokes the Python CLI's `fetch-task` (stdin JSON in, stdout JSON out) the same way regardless of dialect — there is no `--output-json`/`--database` branch left on this path. Dialect branching happens on the TS side, in `persistCrawlTaskResult` (`crawl-task-persistence.ts`): it pipes the parsed result through `mysql-json-importer.ts` when a MySQL pool is present, or `sqlite-json-importer.ts` otherwise.

**Detail enrichment (optional):** `fetch-task` runs `apsi_crawler/enrichment.py` after the liveness check when a source's `fetch_config.enrichment.enabled` is true: it fetches each bid's `source_url` on the crawler's own requests path and POSTs the HTML to the `services/scrapling-extractor` sidecar (`SCRAPLING_EXTRACTOR_URL`; Scrapling 0.4.15 parser only — no fetchers, no anti-bot tooling, never bypasses WAF challenges or login walls; off-target redirects, changed detail-ID queries and same-URL login forms are counted as `failed` without parsing). It fills missing or summary-only values judged by `content_quality.py` (title echoes and duplicate short/long copies are never "content"), validates the whole extractor response before mutating a bid, merges attachments by URL, and records provenance in `raw_payload.enrichment.applied_fields` (+ `original_values` for normalized dates). It never fails the run (`metadata.enrichment` reports `attempted/enriched/failed/skipped`).

Persistence is the other half of the contract: `persistence-merge.ts` (shared by both JSON importers, executed inside one transaction per run) keeps detail-provenance fields (`applied_fields`, cumulative `persisted_fields`) from being downgraded by list-page values, merges `bid_attachments` incrementally (never deletes unobserved rows, never erases a successful archive), and normalizes legacy title echoes to `description = ""` / `full_description = null`. `validateCrawlerImport` refuses a zero-row "success" unless `metadata.dateFilter` explains it (`kept: 0`, `dropped > 0`, `unparsed: 0`) or `metadata.emptyState` reports a verified, tenant-confirmed empty list. A persistence failure is a source failure (`CrawlerPersistenceError`, separate failure log row, no notifications, health write-back as failure). The UI picks the displayable text with `src/lib/bid-description.ts`. Admins edit `fetch_config`/`cadence`/`base_url` per source in `/admin` (PATCH `/api/admin/data-sources/[id]`). Full flow: `docs/architecture/crawler-enrichment-flow.md`; operations guide and measured MySQL baseline: `docs/operations/detail-enrichment.md`.

**Attachment repair (separate worker):** the crawler only records attachment *links*; archiving is a separate loop. `attachment-repair-worker.ts` → `runAttachmentRepairOnce` classifies each `bid_attachments` row with the pure classifier in `src/server/attachments/anomaly.ts` (`never_archived | archive_failed | archive_missing | archive_corrupt | path_not_portable | unavailable | healthy`), takes an `attachment_repair:<source_id>` `crawler_locks` lease per source, and spawns `python -m apsi_crawler.cli archive-attachments` (stdin JSON → stdout JSON, same contract style as `fetch-task`) which validates magic bytes, never writes HTML to disk, and returns `storage_path` **relative** to the archive root. Per-source policy lives in `data_sources.fetch_config.attachments` (`archive`, `mode`, `max_per_run`, `min_interval_seconds`, `timeout_seconds`, `max_bytes`, `browser_link_selector`), validated by `src/server/attachments/policy.ts` and edited in the admin crawler-config panel. `mode: "browser"` routes the download through the `services/browser-downloader` Playwright sidecar (`BROWSER_DOWNLOADER_URL`) which only clicks download controls on public pages — never logs in, never solves CAPTCHAs, never leaves `allowed_hosts`; unreachable = `browser_unavailable` + backoff, never a run failure. Each run writes exactly one `crawler_logs` row with `source = "attachment_repair"`. Operations guide: `docs/operations/attachment-repair.md`.

**List extraction & local-source approval:** list-page parsing is configured per source in `data_sources.fetch_config.list_extraction` (`mode: "scrapling" | "adapter"`, `render`, `item_selector`, `max_items`, six field `selectors`), validated by `src/server/admin/crawler-config.ts` (`parseListExtractionConfig`/`serializeListExtractionConfig`) and edited in the admin crawler-config panel's "List extraction" group. Scrapling is the **main path** (the sidecar's `POST /extract-list`) and the adapter's own parser is the automatic fallback — the crawler reports which ran in `metadata.listExtraction.method` (`scrapling | adapter | adapter_fallback`). Either way the list page is fetched exactly once; `render: true` routes that one fetch through the browser sidecar's `POST /render` for JS-built lists. A list page that is HTTP 200, carries an explicit "no open bids" phrase in its **visible** copy (hidden template rows — `aria-hidden`, `hidden`, `display:none` — never count; BidNet keeps such a row above real rows), yields **zero parsed rows** on both the sidecar and the adapter parser, and confirms the tenant is a **verified empty state**: `status = "success"` with `bids = []` and `metadata.emptyState`, which `validateCrawlerImport` accepts as a zero-row success (health is not downgraded). County/city/special-district rows stay behind the governance gate in `orchestrator.ts` until a person approves them: `POST /api/admin/data-sources/[id]/precheck` (`src/server/admin/source-precheck.ts`, admin/operator) runs robots.txt + a non-persisting `limit=5` dry run + a `discover-tenant` probe on 404 and returns a `ready | empty | needs_fix` verdict plus an optional `suggestedBaseUrl`; the admin then approves through the existing PATCH with the full compliance ledger (reviewer, ToS, legal reference, next review date). Nothing in that flow bypasses the gate. When one source of a platform hits a challenge/throttle, the rest of that `providerFamily` in the same tick come back `status: "deferred"` (`platform-deferral.ts`, `CRAWLER_PLATFORM_MIN_INTERVAL_MS`) instead of being run into a 403 wall. `locked`, `disabled`, `blocked` and `deferred` all mean the crawler was never invoked, so `isCrawlerRunFailure`/`isCrawlerRunSkipped` (orchestrator.ts) keep them out of failure counts: a batch of nothing but skips answers `status: "completed"`, and the SAM.gov route answers 409 rather than 500. Operations guide: `docs/operations/local-source-approval.md`.

**Source discovery (upstream of all that):** new county/city sources are found by *reading BidNet's public agency directory*, never by guessing tenant paths — the same slug appears in three unrelated shapes (`/city-of-aurora/…`, `/colorado/boulder-county/…`, `/ohio/franklincountychildrensservices`), which is why the 2026-09-16 `discover-tenant` probes all 404'd. `discover-sources` (`crawler/apsi_crawler/discovery_service.py`) pages the directory (orchestration over `apsi_crawler.discovery.bidnet.harvest_bidnet` and `apsi_crawler.jurisdictions`; all three collaborators are injectable), classifies each agency `county | city | special_district | unknown` (state-aware — a `borough` is a county equivalent only in AK), attaches a Census GEOID from the committed offline table `crawler/data/us_jurisdictions.tsv`, and emits `candidates[]` whose first ten fields are `SourceCandidate` field-for-field plus a review-only `discovery` block, alongside `review[]`, `existingMatches[]` and `stats{}` (where `county + city + special_district + unknown == agencies`). Two match statuses become candidates: an exact same-state `name_key` hit (`discovery.confidence: "exact"`) and, for counties only after exact matching fails, a unique `<X> County` name *prefix* (`"jurisdiction_prefix"` + `discovery.matchedPrefix`, counted by `stats.prefix_matched`) so a county's purchasing departments are reviewable rather than dropped — several such sources legitimately share one GEOID. Nothing fuzzier than that: `ambiguous`/`not_found` go to `review`, because a wrong GEOID is worse than a missing one. **Special districts are never registered** and everything unmatched goes to `review`. It is read-only and manual: no database write, no governance column, no worker — a person reviews the JSON, runs `npm run source:register`, and the row lands `approval_status IS NULL`, i.e. still behind the gate above. `existingMatches` reverse-looks already-registered sources up in the directory (`exact | partial | none`) to close out the four 2026-09-16 404s. Cross-language contract: `crawler/tests/test_discover_sources_cli.py` + `frontend/scripts/register-sources.test.ts`. Operations guide: `docs/operations/source-discovery.md`.

**Execution controls:** `runCrawlerSourceOnce` (orchestrator.ts) takes a `crawler_locks` lease with a per-attempt unique owner, renews it every TTL/3 (`renewCrawlerLock*`), aborts the Python child on lease loss, and hands runners a `CrawlerExecutionContext` (`signal`, `assertLease`, `lease`) that the importers re-check inside their write transaction. `CRAWLER_TASK_TIMEOUT_MS` (default 30 min) SIGKILLs a runaway child (`CrawlerTaskTimeoutError`). `CRAWLER_PYTHON_BIN` / `CRAWLER_DIRECTORY` locate the crawler (`execution-context.ts`). The manual run routes require `CRAWLER_RUN_TOKEN` or an admin/operator session; `CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN=true` re-enables token-less loopback runs in development only (`run-authorization.ts`). Matcher/notifier failures after a successful ingest surface as `postProcessingErrors` and never trigger a recrawl; only network-classified failures are retried by the worker (`retrying-runner.ts`).

### Workers

Four long-running scripts in `frontend/scripts/`, each supporting a `--check` flag for a non-blocking health probe:

- `crawler-worker.ts` — periodically runs configured sources via `runConfiguredCrawlerSourcesOnce`, which also matches saved search alerts and queues notifications.
- `event-worker.ts` — drains the `event_outbox` table (durable events written by `writeEvent`/`writeAuditEvent` in `src/server/events/event-log.ts`).
- `notification-worker.ts` — drains `notification_outbox` through the configured provider (`src/server/notifications/`).
- `attachment-repair-worker.ts` — every 6 h (`ATTACHMENT_WORKER_INTERVAL_MS`), calls `runAttachmentRepairOnce` (`src/server/attachments/repair-service.ts`) to verify and re-download bid attachments. Not part of the default compose startup; `--once` / `ATTACHMENT_WORKER_RUN_ONCE=1` runs a single pass.

Both outboxes have status/created indexes and dedupe keys; delivery wraps providers in `retrying-*` decorators.

### Auth & billing

- Custom session auth (no NextAuth): random token in a cookie, stored as a SHA-256 hash in `sessions`. Password reset via email token. Login lockout + per-IP/per-account rate limits in `src/server/security/`.
- Multi-tenant: users belong to organizations via `organization_memberships`; several queries resolve a workspace's member user IDs so teammates can see shared intents. `cross-org-isolation.test.ts` guards leakage.
- Billing: Stripe with webhook at `/api/billing/webhook`. `BILLING_PROVIDER=local` disables billing in dev. Credit ledger in `src/server/billing/credit-ledger.ts`.

### i18n

`src/lib/i18n/dictionaries/{en,zh}.ts` — `zh` is typed as `typeof en`, so missing/extra keys are compile errors. Two gotchas:

- **`t()` does not interpolate.** It is a pure dot-path lookup (`src/lib/i18n/LanguageContext.tsx`). A value containing `{count}` must be resolved by the caller with `.replace("{count}", …)` or a local `formatMessage()`, otherwise the literal placeholder renders.
- Hardcoded English JSX strings bypass i18n entirely. `npm run i18n:check` statically scans for both problems plus zh values byte-identical to en.

### Testing

Vitest, `environment: "node"`, `globals: false` (import `describe/it/expect` explicitly), `@` → `src`. Tests are co-located as `*.test.ts` next to the code, including under `scripts/`. Use `createTestDatabase({ seed })` from `src/server/db/test-utils.ts` for a migrated temp-directory SQLite DB, and always `await testDb.cleanup()` in `afterEach`.

The suite runs fully offline: no test needs a live MySQL server or network. MySQL code paths are exercised with stubbed env vars and fake pool objects, and MySQL result validation is tested through pure helpers (e.g. `validateMysqlSmokeInspection` in `mysql-smoke.ts`). Real MySQL verification is a separate manual step — `npm run db:mysql:smoke` against an actual database.

## Environment Variables

Create `frontend/.env.local` for local dev. Key variables:

| Variable | Dev default | Notes |
|---|---|---|
| `DATABASE_PATH` | `data/apsi.sqlite` | SQLite path relative to `frontend/` |
| `DATABASE_URL` | — | MySQL URL; presence switches the whole app to the MySQL path |
| `ADMIN_UI_LOCAL_BYPASS` | `true` | Skip admin auth locally; ignored when `NODE_ENV=production` |
| `APP_ORIGIN` / `CSRF_ALLOWED_ORIGINS` | — | CSRF Origin/Referer allowlist; unneeded on `localhost:3000` |
| `BILLING_PROVIDER` | `local` | Use `stripe` for billing tests |
| `STRIPE_SECRET_KEY` | `sk_test_REPLACE_ME` | Stripe test key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_REPLACE_ME` | Stripe webhook signing secret |
| `NOTIFICATION_PROVIDER` | `file` or `console` | `http` for real delivery |
| `OBJECT_STORAGE_PROVIDER` | `local` | `s3` for S3/S3-compatible storage |
| `STATE_CRAWLER_LIMIT` | — | Records per source for crawler runs |
| `SAM_API_KEY` | — | SAM.gov federal bid crawling |
| `CRAWLER_TASK_TIMEOUT_MS` | `1800000` | Whole fetch-task budget incl. enrichment; child is killed past it |
| `CRAWLER_PYTHON_BIN` / `CRAWLER_DIRECTORY` | `python3` / `../crawler` | Crawler interpreter and source dir (baked into the container images) |
| `CRAWLER_RUN_TOKEN` | — | Bearer token for the manual run routes; otherwise admin/operator session required |
| `CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN` | — | `true` allows token-less loopback runs in development/test only |

Full reference: `docs/transferability/environment-variables.md`.

## Next.js Version Note

This project pins **Next.js 16.2.6** exactly (`frontend/package.json`; `@next/env` pinned to the same version). APIs, conventions, and file structure may differ from Next.js 14/15 training data. Read `node_modules/next/dist/docs/` for authoritative behavior on anything uncertain. `next.config.ts` sets `output: "standalone"` and keeps `better-sqlite3`/`mysql2` as `serverExternalPackages` (native binding + dynamic requires) — don't remove those.

## Key Docs

- `docs/transferability/` — setup, deployment, data model & migrations, known limitations, env vars
- `docs/operations/` — MySQL cutover, backup/restore, billing & notification runbooks, source health
- `docs/product-requirements/` — PRD, implementation status, roadmap, gap analysis
- `docs/qa/` — cross-org isolation coverage, CSRF audit, i18n coverage, launch-readiness audits
