# Attachment Repair Implementation Plan

> **For agentic workers:** Use test-driven development. Four implementers run in parallel on disjoint file trees (ownership below). Work in this shared checkout; do NOT commit, stash, checkout or reset. Never touch the `winbids` MySQL database or any live portal from tests. Read the spec first: `docs/superpowers/specs/2026-09-16-attachment-repair-design.md`.

**Goal:** Every public http(s) bid attachment is archived as a content-validated local file within one scheduler cycle; broken archives are detected and re-downloaded; portals whose downloads are form/JS-driven are handled by a headless-browser sidecar; everything that cannot be archived carries an accurate, stable reason and stops hitting the portal.

**Architecture:** Node worker (`worker:attachments`, 6 h) selects anomalies on both dialects → per-source lease → spawns Python `archive-attachments` (stdin JSON → stdout JSON) which downloads directly or via the `browser-downloader` sidecar, validates magic bytes, writes relative paths → Node writes results + a `crawler_logs` row in one transaction.

**Tech stack:** Python 3.9+ (`requests`), Playwright/Chromium sidecar (Python 3.12), TypeScript/Vitest, Drizzle (SQLite) + hand-written MySQL SQL.

**Defaults (user-confirmed):** interval 6 h; 50 per source per run; 3 s between requests; 50 MB cap; backoff `1h × 2^attempts` capped at 7 d; give up after 6 attempts (`unavailable`, re-eligible after 30 d); re-verify archived files every 7 d; `login_wall` / `html_response` twice in a row → `unavailable`.

---

## Shared contracts (all tasks code against these; do not change without updating this section)

### C1. Python CLI `python -m apsi_crawler.cli archive-attachments` (stdin → stdout)

Request (stdin, one JSON object):
```json
{
  "archive_root": "/abs/path/frontend/data/attachments",
  "browser_downloader_url": "http://127.0.0.1:8092",
  "source": {
    "id": "il_bidbuy", "label": "Illinois BidBuy",
    "mode": "direct", "min_interval_seconds": 3, "timeout_seconds": 30,
    "max_bytes": 52428800, "browser_link_selector": null
  },
  "items": [
    { "id": "il_bidbuy:27-444:attachment:1", "bid_id": "il_bidbuy:27-444", "bid_source": "Illinois BidBuy",
      "source_bid_id": "27-444DHS-P", "page_url": "https://…/bidDetail.sdo?docId=27-444DHS-P",
      "url": "https://…/bidDetail.sdo?downloadFileNbr=1807333&docId=27-444DHS-P",
      "name": "Solicitation.pdf", "expected_extension": ".pdf" }
  ]
}
```
`mode` ∈ `direct | browser`. `browser_downloader_url` may be null. `expected_extension` may be null.

Response (stdout, exactly one JSON object; diagnostics go to stderr; exit 0 even when items fail; exit 2 only for an invalid request):
```json
{
  "results": [
    { "id": "…", "archive_status": "archived", "storage_path": "illinois_bidbuy/il_bidbuy_27-444/il_bidbuy_27-444_attachment_1.pdf",
      "byte_size": 468205, "content_type": "application/pdf", "checksum_sha256": "…", "archive_error": null,
      "failure_kind": null, "final_url": "https://…", "fetched_at": "2026-09-16T03:00:00+00:00", "method": "direct" }
  ],
  "stats": { "archived": 1, "failed": 0, "unavailable": 0, "duration_ms": 1234 }
}
```
- `archive_status` ∈ `archived | failed | unavailable`.
- `storage_path` is **relative to `archive_root`**, uses `_safe_segment(source id)/_safe_segment(bid id)/_safe_segment(attachment id) + extension` (extension from sniffed type, else from URL path, else `expected_extension`, else `.bin`). Never absolute.
- `content_type` is the **sniffed** type when magic bytes are recognized (`%PDF` → `application/pdf`; `PK\x03\x04` → docx/xlsx/pptx by `[Content_Types].xml` peek or `application/zip`; `\xD0\xCF\x11\xE0` → `application/msword` unless header says xls; text without HTML tags → `text/plain`/`text/csv`), else the cleaned response header.
- `failure_kind` ∈ `network | timeout | http_4xx | http_5xx | html_response | login_wall | off_target | too_large | unsupported_type | unavailable | browser_unavailable | browser_error | link_not_found`.
- A `text/html` response, or bytes that sniff as HTML (`<!doctype`, `<html`, leading whitespace tolerated), is **never written** to disk; result `failed` + `html_response` (or `login_wall` when `content_quality.is_login_html` says so).
- `unavailable` is returned by Python only for non-http(s) URLs or `browser` mode without a `browser_downloader_url`-reachable sidecar → no: unreachable sidecar is `failed` + `browser_unavailable` (retryable). Node decides terminal `unavailable` from attempts/kinds.

### C2. browser-downloader sidecar HTTP API (`services/browser-downloader`, default 127.0.0.1:8092)

- `GET /health` → `200 {"ok": true, "browser": "chromium", "playwright": "<version>"}`; `503 {"ok": false, "error": "…"}` when Chromium is missing.
- `POST /download` JSON: `{"page_url": "https://…", "link": {"href_contains": "1807333", "text": "Solicitation.pdf", "selector": null}, "timeout_seconds": 30, "max_bytes": 52428800, "allowed_hosts": ["www.bidbuy.illinois.gov"]}`.
  - Success: `200`, binary body, headers `X-Download-Filename`, `X-Download-Content-Type`, `X-Download-Final-Url`, `X-Download-Byte-Size`.
  - Failure: JSON `{"error": {"code": "…", "message": "…"}}` with `code ∈ INVALID_REQUEST (400) | LOGIN_WALL (403) | OFF_HOST (403) | LINK_NOT_FOUND (404) | TOO_LARGE (413) | TIMEOUT (504) | NAVIGATION_FAILED (502) | BROWSER_ERROR (500)`.
- Link resolution order: `selector` (CSS/XPath, first match) → anchor/button whose `href`/`onclick` contains `href_contains` → element whose normalized text equals `text`. Click, await Playwright `download` event (also accept a navigation response with `Content-Disposition: attachment`), stream to memory up to `max_bytes`.
- Hard rules: never fill inputs or submit credentials; before clicking, if the page has a password/email input **and** a login heading/form action (same rule as `crawler/apsi_crawler/content_quality.is_login_html`) → `LOGIN_WALL`; abort any navigation whose host is not in `allowed_hosts` → `OFF_HOST`; no CAPTCHA handling; one download at a time (process lock); headless Chromium with the crawler's browser UA; `Content-Length` guard and body cap `max_bytes + 64 KB`.
- Config: env `BROWSER_DOWNLOADER_HOST` (default `127.0.0.1`), `BROWSER_DOWNLOADER_PORT` (8092), `BROWSER_DOWNLOADER_MAX_BYTES` (52428800). Dockerfile sets HOST `0.0.0.0` for the compose network. No host `ports:` in compose.

### C3. Node service API (`frontend/src/server/attachments/`, Task C provides, Task D consumes)

```ts
// policy.ts — pure, no server imports
export const ATTACHMENT_MODES = ["direct", "browser"] as const;
export type AttachmentMode = (typeof ATTACHMENT_MODES)[number];
export interface AttachmentPolicy {
  archive: boolean;            // default true
  mode: AttachmentMode;        // default "direct"
  maxPerRun: number;           // default 50, range 1..200
  minIntervalSeconds: number;  // default 3, range 0..60
  timeoutSeconds: number;      // default 30, range 5..120
  maxBytes: number;            // default 52428800, range 1048576..209715200
  browserLinkSelector: string | null;
}
export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy;
export function parseAttachmentPolicy(fetchConfig: Record<string, unknown>): AttachmentPolicy;      // lenient: reads fetchConfig.attachments (snake_case keys), clamps, defaults
export function serializeAttachmentPolicy(policy: AttachmentPolicy): Record<string, unknown>;      // { attachments: { archive, mode, max_per_run, min_interval_seconds, timeout_seconds, max_bytes, browser_link_selector } }
export function validateAttachmentPolicyInput(value: unknown): string | null;                      // strict; message like "attachments.max_per_run must be between 1 and 200." or null

// repair-service.ts
export interface AttachmentRepairRunOptions {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  now?: () => Date;
  archiveRoot?: string;                 // default: CRAWLER_ATTACHMENT_DIR first entry or <cwd>/data/attachments
  browserDownloaderUrl?: string | null; // default: process.env.BROWSER_DOWNLOADER_URL ?? null
  maxPerSource?: number;                // overrides policy.maxPerRun downward (env ATTACHMENT_REPAIR_MAX_PER_SOURCE)
  verifyIntervalMs?: number;            // default 7 d
  sourceIds?: string[];                 // optional filter
  runner?: (request: ArchiveAttachmentsRequest) => Promise<ArchiveAttachmentsResponse>; // default spawns the Python CLI (C1)
}
export interface AttachmentRepairRunResult {
  runId: string; startedAt: string; finishedAt: string; status: "success" | "failure";
  candidates: number; verified: number; repaired: number; metadataFixed: number;
  failed: number; unavailable: number; skipped: number;
  bySource: Array<{ sourceId: string; status: "success" | "failure" | "locked" | "skipped"; attempted: number; repaired: number; failed: number; unavailable: number; error?: string }>;
  byKind: Record<string, number>;
}
export async function runAttachmentRepairOnce(options: AttachmentRepairRunOptions): Promise<AttachmentRepairRunResult>;
```
`runAttachmentRepairOnce` writes exactly one `crawler_logs` row per run (`source = "attachment_repair"`, `run_id = runId`, `status`, `fetched_count = candidates`, `inserted_count = repaired`, `updated_count = metadataFixed`, `skipped_count = skipped`, `failed_count = failed`, `metadata` = JSON of `{ verified, unavailable, byKind, bySource }`), on both dialects.

### C4. Schema additions (`bid_attachments`)

`verified_at TEXT NULL`, `repair_attempts INTEGER NOT NULL DEFAULT 0`, `next_repair_at TEXT NULL`, `failure_kind TEXT NULL`; index `idx_bid_attachments_repair (archive_status, next_repair_at)`. Additive on both dialects, following the `fips_code` precedent (SQLite `addBidAttachmentColumn` + `CREATE INDEX IF NOT EXISTS` after the column helpers; MySQL `mysqlColumnMigrations` + `MysqlIndexMigration` entries; `VARCHAR(191)` for indexed text columns).

---

## Task A — Python archive hardening + `archive-attachments` CLI (agent)

**Ownership:** `crawler/**` (source, tests, fixtures, requirements). Nothing else.

- [x] Failing tests first (`crawler/tests/test_archive.py` new, `test_fetch_task_cli.py` or new `test_archive_attachments_cli.py`): magic sniffing per type; HTML/`text/html` never written and yields `html_response`, login HTML yields `login_wall`; relative `storage_path` shape; blocklist matches whole path segments only (`/authority/` allowed, `/login/` blocked); `max_bytes` enforced while streaming (`too_large`, partial file removed); per-source `min_interval_seconds` honoured between requests (inject sleeper); browser mode: calls sidecar with C2 request, handles binary success and each error code → `failure_kind` mapping; sidecar unreachable → `browser_unavailable`; redirect off target (reuse `enrichment.detect_off_target_redirect`) → `off_target`; 4xx/5xx/timeouts → `http_4xx/http_5xx/timeout`; stdout is exactly one JSON document even when a per-item exception occurs (fail-open per item); invalid stdin → exit 2 + JSON error on stdout.
- [x] Implement in `crawler/apsi_crawler/storage/archive.py` (keep `archive_bid_documents` working for `fetch-sam-gov --archive-documents` — make it produce **relative** `storage_path` too, and update its tests) + new `crawler/apsi_crawler/storage/content_sniff.py` + `crawler/apsi_crawler/storage/browser_download.py` (requests client for C2) + `archive_attachments(request) -> response` in `crawler/apsi_crawler/storage/archive_attachments.py`; wire `archive-attachments` subcommand in `cli.py` (`build_parser()`), reading stdin like `fetch-task`.
- [x] Use `html.public_page.BROWSER_REQUEST_HEADERS` + `Referer: page_url`; stream downloads (`stream=True`, chunked, cap); default timeout from request.
- [x] Run `cd crawler && python3 -m pytest -q` (all green; baseline 330) and the two Python CI commands from `.github/workflows/ci.yml`.
- [x] Report: contract deviations (none expected), test counts, `git diff --stat -- crawler`.

## Task B — browser-downloader sidecar (agent)

**Ownership:** `services/browser-downloader/**` (new). Nothing else.

- [x] Layout mirroring `services/scrapling-extractor`: `server.py` (stdlib `http.server`, ThreadingHTTPServer, JSON errors), `downloader.py` (Playwright sync API, one global lock), `requirements.txt` (`playwright==<pin>`, `pytest`), `Dockerfile` (`FROM mcr.microsoft.com/playwright/python:<pinned tag matching the playwright pin>`, `ENV BROWSER_DOWNLOADER_HOST=0.0.0.0`), `run-local.sh` (venv on python3.12, `pip install -r requirements.txt`, `python -m playwright install chromium`, binds 127.0.0.1), `README.md`, `.gitignore` (`.venv`, `.data`), `tests/`.
- [x] Failing tests first: request validation (`INVALID_REQUEST` cases, non-http page_url, missing link spec, negative/absent Content-Length); link resolution helpers as pure functions over a small HTML DOM model (selector → href_contains → text), login-wall rule parity with `crawler/apsi_crawler/content_quality.is_login_html` (copy the rule, cite the source; the sidecar must not import the crawler package); `allowed_hosts` enforcement helper; size guard. Browser-dependent integration test: **skipped unless** `python -c "import playwright"` succeeds AND Chromium is installed; it serves a local page with `<a href="javascript:downloadFile('123')">Doc.pdf</a>` + a form POST that returns `Content-Disposition: attachment` PDF bytes, and asserts a successful `/download`; also a login-wall page → 403 `LOGIN_WALL`; also a link that navigates to another host → 403 `OFF_HOST`.
- [x] Implement C2 exactly. Log one JSON line per request to stderr (no bodies). Never persist downloads to disk in the sidecar.
- [x] Verify locally: `./run-local.sh` once (this will download Chromium, ~150 MB — allowed), `curl /health`, run the browser integration test, then stop the server. If Chromium install fails in this environment, say so and keep the browser test skipped.
- [x] Report: pinned versions, how to run, test counts, image size expectation.

## Task C — Node data layer + repair service (agent)

**Ownership:** `frontend/src/server/attachments/**` (new), `frontend/src/server/db/migrate.ts`, `frontend/src/server/db/mysql.ts` (+ their tests), `frontend/src/server/db/schema.ts`, `frontend/src/server/bids/attachments.ts` (only to **export** `resolveAllowedLocalPath` / `allowedAttachmentDirs`; no behaviour change), `frontend/src/server/bids/repository.ts` (only to add `failureKind`/`verifiedAt` passthrough to the attachment DTO if you need it — optional). Nothing under `frontend/scripts`, `frontend/src/app`, `frontend/src/components`, `frontend/src/lib/i18n`, `frontend/package.json`.

- [x] Failing tests first: `policy.test.ts` (parse/serialize/validate, ranges, defaults); `anomaly.test.ts` (pure classifier over a row + file probe result: `never_archived | archive_failed | archive_missing | archive_corrupt | path_not_portable | unavailable | healthy`, backoff math `nextRepairAt`, terminal rules: attempts ≥ 6, or `login_wall`/`html_response` twice → `unavailable`; 30-day re-eligibility); `repository.test.ts` (SQLite: candidate selection joins `bids` (for `source`, `source_url`, `source_bid_id`) and `data_sources` (`data_sources.id = bids.source OR data_sources.label = bids.source`, for `fetch_config` policy), respects `archive=false`, per-source limit, `next_repair_at`, skips seed/demo relative URLs → marks them `unavailable(seed)` once); MySQL twin with a fake pool asserting SQL shape and bound values; `repair-service.test.ts` (injected `runner`: happy path writes rows + one `crawler_logs` row in a transaction; runner failure → run `failure` log, no partial updates; lease `attachment_repair:<sourceId>` acquired/renewed/released via `lock-repository.ts` on both dialects, `locked` source skipped; verify pass: existing file + matching checksum → `verified_at` set; missing file → `failed/archive_missing` and re-queued this run; checksum mismatch or HTML magic → `archive_corrupt`; absolute path resolvable under an allowed root → `path_not_portable` → `storage_path` rewritten relative + `updated_count`); migration tests (`migrate.test.ts` / `mysql.test.ts` precedents) for C4.
- [x] Implement `policy.ts`, `anomaly.ts`, `repository.ts` (Drizzle) + `mysql-repository.ts`, `python-runner.ts` (spawn via `crawlerRuntime()` from `../crawler/execution-context`, stdin JSON, 64 MiB maxBuffer, parse C1 response, contract validation), `lease.ts` (small helper around `acquireCrawlerLock*/renewCrawlerLock*/releaseCrawlerLock*`, TTL 10 min, renew every TTL/3 while the runner is active), `repair-service.ts` (C3). Both dialects for every read/write; MySQL uses one transaction connection for the write-back (same pattern as `mysql-json-importer.ts`).
- [x] Add the C4 migration on both dialects; make sure `src/server/db/mysql-route-coverage.test.ts` etc. still pass (no new routes expected).
- [x] Run `cd frontend && npx vitest run src/server/attachments src/server/db` then the full `npx vitest run`, `npm run lint`, and `npx tsc --noEmit -p tsconfig.json | grep src/server/attachments` (must be empty; ~80 pre-existing test-file errors elsewhere are known).
- [x] Report: public API as implemented (must match C3), test counts, `git diff --stat -- frontend/src/server`.

## Task D — worker, admin config, UI copy, compose/CI, docs (agent)

**Ownership:** `frontend/scripts/attachment-repair-worker.ts` (+ test), `frontend/package.json` (scripts only), `frontend/src/server/admin/crawler-config.ts` (+ test), `frontend/src/components/admin/CrawlerConfigPanel.tsx` (+ test), `frontend/src/lib/i18n/dictionaries/{en,zh}.ts`, `frontend/src/app/bids/[id]/page.tsx` (attachment status copy only), `docker-compose.yml`, `.github/workflows/ci.yml`, `docs/operations/attachment-repair.md` (new), `docs/transferability/environment-variables.md`, `CLAUDE.md`, `README.md`, `docs/architecture/crawler-enrichment-flow.md` (one new section), `AGENTS.md`. Nothing under `frontend/src/server/attachments`, `crawler/`, `services/`.

- [x] Worker `frontend/scripts/attachment-repair-worker.ts` mirroring `crawler-worker.ts`: `--check` (validate env: production-like runtimes need `mysql://`; `BROWSER_DOWNLOADER_URL` optional http(s); `CRAWLER_ATTACHMENT_DIR` optional; report resolved interval/limits as JSON), `--once`/`ATTACHMENT_WORKER_RUN_ONCE=1`, loop with `ATTACHMENT_WORKER_INTERVAL_MS` (default 21600000), `ATTACHMENT_REPAIR_MAX_PER_SOURCE`, `CRAWLER_OWNER`-style owner, SIGINT/SIGTERM stop, `runMigrations`, `closeResolvedMysqlPool`, structured logs (`attachment_repair_completed`, `attachment_repair_crashed`), `captureException`. Import `runAttachmentRepairOnce` from `../src/server/attachments/repair-service` per C3 (Task C ships it; until then write the worker against the interface and test it with a mocked module via `vi.mock`).
- [x] `package.json`: `worker:attachments`, `worker:attachments:check`, `attachments:repair:once` (`ATTACHMENT_WORKER_RUN_ONCE=1 tsx scripts/attachment-repair-worker.ts`), add `worker:attachments:check` to `workers:check`.
- [x] Admin: `crawler-config.ts` validates `fetchConfig.attachments` via `validateAttachmentPolicyInput` from `@/server/attachments/policy` (C3; if the module is not there yet, code against the signature and note it), keeps `enrichment` behaviour; `CrawlerConfigPanel.tsx` gets an "Attachments" group: archive toggle, mode select (`direct`/`browser`), max per run, interval, timeout, max MB, browser link selector; en/zh copy for every new string (no hardcoded English; `t()` does not interpolate). Update panel tests.
- [x] Bid detail page: new status copy for `unavailable` attachments explaining "portal requires interactive download; use the original link" (en/zh); keep existing keys.
- [x] Compose: `browser-downloader` service (build `./services/browser-downloader`, no `ports:`, `profiles: [workers]`, healthcheck via Python urllib on `/health`) and `attachment-worker` service (worker image, `command: ["npm", "run", "worker:attachments"]`, `profiles: [workers]`, env `BROWSER_DOWNLOADER_URL=http://browser-downloader:8092`, same DATABASE_URL pinning as the other services, `apsi-data` volume). `docker compose config --quiet` must pass.
- [x] CI: extend the `crawler` job to run `services/browser-downloader` unit tests (install its requirements **without** `playwright install`; browser test self-skips), extend `crawler-runtime` to run `npm run worker:attachments:check` inside the worker image, `workers:check` already covers it.
- [x] Docs: `docs/operations/attachment-repair.md` (anomaly taxonomy, cadence, env vars, how to run once, how to read `crawler_logs` for `attachment_repair`, browser sidecar boundaries and how to start it, historical data behaviour); env var table rows (`ATTACHMENT_WORKER_INTERVAL_MS`, `ATTACHMENT_WORKER_RUN_ONCE`, `ATTACHMENT_REPAIR_MAX_PER_SOURCE`, `BROWSER_DOWNLOADER_URL`, `BROWSER_DOWNLOADER_HOST/PORT/MAX_BYTES`); CLAUDE.md (commands table, workers section, architecture paragraph), README bullet, architecture doc section, AGENTS.md structure line.
- [x] Run `cd frontend && npx vitest run scripts src/server/admin src/components/admin`, `npm run lint`, `npm run i18n:check` (no new findings vs. baseline in `winbids-demo/page.tsx`), `docker compose config --quiet`.
- [x] Report: anything you coded against an interface that did not exist yet (so the integrator can wire it), test counts, `git diff --stat`.

## Integration (controller, after A–D)

- [x] Wire any interface gaps between C and D; run full gates: crawler pytest, extractor pytest, browser-downloader pytest, `npx vitest run`, lint, build, `docker compose config`, worker image rebuild + `worker:attachments:check` smoke.
- [x] Real run against the local MySQL: `ATTACHMENT_REPAIR_MAX_PER_SOURCE=3 npm run attachments:repair:once` with the browser sidecar up; expect MO/MS direct archives, IL browser archives, 150 legacy absolute paths rewritten relative, seed/demo rows `unavailable`; verify via SQL and by downloading one repaired attachment through `/api/bids/[id]/attachments/[attachmentId]`.
- [x] Update `docs/operations/crawler-hardening-verification.md` or the new ops doc with measured results; SDD ledger under `.superpowers/sdd/2026-09-16-attachment-repair/progress.md`.
