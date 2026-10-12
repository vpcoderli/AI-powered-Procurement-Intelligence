# State / County / City Data Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make state, county, city and township bid data provably complete, correct and usable.

**Architecture:** Six tasks: five components, then a wiring-and-docs task.
1. A pure deadline parser drives a deadline-passed lifecycle rule, at import time and in a periodic sweep.
2. The NY Contract Reporter spider learns subcontracting cards.
3. Two idempotent data migrations, one per concern, repair legacy rows in both dialects.
4. A demo-data purge removes seed bids with their dependents.
5. A `data:integrity` tool reports per-level health and compares before/after snapshots row by row, so every later change can prove it lost nothing.
6. A wiring task adds the npm scripts, integration suite and runbooks.

**Tech Stack:**
- Next.js 16 / TypeScript with Vitest;
- a dual runtime: SQLite (Drizzle, better-sqlite3) and MySQL 8 (mysql2, hand-written SQL);
- the Python 3.12 crawler with pytest.

## Global Constraints

**Dialects and migrations**
- Every server-side change implements both dialects. SQLite goes through `db` from `@/server/db/client` (Drizzle, or the raw `sqlite` handle where the codebase already does). MySQL goes through `resolveMysqlPool()` with `mysqlSelectMany`/`mysqlExecute`/`mysqlTransaction` from `@/server/db/mysql-runtime`.
- MySQL has no foreign keys: `mysql.ts` strips every `REFERENCES`.
- SQLite enforces the foreign keys declared in `migrate.ts` (`ON DELETE CASCADE` on the bid children, `ON DELETE SET NULL` on `knowledge_items.source_bid_id`). No foreign key has `ON UPDATE CASCADE`.
- Data migrations must be idempotent.
  - SQLite: statements at the end of `runMigrations` in `frontend/src/server/db/migrate.ts`.
  - MySQL: statements returned by `mysqlDataMigrationStatements()` in `frontend/src/server/db/mysql.ts`.
- No new table, column or index is needed. If one ever is, it goes in the first `sqlite.exec` block of `migrate.ts`.

**Tests and safety**
- Tests stay offline.
  - Vitest uses `globals: false`, and every test using `createTestDatabase({ seed })` from `src/server/db/test-utils.ts` ends with `await testDb.cleanup()`.
  - Real-MySQL tests live in `*.mysql.integration.test.ts` files guarded by `describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))`. They create and drop their own random database, like `frontend/src/server/db/local-issuer-type-backfill.mysql.integration.test.ts`.
- Never connect to the `winbids` database or the `winbids-mysql` container from a test or during development.
- Never touch the main checkout `/Users/sakya/workspace/AI-powered-Procurement-Intelligence`; it belongs to another session. Work only in your own worktree.

**Toolchain**
- Node: prefix every Node/npm/npx command with `PATH=/usr/local/bin:$PATH`, which gives Node 24 (the default `node` cannot load better-sqlite3).
- Python: `/Users/sakya/workspace/AI-powered-Procurement-Intelligence/services/scrapling-extractor/.venv/bin/python` (3.12), run from `crawler/`.
- A throwaway MySQL never uses `sh -c`:
  1. `PW=$(openssl rand -hex 16); C=$(docker run -d --rm -e MYSQL_ROOT_PASSWORD="$PW" -p 127.0.0.1::3306 mysql:8)`
  2. Poll `docker exec -e MYSQL_PWD="$PW" "$C" mysqladmin -uroot -h127.0.0.1 ping`.
  3. `PORT=$(docker port "$C" 3306/tcp | head -1 | sed 's/.*://')`; the URL is `mysql://root:$PW@127.0.0.1:$PORT`.
  4. `docker stop "$C"` when done.
- zsh reserves the variable name `status`.

**Commits and files**
- Commits carry no `Co-Authored-By` or other attribution trailer. Stage explicit paths only.
- Never commit `frontend/data/**`, `.env*` or `.DS_Store`.
- Only Task 6 edits `frontend/package.json`. Other tasks run their scripts with `PATH=/usr/local/bin:$PATH npx tsx scripts/<file>.ts`.

**Gate:** crawler pytest; full Vitest; `npm run lint`; tsc error files (excluding `.next/`) equal to the 78-file baseline.

**Fixed values**
- **Deadline zone:** `DEADLINE_ZONE_OFFSET_MINUTES = -600` (UTC−10).
  - A date-only deadline D expires at D+1 00:00 UTC−10.
  - An offsetless time is read as a UTC−10 wall clock.
  - An explicit `Z` or offset is exact.
  - An unparseable or blank deadline never expires.
- **Closed reasons:** `"deadline_passed"` (new) and `"delisted"` (existing). Both are recorded under `raw_payload.lifecycle` as `{ closed_reason, closed_observed_at }`, plus `deadline` for the new reason.
- **Lifecycle invariants:** an `awarded` bid is never downgraded; `is_active` always equals `lifecycle_status === 'open'`; an import that observes a future deadline reopens a bid.
- **NY id shape:**
  - legacy malformed: `ny_contract_reporter:<CR#> Company: <company>`;
  - clean: `ny_contract_reporter:<CR#>`;
  - subcontract marker sentence: `This is a subcontracting opportunity`.
- **Demo bid rule:** a bid is demo data only when its id prefix is NOT a `data_sources.id` AND one of these holds:
  - **demo readiness:** `id` ends with `_demo_readiness` AND `source_bid_id` starts with `demo:`. These rows come from `npm run demo:prepare` (`frontend/scripts/demo-readiness.ts`; ids have no colon; `raw_payload.demoReadiness = true`).
  - **mock seed:** `id` is all digits AND `source_bid_id = 'mock:' || id`. These come from `db:seed` / `MOCK_BIDS`.

  The id prefix is the text before the first `:`, or the whole id when there is none. The local `winbids` data has exactly 50 + 6 such rows; no registered-source row carries these markers.

---

### Task 1: Deadline parser and deadline-passed lifecycle rule

**Files:**
- Create: `frontend/src/lib/bid-deadline.ts`, `frontend/src/lib/bid-deadline.test.ts`
- Modify: `frontend/src/server/crawler/lifecycle.ts`, `frontend/src/server/crawler/lifecycle.test.ts`
- Modify: `frontend/src/server/crawler/persistence-merge.ts` (`mergePersistedBid`, ~:57-106)
- Modify: `frontend/src/server/crawler/bid-intake.ts` (the `mergePersistedBid(...)` call, ~:80)
- Create: `frontend/src/server/bids/lifecycle-sweep.ts`, `frontend/src/server/bids/lifecycle-sweep.test.ts`, `frontend/src/server/bids/lifecycle-sweep.mysql.integration.test.ts`
- Modify: `frontend/src/server/crawler/worker-tick.ts` (after the precheck block, ~:93-110), `frontend/src/server/crawler/worker-tick.test.ts`, `frontend/scripts/crawler-worker.ts` (tick logging, ~:176-183)
- Create: `frontend/scripts/sweep-bid-lifecycle.ts`. Model it on `frontend/scripts/run-detail-backfill-once.ts`: createDatabase plus runMigrations, an optional MySQL pool, and a `finally` that closes it.

**Interfaces (produces):**
```ts
// frontend/src/lib/bid-deadline.ts
export const DEADLINE_ZONE_OFFSET_MINUTES = -600;
export interface ParsedBidDeadline { instantMs: number; dateOnly: boolean }
export function parseBidDeadline(text: string | null | undefined): ParsedBidDeadline | null;
/** Instant (ms) from which the bid counts as expired; null when unparseable. */
export function bidDeadlineExpiresAtMs(text: string | null | undefined): number | null;
export function bidDeadlinePassed(text: string | null | undefined, nowMs: number): boolean;

// frontend/src/server/crawler/lifecycle.ts
export function mergeLifecycleFields(incoming: JsonRecord, existing?: JsonRecord, options?: { now?: string }): JsonRecord;
export function closedRawPayload(raw: unknown, reason: "delisted" | "deadline_passed", at: string, extra?: JsonRecord): string | null;
// delistedRawPayload(raw, at) stays and delegates to closedRawPayload; it keeps its string return type.

// frontend/src/server/bids/lifecycle-sweep.ts
export interface LifecycleSweepResult { scanned: number; closed: number; unparseable: number; closedByIssuerType: Record<string, number>; dryRun: boolean }
export function sweepExpiredBids(target: { database: AppDatabase } | { mysql: MysqlLike }, options: { now: Date; dryRun?: boolean; batchSize?: number }): Promise<LifecycleSweepResult>;
```
Match the codebase's existing types: use the SQLite/MySQL handle shapes that `run-detail-backfill-once.ts` and `detail-history.ts` use (`DetailHistoryStore`).

**Parser rules (exact):**
1. Trim. An empty string, `null` or `undefined` gives `null`.
2. `^/Date\((-?\d+)\)/$` gives an exact instant of that many ms.
   - `^\d{13}$` is epoch milliseconds.
   - `^\d{10}$` is epoch seconds, multiplied by 1000.
   - Either one is accepted only when the resulting UTC year is between 2000 and 2100.
3. ISO forms:
   - `^(\d{4})-(\d{2})-(\d{2})$` is date-only.
   - `^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$` carries a time. With a zone it is exact; without one it is a UTC−10 wall clock.
4. US numeric: `^(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?(?:\s+[A-Za-z]{1,5})?$`.
   - A two-digit year means 2000 + yy.
   - A trailing zone abbreviation such as `CST`, `PDT` or `ET` is accepted and ignored: the time is read as a UTC−10 wall clock.
5. Month name, case-insensitive: `^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s*@?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?(?:\s+[a-z]{1,5})?$`.
6. Validation, where any failure gives `null`:
   - month 1–12;
   - day within the month, including leap years;
   - hour 0–23, or 1–12 when AM/PM is given;
   - minute and second 0–59.
7. AM/PM: 12 AM gives 0; 12 PM gives 12; any other h PM gives h + 12.
8. Instants:
   - date-only: `instantMs = Date.UTC(y, m-1, d) - DEADLINE_ZONE_OFFSET_MINUTES*60000`, the start of day D in UTC−10;
   - offsetless time: `Date.UTC(y, m-1, d, h, mi, s) - DEADLINE_ZONE_OFFSET_MINUTES*60000`;
   - zoned: the exact instant.
9. `bidDeadlineExpiresAtMs`: date-only gives `Date.UTC(y, m-1, d+1) - DEADLINE_ZONE_OFFSET_MINUTES*60000`; otherwise `instantMs`.
10. `bidDeadlinePassed(text, now)` is `expiresAt !== null && now >= expiresAt`.
11. The module is pure: no `Date.now()`, no `new Date(string)`, no dependence on the server time zone.

**`bid-deadline.test.ts`.** Every case uses `NOW = Date.UTC(2026, 9, 13, 12, 0, 0)` (2026-10-13T12:00:00Z) and asserts `bidDeadlinePassed(text, NOW)`.

*Passed (true):*
- `"10/12/2026"`
- `"2026-10-12"`
- `"10/13/2026 2:00 AM"`, which equals NOW
- `"05/31/26"`
- `"4/16/2026"`
- `"Aug 21, 2026 @ 02:00 PM"`
- `"1761757200000"`
- `"2026-10-13T11:59:59Z"`

*Not passed (false):*
- `"10/13/2026"`
- `"2026-10-13"`
- `"10/13/2026 2:00 PM CST"`
- `"Dec 1, 2026 @ 10:00 AM"`
- `"/Date(1893456000000)/"`
- `"2026-10-13T12:00:01Z"`
- `"2026-10-13T08:00:00-05:00"`
- `"01/01/2028"`

*Unparseable (`parseBidDeadline` returns `null`, so not passed):*
- `"Not Available"`, `"TBD"`, `""`, `null`
- `"02/30/2026"`, `"13/01/2026"`, `"2026-02-29"`
- `"10/12/2026 25:00"`
- `"10/12/2026 13:00 PM"`

*Valid:* `"2028-02-29"`, as a leap day.

*Exact values to assert:*
- `parseBidDeadline("10/12/2026")` gives `{ instantMs: Date.UTC(2026,9,12,10), dateOnly: true }`.
- `bidDeadlineExpiresAtMs("10/12/2026")` gives `Date.UTC(2026,9,13,10)`.

**Import-time rule.**
- `mergeLifecycleFields(incoming, existing, { now })` first computes the status exactly as today.
- Then, when `now` parses as an ISO instant, the status is `open`, and `bidDeadlinePassed(deadline, Date.parse(now))` holds, it returns `lifecycle_status: "closed"` and `is_active: 0`. Here `deadline = text(incoming.deadline_date) || text(existing.deadline_date)`.
- Without `now`, the behaviour is unchanged.

`mergePersistedBid(incoming, existing, options?: { now?: string })` passes `now` through. When the deadline rule closed the bid, it sets `merged.raw_payload.lifecycle = { ...previous lifecycle block, closed_reason: "deadline_passed", closed_observed_at: now, deadline }`. It sets this on the merged raw_payload object it already builds (~:86-100).

`bid-intake.ts` calls `mergePersistedBid(row, prior ?? undefined, { now: payload.finishedAt ?? payload.startedAt })`.

Because the incoming raw payload replaces the old one, a reopened bid carries no stale `closed_reason`. Add a test for that.

**`closedRawPayload`:**
- When `raw` is a JSON object (a string parsing to an object, or an object), return `JSON.stringify({ ...raw, lifecycle: { ...raw.lifecycle, closed_reason: reason, closed_observed_at: at, ...extra } })`.
- Otherwise return `null`. The sweep then leaves `raw_payload` untouched, so a non-JSON payload is never destroyed.
- `delistedRawPayload` keeps its current behaviour for objects. For non-objects it returns the same `JSON.stringify({ lifecycle: … })` as today; keep it exactly as is so the existing delist tests still pass.

**Sweep:**
- Page with `SELECT id, deadline_date, issuer_type, raw_payload FROM bids WHERE lifecycle_status = 'open' AND id > ? ORDER BY id LIMIT ?`, default `batchSize` 500. In SQLite this goes through Drizzle `sql` or the client the codebase uses for raw SQL.
- For each row where `bidDeadlinePassed(deadline_date, now)`: `UPDATE bids SET lifecycle_status = 'closed', is_active = 0, raw_payload = ?, updated_at = ? WHERE id = ? AND lifecycle_status = 'open'`.
  - `raw_payload` is `closedRawPayload(raw, "deadline_passed", nowIso, { deadline })` when that returns non-null; otherwise the column is left out of the SET.
  - One transaction per page (`mysqlTransaction` / Drizzle transaction).
- `dryRun` writes nothing but counts the same way.
- `unparseable` counts open rows with a non-blank deadline that `parseBidDeadline` rejects.
- `closedByIssuerType` is keyed by `issuer_type`.

**Worker tick:** after the precheck block, run `sweepExpiredBids(<same store>, { now })` in its own try/catch. Add `lifecycleSweep?: LifecycleSweepResult` and `lifecycleSweepError?: string` to the tick result. `crawler-worker.ts` logs `JSON.stringify({ event: "crawler_lifecycle_sweep", ...result })` when `closed > 0` or on error, in the same style as the neighbouring log lines.

**Script `sweep-bid-lifecycle.ts`:**
- Register it in `frontend/scripts/mysql-pool-exit.test.ts` (case list ~:109-124), like the other scripts there.
- Flags `--dry-run` and `--json`.
- Prints `scanned`, `closed`, `unparseable` and the per-issuer-type closures.
- Works on whichever dialect `DATABASE_URL` selects.
- Exit 0 on success, 1 on error.

**Tests (all must be added and pass):**
- `bid-deadline.test.ts`: all of the parser cases above.
- `lifecycle.test.ts`:
  - with `now`, an open incoming row with a passed deadline closes;
  - a future deadline stays open;
  - an awarded existing row stays awarded;
  - a closed existing row with an incoming future deadline reopens;
  - without `now`, nothing changes;
  - a missing incoming deadline falls back to the existing one;
  - `closedRawPayload` returns `null` for non-JSON.
- Import path, in the existing importer or bid-intake tests:
  - a crawl of an open row with a past deadline stores `lifecycle_status = "closed"`, `is_active = 0` and `raw_payload.lifecycle.closed_reason = "deadline_passed"`;
  - re-importing the same bid with a future deadline stores it open, with no `closed_reason`.
- `lifecycle-sweep.test.ts` (SQLite), with seeded open rows in several formats:
  - closes exactly the expired ones;
  - leaves awarded and closed rows alone;
  - counts unparseable rows;
  - `dryRun` writes nothing;
  - is idempotent on a second run;
  - preserves a non-JSON raw_payload;
  - pages correctly with `batchSize: 2`.
- `lifecycle-sweep.mysql.integration.test.ts`: the same scenario on real MySQL.
- `worker-tick.test.ts`: the tick result carries `lifecycleSweep`, and a sweep failure becomes `lifecycleSweepError` without failing the tick. Existing tests stay green, including the case where an open bid with no deadline stays active.
- Existing tests must stay green: `sqlite-json-importer.test.ts`, `mysql-json-importer.test.ts`, `bid-intake.test.ts`, `bidnet-lifecycle.integration.test.ts`, `detail-history*.test.ts`.

**Commit message:** `feat(lifecycle): close bids whose deadline has passed, at import and in a worker sweep`

---

### Task 2: NY Contract Reporter subcontracting cards

**Files:**
- Modify: `crawler/apsi_crawler/spiders/ny_contract_reporter.py`: `_FIELD_LABELS` (~:18-32), `_fields_from_chunks` (~:84-100), `_record_from_item` (~:103-121)
- Create: `crawler/tests/fixtures/ny_ads_search_subcontract.html`
- Create: `crawler/tests/test_ny_contract_reporter_subcontract.py`

**Behaviour:**
1. Add `"Company:"` to `_FIELD_LABELS`.
2. Add `_SUBCONTRACT_MARKERS = ("this is a subcontracting opportunity",)`. A chunk whose lowercased, trailing-period-stripped text equals a marker is not appended to any field value. It sets `fields["__subcontracting__"] = True`, or an equivalent flag that `_record_from_item` reads.
3. Defensive split in `_record_from_item`:
   - If the CR# value matches `^(\S+)\s+Company:\s*(.+)$` and there is no separate `Company:` field, the CR# becomes group 1 and the company becomes group 2 (stripped).
   - If the title ends with ` This is a subcontracting opportunity`, case-insensitive with an optional `.`, strip it and mark the record as subcontracting.
4. The record dict gains:
   - `"issuer_name": fields.get("Agency:") or company`;
   - `"contractor_company": company` (or `None`);
   - `"subcontracting": True|False`.

   Everything else is unchanged: CR# stays the preferred id, falling back to `data-ad-id`, and the URL template is unchanged. The new keys land in `raw_payload` through the normalizer's raw copy.
5. Do not change `normalizers/state_bids.py`'s `"Unknown state agency"` default.

**Fixture `ny_ads_search_subcontract.html`:**
- Copy the outer markup of one card from `crawler/tests/fixtures/ny_ads_search_live_response.html`: same element structure, classes and `data-ad-id` attribute.
- Use `data-ad-id="2138281"` and these chunks, in order:
  - `Title:` → `PIKE CS - NYS OGS Empire State Plaza Decarb Plan`;
  - a separate element holding `This is a subcontracting opportunity`;
  - `CR#:` → `2138281`;
  - `Company:` → `Pike Construction Services, Inc.`;
  - `Issue date:` → `8/20/2026`;
  - `Due date:` → `9/8/2026`;
  - `Category:` → `Construction Vertical: Building Construction; Rehabilitation & New Construction`.
- Add a second card, `data-ad-id="2138289"`, where CR# and company sit in ONE text node, `2138289 Company: E.W. Howell Co., LLC.`, with title `CUNY Queens College - Razran Hall & Science Laboratory Renovation`.

**Tests in `test_ny_contract_reporter_subcontract.py`.** Feed the fixture through the same public entry point the existing live-HTML test uses (`crawler/tests/test_state_live_sources.py:135-165`), then normalize.

*Card 2138281:*
- `id == "ny_contract_reporter:2138281"`
- `source_bid_id == "2138281"`
- `dedupe_key == id`
- `title == "PIKE CS - NYS OGS Empire State Plaza Decarb Plan"`
- `issuer_name == "Pike Construction Services, Inc."`
- `raw_payload["contractor_company"]` equals that company
- `raw_payload["subcontracting"] is True`
- `deadline_date == "9/8/2026"`
- `source_url.endswith("/Ads/Details/2138281")`

*Card 2138289:* `id == "ny_contract_reporter:2138289"` and `issuer_name == "E.W. Howell Co., LLC."`.

*Both cards:* `apsi_crawler.data_quality.core_issues(...)` (or the module's public equivalent) reports no `invalid_issuer`.

*Existing cards:* the two cards in `ny_ads_search_live_response.html` still produce byte-identical records, with `subcontracting False` and `contractor_company None` as the only new keys. All existing tests in `crawler/tests` pass.

**Commit message:** `fix(crawler): NY Contract Reporter subcontracting cards get a clean id and the contractor as issuer`

---

### Task 3: Data migrations — correct legacy FIPS drift, re-key NY subcontract rows

**Files:**
- Modify: `frontend/src/server/db/migrate.ts`: new statements after the legacy issuer backfill (~:1316-1334)
- Modify: `frontend/src/server/db/mysql.ts`: new exported constants plus `mysqlDataMigrationStatements()` (~:505-523)
- Modify: `frontend/src/server/db/local-issuer-type-backfill.test.ts`, `frontend/src/server/db/local-issuer-type-backfill.mysql.integration.test.ts`, `frontend/src/server/db/mysql.test.ts`
- Create: `frontend/src/server/db/ny-subcontract-rekey.test.ts`, `frontend/src/server/db/ny-subcontract-rekey.mysql.integration.test.ts`

**3a. FIPS drift.** A legacy local row was skipped by the backfill only because its stored FIPS is stale. It gets its source's level and FIPS, and keeps the old FIPS under `raw_payload.legacy_fips_code`.

SQLite: one statement. SET expressions read the pre-update row, so `bids.fips_code` inside `json_set` is the old value.
```sql
UPDATE bids SET
  issuer_type = data_sources.jurisdiction_level,
  raw_payload = CASE WHEN json_valid(bids.raw_payload) AND json_type(bids.raw_payload) = 'object'
    THEN json_set(bids.raw_payload, '$.legacy_fips_code', bids.fips_code) ELSE bids.raw_payload END,
  fips_code = data_sources.fips_code
FROM data_sources
WHERE bids.issuer_type = 'state' AND instr(bids.id, ':') > 1
  AND data_sources.id = substr(bids.id, 1, instr(bids.id, ':') - 1)
  AND data_sources.jurisdiction_level IN ('county', 'city', 'township', 'special_district')
  AND data_sources.state_code = bids.state_code
  AND (bids.jurisdiction_level IS NULL OR bids.jurisdiction_level = '' OR bids.jurisdiction_level = data_sources.jurisdiction_level)
  AND bids.fips_code IS NOT NULL AND bids.fips_code <> ''
  AND data_sources.fips_code IS NOT NULL AND data_sources.fips_code <> ''
  AND bids.fips_code <> data_sources.fips_code;
```
MySQL: two statements, in this order. Multi-table UPDATE assignment order is not guaranteed, so the stamp goes first.
```ts
export const MYSQL_LEGACY_FIPS_DRIFT_CONDITION = " WHERE bids.issuer_type = 'state' AND LOCATE(':', bids.id) > 1"
  + " AND data_sources.jurisdiction_level IN ('county', 'city', 'township', 'special_district')"
  + " AND data_sources.state_code COLLATE utf8mb4_bin = bids.state_code COLLATE utf8mb4_bin"
  + " AND (bids.jurisdiction_level IS NULL OR bids.jurisdiction_level = '' OR bids.jurisdiction_level = data_sources.jurisdiction_level)"
  + " AND bids.fips_code IS NOT NULL AND bids.fips_code <> ''"
  + " AND data_sources.fips_code IS NOT NULL AND data_sources.fips_code <> ''"
  + " AND bids.fips_code COLLATE utf8mb4_bin <> data_sources.fips_code COLLATE utf8mb4_bin";
export const MYSQL_LEGACY_FIPS_DRIFT_STAMP = "UPDATE bids JOIN data_sources ON data_sources.id = SUBSTRING_INDEX(bids.id, ':', 1)"
  + " SET bids.raw_payload = JSON_SET(bids.raw_payload, '$.legacy_fips_code', bids.fips_code)"
  + MYSQL_LEGACY_FIPS_DRIFT_CONDITION + " AND JSON_VALID(bids.raw_payload) AND JSON_TYPE(bids.raw_payload) = 'OBJECT'";
export const MYSQL_LEGACY_FIPS_DRIFT_RETYPE = "UPDATE bids JOIN data_sources ON data_sources.id = SUBSTRING_INDEX(bids.id, ':', 1)"
  + " SET bids.issuer_type = data_sources.jurisdiction_level, bids.fips_code = data_sources.fips_code"
  + MYSQL_LEGACY_FIPS_DRIFT_CONDITION;
```
`mysqlDataMigrationStatements()` returns `[lifecycle UPDATE, MYSQL_LOCAL_ISSUER_TYPE_BACKFILL, MYSQL_LEGACY_FIPS_DRIFT_STAMP, MYSQL_LEGACY_FIPS_DRIFT_RETYPE, ...3b statements]`.

**Update the migrate.ts comment above the legacy backfill.** It must say that a FIPS-drifted row is now corrected, with its FIPS aligned to the source and the old value kept in `legacy_fips_code`. The FIPS guard on the first statement stays, because the second statement handles exactly those rows.

**Tests (3a):**
- In `local-issuer-type-backfill.test.ts`, the drift fixture row (`bidnet_co_boulder:drift`, or whatever it is named) now expects:
  - `issuer_type` equal to the source level;
  - `fips_code` equal to the source FIPS;
  - `raw_payload.legacy_fips_code` equal to the old FIPS.
- A drift row whose raw_payload is non-JSON is corrected with raw_payload unchanged.
- The lowercase state-code row still stays `state`.
- Running migrations twice changes nothing more.
- The MySQL integration test gets the same expectations.
- `mysql.test.ts` asserts the statement order and pins the three constants.

**3b. NY re-key.** A row whose id is `ny_contract_reporter:<cr> Company: <company>` is handled as follows:
- When no row has id `ny_contract_reporter:<cr>` and no child row references the old id:
  - `id` and `dedupe_key` become `ny_contract_reporter:<cr>`;
  - `source_bid_id` becomes `<cr>`;
  - `issuer_name` becomes `<company>` when it is NULL, empty, or starts with `Unknown`;
  - `title` has a trailing ` This is a subcontracting opportunity` removed (case-insensitive, then trimmed).
- When a clean row already exists and the malformed row has no children: delete the malformed row.
- When the malformed row has child references: leave it unchanged.

"Child references" means any row in:
`bid_attachments`, `bid_field_corrections`, `saved_bids`, `intent_to_bid`, `submission_paths`, `award_outcomes`, `compliance_manifest_items`, `pursuit_decisions`, `response_workspace_items`, `response_package_snapshots`, `response_package_exports`, `response_package_export_review_events`, `supplier_artifacts`, `artifact_versions`, `quote_requests`, `deadline_reminders` (all `bid_id`), and `knowledge_items.source_bid_id`.

Write one SQLite statement per case (UPDATE, then DELETE) and the MySQL equivalents.
- SQLite parses with `instr(source_bid_id, ' Company: ')` and `substr`.
- MySQL uses `SUBSTRING_INDEX(bids.source_bid_id, ' Company: ', 1)` and `SUBSTRING_INDEX(bids.source_bid_id, ' Company: ', -1)`.
- The MySQL self-reference check for an existing clean row must use a derived table (`NOT EXISTS (SELECT 1 FROM (SELECT id FROM bids) AS existing WHERE existing.id = …)`), because MySQL refuses to UPDATE a table it also selects from directly.

Match on `bids.id LIKE 'ny!_contract!_reporter:% Company: %' ESCAPE '!'`.

**Tests (3b)**, in SQLite and in the MySQL integration test:
- a malformed row with no clean twin and no children is re-keyed with every field asserted;
- a malformed row with a clean twin is deleted, and the twin is unchanged;
- a malformed row referenced by `saved_bids` is unchanged;
- a clean NY row is never touched;
- a second migration run is a no-op.

**Commit message:** `fix(db): correct FIPS-drifted legacy local bids and re-key NY subcontract rows`

---

### Task 4: Demo/seed bid purge, including every dependent row

**Files:**
- Create: `frontend/src/server/integrity/demo-purge.ts`, `frontend/src/server/integrity/demo-purge.test.ts`, `frontend/src/server/integrity/demo-purge.mysql.integration.test.ts`
- Create: `frontend/scripts/purge-demo-bids.ts`. Use `frontend/scripts/state-data-quality-check.ts` as the skeleton: arg parsing, `--json`, `isMysqlDatabaseUrlConfigured(env)`, entry guard, pool closed in `finally`, and the target printed via `redactMysqlDatabaseUrl`.
- Modify: `frontend/scripts/mysql-pool-exit.test.ts`. Register the new script in its case list (~:109-124), the same way the existing scripts are registered.

**Interfaces (produces):**
```ts
export interface DemoBid { id: string; sourceBidId: string; title: string | null; stateCode: string | null; lifecycleStatus: string | null; kind: "demo_readiness" | "mock_seed" }
export interface DemoPurgePlan { bids: DemoBid[]; dependents: Record<string, number>; knowledgeItemsToDetach: number }
export function findDemoBids(target): Promise<DemoBid[]>;
export function planDemoPurge(target): Promise<DemoPurgePlan>;
export function purgeDemoBids(target, options: { apply: boolean }): Promise<DemoPurgePlan & { applied: boolean; deleted: Record<string, number> }>;
```
`target` uses the same `{ database } | { mysql }` shape as Task 1's sweep.

**Demo rule:** exactly the Global Constraints rule. Implement it once, as a pure predicate `isDemoBidRow(row, registeredSourceIds)`, and use it in both dialects. Task 5 reuses it.

**Dependents.** Every row that would be orphaned is deleted.
- **Direct `bid_id` children:** `bid_attachments`, `bid_field_corrections`, `saved_bids`, `intent_to_bid`, `submission_paths`, `award_outcomes`, `compliance_manifest_items`, `pursuit_decisions`, `response_workspace_items`, `response_package_snapshots`, `response_package_exports`, `response_package_export_review_events`, `supplier_artifacts`, `artifact_versions`, `quote_requests`, `deadline_reminders`.
- **Indirect children** reference those rows, not `bids`. Examples: `submission_confirmations`, `response_workspace_comments`, `response_workspace_activity`, `response_workspace_item_artifacts`, `quote_request_artifacts`.
- **Derive the full graph from the `REFERENCES` clauses in `frontend/src/server/db/migrate.ts`.** Encode it as a static ordered table list in `demo-purge.ts`, children first.
- Add a structural test that reads `migrate.ts` and fails if any table whose `REFERENCES` chain reaches `bids` is missing from that list. Future tables then cannot be silently orphaned.
- `knowledge_items.source_bid_id` is set to `NULL`, matching SQLite's `ON DELETE SET NULL`. It is not deleted.
- Soft, unkeyed references are left untouched as history, and the docs say so: `notification_outbox.matched_bid_ids`, `search_alert_digest_runs.matched_bid_ids_json`, `event_log.target_id`/`metadata_json`, `ai_call_logs.metadata_json`, `crawler_logs.metadata`.

**Apply:**
- One transaction: delete the dependents children-first, detach `knowledge_items`, then delete the bids.
- SQLite runs `PRAGMA foreign_key_check` before commit and rolls back if it returns rows.
- MySQL, after the deletes and before commit, runs one orphan-count query per relationship in the static list. It rolls back if any count is non-zero.
- Without `apply`, nothing is written; it returns the same plan with counts.
- A second apply finds no demo bids and writes nothing.

**Script `purge-demo-bids.ts`:**
- Default is a dry run that prints the plan: the demo bid count by kind, then per-table dependent counts.
- `--apply` executes, and requires `--backup-file <path>` pointing to an existing non-empty file. Without that it exits 2 with a message saying to take a backup first (`npm run db:backup`, or `mysqldump` inside the container).
- `--json` prints machine-readable output.
- Exit codes: 0 OK, 1 error, 2 usage.

**Tests (SQLite) in `demo-purge.test.ts`:**
- Seed the following:
  - two demo-readiness bids (`al_state_procurement_demo_readiness`, `source_bid_id` `demo:al_state_procurement`);
  - two mock bids (`"1"`, `"2"`, `source_bid_id` `mock:1`/`mock:2`);
  - an unregistered bid that matches NO marker (for example id `orphan_source:9`), which must survive;
  - a real registered bid.
- Give every bid dependents across at least: attachments, an intent with workspace items and a workspace comment, a response package snapshot with an export and a review event, saved_bids, an award outcome, a quote request with a quote artifact, a deadline reminder, and a knowledge item.
- Assert:
  - the dry-run counts are exact;
  - apply removes exactly the four demo bids and their dependents;
  - the real bid, the non-matching unregistered bid and all their dependents are intact;
  - the knowledge item pointing at a demo bid now has `source_bid_id IS NULL`;
  - `PRAGMA foreign_key_check` is empty;
  - a second apply deletes 0;
  - the structural `REFERENCES` coverage test passes.

**MySQL integration:** the same seed and assertions on real MySQL, including zero orphans for every relationship.

**Commit message:** `feat(integrity): purge demo and seed bids with every dependent row, dry-run by default`

**Coverage note.** All 50 states have real open state-level bids from their registered sources, so the purge removes no state's coverage. The only demo-only code is "US", because SAM.gov has no API key.

**Risks the docs must state:**
- `npm run demo:prepare` against MySQL re-creates the 50 demo-readiness bids, and `db:mysql:import-sqlite` re-imports any rows still in a local SQLite file. Neither may run against `winbids` or production.
- `data:integrity`'s `demoLike` metric makes any re-pollution visible.

---

### Task 5: `data:integrity` — per-level report and before/after compare

Depends on Task 1 (`@/lib/bid-deadline`) and Task 4 (`isDemoBidRow`).

**Files:**
- Create: `frontend/src/server/integrity/data-integrity.ts`, `frontend/src/server/integrity/data-integrity.test.ts`, `frontend/src/server/integrity/data-integrity.mysql.integration.test.ts`
- Create: `frontend/scripts/data-integrity.ts`

**Levels.** A bid's level is its `issuer_type` when that is one of `state | county | city | township | special_district | federal`, otherwise `other`.

**Visibility** must use exactly the search path's predicate: `display_status <> 'suppressed'`, `isPublishableRow` (`frontend/src/server/bids/repository.ts`, ~:53-64), and `isActive`. Read rows in pages and evaluate them in JS with the same functions. Do not reimplement the gate in SQL.

`isPublishableRow` combines two checks: the registered-source identity guard (`bids/registered-source-identity.ts`) and `getBidUsability(...).discovery`. In that guard a registered source compares fields, an ambiguous one hides the row, and an UNKNOWN source leaves the row visible.

So `identityMismatch` must be computed independently. Use `createRegisteredSourceIndex().resolveBid` and `sourceIdentityDifferences` from `frontend/src/lib/source-identity.ts` (~:30, ~:59-83), with the exact state comparison.

`unregistered` and `demoLike` use the id-prefix rule and Task 4's `isDemoBidRow`, imported from `@/server/integrity/demo-purge`. That makes Task 5 depend on Task 4 too.

**Script skeleton:** follow `frontend/scripts/state-data-quality-check.ts`:
- arg parsing;
- `--json`;
- `isMysqlDatabaseUrlConfigured(env)`;
- an entry guard;
- the pool closed in `finally`;
- the target printed with `redactMysqlDatabaseUrl`.

Use per-dialect loaders feeding a pure report builder, as `frontend/scripts/demo-readiness.ts` does (~:876-981). Register the script in `frontend/scripts/mysql-pool-exit.test.ts`.

Importing `@/server/db/client` opens `cwd/data/apsi.sqlite` in SQLite mode. In MySQL mode its `db` is a throwing proxy, so take explicit handles rather than the singleton wherever possible.

**Report** (`buildIntegrityReport(target, { now })` returns `IntegrityReport`; both dialects). Per level:
- **counts:** `total`, `open`, `closed`, `awarded`;
- **visibility:**
  - `openVisible`;
  - `openHidden`;
  - `hiddenReasons`, the top issue codes from `getBidUsability`, with counts;
- **identity and source checks:**
  - `identityMismatch`: the row's registered source, found through the id prefix, disagrees on level (`issuer_type`/`jurisdiction_level` for local sources), on state (exact) or on FIPS (both non-empty);
  - `unregistered`: the id prefix is not a `data_sources.id`;
  - `demoLike`: the Global Constraints demo rule;
- **completeness among open rows:**
  - `withBody`: `getBidDescription` is non-empty;
  - `bodyLockedAtSource`: `detailAccessFromRawPayload(...)?.restricted` includes `"description"`;
  - `withIssuer`: the issuer is non-blank and does not start with `Unknown`;
  - `deadlineParseable`;
  - `withSourceUrl`;
- **lifecycle health:** `expiredOpen` (open, and `bidDeadlinePassed(deadline, now)`);
- **freshness:**
  - `newestLastSeenAt`;
  - per-level source health from `data_sources` (`is_enabled = 1`): `sources`, `neverSucceeded`, `succeededWithin2d`, `succeededWithin7d`, `failing` (`consecutive_failures > 0`).

  State and federal sources are those with a NULL or empty `jurisdiction_level`; they are reported as level `state` unless `id = 'sam_gov'`, which is `federal`.

**Snapshot** (`--snapshot <file>`): JSON `{ version: 1, takenAt, dialect, report, rows }`.
- `rows` maps `id` to `{ h, level, visible, open, t }`.
- `h` is the sha256 of a canonical JSON of every bids column. Use `SELECT *`; order the keys; keep NULL distinct from an empty string.
- `t` holds `issuer_type, jurisdiction_level, fips_code, lifecycle_status, is_active, display_status, issuer_name, title, deadline_date, source_bid_id`.

**Compare** (`--compare <file>`):
- Reports:
  - added and removed ids by level;
  - changed rows, grouped by which `t` columns changed (for example `issuer_type state→city: 11`, `lifecycle_status open→closed: 340`);
  - rows whose only change is outside `t`;
  - a per-level metric delta table.
- It **fails** (exit 1):
  - when an id was removed and does not match `--allow-removed <regex>`, which is repeatable and defaults to none;
  - when a row that was open and visible before is still present and open now but not visible (a visibility regression);
  - when a level's `identityMismatch` increased.
- It **warns** when a row went open→closed without `raw_payload.lifecycle.closed_reason` being `deadline_passed` or `delisted`.

**Script `data-integrity.ts`:**
- Flags: `--json`, `--snapshot <file>`, `--compare <file>`, `--allow-removed <regex>` (repeatable).
- The default output is a human-readable per-level table.
- Exit codes: 0 OK, 1 regression, 2 usage error.
- It never writes to the database.

**Tests:**
- SQLite, with seeded rows covering:
  - state, county and city levels;
  - an open hidden row (`issuer_name` "Unknown state agency");
  - a FIPS-mismatched row;
  - an unregistered demo row;
  - a body-locked BidNet row (`raw_payload.detail_access`);
  - an expired open row;
  - a closed row.
- Assert every metric.
- Snapshot, then mutate (delete a row, hide a visible open row by changing its issuer to "Unknown x", retype a row), then compare. Assert:
  - the failures and the exit decision;
  - the removed id;
  - the visibility regression;
  - that `--allow-removed` lets the deletion pass.
- MySQL integration: the same report on real MySQL, where the counts must equal the SQLite run on identical seed data.

**Commit message:** `feat(integrity): data:integrity report and row-level before/after compare for state, county and city data`

---

### Task 6: Wiring and documentation

**Files:**
- Modify: `frontend/package.json`
  - scripts: `"data:integrity": "tsx scripts/data-integrity.ts"`, `"bids:lifecycle:sweep": "tsx scripts/sweep-bid-lifecycle.ts"`, `"bids:purge-demo": "tsx scripts/purge-demo-bids.ts"`;
  - append to `test:crawler-integration`: `src/server/bids/lifecycle-sweep.mysql.integration.test.ts src/server/db/ny-subcontract-rekey.mysql.integration.test.ts src/server/integrity/data-integrity.mysql.integration.test.ts src/server/integrity/demo-purge.mysql.integration.test.ts`.
- Create: `docs/operations/data-integrity.md`, a Chinese runbook covering:
  - why;
  - before and after every migration, deploy or data fix: backup, then `npm run data:integrity -- --snapshot before.json`, then the change, then `--compare before.json`;
  - how to read the report;
  - the deadline rule;
  - the demo purge with `--apply` and its backup requirement;
  - the warning never to run `npm run demo:prepare` or `db:mysql:import-sqlite` against `winbids` or production, because both re-create demo bids;
  - BidNet detail locking. Anonymous visitors see "Description Locked — Registered members only", so local bodies cannot be completed without a vendor login, which the project never uses.
- Modify:
  - `docs/operations/bid-lifecycle-and-crawl-budget.md`: the deadline rule, the sweep, `closed_reason` values;
  - `docs/qa/crawler-data-usability-fixes-2026-10-01.md`: append a dated `## 数据完整性（2026-10-13）` section. Aurora is now corrected; NY subcontract rows are fixed; demo data is purged; the deadline rule; the integrity tool. Also correct the sentence that says the Aurora rows are deliberately left alone.
  - `CLAUDE.md`:
    - command list: `data:integrity`, `bids:lifecycle:sweep`, `bids:purge-demo`;
    - the "Paged BidNet lists & bid lifecycle" paragraph: the deadline rule and sweep;
    - the "Testing" section: `test:crawler-integration` now includes the new files.

**Commit message:** `docs: data-integrity runbook, deadline rule, NY subcontract fix, demo purge; wire the npm scripts`

---

## Independent test phase (after Tasks 1–6 are integrated)

Run by agents that did not write the code, on a different model from the implementers.
1. **Acceptance tests.** From this plan's requirements alone, without the implementers' reports, write black-box tests:
   - `frontend/src/__acceptance__/data-integrity.acceptance.test.ts`;
   - `crawler/tests/test_acceptance_ny_subcontract.py`.

   Then run the full gate.
2. **Data rehearsal** on a throwaway MySQL, never `winbids`:
   - restore the newest winbids backup;
   - `data:integrity --snapshot`;
   - `db:mysql:migrate`;
   - `bids:purge-demo --apply`;
   - `bids:lifecycle:sweep`;
   - `data:integrity --compare --allow-removed '<demo rule>'`.

   Expected:
   - 0 unexplained removals;
   - 0 visibility regressions;
   - Aurora's 11 rows become city with FIPS 0804000;
   - the 22 NY rows are re-keyed;
   - 56 demo bids and their dependents are gone;
   - the expired open rows are closed with `deadline_passed`;
   - every other row is byte-identical.
3. **Final whole-branch review** on a third model.

Any failure goes to an automatic fix (implementer model), then a re-test (tester model), for up to five rounds.
