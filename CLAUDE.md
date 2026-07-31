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
npm run test                     # Vitest suite (~280 test files)
npm run db:migrate               # Apply schema migrations to SQLite
npm run db:seed                  # Seed demo data
npm run auth:reset-admin         # Reset admin password
npm run crawler:once             # One-shot run of every configured source (SAM.gov + 50 states)
npm run worker:crawler           # Continuous crawler daemon
npm run worker:events            # Event outbox daemon
npm run worker:notifications     # Notification delivery daemon
npm run workers:check            # Non-blocking health check of all three workers
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
docker compose up --build        # Local web app (repo root), http://localhost:3000
docker build -t apsi-frontend frontend
```

`.github/workflows/ci.yml` runs on every push/PR: `npm ci`, `lint`, `test`, `build`, then seeds a throwaway SQLite DB (`npm run db:seed`) and runs `npm run risk:check` as a merge gate. CI deliberately does **not** set `NODE_ENV=production` — production mode makes `risk:check` additionally require real-world data-source legal/approval review, which seed data cannot satisfy (that stricter gate belongs to the release checklist). `frontend/Dockerfile` is a multi-stage build (`deps` → `builder` → `runner`) using Next.js `output: "standalone"` and packages **only the web process** — the three worker scripts are not in this image. `docker-compose.yml` is local/demo parity only; production topology lives in `docs/operations/aws-deployment-runbook.md`.

## Crawler Commands

```bash
cd crawler
pip install -r requirements.txt
pytest                                              # All tests
PYTHONPATH=. pytest tests/test_generic_state.py     # One test file
echo '{"task_id":"t1","source_id":"ca_caleprocure","label":"California Cal eProcure","state_code":"CA","provider_family":null,"fetch_config":{"base_url":"https://caleprocure.ca.gov"},"limit":25,"query":null}' \
  | python -m apsi_crawler.cli fetch-task           # reads a JSON task payload from stdin, writes a JSON result to stdout
python -m apsi_crawler.cli fetch-sam-gov --posted-from 2026-07-01 --posted-to 2026-07-28
python -m apsi_crawler.cli validate-state-live --source ca_caleprocure          # repeatable; defaults to all beta sources
python -m apsi_crawler.cli import-fixture --database <path> --fixture <path>
```

Those four subcommands — `import-fixture`, `fetch-sam-gov`, `validate-state-live`, `fetch-task` — are the complete CLI surface (`build_parser()` in `crawler/apsi_crawler/cli.py`).

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

### Workers

Three long-running scripts in `frontend/scripts/`, each supporting a `--check` flag for a non-blocking health probe:

- `crawler-worker.ts` — periodically runs configured sources via `runConfiguredCrawlerSourcesOnce`, which also matches saved search alerts and queues notifications.
- `event-worker.ts` — drains the `event_outbox` table (durable events written by `writeEvent`/`writeAuditEvent` in `src/server/events/event-log.ts`).
- `notification-worker.ts` — drains `notification_outbox` through the configured provider (`src/server/notifications/`).

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

Full reference: `docs/transferability/environment-variables.md`.

## Next.js Version Note

This project pins **Next.js 16.2.6** exactly (`frontend/package.json`; `@next/env` pinned to the same version). APIs, conventions, and file structure may differ from Next.js 14/15 training data. Read `node_modules/next/dist/docs/` for authoritative behavior on anything uncertain. `next.config.ts` sets `output: "standalone"` and keeps `better-sqlite3`/`mysql2` as `serverExternalPackages` (native binding + dynamic requires) — don't remove those.

## Key Docs

- `docs/transferability/` — setup, deployment, data model & migrations, known limitations, env vars
- `docs/operations/` — MySQL cutover, backup/restore, billing & notification runbooks, source health
- `docs/product-requirements/` — PRD, implementation status, roadmap, gap analysis
- `docs/qa/` — cross-org isolation coverage, CSRF audit, i18n coverage, launch-readiness audits
