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
echo '{"platform":"bidnet","states":["OH"]}' \
  | python -m apsi_crawler.cli discover-sources > candidates.json   # read-only agency-directory walk (states filters results, not pages); the whole file goes to `npm run source:register`
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

`src/app/` is the App Router tree. Primary pages: `/search` (main bid search), `/bids/[id]`, `/intents/[id]` (bidding workspace), `/saved`, `/knowledge`, `/profile`, `/settings` (billing & preferences), `/admin` (the admin console, below), plus auth pages and the public marketing/demo routes (`/`, `/request-demo`, `/resources`, `/winbids-demo`). All data access goes through `/api/*`.

**Admin console (`/admin/**`):** a left navigation (the admin tree `AppSidebar` shows on any `/admin/**` path, `src/components/layout/admin-sidebar-tree.tsx`) over these pages, each a thin `"use client"` `page.tsx` that renders one view and loads only its own endpoints: overview `/admin`; data sources — list `/admin/sources`, detail `/admin/sources/[id]` (reached from the list, not a menu entry), onboarding `/admin/sources/onboarding`, runs `/admin/sources/runs`; data quality — state portal quality `/admin/quality`, bid QA `/admin/quality/bids`; users & access — users `/admin/users`, audit log `/admin/users/audit`; operations — notifications `/admin/notifications`, growth `/admin/growth`, config `/admin/config`. Every page is open to `admin`/`operator`/`support` except runs, bid QA and notifications (`admin`/`operator`) and users, audit log and config (`admin` only). The shell is `src/app/admin/layout.tsx` (Server Component) rendering the client `src/components/admin/AdminShell.tsx` (loading / sign-in / console-role gate, per-page role guard, breadcrumb, page title, role flags via `admin-session.tsx`); the menu — routes, icons, i18n keys and the roles that see each item — is the one table in `src/components/admin/admin-nav.ts`, read by the sidebar tree, the breadcrumb and the guard (`canViewAdminPath`; an admin path the menu does not list is admin-only). A new page = a menu entry there + a thin `page.tsx` + a row in `PAGES` of `src/app/admin/admin-pages.test.ts`; page bodies live under `src/components/admin/{overview,sources,sections}/` and load through `useAdminResource`. The overview reads `GET /api/admin/overview` (`getAdminOverview`/`getAdminOverviewFromMysql`, `src/server/admin/overview.ts`; four independent blocks — coverage, onboarding pipeline, crawl health, bids — and a block that fails comes back `null` with `errors[block]`); the source list reads the server-side paginated `GET /api/admin/data-sources` (`data-source-query.ts`: repeatable `level`/`state`/`platform`/`approval`/`health`, `q`, `sort` = `label|lastRun|failures|updated` with a `-` prefix for descending, `page`/`pageSize` (default 1/50, `pageSize` ≤ 200), answering `{ items, total, page, pageSize, facets }` with each facet counted under every other filter but its own, and 400 `INVALID_REQUEST` for a bad parameter such as an unknown filter value or a page past the end; an item's `approvalState` is the gate's view — `awaiting` is `needs_review` at any level or NULL approval on a local row, so it also counts a held federal/state row, which the overview's `awaitingApproval` (local levels only) leaves out); `GET /api/admin/data-sources/index` (admin/operator) returns every source matching the same filters in a light shape (≤ 5000 rows plus `truncated`) for "run or queue everything that matches"; `GET /api/admin/data-sources/[id]` (`source-detail.ts`) returns one source with its `crawler_logs` keys, computed level/platform/approval/health, ledgered-approval readiness (local sources only) and bid counts plus the latest bids; `GET /api/admin/crawler-logs` (admin/operator/support; read through `CrawlerLogList` by the runs page and the detail page's runs tab) pages `crawler_logs` newest first: `source` repeatable (≤ 10 keys such as the detail's `logSourceKeys`; blank and repeated values are ignored), a `before` + `beforeId` cursor (`beforeId` needs `before`), `limit` (default 25, clamped to 1–100, a fraction is truncated), answering `{ logs, nextCursor }` — `nextCursor` is `{ before, beforeId }` of the last row when a full page came back, else `null` — and 400 `INVALID_REQUEST` for more than ten sources, a `beforeId` without `before` or an over-long cursor. Design: `docs/superpowers/specs/2026-09-29-admin-console-redesign-design.md`.

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

**Paged BidNet lists & bid lifecycle:** a `fetch-task` request may add `list_kind` (`open`/`closed`/`awarded`, default `open`), `start_page` (default 1), `max_pages` (default 4, 1–50 via a source's `fetch_config.list_pages` — `state-runner.ts`'s `listPagesFor`), and `stop_before` (ISO date, history backfill). A paged adapter (BidNet today) answers with `metadata.pagination = {list_kind, start_page, pages_fetched, next_page, stopped_reason, requests_made, complete}` (`stopped_reason`: `exhausted | max_pages | window | limit | unreadable_page | repeated_page`; `requests_made` includes enrichment detail fetches); non-paged adapters report no `metadata.pagination` and keep the `limit: 25` default, while BidNet's `limit: null` means uncapped, bounded only by `max_pages`. `complete` requires the walk to exhaust its own last page from page 1, every page's rows corroborated by that page's own reader (sidecar rows the reader never read that link off the portal's site are discarded before this check), nothing cut by `limit`/`query`, and page 1's printed total plus `<title>` confirming the tenant — a `date_range` filter always forces it back to `false`. A page-1-only run that finds zero rows is a separate case (`list_extraction.py`'s `_raise_empty_first_page`): it's a `complete: true` zero-row success only when the adapter's own parser confirms a verified-empty tenant, page 1's `<title>` names it, and the walk started at page 1; a positive printed total with zero rows is never treated as empty and instead raises `ListPageReadError`, failing the whole run loudly rather than letting delisting quietly clear the source. Bids gained `lifecycle_status` (`open`/`closed`/`awarded`, `frontend/src/lib/bid-lifecycle.ts`), `awarded_date` and `solicitation_number`; `is_active` stays exactly `lifecycle_status === "open"`. `lifecycle.ts`'s `mergeLifecycleFields`, called by `persistence-merge.ts` on every upsert, applies the transition (an `awarded` bid is never downgraded to `closed`), and both JSON importers close every previously-`open` bid of a source that a `complete: true` open-list run did not return (`lifecycle.ts`'s `delistingApplies` gates it; `sqlite-json-importer.ts`/`mysql-json-importer.ts` each implement their own `delistMissingOpenBids`; `raw_payload.lifecycle.closed_reason = "delisted"`) — a failed, truncated, or date-windowed run never delists. Runbook: `docs/operations/bid-lifecycle-and-crawl-budget.md`.

**Detail enrichment (optional):** `fetch-task` runs `apsi_crawler/enrichment.py` after the liveness check when a source's `fetch_config.enrichment.enabled` is true: it fetches each bid's `source_url` on the crawler's own requests path and POSTs the HTML to the `services/scrapling-extractor` sidecar (`SCRAPLING_EXTRACTOR_URL`; Scrapling 0.4.15 parser only — no fetchers, no anti-bot tooling, never bypasses WAF challenges or login walls; off-target redirects, changed detail-ID queries and same-URL login forms are counted as `failed` without parsing). It fills missing or summary-only values judged by `content_quality.py` (title echoes and duplicate short/long copies are never "content"), validates the whole extractor response before mutating a bid, merges attachments by URL, and records provenance in `raw_payload.enrichment.applied_fields` (+ `original_values` for normalized dates). It never fails the run (`metadata.enrichment` reports `attempted/enriched/failed/skipped`).

Persistence is the other half of the contract: `persistence-merge.ts` (shared by both JSON importers, executed inside one transaction per run) keeps detail-provenance fields (`applied_fields`, cumulative `persisted_fields`) from being downgraded by list-page values, merges `bid_attachments` incrementally (never deletes unobserved rows, never erases a successful archive), and normalizes legacy title echoes to `description = ""` / `full_description = null`. `validateCrawlerImport` refuses a zero-row "success" unless `metadata.dateFilter` explains it (`kept: 0`, `dropped > 0`, `unparsed: 0`) or `metadata.emptyState` reports a verified, tenant-confirmed empty list. A persistence failure is a source failure (`CrawlerPersistenceError`, separate failure log row, no notifications, health write-back as failure). The UI picks the displayable text with `src/lib/bid-description.ts`. Admins edit `fetch_config`/`cadence`/`base_url` per source on the source detail page `/admin/sources/[id]` (its Crawler config tab; PATCH `/api/admin/data-sources/[id]`). Full flow: `docs/architecture/crawler-enrichment-flow.md`; operations guide and measured MySQL baseline: `docs/operations/detail-enrichment.md`.

**Attachment repair (separate worker):** the crawler only records attachment *links*; archiving is a separate loop. `attachment-repair-worker.ts` → `runAttachmentRepairOnce` classifies each `bid_attachments` row with the pure classifier in `src/server/attachments/anomaly.ts` (`never_archived | archive_failed | archive_missing | archive_corrupt | path_not_portable | unavailable | healthy`), takes an `attachment_repair:<source_id>` `crawler_locks` lease per source, and spawns `python -m apsi_crawler.cli archive-attachments` (stdin JSON → stdout JSON, same contract style as `fetch-task`) which validates magic bytes, never writes HTML to disk, and returns `storage_path` **relative** to the archive root. Per-source policy lives in `data_sources.fetch_config.attachments` (`archive`, `mode`, `max_per_run`, `min_interval_seconds`, `timeout_seconds`, `max_bytes`, `browser_link_selector`), validated by `src/server/attachments/policy.ts` and edited in the admin crawler-config panel. `mode: "browser"` routes the download through the `services/browser-downloader` Playwright sidecar (`BROWSER_DOWNLOADER_URL`) which only clicks download controls on public pages — never logs in, never solves CAPTCHAs, never leaves `allowed_hosts`; unreachable = `browser_unavailable` + backoff, never a run failure. Each run writes exactly one `crawler_logs` row with `source = "attachment_repair"`. Operations guide: `docs/operations/attachment-repair.md`.

**List extraction & local-source approval:** list-page parsing is configured per source in `data_sources.fetch_config.list_extraction` (`mode: "scrapling" | "adapter"`, `render`, `item_selector`, `max_items`, six field `selectors`), validated by `src/server/admin/crawler-config.ts` (`parseListExtractionConfig`/`serializeListExtractionConfig`) and edited in the admin crawler-config panel's "List extraction" group. Scrapling is the **main path** (the sidecar's `POST /extract-list`) and the adapter's own parser is the automatic fallback — the crawler reports which ran in `metadata.listExtraction.method` (`scrapling | adapter | adapter_fallback`). Either way the list page is fetched exactly once; `render: true` routes that one fetch through the browser sidecar's `POST /render` for JS-built lists. A list page that is HTTP 200, carries an explicit "no open bids" phrase in its **visible** copy (hidden template rows — `aria-hidden`, `hidden`, `display:none` — never count; BidNet keeps such a row above real rows), yields **zero parsed rows** on both the sidecar and the adapter parser (a paged BidNet walk first discards the sidecar rows the page's own reader never read that link off the portal's site — an agency announcement's Outlook safelinks URL, say, which would otherwise become an over-long bid id and fail the whole import — and counts them in `metadata.listExtraction.discarded_offsite_rows`, a key present only when something was dropped), and confirms the tenant is a **verified empty state**: `status = "success"` with `bids = []` and `metadata.emptyState`, which `validateCrawlerImport` accepts as a zero-row success (health is not downgraded). County/city/special-district rows stay behind the governance gate in `orchestrator.ts` until a person approves them: `POST /api/admin/data-sources/[id]/precheck` (`src/server/admin/source-precheck.ts`, admin/operator) runs robots.txt + a non-persisting `limit=5` dry run + a `discover-tenant` probe on 404 and returns a `ready | empty | needs_fix` verdict plus an optional `suggestedBaseUrl`; the admin then approves through the existing PATCH with the full compliance ledger (reviewer, ToS, legal reference, next review date). Nothing in that flow bypasses the gate. When one source of a platform hits a challenge/throttle, the rest of that `providerFamily` in the same tick come back `status: "deferred"` (`platform-deferral.ts`, `CRAWLER_PLATFORM_MIN_INTERVAL_MS`) instead of being run into a 403 wall. `locked`, `disabled`, `blocked` and `deferred` all mean the crawler was never invoked, so `isCrawlerRunFailure`/`isCrawlerRunSkipped` (orchestrator.ts) keep them out of failure counts: a batch of nothing but skips answers `status: "completed"`, and the SAM.gov route answers 409 rather than 500. **Batch onboarding (phase 3, spec §7):** the ~950 registered county/city/township rows are approved through three steps, none of which approves anything by itself. `platform_reviews` (`platform-reviews-repository.ts`; `GET /api/admin/platform-reviews` for admin/operator/support, `POST` admin-only and CSRF-checked, each write a `platform_review.created` audit event; a renewal is a new row, there is no PATCH) holds one compliance review per `provider_family` (never for the display fallbacks `public_portal` / `state_portal` / `federal_portal` a NULL `provider_family` reads as, which `validatePlatformReviewInput` rejects and the panel does not offer) — ToS, robots.txt, the fixed access boundary, reviewer, `next_review_at`. The row with the newest `reviewed_at` is the platform's effective review: `valid` while its `next_review_at` is in the future, `expired` after, `missing` with no row; an expired or missing one stops batch approval of that platform's local sources while already-approved sources keep running (the crawler gate never reads it). `data_sources.precheck_requested_at` is the precheck queue flag, only *set* by `npm run source:precheck -- --provider bidnet --pending [--dry-run]` (or `--source <id>`; the script does not read `.env.local`, so export `DATABASE_URL` or it writes SQLite), `POST /api/admin/data-sources/precheck-requests` (admin/operator) and the console's queue button — `pending` means awaiting precheck and not already queued: local level, enabled, `approval_status` NULL/`needs_review` but not held by a person, not queued, and a stored precheck that `precheckEvidence` (`precheck-queue.ts`, the same rule the readiness's `awaiting_precheck` uses) reads as `missing`, `base_url_changed`, `superseded` (a `last_failure_at` or `last_approval_reviewed_at` after it) or `stale` (older than 14 days); a fresh `needs_fix` of the current address is not pending. The crawler worker drains it (`precheck-queue-runner.ts`, called from `crawler-worker.ts` after the daily lists) on the same tick's `PlatformTickBudget`, i.e. whatever the lists left: oldest first, at most 500 rows read and 50 started per tick, 2 requests reserved per precheck and 2 + 6 settled after a 404 tenant probe, one robots.txt fetch per URL — i.e. per host — per tick (`createCachedRobotsFetch`), prechecks of one platform spaced by `CRAWLER_PLATFORM_MIN_INTERVAL_MS`. A precheck that answers about the source itself (ready/empty, or a 404/parse `needs_fix`) clears the flag; a WAF challenge (`wafChallenge` or HTTP 429) pauses the platform (`CRAWLER_PLATFORM_PAUSE_MS`) and keeps the flag; an environment/transient failure (no result document, network-class error, 5xx) keeps the flag and stops that platform for the tick without pausing it; the worker-lifetime `PrecheckRetryRegistry` backs such a source off and, after `PRECHECK_MAX_ATTEMPTS = 3` consecutive challenge/error outcomes, clears its flag as `abandoned` (the row keeps the `needs_fix` the precheck wrote — re-queue it by id). Per-tick events: `crawler_precheck_queue_processed` / `crawler_precheck_queue_completed`, plus `crawler_precheck_abandoned`. `POST /api/admin/data-sources/batch` (`action: "approve"`, admin, ≤ 100 ids) approves a local source — any set `jurisdiction_level` other than federal/state (`isGatedLocalJurisdictionLevel`) — only when the three `ledgered-approval.ts` checks all hold — a `valid` platform review; `live_health_disposition` ∈ {`ready`, `empty`} with `live_health_reviewed_at` at most 14 days old; the `precheck.baseUrl` stored in `live_health_notes` equal to the current `base_url` — and the row is not held by a person (`isHeldByPerson`: `needs_review` written by a governance change that no later `last_failure_at` explains; only the single-source form lifts a hold), not disabled, not login-gated beyond what the review's ledger covers, not queued for a new precheck, and has seen no failure or governance change since its precheck. It then writes `approved` / `approved_public`, `approved_for_ingestion = 1`, `is_enabled = 1` and the ledger copied from the review (reviewer, ToS, legal reference, `compliance_review_due_at = next_review_at`) with `approval_notes = 依据平台审查 #<id>；预检 <verdict> @<time>`; anything else is skipped with one of thirteen reasons, checked in this order — `already_approved`, `blocked`, `held`, `disabled`, `missing_platform_review`, `platform_review_expired`, `login_requirements_unmet`, `precheck_queued`, `precheck_missing`, `base_url_changed`, `precheck_superseded`, `precheck_stale`, `precheck_needs_fix` (`not_local`, the fourteenth `LedgeredApprovalReason`, never reaches the route) — and nothing is written (answer `{ updatedCount, skippedCount, outcomes: [{ sourceId, outcome, reason }], sources }`); federal/state ids keep the generic approval, where a login-gated source missing required ledger fields is still `SourceApprovalRequirementsError` → 400 `APPROVAL_REQUIREMENTS_UNMET`. `GET /api/admin/data-sources/approval-readiness?providerFamily=` (admin/operator/support) serves the six buckets — `approvable | awaiting_precheck | needs_fix | missing_platform_review | approved | blocked`, where `held` / `disabled` / `login_requirements_unmet` count as `blocked` and `precheck_queued` / `precheck_superseded` as `awaiting_precheck` — with each entry's `baseUrl` and the tenant probe's `suggestedBaseUrl` (display only, never written); the platform-review and ledgered-approval panels on `/admin/sources/onboarding` render it. `toAdminSource` reads a local row with NULL governance columns as `needs_review` / not approved for ingestion / `not_reviewed`, matching the gate, and the source detail page header (`/admin/sources/[id]`) hides its un-ledgered Approve for local sources. Operations guide: `docs/operations/local-source-approval.md` (§8 is this path; the ledger columns and how approval copies them are in `docs/operations/data-source-compliance-ledger.md`).

**Source discovery (upstream of all that):** new county/city/township sources are found by *reading BidNet's public agency directory*, never by guessing tenant paths — the same slug appears in three unrelated shapes (`/city-of-aurora/…`, `/colorado/boulder-county/…`, `/ohio/franklincountychildrensservices`), which is why the 2026-09-16 `discover-tenant` probes all 404'd. `discover-sources` (`crawler/apsi_crawler/discovery_service.py`) pages the directory (orchestration over `apsi_crawler.discovery.bidnet.harvest_bidnet` and `apsi_crawler.jurisdictions`; all three collaborators are injectable), classifies each agency `county | city | township | special_district | unknown` (state-aware — a `borough` is a county equivalent only in AK; `township` means the name says township/twp in any state, or — only in NY, CT, ME, MA, NH, RI, VT, WI — opens with "town of" or ends in "town", a town elsewhere stays `city`), attaches a Census GEOID from the committed offline table `crawler/data/us_jurisdictions.tsv` (a third table level, `cousub`, carries active town/township governments alongside the `county` and `place` rows), and emits `candidates[]` whose first eleven fields are `SourceCandidate` field-for-field plus a review-only `discovery` block, alongside `review[]`, `existingMatches[]` and `stats{}` (where `county + city + township + special_district + unknown == agencies`). Two match statuses become candidates: an exact same-state `name_key` hit (`discovery.confidence: "exact"`) and, for counties only after exact matching fails, a unique `<X> County` name *prefix* (`"jurisdiction_prefix"` + `discovery.matchedPrefix`, counted by `stats.prefix_matched`) so a county's purchasing departments are reviewable rather than dropped — several such sources legitimately share one GEOID; townships match only `cousub` rows and get no such prefix fallback, so same-named townships (MI's several `Richmond Township`s, NY's several `Town of Clinton`s) go to `ambiguous_match` rather than being guessed. A state an agency writes after a comma in its own name outranks its purchasing group's state (`apsi_crawler.us_states.name_state`; `discovery.stateSource: "name"` vs `"group"`, two conflicting commas falling back to the group), and a trailing ", XX" (`strip_state_suffix`) is stripped before classifying/matching/id-building though the `label` and `discovery.agencyName` keep it; township candidate ids carry the Census type word too (`..._town` / `..._township`) so, e.g., the Town of Rye and the City of Rye never collide into a bare `_2`. Nothing fuzzier than that: `ambiguous`/`not_found` go to `review`, because a wrong GEOID is worse than a missing one. **Special districts are never registered** and everything unmatched goes to `review`. It is read-only and manual: no database write, no governance column, no worker — a person reviews the JSON, runs `npm run source:register` on the file as written (it accepts that document or a bare `SourceCandidate[]`, refuses a run whose `stats.stopped_reason` is not `exhausted` unless `--allow-partial`, and holds back — printing the `PATCH` to make instead — any candidate whose tenant an `existingMatches` entry already suggests for an existing source, unless `--allow-suggested`), and the row lands `approval_status IS NULL`, i.e. still behind the gate above. "Already registered" means the **tenant** is registered, never that an id collides: a BidNet tenant is its slug (`/colorado/city-of-aurora` and the root alias `/city-of-aurora` are one tenant; `Boulder County` and `City of Boulder` both key to `boulder` yet are two), so dedupe compares slugs of `existing_sources[].base_url`/`existing_base_urls` (`TENANT_KEYS`), an id-only collision just gets a `_2` suffix, and `existing_ids` without any registered URL is exit 2. `existingMatches` reverse-looks already-registered sources up in the directory to close out the four 2026-09-16 404s (Laramie County, WY states its own name after a comma and now resolves to a `partial` suggestion for `bidnet_wy_laramie`); it suggests a URL (`exact | partial`) only when state and jurisdiction level (`existing_sources[].jurisdiction_level`, else the label classified) both agree — otherwise `level_mismatch | state_unconfirmed | level_unconfirmed` with `suggestedBaseUrl: null`, or `none`. Cross-language contract: `crawler/tests/test_discover_sources_cli.py` + `frontend/scripts/register-sources.test.ts`. Operations guide: `docs/operations/source-discovery.md`.

**Execution controls:** `runCrawlerSourceOnce` (orchestrator.ts) takes a `crawler_locks` lease with a per-attempt unique owner, renews it every TTL/3 (`renewCrawlerLock*`), aborts the Python child on lease loss, and hands runners a `CrawlerExecutionContext` (`signal`, `assertLease`, `lease`) that the importers re-check inside their write transaction. `CRAWLER_TASK_TIMEOUT_MS` (default 30 min) SIGKILLs a runaway child (`CrawlerTaskTimeoutError`). `CRAWLER_PYTHON_BIN` / `CRAWLER_DIRECTORY` locate the crawler (`execution-context.ts`). The manual run routes require `CRAWLER_RUN_TOKEN` or an admin/operator session; `CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN=true` re-enables token-less loopback runs in development only (`run-authorization.ts`). Matcher/notifier failures after a successful ingest surface as `postProcessingErrors` and never trigger a recrawl; only network-classified failures are retried by the worker (`retrying-runner.ts`), and a platform throttle signature (a `*ChallengeError`, or an `HtmlPageError` answered 403/429/202) never is — the platform pause answers it. `runCrawlTask` reports the crawler's own structured error class (`BidNetChallengeError`, `HtmlPageError`, …) ahead of the process exit status (`fetch-task` exits 1 on every exception), which is what lets `isPlatformThrottleSignature` see a real challenge; `classifyCrawlerFailure` treats `HtmlPageError` transport failures (`HTML request failed: …`) and HTTP 5xx/429/403/202 as `network` (retried, demoted to `needs_review` only after 5 consecutive failures) while a 404, a non-HTML/empty page or missing table headers stay `parse` (immediate `needs_review`). `PlatformDeferralTracker`'s default spacing sleep is a ref'd timer, so `npm run crawler:once` on SQLite no longer exits mid-run.

**Platform request budget & activity tiers:** `runConfiguredCrawlerSourcesOnce` (`configured-runner.ts`) spends an hourly per-`provider_family` request budget instead of the flat per-tick source cap for budgeted platforms (`CRAWLER_PLATFORM_BUDGETS`, default `bidnet=60`; `platform-budget.ts`'s `PlatformTickBudget` reserves `⌊hourly × tickMs / 1h⌋` per tick and settles against each run's actual `metadata.pagination.requests_made`) — platforms absent from the budget map keep the old 10-sources-per-tick cap, and `npm run crawler:once` shares this same code path so it is budget-constrained too. A platform that answers with a throttle signature is paused for `CRAWLER_PLATFORM_PAUSE_MS` (default 30 min, in-memory per worker process); sources skipped for either reason are logged as one `crawler_platform_sources_skipped` event per family (`paused`/`budget` counts) and never counted as failures. For `county`/`city`/`township`/`special_district` sources, `scheduler.ts` tracks `data_sources.consecutive_empty_runs` (incremented on a verified-empty success, reset the moment a run sees an open bid) and widens the effective cadence to weekly once it reaches `QUIET_SOURCE_EMPTY_RUNS = 3` (`effectiveIntervalMs`). `township` is a `jurisdiction_level` for Township and New-England/NY/WI-style towns, slotted into the same enums, scheduling order and activity tiering as the other local levels — the governance gate already keys off "not federal/state", so it needed no gate changes of its own.

### Workers

Four long-running scripts in `frontend/scripts/`, each supporting a `--check` flag for a non-blocking health probe:

- `crawler-worker.ts` — periodically runs configured sources via `runConfiguredCrawlerSourcesOnce`, which also matches saved search alerts and queues notifications; after the daily lists, in the same tick, it runs the queued prechecks (`runQueuedPrechecksOnce`, `precheck-queue-runner.ts`) on whatever platform budget the lists left.
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
| `CRAWLER_PLATFORM_BUDGETS` | `bidnet=60` | Per-platform hourly request budget, e.g. `bidnet=60,bonfire=30`; a platform can also be set to `unlimited`, which only waives the hourly budget check — like an unlisted platform, it still keeps the flat 10-sources-per-tick cap |
| `CRAWLER_PLATFORM_PAUSE_MS` | `1800000` | How long a platform is paused (worker memory only) after a throttle/challenge signature |
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
