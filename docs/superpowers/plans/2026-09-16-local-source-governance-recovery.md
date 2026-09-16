# Local Source Governance Recovery — Implementation Plan

> **For agentic workers:** TDD. Four implementers in parallel on disjoint file trees (ownership below). Shared checkout; do NOT commit/stash/checkout/reset. No live portal requests from tests (fixtures only); never touch the `winbids` MySQL database. Spec: `docs/superpowers/specs/2026-09-16-local-source-governance-recovery-design.md`. Decisions (user, 2026-09-16): (1) governance = pre-check + one-click approval form; (2) verified empty state = zero-row success (design below); (3) Scrapling list extraction is the **main path**, adapter regex is the fallback; (4) `browser-downloader` gets a `/render` endpoint this phase; (5) tenant-path discovery suggests, admin confirms; (6) the 5 disabled placeholder state sources are marked `blocked` (integration step, via admin API).

**Goal:** County/city sources can be pre-checked (robots + dry-run fetch + tenant-path discovery) and approved from `/admin` with a compliance-ledger form; approved sources no longer fail on legitimate empty pages, 404 tenant paths or platform throttling; list parsing runs through the Scrapling sidecar with adapter regex as fallback; JS-rendered tenants can be rendered by the browser sidecar.

---

## Shared contracts

### C1. `fetch-task` additions (Python → Node)

`fetch_config.list_extraction` (per source, optional):
```json
{ "mode": "scrapling" | "adapter", "render": false, "item_selector": null, "max_items": 200,
  "selectors": { "title": null, "url": null, "published_date": null, "deadline_date": null, "source_bid_id": null, "issuer_name": null } }
```
Defaults: `mode = "scrapling"` when `SCRAPLING_EXTRACTOR_URL` is set **and** the adapter exposes a list-HTML fetcher (bidnet platform, generic_state); otherwise `"adapter"`. `render = false`.

Result `metadata` additions:
- `metadata.listExtraction = { "method": "scrapling" | "adapter" | "adapter_fallback", "items": n, "diagnostics": {field: "selector"|"heuristic"|"not_found"}, "rendered": bool, "extractor": url|null, "fallback_reason": str|null }`
- `metadata.emptyState = { "verified": true, "marker": "There are no open bids at this time.", "tenant_confirmed": true, "method": "adapter"|"scrapling" }` — present only when the page is a verified empty list. Then `status = "success"`, `bids = []`. Rules for `verified: true`: (a) page HTTP 200 and not a WAF challenge; (b) an explicit empty-list phrase matched (`no open bids|no open solicitations|no solicitations (are )?(currently )?available|no results found|there are currently no`); (c) `tenant_confirmed` — the source label's distinctive token (e.g. "Erie", "Boulder") appears in `<title>` or body text. Without (c) the run stays a normal `EmptyCrawlerResultError` failure.

### C2. Scrapling sidecar `POST /extract-list`

Request: `{ "url": "...", "html": "...", "item_selector": null|str, "selectors": {field: css|xpath}, "fields": ["title","url","published_date","deadline_date","source_bid_id","issuer_name"], "max_items": 200, "auto_save": true }`
Response 200: `{ "items": [ { "title": str, "url": abs str, "published_date": str|null, "deadline_date": str|null, "source_bid_id": str|null, "issuer_name": str|null } ], "diagnostics": { field: "selector"|"heuristic"|"not_found" }, "item_selector_used": str|null, "empty_state": { "detected": bool, "marker": str|null } }`
Errors: same envelope as `/extract` (`INVALID_REQUEST` 400, body cap 413, `EXTRACT_FAILED` 500). Heuristics when no `item_selector`: pick the repeated container (table rows / list items / cards) with the most anchors whose href looks like a detail link; per field: selector → heuristic (anchor text = title, anchor href = url, date-like cells, numeric path segment = source_bid_id). Adaptive selectors via Scrapling `auto_save`/`auto_match` keyed by URL host, same storage dir as `/extract`.

### C3. browser-downloader `POST /render`

Request: `{ "page_url": "...", "allowed_hosts": [...], "timeout_seconds": 30, "wait_for": { "selector": str|null, "network_idle": true } }`
Response 200: `{ "final_url": str, "status": int, "title": str, "html": str }` (html capped at 2 MiB → `413 TOO_LARGE`). Same guards as `/download`: LOGIN_WALL (never types), OFF_HOST, TIMEOUT, NAVIGATION_FAILED, single concurrency, crawler UA, no CAPTCHA.

### C4. `python -m apsi_crawler.cli discover-tenant` (stdin → stdout, read-only)

Request: `{ "base_url": "https://www.bidnetdirect.com/franklin-county-oh/solicitations/open-bids", "label": "Franklin County, OH (BidNet)", "state_code": "OH", "provider_family": "bidnet", "max_requests": 6, "min_interval_seconds": 3 }`
Response: `{ "candidates": [ { "url": str, "status": int, "title": str|null, "label_match": bool, "rows": int, "empty_state": bool } ], "suggested_base_url": str|null, "reason": str }`. Candidate generation for bidnet: `/{state-name}/{slug}/solicitations/open-bids`, `/{slug}/solicitations/open-bids`, slug variants (`franklin-county-oh` → `franklin-county`, `franklin-county-ohio`, `franklin-county-oh`), plus the current URL. Stop early at the first candidate with `label_match && (rows > 0 || empty_state)`. Requests spaced by `min_interval_seconds`; WAF 202 aborts with `reason = "waf_challenge"`.

### C5. Admin pre-check API (Node)

`POST /api/admin/data-sources/[id]/precheck` — admin or operator. Body `{ "limit": 5 }` optional. Runs, in order: robots scan for the source's base URL host (`scanSourceCompliance`), dry-run `runCrawlTask(source, { taskId, limit })` **without** persisting and **without** the governance gate (this is what the gate is for); if the run failed with HTTP 404, `discover-tenant`. Persists `robots_txt_*` and `live_health_*` (`live_health_disposition` ∈ `ready | empty | needs_fix`, `live_health_notes` = JSON summary, `live_health_reviewed_at`) on both dialects. Response 200:
```json
{ "sourceId": "bidnet_ny_erie", "checkedAt": "...", "verdict": "ready" | "empty" | "needs_fix",
  "reasons": ["..."],
  "robots": { "status": "clear", "flagged": false, "flagReason": null },
  "fetch": { "status": "ok" | "empty_verified" | "failed", "items": 0, "sample": [{"title": "...", "url": "..."}], "listMethod": "scrapling", "errorCode": null, "errorMessage": null, "httpStatus": 200, "wafChallenge": false },
  "suggestedBaseUrl": null }
```
Errors: `SOURCE_NOT_FOUND` 404, `PRECHECK_FAILED` 502 (crawler unavailable). Register in `role-route-coverage.test.ts` (operator-mutation) and `mysql-route-coverage.test.ts` if it imports the client db.

### C6. Approval form → existing `PATCH /api/admin/data-sources/[id]` (admin role)

One request with: `approvalStatus: "approved"`, `legalReviewStatus: "approved_public"`, `approvedForIngestion: true`, `isEnabled: true`, `tosReviewed: true`, `tosUrl`, `complianceReviewer` (prefilled from the signed-in admin's email, editable), `legalOpinionReference` (required when robots flagged), `complianceReviewDueAt` (default +12 months), `complianceNotes`, `approvalNotes`. Task C makes sure every one of these fields is accepted by the PATCH parser and written by `updateAdminDataSource`/`…FromMysql` (add the missing ones), and that `requires_login = 1` sources are refused approval without `complianceReviewer` + `legalOpinionReference` + `tosReviewed` (hard check from the 2026-07-29 design).

### C7. Platform deferral (Node)

`configured-runner.ts` / manual route: when a source in this tick fails with a challenge/throttle signature (`errorCode ∈ {BidNetChallengeError}` or `HtmlPageError` whose message carries `status 403|429|202`), the remaining not-yet-run sources with the same `providerFamily` in this tick get `status: "deferred"`, `reason: "platform_throttled:<sourceId>"` — no health write-back, not retried by the worker, shown in the batch panel. New union member on `RunCrawlerSourceOnceResult`; every switch over `status` must handle it. `CRAWLER_PLATFORM_MIN_INTERVAL_MS` (default 5000) sleeps between two sources of the same platform.

---

## Task A — crawler (agent). Ownership: `crawler/**`

- [x] Empty state: `content_quality.detect_empty_list(html, label) -> {"detected", "marker", "tenant_confirmed"}`; `VerifiedEmptyListError(marker, tenant_confirmed)` raised by `co_bidnet`/`generic_state` list stage when detected; `cli.fetch_task` catches it → success + `metadata.emptyState` (C1). Fixture: `crawler/tests/fixtures/bidnet_erie_no_open_bids.html` (real page, saved 2026-09-16).
- [x] List-HTML fetchers: adapters expose `fetch_list_html(source, url, session, timeout) -> (html, final_url, status)` (bidnet platform + generic_state; registry `LIST_HTML_FETCHERS`). New `apsi_crawler/list_extraction.py`: resolves `fetch_config.list_extraction`, fetches HTML (via `render` → C3 when `render: true`, else requests with the same politeness), POSTs C2, normalizes items with `normalize_state_opportunity`, falls back to the adapter parser on sidecar unreachable / invalid response / zero items without empty-state (`method: "adapter_fallback"`, `fallback_reason`). Emit `metadata.listExtraction`. Never more than one list request per run.
- [x] `discover-tenant` subcommand (C4) with injectable session/sleeper; label matching by distinctive tokens.
- [x] Tests for all of the above (fake sessions/sidecar), `python3 -m pytest -q` green (baseline 413), CI command `PYTHONPATH=crawler python3 -m pytest crawler/tests -q`.

## Task B — sidecars (agent). Ownership: `services/scrapling-extractor/**`, `services/browser-downloader/**`

- [x] `/extract-list` (C2) in the extractor: `list_extractors.py` + route; tests with `tests/fixtures/live/bidnet_erie_no_open_bids.html` (expect `empty_state.detected`, 0 items), the IL list fixture from `crawler/tests/fixtures/il_bidbuy_open_bids.html` (copy it into the extractor fixtures; expect ≥ 1 item with title/url/source_bid_id), a synthetic table page and a synthetic card/list page; selector precedence, `max_items`, request validation, body cap.
- [x] `/render` (C3) in browser-downloader: `renderer.py` + route + guards reuse; unit tests without a browser (validation, host guard, html cap) + browser integration test (skipped without Chromium) rendering a local page whose list is injected by JS after load (`wait_for.selector`), plus LOGIN_WALL and OFF_HOST cases. Update both READMEs.
- [x] Run both suites (`.venv/bin/python -m pytest -q tests` in each service).

## Task C — Node server (agent). Ownership: `frontend/src/server/**` (except `frontend/src/server/attachments/**`), `frontend/src/app/api/**`, `frontend/scripts/source-compliance-*.ts`, related tests

- [x] `validateCrawlerImport`: accept zero-row success when `metadata.emptyState.verified === true && tenant_confirmed === true`; `recordSourceHealthOutcome`: success (resets failures). `crawl-task-persistence` unchanged otherwise.
- [x] `crawler-config.ts`: validate `fetchConfig.list_extraction` (mode enum, render boolean, selectors map of non-empty strings, max_items 1..500).
- [x] Pre-check service `src/server/admin/source-precheck.ts` (+ MySQL twin for reads/writes) and route (C5); `discover-tenant` spawn via `crawlerRuntime()`; register in coverage tests.
- [x] PATCH parser + repositories accept every C6 field on both dialects; hard check for `requires_login`.
- [x] Compliance scan: `scanSourceCompliance` input built from `data_sources` rows (all enabled sources incl. county/city), script `source-compliance-scan.ts` updated; write `robots_txt_*` back on both dialects.
- [x] Platform deferral (C7) in `configured-runner.ts` and `api/crawler/state/run/route.ts`; `source-health-outcome.ts` ignores `deferred`; `retrying-runner.ts` treats it terminal; `JurisdictionBatchRunPanel` type union is Task D's, but export the status type from the server so D can import it.
- [x] Run `npx vitest run src/server src/app/api`, full suite, lint, `npx tsc --noEmit | grep -v "\.test\.ts"` empty.

## Task D — admin UI, client API, i18n, docs (agent). Ownership: `frontend/src/app/admin/**`, `frontend/src/components/admin/**`, `frontend/src/lib/api/admin.ts`, `frontend/src/lib/i18n/dictionaries/{en,zh}.ts`, `docs/operations/local-source-approval.md` (new), `docs/transferability/environment-variables.md`, `CLAUDE.md`, `README.md`, `docs/architecture/crawler-enrichment-flow.md`, `AGENTS.md`

- [x] `lib/api/admin.ts`: `precheckAdminDataSource(id)` (C5) typed client; extend `updateAdminDataSource` payload type with C6 fields.
- [x] Admin data-source table row / batch panel: "前置检查" button → result card (verdict badge, robots, fetch sample, suggested base URL with "写入 base_url" confirm button that PATCHes `baseUrl`); "批准县/市源" dialog (C6 fields, reviewer prefilled from `/api/auth/session` user email, due date default +12 months, robots-flagged → legal reference required client-side too); batch run statuses `deferred` ("平台限流，本批推迟") and empty-state success ("空态：无开放招标") derived from the result payload; `CrawlerConfigPanel` gets a "List extraction" group (mode, render, item selector, field selectors, max items). All strings en/zh; `t()` does not interpolate.
- [x] Docs: `docs/operations/local-source-approval.md` (什么是治理拦截、前置检查、批准表单字段与责任、空态、404 租户探测、平台限流、Scrapling 主路径与回退、`/render`）; env rows (`CRAWLER_PLATFORM_MIN_INTERVAL_MS`); CLAUDE.md (CLI surface now includes `archive-attachments` and `discover-tenant` — fix the "four subcommands" sentence; list-extraction paragraph; precheck route); README bullet; architecture doc section; AGENTS.md if structure changed.
- [x] Run `npx vitest run src/app/admin src/components/admin src/lib`, lint, `npm run i18n:check` (no new findings).

## Integration (controller)

- [x] Wire gaps; full gates (crawler, extractor, browser-downloader pytest; vitest; lint; build; compose config).
- [x] Extend the offline integration test if cheap: IL list fixture through `/extract-list` main path.
- [x] Real run (local MySQL, sidecars up): precheck each of the 10 BidNet sources (≤ 6 requests each, 3 s apart); approve the 4 known-good ones + Boulder/Erie through the form/API with reviewer = user's admin email; PATCH suggested `base_url` for 404 tenants only if the discovery is unambiguous, else leave for the user; mark the 5 placeholder state sources `blocked`; run `POST /api/crawler/state/run` for the approved county sources and verify empty-state success rows and ingested bids.
- [x] Ledger `.superpowers/sdd/2026-09-16-local-source-governance-recovery/progress.md`; measured results appended to the ops doc.
