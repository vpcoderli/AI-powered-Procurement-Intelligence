# Data Usability P0 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five P0 defects that the 2026-10-09 code review found in the Codex data-usability work (`codex/data-usability-20261001`). After the fixes, merging it must not hide legacy local bids, erase verified bodies, download SAM attachments inside the crawl, read unbounded history, or discard real procurement text.

**Architecture:** Five independent corrections, committed on a branch cut from the committed Codex work:
- **P0-1:** an idempotent data migration in both dialects, built the same way as the existing `lifecycle_status` backfill.
- **P0-2:** resets the per-run provenance whenever history is reused.
- **P0-3:** makes inline SAM archiving opt-in and leaves archiving to the attachment-repair worker.
- **P0-4:** replaces the unbounded `SELECT *` history read with two bounded queries, one for list runs and one for backfill runs.
- **P0-5:** gives both description classifiers the same tightened rules and adds a shared TS/Python contract fixture.

**Tech Stack:**
- TypeScript: Next.js 16 server code, Vitest 4, Drizzle on `better-sqlite3`, and `mysql2` on MySQL 8.
- Python 3.12 crawler: stdlib, `requests` and pytest.

**Origin:** The findings come from the 2026-10-09 `/engineering:code-review` of the uncommitted working tree. That tree is based on `8897029`; its last edit was 2026-10-09 11:57, and it had not changed by 2026-10-12. The impact numbers below come from replaying this plan's rules over a read-only export of local `winbids` (7,230 bids). Before this plan was written, every SQL statement in it was also run on SQLite 3.53 and on a throwaway MySQL 8.

---

## The five findings

### P0-1: Legacy county, city and township bids disappear
- **Cause:** The old state normalizer stored every bid with `issuer_type: "state"`; the new one uses `source.jurisdiction`. The new publication gate rejects the stored rows:
  - `getBidCoreIssues` (`frontend/src/lib/bid-usability.ts`) adds `jurisdiction_mismatch`. It also adds `invalid_fips_code`, because it expects 2 FIPS digits for `state`.
  - The registered-source guard (`frontend/src/server/bids/registered-source-identity.ts`) compares the bid with its source's level.
  - Nothing rewrites the stored rows.
- **Effect:** 1,355 of 7,230 bids are hidden, including all 555 county, 703 city and 71 township bids.
- **Without a fix:**
  - An open bid comes back only after its source recrawls. `bid-intake.ts` skips the identity-change check when the stored row is already core-invalid.
  - Closed and awarded bids never come back.

### P0-2: A failed detail retry erases the verified body
- **Cause:** `apply_detail_history` (`crawler/apsi_crawler/detail_backfill.py`) copies the previous run's `raw_payload.enrichment`, `applied_fields` included. `record_outcome` clears that list only when nothing was attempted.
- **Why it is common:** The default enrichment `fields` include `attachments`. Their completeness check is always false (`enrichment.py`, `_already_complete`), so every enrichment-enabled bid gets a fetch attempt.
- **Effect:** When the fetch fails, the stale list reaches `mergePersistedBid` (`frontend/src/server/crawler/persistence-merge.ts`) or `prepare_persisted_bid` (`crawler/apsi_crawler/data_quality.py`). Both then accept the list summary as fresh detail text and clear `full_description`.

### P0-3: Every SAM run downloads every attachment
- **Cause:**
  - SAM `resourceLinks` are now recorded as attachments (`crawler/apsi_crawler/normalizers/bids.py`, `_resource_attachments`).
  - `buildArgs` (`frontend/src/server/crawler/sam-gov-runner.ts`) passes `--archive-documents` unless a caller sets `archiveDocuments: false`.
  - The only managed caller (`configured-runner.ts`) never sets it.
- **Effect:** Downloads run one after another, unthrottled, for the whole 30-day window, inside one 30-minute task budget. A timeout kills the run and discards everything it fetched.

### P0-4: Detail history is unbounded
- **Cause:**
  - `loadDetailHistory` (`frontend/src/server/crawler/detail-history.ts`) runs `SELECT * … WHERE id LIKE ? ESCAPE '!'` with no row limit. On SQLite this is a full table scan (`SCAN bids`).
  - With automatic backfill on, it runs up to three times per source per tick: twice in `configured-runner.ts`, once in `state-runner.ts`.
  - Backfill output carries every candidate (`cli.py`, `fetch_task` / `fetch_sam_gov`).
- **Effect:** SAM history grows until the JSON exceeds the V8 string limit or the 64 MB child stdout buffer.

### P0-5: The description classifiers discard real text and disagree
- **Cause:** Prefix rules in `getBidDescriptionIssue` (`frontend/src/lib/bid-description.ts`) and `valid_body_text` (`detail_backfill.py`) reject real procurement text:
  - "Signing and striping…", "Sign installation…", "Login.gov integration…" and "Unauthorized vehicle towing…".
  - "Register of Deeds…" (Python only).
  - Any one-line text that starts with a street address and ends with a ZIP.
- **Divergence:** The two languages also disagree on HTML pages, "Combined Synopsis / Solicitation", "RFP:", "Register …" and navigation text with inner spaces.
- **Effect:**
  - Real bodies are stored as empty strings and become unanalysable.
  - Backfill then refetches them forever.
  - Each TS/Python disagreement costs an hourly refetch.

## Decisions taken in this plan

1. **P0-1 uses a data backfill, not a read-time shim.**
   - **Mechanism:** One idempotent `UPDATE` per dialect, run by `runMigrations` / `runMysqlMigrations` next to the existing `lifecycle_status` fix. A shim would have to be repeated in the TS gate, the guard, `detail-history.ts`, the Python gate and `historical_candidates`.
   - **Replay result:** On the local export the rule updates exactly 1,329 rows, and visible bids rise from 5,875 to 7,193. None of the 1,329 rows carries a persisted `data_quality` verdict that would need clearing.
   - **Still hidden afterwards, out of scope (37 rows):**
     - 22 open `ny_contract_reporter` rows whose issuer is "Unknown state agency". They are `invalid_issuer`, hidden by design.
     - 11 closed `bidnet_co_city_aurora` rows that carry FIPS `0803455` while the registry says `0804000`. This is review item P1-8 (registry corrections).
     - 4 seed/demo rows.
2. **P0-3 makes inline archiving opt-in (`archiveDocuments: true`).** The attachment-repair worker archives SAM links under the `sam_gov` row's `fetch_config.attachments` policy (default `archive: true`, `max_per_run` 50).
3. **P0-4 bounds history reads.**
   - **List runs:**
     - They read rows whose `last_seen_at` falls within 30 days of the source's newest `last_seen_at`, newest first, at most 5,000 rows.
     - Hitting the cap logs a `crawler_detail_history_truncated` event.
     - The window follows the source's own last sighting, not the clock, so a worker outage cannot empty it.
   - **Backfill runs:**
     - They read only rows that have no usable body and are due for retry, oldest attempt first.
     - They read at most the run's attempt budget: `max_details_per_run` after the platform-budget clamp, or SAM's `maxDescriptions` (default 25).
     - They page 200 rows at a time, for at most 10 pages, so rows the registry no longer accepts cannot block valid ones.
   - **Per-dialect source scope:**
     - SQLite uses the primary-key range `[<id>:, <id>;)`. Its `LIKE` cannot use that index.
     - MySQL keeps the escaped prefix `LIKE`, which reads the primary key as a range (`EXPLAIN`: `range`, `key=PRIMARY`). MySQL's default `utf8mb4_0900_ai_ci` sorts `;` before `:`, so the SQLite range is empty there; this was verified on MySQL 8.
4. **P0-4 skips idle backfill sources.** A backfill source whose body-less rows are all still cooling down is now skipped. Before, it was run only to record `deferred` outcomes.
5. **P0-5 recognizes access and error notices only as whole notices.**
   - **Log in, sign in, register:** These must be followed by one of:
     - "to view/see/access/download", optionally after "to/with/on/at" and up to four words;
     - "required";
     - the end of the text.
   - **Error phrases:** "access denied", "forbidden", "unauthorized", "error 403/404/500" and "page not found" must be followed by punctuation or the end of the text.
   - **Addresses:** An address is rejected only when the whole text is one address.
   - **Python:** It adopts TypeScript's existing placeholder, HTML and navigation rules.
   - **Contract:** The shared fixture is the contract.
   - **Verification:** Both implementations below were run against all 45 fixture cases and against the existing TS and Python test lists, and agree on every one (Python 3.12 and 3.9).

## Global Constraints

- **Main checkout:** Never edit, stash, commit or check out anything in `/Users/sakya/workspace/AI-powered-Procurement-Intelligence`; an OpenAI Codex session owns it. Work only in `.claude/worktrees/data-usability-p0` on branch `fix/data-usability-p0`.
- **Both runtimes:** Every server change covers both the SQLite path (Drizzle / `better-sqlite3`) and the MySQL path (hand-written SQL).
- **Test isolation:** Tests never touch the `winbids` database or a live portal. Real-MySQL tests create and drop their own `apsi_crawler_test_*` schema on a throwaway container (see Shared commands).
- **Commit messages:** No `Co-Authored-By` trailer in any commit message.
- **Staging:**
  - Commit with explicit pathspecs only (`git add <paths>`); never `git add -A` or `git add .`.
  - Never commit `data/apsi.sqlite*`, `.DS_Store`, `services/.DS_Store`, `frontend/data/` or `ops-evidence/`.
- **Node:** Run Node tooling with Node 24 (`PATH=/usr/local/bin:$PATH`). The default `node` (v23.9) cannot load `better-sqlite3`, which is built for NODE_MODULE_VERSION 137.
- **Vitest:**
  - Run it without sourcing `frontend/.env.local`; that file switches the suite to MySQL mode.
  - `globals` is `false`, so import `describe`/`it`/`expect`/`vi` explicitly.
- **Python:** Tests use `$PY`, a 3.12 venv with `requests` and `pytest`. Crawler code must stay Python 3.9-compatible: no `match` statements and no runtime `X | Y` types.
- **Classifier contract:** For every case in `crawler/tests/fixtures/description_quality_contract.json`, `getBidDescriptionIssue` (TS) and `body_issue` (Python) must return the same code. Any rule change starts with the fixture.
- **P0-1 levels:** The local levels in the backfill are exactly `('county', 'city', 'township', 'special_district')`.
- **P0-4 constants:**
  - `DETAIL_HISTORY_LIST_WINDOW_DAYS = 30`
  - `DETAIL_HISTORY_LIST_LIMIT = 5000`
  - `DETAIL_BACKFILL_PAGE_SIZE = 200`
  - `DETAIL_BACKFILL_MAX_PAGES = 10`
  - default attempt budget 25
- **Shell:** It is zsh. `status` is a read-only variable there, so use `rc`. Do not wrap commands in `sh -c`; Claude Code's safety check refuses it.

## Shared commands

```bash
REPO=/Users/sakya/workspace/AI-powered-Procurement-Intelligence
WT=$REPO/.claude/worktrees/data-usability-p0
PY=$REPO/services/scrapling-extractor/.venv/bin/python
```

- One Vitest file: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run <file>`
- One pytest file: `cd $WT/crawler && $PY -m pytest <file> -q`

Shell variables do not persist between tool calls, so put the `REPO`/`WT`/`PY` lines at the start of every command that uses them.

For `*.mysql.integration.test.ts` files, use a throwaway MySQL. Run the whole block as one command; the password is generated per container and never printed:

```bash
REPO=/Users/sakya/workspace/AI-powered-Procurement-Intelligence; WT=$REPO/.claude/worktrees/data-usability-p0
PW=$(openssl rand -hex 16); C=$(docker run -d --rm -e MYSQL_ROOT_PASSWORD="$PW" -p 127.0.0.1::3306 mysql:8)
for i in $(seq 1 60); do docker exec -e MYSQL_PWD="$PW" "$C" mysqladmin -uroot -h127.0.0.1 ping >/dev/null 2>&1 && break; sleep 2; done
PORT=$(docker port "$C" 3306/tcp | head -1 | sed 's/.*://')
cd "$WT/frontend" && CRAWLER_INTEGRATION_MYSQL_URL="mysql://root:$PW@127.0.0.1:$PORT/" PATH=/usr/local/bin:$PATH npx vitest run <files>; rc=$?
docker stop "$C" >/dev/null; echo "exit=$rc"
```

If `docker info` fails, start Docker Desktop with `open -a Docker` and wait until `docker info` succeeds.

## File map

| Task | Files |
|---|---|
| 1 (P0-1) | `frontend/src/server/db/migrate.ts`, `frontend/src/server/db/mysql.ts`, `frontend/src/server/db/mysql.test.ts`, new `frontend/src/server/db/local-issuer-type-backfill.test.ts`, new `frontend/src/server/db/local-issuer-type-backfill.mysql.integration.test.ts` |
| 2 (P0-2) | `crawler/apsi_crawler/detail_backfill.py` (`apply_detail_history`, `historical_candidates`), new `crawler/tests/test_detail_retry_provenance.py`, new `frontend/src/server/crawler/detail-retry-provenance.test.ts` |
| 3 (P0-3) | `frontend/src/server/crawler/sam-gov-runner.ts` (`buildArgs`), `frontend/src/server/crawler/sam-gov-runner.test.ts`, `docs/operations/attachment-repair.md` |
| 4 (P0-4) | `frontend/src/server/crawler/detail-history.ts`, `frontend/src/server/crawler/detail-history.test.ts`, new `frontend/src/server/crawler/detail-history.mysql.integration.test.ts`, `frontend/src/server/crawler/state-runner.ts`, `frontend/src/server/crawler/sam-gov-runner.ts` (history loading), `frontend/src/server/crawler/sam-gov-runner.test.ts` (module mock), `frontend/src/server/crawler/configured-runner.ts`, `frontend/src/server/crawler/configured-runner.test.ts`, `crawler/apsi_crawler/cli.py`, new `crawler/tests/test_detail_backfill_budget.py` |
| 5 (P0-5) | `frontend/src/lib/bid-description.ts`, new `frontend/src/lib/bid-description.contract.test.ts`, `crawler/apsi_crawler/content_quality.py`, `crawler/apsi_crawler/detail_backfill.py` (`valid_body_text` and its imports), new `crawler/tests/fixtures/description_quality_contract.json`, new `crawler/tests/test_description_quality_contract.py` |
| 6 | `frontend/package.json` (`test:crawler-integration`), `docs/operations/detail-backfill.md`, `docs/qa/crawler-data-usability-fixes-2026-10-01.md` |

## Execution order

- **Task 0:** controller only.
- **Wave 1, in parallel (no shared files):** Tasks 1, 2 and 3.
- **Wave 2, in parallel (no shared files), after wave 1 is committed:** Tasks 4 and 5. Task 4 edits `sam-gov-runner.ts` and its test after Task 3. Task 5 edits `detail_backfill.py` after Task 2.
- **Task 6:** last.

Each implementer commits only its own paths, so parallel commits never capture another task's edits.

---

### Task 0: Execution worktree (controller only)

**Files:** none in the main checkout.

- [ ] **Step 1: Confirm the reviewed work is committed**

The fixes build on the Codex work, so it must exist as a commit. Run:

```bash
REPO=/Users/sakya/workspace/AI-powered-Procurement-Intelligence
FILES="crawler/apsi_crawler/detail_backfill.py crawler/apsi_crawler/content_quality.py crawler/apsi_crawler/cli.py crawler/apsi_crawler/data_quality.py crawler/apsi_crawler/enrichment.py crawler/tests/test_enrichment.py crawler/tests/test_detail_backfill.py frontend/src/lib/bid-description.ts frontend/src/lib/bid-usability.ts frontend/src/server/crawler/detail-history.ts frontend/src/server/crawler/detail-history.test.ts frontend/src/server/crawler/sam-gov-runner.ts frontend/src/server/crawler/sam-gov-runner.test.ts frontend/src/server/crawler/state-runner.ts frontend/src/server/crawler/configured-runner.ts frontend/src/server/crawler/configured-runner.test.ts frontend/src/server/crawler/persistence-merge.ts frontend/src/server/db/migrate.ts frontend/src/server/db/mysql.ts frontend/src/server/db/mysql.test.ts frontend/package.json docs/operations/attachment-repair.md docs/operations/detail-backfill.md docs/qa/crawler-data-usability-fixes-2026-10-01.md"
git --no-optional-locks -C "$REPO" status --short -- ${=FILES}
BASE=$(git -C "$REPO" rev-parse codex/data-usability-20261001)
for f in ${=FILES}; do git -C "$REPO" cat-file -e "$BASE:$f" 2>/dev/null || echo "missing at BASE: $f"; done
echo "BASE=$BASE"
```

(`${=FILES}` makes zsh split the list into words.)

Expected: both checks print nothing, and the last line prints `BASE`. Any other output means the work is not committed: stop and ask the user to have the Codex session commit it. Never commit, stash or check out in that checkout yourself.

- [ ] **Step 2: Create the worktree on BASE**

```bash
REPO=/Users/sakya/workspace/AI-powered-Procurement-Intelligence
BASE=$(git -C "$REPO" rev-parse codex/data-usability-20261001)
git -C "$REPO" worktree add .claude/worktrees/data-usability-p0 -b fix/data-usability-p0 "$BASE"
ln -s "$REPO/frontend/node_modules" "$REPO/.claude/worktrees/data-usability-p0/frontend/node_modules"
git --no-optional-locks -C "$REPO" diff --quiet "$BASE" -- frontend/package-lock.json && echo "installed node_modules match BASE's lockfile"
```

Expected: the last line prints. If it does not, the installed packages differ from BASE; stop and report.

- [ ] **Step 3: Bring this plan into the branch**

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence/.claude/worktrees/data-usability-p0
git checkout docs/data-usability-p0-plan -- docs/superpowers/plans/2026-10-12-data-usability-p0-fixes.md
git commit -m "docs(plan): data-usability P0 fix plan" -- docs/superpowers/plans/2026-10-12-data-usability-p0-fixes.md
```

- [ ] **Step 4: Record the baseline in the SDD ledger**

```bash
REPO=/Users/sakya/workspace/AI-powered-Procurement-Intelligence; WT=$REPO/.claude/worktrees/data-usability-p0; PY=$REPO/services/scrapling-extractor/.venv/bin/python
cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run 2>&1 | tail -4
cd $WT/crawler && $PY -m pytest -q 2>&1 | tail -2
LEDGER=$WT/.superpowers/sdd/2026-10-12-data-usability-p0-fixes; mkdir -p $LEDGER
cd $WT/frontend && PATH=/usr/local/bin:$PATH npx tsc --noEmit -p . 2>&1 | grep -oE '^[^(]+\(' | sort -u > $LEDGER/tsc-baseline.txt; wc -l < $LEDGER/tsc-baseline.txt
```

Expected, matching the 2026-10-09 review:
- Vitest: 398 files passed, 2 skipped.
- Crawler: 951 passed.
- tsc: errors only in pre-existing test files.

`.superpowers/` is git-ignored, so the baseline file never reaches a commit.

#### Fallback: work from a snapshot

Use this only if the user explicitly agrees to work from a snapshot of the uncommitted tree. Run it instead of Steps 1–2, then continue with Step 3.

```bash
REPO=/Users/sakya/workspace/AI-powered-Procurement-Intelligence; SNAP=$(mktemp -d)
git -C "$REPO" worktree add .claude/worktrees/data-usability-p0 -b fix/data-usability-p0 8897029
git --no-optional-locks -C "$REPO" diff --binary 8897029 > "$SNAP/codex.patch"
git --no-optional-locks -C "$REPO" ls-files --others --exclude-standard | grep -v -E '^data/|(^|/)\.DS_Store$' > "$SNAP/untracked.txt"
cd "$REPO/.claude/worktrees/data-usability-p0" && git apply --index "$SNAP/codex.patch"
rsync -a --files-from="$SNAP/untracked.txt" "$REPO/" ./ && git add --pathspec-from-file="$SNAP/untracked.txt"
git commit -m "wip: snapshot of the uncommitted data-usability work"
ln -s "$REPO/frontend/node_modules" frontend/node_modules
```

When the Codex session later commits the same tree, `fix/data-usability-p0` merges into it cleanly, because both sides carry identical changes. If the Codex tree changes after the snapshot, re-review the files both sides touch before merging.

---

### Task 1: Give legacy local bids their source's level (P0-1)

**Files:**
- Modify: `frontend/src/server/db/migrate.ts` (the end of `runMigrations`)
- Modify: `frontend/src/server/db/mysql.ts` (`mysqlDataMigrationStatements`)
- Modify: `frontend/src/server/db/mysql.test.ts` (test "backfills closed lifecycle for inactive rows")
- Create: `frontend/src/server/db/local-issuer-type-backfill.test.ts`
- Create: `frontend/src/server/db/local-issuer-type-backfill.mysql.integration.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export const MYSQL_LOCAL_ISSUER_TYPE_BACKFILL: string` in `mysql.ts`.
  - `mysqlDataMigrationStatements()` returns the lifecycle statement, then that constant.

- [ ] **Step 1: Write the failing SQLite test**

Create `frontend/src/server/db/local-issuer-type-backfill.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, dataSources } from "@/server/db/schema";
import { runMigrations } from "@/server/db/migrate";
import { getBidByIdFromRepository, listBids } from "@/server/bids/repository";

const NOW = "2026-10-01T00:00:00Z";
const sources = [
  { id: "bidnet_co_boulder", label: "Boulder County, CO (BidNet)", issuerType: "county", jurisdictionLevel: "county", stateCode: "CO", fipsCode: "08013", createdAt: NOW, updatedAt: NOW },
  { id: "bidnet_mi_canton_township", label: "Canton Township, MI (BidNet)", issuerType: "township", jurisdictionLevel: "township", stateCode: "MI", fipsCode: "2616312860", createdAt: NOW, updatedAt: NOW },
  { id: "co_state", label: "Colorado State Procurement", issuerType: "state", jurisdictionLevel: "state", stateCode: "CO", fipsCode: "08", createdAt: NOW, updatedAt: NOW },
];

/** The shape every county/city/township bid was stored in before the data-usability change. */
function legacyBid(id: string, overrides: Partial<typeof bids.$inferInsert> = {}) {
  const sourceBidId = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return {
    id, source: "Boulder County, CO (BidNet)", sourceBidId, dedupeKey: id,
    title: "Road repairs", description: "Resurface county roads and provide traffic management.",
    issuerName: "Boulder County", issuerType: "state", jurisdictionLevel: "county", stateCode: "CO", fipsCode: "08013",
    sourceUrl: `https://www.bidnetdirect.com/colorado/bouldercounty/bid/${sourceBidId}`,
    firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

describe("legacy local issuer_type backfill on SQLite", () => {
  let testDb: TestDatabase;
  const issuerTypes = () => Object.fromEntries(testDb.db.select({ id: bids.id, issuerType: bids.issuerType }).from(bids).all()
    .map((row) => [row.id, row.issuerType]));

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(sources).run();
  });
  afterEach(async () => { await testDb.cleanup(); });

  it("makes open, closed and township legacy rows publishable again", async () => {
    testDb.db.insert(bids).values([
      legacyBid("bidnet_co_boulder:open"),
      legacyBid("bidnet_co_boulder:closed", { lifecycleStatus: "closed", isActive: 0 }),
      legacyBid("bidnet_mi_canton_township:7", {
        source: "Canton Township, MI (BidNet)", issuerName: "Canton Township", jurisdictionLevel: "township",
        stateCode: "MI", fipsCode: "2616312860", sourceUrl: "https://www.bidnetdirect.com/michigan/cantontownship/bid/7",
      }),
    ]).run();
    expect(await listBids(testDb.db)).toEqual([]);

    runMigrations(testDb.db);

    expect((await listBids(testDb.db)).map((bid) => bid.id)).toEqual([
      "bidnet_co_boulder:closed", "bidnet_co_boulder:open", "bidnet_mi_canton_township:7",
    ]);
    expect(await getBidByIdFromRepository(testDb.db, "bidnet_co_boulder:closed")).toBeDefined();
    expect(issuerTypes()).toEqual({
      "bidnet_co_boulder:open": "county", "bidnet_co_boulder:closed": "county", "bidnet_mi_canton_township:7": "township",
    });
  });

  it("changes nothing it cannot attribute to a registered local source, and is idempotent", () => {
    testDb.db.insert(bids).values([
      legacyBid("bidnet_co_boulder:open"),
      legacyBid("co_state:1", { source: "Colorado State Procurement", issuerName: "State of Colorado", jurisdictionLevel: "state", fipsCode: "08" }),
      legacyBid("unknown_portal:1"),
      legacyBid("bidnet_co_boulder:conflict", { jurisdictionLevel: "city" }),
      legacyBid("bidnet_co_boulder:elsewhere", { stateCode: "WY" }),
      legacyBid("legacy-without-namespace"),
    ]).run();

    runMigrations(testDb.db);
    const afterFirstRun = testDb.db.select().from(bids).all();
    runMigrations(testDb.db);

    expect(issuerTypes()).toEqual({
      "bidnet_co_boulder:open": "county", "co_state:1": "state", "unknown_portal:1": "state",
      "bidnet_co_boulder:conflict": "state", "bidnet_co_boulder:elsewhere": "state", "legacy-without-namespace": "state",
    });
    expect(testDb.db.select().from(bids).all()).toEqual(afterFirstRun);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/db/local-issuer-type-backfill.test.ts`

Expected: both tests FAIL. `listBids` still returns `[]` after `runMigrations`, and `bidnet_co_boulder:open` is still `state`.

- [ ] **Step 3: Implement the SQLite backfill**

In `frontend/src/server/db/migrate.ts`, find the last statement of `runMigrations`:

```ts
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_data_sources_jurisdiction ON data_sources(jurisdiction_level, state_code)");
}
```

Replace it with:

```ts
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_data_sources_jurisdiction ON data_sources(jurisdiction_level, state_code)");

  // Bids stored before the data-usability change carry issuer_type 'state' even when their
  // registered source is a county, city or township, so the publication gate hides them
  // (bid-usability.ts, registered-source-identity.ts). Give them their source's level.
  // Idempotent; runs on every migration after the data_sources columns above exist. MySQL
  // runs the same rule as MYSQL_LOCAL_ISSUER_TYPE_BACKFILL (mysql.ts).
  sqlite.exec(`
    UPDATE bids SET issuer_type = data_sources.jurisdiction_level
    FROM data_sources
    WHERE bids.issuer_type = 'state'
      AND instr(bids.id, ':') > 1
      AND data_sources.id = substr(bids.id, 1, instr(bids.id, ':') - 1)
      AND data_sources.jurisdiction_level IN ('county', 'city', 'township', 'special_district')
      AND upper(data_sources.state_code) = upper(bids.state_code)
      AND (bids.jurisdiction_level IS NULL OR bids.jurisdiction_level = '' OR bids.jurisdiction_level = data_sources.jurisdiction_level)
  `);
}
```

`mysql.ts` translates only the first `sqlite.exec(\`…\`)` block of `migrate.ts` into MySQL DDL. This new block is never translated, which is intended: Step 5 adds the MySQL twin.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/db/local-issuer-type-backfill.test.ts`

Expected: 2 passed.

- [ ] **Step 5: Add the MySQL twin**

In `frontend/src/server/db/mysql.ts`, replace:

```ts
/** Idempotent data fixes that run after every column and index migration. */
export function mysqlDataMigrationStatements(): string[] {
  return ["UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'"];
}
```

with:

```ts
/**
 * migrate.ts's last statement, for MySQL: bids stored before the data-usability change carry
 * issuer_type 'state' even when their registered source is local; give them the source's level.
 */
export const MYSQL_LOCAL_ISSUER_TYPE_BACKFILL = "UPDATE bids JOIN data_sources ON data_sources.id = SUBSTRING_INDEX(bids.id, ':', 1)"
  + " SET bids.issuer_type = data_sources.jurisdiction_level"
  + " WHERE bids.issuer_type = 'state' AND LOCATE(':', bids.id) > 1"
  + " AND data_sources.jurisdiction_level IN ('county', 'city', 'township', 'special_district')"
  + " AND UPPER(data_sources.state_code) = UPPER(bids.state_code)"
  + " AND (bids.jurisdiction_level IS NULL OR bids.jurisdiction_level = '' OR bids.jurisdiction_level = data_sources.jurisdiction_level)";

/** Idempotent data fixes that run after every column and index migration. */
export function mysqlDataMigrationStatements(): string[] {
  return [
    "UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'",
    MYSQL_LOCAL_ISSUER_TYPE_BACKFILL,
  ];
}
```

- [ ] **Step 6: Update the MySQL statement test**

In `frontend/src/server/db/mysql.test.ts`, add `MYSQL_LOCAL_ISSUER_TYPE_BACKFILL,` to the import list from `./mysql` (the one that already imports `mysqlDataMigrationStatements`). Then replace:

```ts
  it("backfills closed lifecycle for inactive rows", () => {
    expect(mysqlDataMigrationStatements()).toEqual([
      "UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'",
    ]);
  });
```

with:

```ts
  it("backfills closed lifecycle for inactive rows and local issuer types for legacy bids", () => {
    expect(mysqlDataMigrationStatements()).toEqual([
      "UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'",
      MYSQL_LOCAL_ISSUER_TYPE_BACKFILL,
    ]);
    expect(MYSQL_LOCAL_ISSUER_TYPE_BACKFILL).toContain("ON data_sources.id = SUBSTRING_INDEX(bids.id, ':', 1)");
    expect(MYSQL_LOCAL_ISSUER_TYPE_BACKFILL).toContain("IN ('county', 'city', 'township', 'special_district')");
  });
```

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/db/mysql.test.ts`

Expected: PASS. Another test in that file may count the statements `runMysqlMigrations` applied. If so, raise that count by one for the new data statement and change no other expectation.

- [ ] **Step 7: Write the real-MySQL integration test**

Create `frontend/src/server/db/local-issuer-type-backfill.mysql.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { getBidByIdFromMysql } from "@/server/bids/repository";

const NOW = "2026-10-01T00:00:00Z";

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("legacy local issuer_type backfill on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  let mysql: ReturnType<typeof createMysqlPool>;

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  it("aligns only legacy rows of registered local sources, idempotently", async () => {
    await mysql.query(
      "INSERT INTO data_sources (id, label, issuer_type, jurisdiction_level, state_code, fips_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?)",
      ["bidnet_co_boulder", "Boulder County, CO (BidNet)", "county", "county", "CO", "08013", NOW, NOW,
        "co_state", "Colorado State Procurement", "state", "state", "CO", "08", NOW, NOW],
    );
    const legacy = (id: string, jurisdictionLevel: string, fipsCode = "08013") => {
      const sourceBidId = id.slice(id.indexOf(":") + 1);
      return [id, "Boulder County, CO (BidNet)", sourceBidId, id, "Road repairs",
        "Resurface county roads and provide traffic management.", "Boulder County", "state", jurisdictionLevel, "CO", fipsCode,
        `https://www.bidnetdirect.com/colorado/bouldercounty/bid/${sourceBidId}`, NOW, NOW, NOW, NOW];
    };
    for (const values of [legacy("bidnet_co_boulder:legacy", "county"), legacy("bidnet_co_boulder:conflict", "city"),
      legacy("co_state:1", "state", "08"), legacy("unknown_portal:1", "county")]) {
      await mysql.query(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, jurisdiction_level, state_code, fips_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        values,
      );
    }
    expect(await getBidByIdFromMysql(mysql, "bidnet_co_boulder:legacy")).toBeUndefined();

    await runMysqlMigrations(mysql);
    await runMysqlMigrations(mysql);

    const [rows] = await mysql.query("SELECT id, issuer_type FROM bids");
    expect(Object.fromEntries((rows as Array<{ id: string; issuer_type: string }>).map((row) => [row.id, row.issuer_type]))).toEqual({
      "bidnet_co_boulder:legacy": "county", "bidnet_co_boulder:conflict": "state", "co_state:1": "state", "unknown_portal:1": "state",
    });
    expect(await getBidByIdFromMysql(mysql, "bidnet_co_boulder:legacy")).toBeDefined();
  });
});
```

- [ ] **Step 8: Run the integration test, skipped and real**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/db/local-issuer-type-backfill.mysql.integration.test.ts`

Expected: 1 skipped. No `CRAWLER_INTEGRATION_MYSQL_URL` is set.

Then run the Shared commands MySQL block with `<files>` = `src/server/db/local-issuer-type-backfill.mysql.integration.test.ts`. Expected: 1 passed, `exit=0`.

- [ ] **Step 9: Run the neighbouring suites**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/db src/server/bids src/server/crawler/data-quality.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence/.claude/worktrees/data-usability-p0
git add frontend/src/server/db/migrate.ts frontend/src/server/db/mysql.ts frontend/src/server/db/mysql.test.ts frontend/src/server/db/local-issuer-type-backfill.test.ts frontend/src/server/db/local-issuer-type-backfill.mysql.integration.test.ts
git commit -m "fix(db): give legacy local bids their registered source's issuer type"
```

---

### Task 2: Reused history never carries the previous run's applied_fields (P0-2)

**Files:**
- Modify: `crawler/apsi_crawler/detail_backfill.py` (`apply_detail_history`, `historical_candidates`, plus two private helpers)
- Create: `crawler/tests/test_detail_retry_provenance.py`
- Create: `frontend/src/server/crawler/detail-retry-provenance.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no new public API. After this task, `apply_detail_history` and `historical_candidates` always hand on `raw_payload.enrichment.applied_fields == []`.

- [ ] **Step 1: Write the failing Python tests**

Create `crawler/tests/test_detail_retry_provenance.py`:

```python
"""P0-2: reused history carries retry provenance, never the previous run's applied_fields."""

import requests

from apsi_crawler.data_quality import prepare_persisted_bid
from apsi_crawler.detail_backfill import apply_detail_history, historical_candidates
from apsi_crawler.enrichment import enrich_bids
from test_enrichment import FakeExtractor, FakeSession, _source

DETAIL_SUMMARY = "Storm sewer replacement, Phase 2: furnish and install 2,400 linear feet of storm sewer."
VERIFIED_BODY = DETAIL_SUMMARY + " Includes trench restoration, inlet reconstruction and traffic control for twelve weeks."
LIST_SUMMARY = "Storm sewer replacement."


def _persisted_row():
    return {
        "id": "il_bidbuy:22-118", "source_bid_id": "22-118", "dedupe_key": "il_bidbuy:22-118",
        "title": "Storm sewer replacement - Phase 2", "issuer_name": "Illinois DOT", "issuer_type": "state", "state_code": "IL",
        "source_url": "https://portal.example.gov/bid/22-118", "description": DETAIL_SUMMARY, "full_description": VERIFIED_BODY,
        "detail_fetched_at": "2026-09-01T00:00:00Z", "first_seen_at": "2026-08-30T00:00:00Z",
        "raw_payload": {"enrichment": {
            "fields": {"description": "selector"},
            "applied_fields": ["description", "full_description"],
            "persisted_fields": ["description", "full_description"],
            "outcome": {"status": "success", "reason": None, "attempted": True, "attempted_at": "2026-09-01T00:00:00Z",
                        "attempt_count": 1, "valid_body": True, "verified_at": "2026-09-01T00:00:00Z",
                        "next_retry_at": "2026-09-08T00:00:00Z"},
        }},
    }


def _list_bid():
    return {
        "id": "il_bidbuy:22-118", "source_bid_id": "22-118", "dedupe_key": "il_bidbuy:22-118",
        "title": "Storm sewer replacement - Phase 2", "issuer_name": "Illinois DOT", "issuer_type": "state", "state_code": "IL",
        "source_url": "https://portal.example.gov/bid/22-118", "description": LIST_SUMMARY, "full_description": None,
        "first_seen_at": "2026-10-12T00:00:00Z", "raw_payload": {}, "attachments": [],
    }


def test_reused_history_keeps_retry_provenance_but_not_the_previous_runs_applied_fields():
    bid = _list_bid()
    apply_detail_history([bid], [_persisted_row()], "il_bidbuy")
    enrichment = bid["raw_payload"]["enrichment"]
    assert enrichment["applied_fields"] == []
    assert enrichment["persisted_fields"] == ["description", "full_description"]
    assert enrichment["outcome"]["attempt_count"] == 1


def test_failed_retry_keeps_the_verified_body_when_persisted():
    existing = _persisted_row()
    bid = _list_bid()
    apply_detail_history([bid], [existing], "il_bidbuy")
    session = FakeSession({bid["source_url"]: requests.ConnectionError("portal reset the connection")})

    out, stats = enrich_bids([bid], _source(), {"enrichment": {"enabled": True, "min_interval_seconds": 0}},
                             extractor=FakeExtractor(), session=session, now=lambda: "2026-10-12T00:00:00Z")

    assert stats["failed"] == 1
    assert out[0]["raw_payload"]["enrichment"]["applied_fields"] == []
    merged = prepare_persisted_bid(out[0], existing, "2026-10-12T00:00:00Z")
    assert merged["description"] == DETAIL_SUMMARY
    assert merged["full_description"] == VERIFIED_BODY


def test_backfill_candidates_start_without_the_previous_runs_applied_fields():
    row = {**_persisted_row(), "description": "", "full_description": None}
    candidates = historical_candidates([row], "il_bidbuy")
    assert candidates[0]["raw_payload"]["enrichment"]["applied_fields"] == []
    assert row["raw_payload"]["enrichment"]["applied_fields"] == ["description", "full_description"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd $WT/crawler && $PY -m pytest tests/test_detail_retry_provenance.py -q`

Expected: 3 failed. `applied_fields` is still `["description", "full_description"]`, and `merged["description"]` is the list summary.

- [ ] **Step 3: Implement**

In `crawler/apsi_crawler/detail_backfill.py`, add these two helpers directly above `def apply_detail_history`:

```python
def _carried_enrichment(enrichment):
    """Retry provenance that may cross runs: everything except the previous run's field evidence.

    `applied_fields` names the fields THIS run's detail fetch wrote. A copy carried into a retry
    that then fails makes the importers take the list summary as fresh detail text and clear the
    verified full description. An explicit [] also stops the importers' legacy branch from
    treating copied `fields` diagnostics as detail provenance.
    """
    carried = deepcopy(enrichment) if isinstance(enrichment, dict) else {}
    carried["applied_fields"] = []
    return carried


def _fresh_candidate(row):
    candidate = deepcopy(row)
    raw = candidate.get("raw_payload")
    if isinstance(raw, dict) and isinstance(raw.get("enrichment"), dict):
        raw["enrichment"] = _carried_enrichment(raw["enrichment"])
    return candidate
```

In `apply_detail_history`, replace:

```python
        raw["enrichment"] = deepcopy(old_enrichment)
```

with:

```python
        raw["enrichment"] = _carried_enrichment(old_enrichment)
```

In `historical_candidates`, replace the start of the return statement:

```python
    return [deepcopy(row) for row in history or [] if isinstance(row, dict) and not core_issues(row)
```

with:

```python
    return [_fresh_candidate(row) for row in history or [] if isinstance(row, dict) and not core_issues(row)
```

- [ ] **Step 4: Run the tests and the whole crawler suite**

Run: `cd $WT/crawler && $PY -m pytest tests/test_detail_retry_provenance.py -q && $PY -m pytest -q`

Expected: 3 passed, then the full suite passes.

An existing test may assert that `apply_detail_history` copies `applied_fields` unchanged. That assertion encodes this defect: change only its `applied_fields` expectation to `[]`, and name the test in your report.

- [ ] **Step 5: Pin the importer's side of the contract**

Create `frontend/src/server/crawler/detail-retry-provenance.test.ts`. It passes immediately; it guards the behaviour the Python fix relies on.

```ts
import { describe, expect, it } from "vitest";
import { mergePersistedBid } from "./persistence-merge";

// Consumer half of P0-2: when a detail retry applied nothing (`applied_fields: []`), the importer
// keeps the verified body even though the list page offered a shorter summary.
const existing = {
  id: "il_bidbuy:22-118",
  title: "Storm sewer replacement - Phase 2",
  description: "Storm sewer replacement, Phase 2: furnish and install 2,400 linear feet of storm sewer.",
  full_description: "Storm sewer replacement, Phase 2: furnish and install 2,400 linear feet of storm sewer. Includes trench restoration, inlet reconstruction and traffic control for twelve weeks.",
  detail_fetched_at: "2026-09-01T00:00:00Z",
  raw_payload: JSON.stringify({ enrichment: { applied_fields: ["description", "full_description"], persisted_fields: ["description", "full_description"] } }),
};

describe("a failed detail retry never replaces a verified body", () => {
  it("keeps the stored description and full description when the retry applied nothing", () => {
    const failedRetry = {
      id: existing.id,
      title: existing.title,
      description: "Storm sewer replacement.",
      full_description: null,
      raw_payload: { enrichment: { applied_fields: [], persisted_fields: ["description", "full_description"],
        outcome: { status: "failure", reason: "ConnectionError", attempted: true } } },
    };
    const merged = mergePersistedBid(failedRetry, existing);
    expect(merged.description).toBe(existing.description);
    expect(merged.full_description).toBe(existing.full_description);
  });
});
```

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/crawler/detail-retry-provenance.test.ts src/server/crawler/persistence-merge.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence/.claude/worktrees/data-usability-p0
git add crawler/apsi_crawler/detail_backfill.py crawler/tests/test_detail_retry_provenance.py frontend/src/server/crawler/detail-retry-provenance.test.ts
git commit -m "fix(crawler): reused detail history never carries the previous run's applied_fields"
```

Add the path of any existing test you changed in Step 4 to the `git add` line.

---

### Task 3: SAM runs record attachment links and leave archiving to the repair worker (P0-3)

**Files:**
- Modify: `frontend/src/server/crawler/sam-gov-runner.ts` (`buildArgs`)
- Modify: `frontend/src/server/crawler/sam-gov-runner.test.ts` (two tests)
- Modify: `docs/operations/attachment-repair.md`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `runSamGovCrawler` passes `--archive-documents` only for `archiveDocuments: true`.

- [ ] **Step 1: Change the tests first**

In `frontend/src/server/crawler/sam-gov-runner.test.ts`, test "starts the Python crawler with documented date and pagination options": delete these three lines from the expected argument list. Keep the `path` import; other assertions still use it.

```ts
        "--archive-documents",
        "--archive-dir",
        path.resolve(process.cwd(), "data", "attachments"),
```

Replace the whole test `it("passes archive document options by default", …)` with:

```ts
  it("archives documents inside the run only when a caller asks for it", async () => {
    for (let call = 0; call < 2; call += 1) {
      mockedExecFile.mockImplementationOnce(((_command: string, _args: readonly string[], _options: ExecFileOptions, callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
        callback(null, mysqlJsonPayload, "");
        return {} as ReturnType<typeof execFile>;
      }) as typeof execFile);
    }

    await runSamGovCrawler({ postedFrom: "05/01/2026", postedTo: "05/19/2026", databasePath: "/tmp/apsi.sqlite", archiveDir: "/tmp/attachments", outputJson: true });
    await runSamGovCrawler({ postedFrom: "05/01/2026", postedTo: "05/19/2026", databasePath: "/tmp/apsi.sqlite", archiveDir: "/tmp/attachments", outputJson: true, archiveDocuments: true });

    expect(mockedExecFile.mock.calls[0][1]).not.toContain("--archive-documents");
    expect(mockedExecFile.mock.calls[0][1]).not.toContain("--archive-dir");
    expect(mockedExecFile.mock.calls[1][1]).toEqual(expect.arrayContaining(["--archive-documents", "--archive-dir", "/tmp/attachments"]));
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/crawler/sam-gov-runner.test.ts`

Expected: both tests FAIL, because `--archive-documents` is still passed by default.

- [ ] **Step 3: Implement**

In `frontend/src/server/crawler/sam-gov-runner.ts` (`buildArgs`), replace:

```ts
  if (options.archiveDocuments !== false) {
    args.push("--archive-documents", "--archive-dir", options.archiveDir ?? defaultArchiveDir());
  }
```

with:

```ts
  // Inline archiving would download every resourceLink of every bid in the window, one after
  // another, inside the run's time budget. Managed runs record the links; the attachment-repair
  // worker archives them under the source's own limits. Only an explicit caller archives here.
  if (options.archiveDocuments === true) {
    args.push("--archive-documents", "--archive-dir", options.archiveDir ?? defaultArchiveDir());
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/crawler src/app/api/crawler`

Expected: PASS.

- [ ] **Step 5: Document it**

In `docs/operations/attachment-repair.md`, insert this section directly above the line `## 运行`:

```markdown
## SAM.gov 附件

SAM.gov 运行把每条机会的 `resourceLinks` 记为附件链接（`archive_status = not_archived`），抓取进程内不下载。归档由本 worker 完成，按 `sam_gov` 源的 `fetch_config.attachments` 策略（默认 `archive: true`、`max_per_run` 50）限速、限量。只有调用方显式传 `archiveDocuments: true` 时，`runSamGovCrawler` 才在运行内下载，仅用于手工排查。如果某类 SAM 链接必须带 API key 才能下载，下载失败由本 worker 的失败分类和退避处理，不影响抓取运行。

```

- [ ] **Step 6: Commit**

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence/.claude/worktrees/data-usability-p0
git add frontend/src/server/crawler/sam-gov-runner.ts frontend/src/server/crawler/sam-gov-runner.test.ts docs/operations/attachment-repair.md
git commit -m "fix(crawler): SAM runs record attachment links and leave archiving to the repair worker"
```

---

### Task 4: Bounded detail history (P0-4)

**Files:**
- Modify: `frontend/src/server/crawler/detail-history.ts` (whole file below)
- Modify: `frontend/src/server/crawler/detail-history.test.ts`
- Create: `frontend/src/server/crawler/detail-history.mysql.integration.test.ts`
- Modify: `frontend/src/server/crawler/state-runner.ts`
- Modify: `frontend/src/server/crawler/sam-gov-runner.ts` (history loading only)
- Modify: `frontend/src/server/crawler/sam-gov-runner.test.ts` (module mock only)
- Modify: `frontend/src/server/crawler/configured-runner.ts`
- Modify: `frontend/src/server/crawler/configured-runner.test.ts`
- Modify: `crawler/apsi_crawler/cli.py`
- Create: `crawler/tests/test_detail_backfill_budget.py`

**Interfaces:**
- Consumes: Task 3's `buildArgs` change in `sam-gov-runner.ts` (do not undo it).
- Produces, all exported from `detail-history.ts`:
  - `loadDetailHistory(store, sourceId, source?)`. The signature is unchanged; the read is now bounded.
  - `loadDetailBackfillCandidates(store: DetailHistoryStore, sourceId: string, source: CrawlableSource | undefined, options: { limit: number; now?: Date }): Promise<DetailHistoryRecord[]>`.
  - `detailBackfillQuery(dialect: "sqlite" | "mysql", sourceId: string, now: Date, page: number): { sql: string; values: unknown[] }`.
  - `sourceIdPredicate(dialect: "sqlite" | "mysql", sourceId: string): [string, string[]]`.
  - `missingBody(row)`, `historyDue(row, now)` and `historyAge(row)`, moved unchanged from `configured-runner.ts`.
  - `detailAttemptBudget(source: Pick<CrawlableSource, "fetchConfig">): number`.
  - The constants `DETAIL_HISTORY_LIST_WINDOW_DAYS`, `DETAIL_HISTORY_LIST_LIMIT`, `DETAIL_BACKFILL_PAGE_SIZE` and `DETAIL_BACKFILL_MAX_PAGES`.

- [ ] **Step 1: Update the existing detail-history test and add failing ones**

In `frontend/src/server/crawler/detail-history.test.ts`, replace the import lines:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { fenceDetailBackfillPayload, loadDetailHistory } from "./detail-history";
```

with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  DETAIL_BACKFILL_PAGE_SIZE, DETAIL_HISTORY_LIST_LIMIT, detailAttemptBudget, detailBackfillQuery, fenceDetailBackfillPayload,
  loadDetailBackfillCandidates, loadDetailHistory, sourceIdPredicate,
} from "./detail-history";
```

In the first test ("keeps only exact canonical core-valid history…"), replace the MySQL call assertion:

```ts
    if (dialect === "mysql") expect(calls).toEqual([{ sql: "SELECT * FROM bids WHERE id LIKE ? ESCAPE '!' ORDER BY first_seen_at, id", values: ["city!_portal:%"] }]);
```

with:

```ts
    if (dialect === "mysql") expect(calls).toEqual([
      { sql: "SELECT MAX(last_seen_at) AS latest FROM bids WHERE id LIKE ? ESCAPE '!'", values: ["city!_portal:%"] },
      { sql: "SELECT * FROM bids WHERE id LIKE ? ESCAPE '!' AND last_seen_at >= ? ORDER BY last_seen_at DESC, id LIMIT ?",
        values: ["city!_portal:%", "2026-09-08T00:00:00.000Z", 5000] },
    ]);
```

Append at the end of the file:

```ts
describe("bounded list history", () => {
  it("reads this source's rows seen within 30 days of its newest sighting, newest first", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values([
      bid("fresh"),
      bid("edge", { lastSeenAt: "2026-09-08T00:00:00.000Z" }),
      bid("stale", { lastSeenAt: "2026-09-07T23:59:59.000Z" }),
      bid("neighbour", { id: "city_portal_2:neighbour", dedupeKey: "city_portal_2:neighbour" }),
    ]).run();
    const rows = await loadDetailHistory({ database: database.db }, source.id, source);
    expect(rows.map((row) => row.id)).toEqual(["city_portal:fresh", "city_portal:edge"]);
  });

  it("scopes SQLite reads to a primary-key range", async () => {
    database = await createTestDatabase({ seed: false });
    const [scope, values] = sourceIdPredicate("sqlite", source.id);
    const plan = database.db.$client.prepare(`EXPLAIN QUERY PLAN SELECT * FROM bids WHERE ${scope}`).all(...values) as Array<{ detail: string }>;
    expect(plan.map((step) => step.detail).join("\n")).toMatch(/SEARCH bids USING .*\(id>\? AND id<\?\)/);
  });

  it("caps one list run's history and reports the truncation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mysql = {
      query: async (sql: string): Promise<[unknown[], unknown?]> => sql.startsWith("SELECT MAX")
        ? [[{ latest: NOW }]]
        : [Array.from({ length: DETAIL_HISTORY_LIST_LIMIT }, (_, index) => ({ id: `city_portal:${index}`, source_bid_id: String(index) }))],
    };
    await loadDetailHistory({ mysql }, source.id, source);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "crawler_detail_history_truncated", source: "city_portal", limit: 5000 }));
    warn.mockRestore();
  });
});

describe("detail backfill candidates", () => {
  const outcome = (attemptedAt: string, nextRetryAt: string) =>
    JSON.stringify({ enrichment: { outcome: { attempted_at: attemptedAt, next_retry_at: nextRetryAt, attempt_count: 1 } } });
  const now = new Date(NOW);

  it("returns due rows without a usable body, oldest attempt first, up to the limit", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values([
      bid("never", { description: "", firstSeenAt: "2026-09-01T00:00:00.000Z" }),
      bid("retried", { description: "", firstSeenAt: "2026-08-01T00:00:00.000Z", rawPayload: outcome("2026-09-15T00:00:00+00:00", "2026-09-15T01:00:00+00:00") }),
      bid("echo", { description: "Road repairs", firstSeenAt: "2026-09-20T00:00:00.000Z" }),
      bid("cooling", { description: "", rawPayload: outcome("2026-10-07T23:00:00+00:00", "2026-10-08T23:00:00+00:00") }),
      bid("complete"),
      bid("foreign", { description: "", stateCode: "IL", firstSeenAt: "2026-01-01T00:00:00.000Z" }),
    ]).run();
    const load = (limit: number) => loadDetailBackfillCandidates({ database: database!.db }, source.id, source, { limit, now });
    expect((await load(5)).map((row) => row.id)).toEqual(["city_portal:never", "city_portal:retried", "city_portal:echo"]);
    expect((await load(1)).map((row) => row.id)).toEqual(["city_portal:never"]);
  });

  it("pages past rows the registry no longer accepts", async () => {
    database = await createTestDatabase({ seed: false });
    database.db.insert(bids).values(Array.from({ length: DETAIL_BACKFILL_PAGE_SIZE + 1 }, (_, index) =>
      bid(`foreign${String(index).padStart(3, "0")}`, { description: "", stateCode: "IL", firstSeenAt: "2026-01-01T00:00:00.000Z" }))).run();
    database.db.insert(bids).values(bid("valid", { description: "" })).run();
    const rows = await loadDetailBackfillCandidates({ database: database.db }, source.id, source, { limit: 1, now });
    expect(rows.map((row) => row.id)).toEqual(["city_portal:valid"]);
  });

  it("treats a bare SAM description link as a missing body", async () => {
    database = await createTestDatabase({ seed: false });
    const link = "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=abc";
    database.db.insert(bids).values([
      bid("abc", { id: "sam_gov:abc", dedupeKey: "sam_gov:abc", issuerType: "federal", stateCode: "US", description: link, fullDescription: link }),
      bid("done", { id: "sam_gov:done", dedupeKey: "sam_gov:done", issuerType: "federal", stateCode: "US" }),
    ]).run();
    const rows = await loadDetailBackfillCandidates({ database: database.db }, "sam_gov", undefined, { limit: 25, now });
    expect(rows.map((row) => row.id)).toEqual(["sam_gov:abc"]);
  });

  it("builds the MySQL query with an escaped prefix, guarded JSON reads and one binary collation", () => {
    const { sql, values } = detailBackfillQuery("mysql", "sam_gov", now, 1);
    expect(sql).toContain("id LIKE ? ESCAPE '!'");
    expect(sql).toContain("NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.enrichment.outcome.next_retry_at')), 'null')");
    expect(sql).toContain("COLLATE utf8mb4_bin");
    expect(sql).toMatch(/LIMIT \? OFFSET \?$/);
    expect(values).toEqual(["sam!_gov:%", NOW, DETAIL_BACKFILL_PAGE_SIZE, DETAIL_BACKFILL_PAGE_SIZE]);
  });

  it("reads the attempt budget the way the crawler does", () => {
    expect(detailAttemptBudget({ fetchConfig: {} })).toBe(25);
    expect(detailAttemptBudget({ fetchConfig: { enrichment: { max_details_per_run: 4 } } })).toBe(4);
    expect(detailAttemptBudget({ fetchConfig: { enrichment: { max_details_per_run: 999 } } })).toBe(200);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/crawler/detail-history.test.ts`

Expected: FAIL. The new imports do not exist yet, and the MySQL SQL assertion differs.

- [ ] **Step 3: Rewrite `detail-history.ts`**

Replace the whole content of `frontend/src/server/crawler/detail-history.ts` with the following. `normalizedRows`, `jsonValue` and `fenceDetailBackfillPayload` are unchanged from the current file. `missingBody`, `historyOutcome`, `historyDue` and `historyAge` move here unchanged from `configured-runner.ts`.

```ts
import type { AppDatabase } from "@/server/db/client";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import type { CrawlableSource, MysqlSourceStore } from "./source-registry";
import { evaluateCrawlerBid, existingIdentityIssues } from "./data-quality";
import { getBidDescription } from "@/lib/bid-description";
import { isCanonicalSourceBid } from "@/lib/source-identity";

export type DetailHistoryRecord = Record<string, unknown>;

export interface DetailHistoryStore {
  database?: AppDatabase;
  mysql?: MysqlSourceStore;
}

type Dialect = "sqlite" | "mysql";

/** A list run only returns bids its source showed recently; older rows cannot be reused. */
export const DETAIL_HISTORY_LIST_WINDOW_DAYS = 30;
/** Safety cap for one list run's history, newest sighting first. */
export const DETAIL_HISTORY_LIST_LIMIT = 5000;
/** Backfill reads a page at a time so rows the registry no longer accepts cannot block valid ones. */
export const DETAIL_BACKFILL_PAGE_SIZE = 200;
export const DETAIL_BACKFILL_MAX_PAGES = 10;
/** crawler/apsi_crawler/enrichment.py: max_details_per_run defaults to 25 and is clamped to 1–200. */
const DEFAULT_DETAIL_ATTEMPTS = 25;
const DAY_MS = 86_400_000;

function jsonValue(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizedRows(rows: DetailHistoryRecord[], sourceId: string, source?: CrawlableSource): DetailHistoryRecord[] {
  return rows.filter((row) => isCanonicalSourceBid({ id: row.id, sourceBidId: row.source_bid_id }, sourceId))
    .map((row): DetailHistoryRecord => ({
      ...row,
      raw_payload: jsonValue(row.raw_payload, {}),
      quality_flags_json: jsonValue(row.quality_flags_json, []),
      // Attachments are merged additively by persistence. A detail retry cannot delete them.
      attachments: [],
    })).filter((row) => {
      if (!evaluateCrawlerBid(row).coreValid) return false;
      const level = source?.jurisdictionLevel ?? source?.issuerType;
      const expected = source ? { state_code: source.stateCode, issuer_type: level, jurisdiction_level: level, fips_code: source.fipsCode }
        : sourceId === "sam_gov" ? { state_code: "US", issuer_type: "federal", jurisdiction_level: "federal" } : {};
      return existingIdentityIssues(row, expected).length === 0 && (!source?.baseUrl || row.source_url !== source.baseUrl);
    });
}

/** True when neither stored text field is usable procurement content. */
export function missingBody(row: DetailHistoryRecord): boolean {
  return !getBidDescription({ title: String(row.title ?? ""), description: String(row.description ?? ""), fullDescription: String(row.full_description ?? "") });
}

function historyOutcome(row: DetailHistoryRecord): Record<string, unknown> {
  const raw = row.raw_payload as { enrichment?: { outcome?: unknown } } | null;
  const outcome = raw?.enrichment?.outcome;
  return outcome && typeof outcome === "object" && !Array.isArray(outcome) ? outcome as Record<string, unknown> : {};
}

export function historyDue(row: DetailHistoryRecord, now: Date): boolean {
  const retry = historyOutcome(row).next_retry_at;
  const at = typeof retry === "string" ? Date.parse(retry) : NaN;
  return !Number.isFinite(at) || at <= now.getTime();
}

export function historyAge(row: DetailHistoryRecord): number {
  const at = historyOutcome(row).attempted_at ?? row.first_seen_at;
  const parsed = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Detail fetches one backfill run may attempt, read the way the crawler reads it. */
export function detailAttemptBudget(source: Pick<CrawlableSource, "fetchConfig">): number {
  const enrichment = source.fetchConfig?.enrichment;
  const requested = enrichment && typeof enrichment === "object" && !Array.isArray(enrichment)
    ? (enrichment as Record<string, unknown>).max_details_per_run : undefined;
  return typeof requested === "number" && Number.isFinite(requested)
    ? Math.min(200, Math.max(1, Math.trunc(requested)))
    : DEFAULT_DETAIL_ATTEMPTS;
}

/**
 * The source's canonical ID namespace. SQLite: the primary-key range `[<id>:, <id>;)`, because
 * its case-insensitive LIKE cannot use that index. MySQL: an escaped prefix LIKE, which the
 * optimizer reads as a primary-key range; its default utf8mb4_0900_ai_ci collation sorts ";"
 * before ":", so the SQLite range would be empty there.
 */
export function sourceIdPredicate(dialect: Dialect, sourceId: string): [string, string[]] {
  return dialect === "mysql"
    ? ["id LIKE ? ESCAPE '!'", [`${sourceId.replace(/[!%_]/g, (character) => `!${character}`)}:%`]]
    : ["id >= ? AND id < ?", [`${sourceId}:`, `${sourceId};`]];
}

async function selectRows(store: DetailHistoryStore, sql: string, values: unknown[]): Promise<DetailHistoryRecord[]> {
  return store.mysql
    ? mysqlSelectMany<DetailHistoryRecord>(store.mysql, sql, values)
    : store.database!.$client.prepare(sql).all(...values) as DetailHistoryRecord[];
}

/**
 * History for a list run: this source's rows seen within 30 days of its newest sighting, newest
 * first, at most 5,000. Anchoring on the newest sighting rather than the clock keeps the window
 * full after a worker outage.
 */
export async function loadDetailHistory(store: DetailHistoryStore, sourceId: string, source?: CrawlableSource): Promise<DetailHistoryRecord[]> {
  const [scope, scopeValues] = sourceIdPredicate(store.mysql ? "mysql" : "sqlite", sourceId);
  const [newest] = await selectRows(store, `SELECT MAX(last_seen_at) AS latest FROM bids WHERE ${scope}`, scopeValues);
  const latest = typeof newest?.latest === "string" ? Date.parse(newest.latest) : Number.NaN;
  const since = Number.isFinite(latest) ? new Date(latest - DETAIL_HISTORY_LIST_WINDOW_DAYS * DAY_MS).toISOString() : "";
  const rows = await selectRows(store,
    `SELECT * FROM bids WHERE ${scope} AND last_seen_at >= ? ORDER BY last_seen_at DESC, id LIMIT ?`,
    [...scopeValues, since, DETAIL_HISTORY_LIST_LIMIT]);
  if (rows.length >= DETAIL_HISTORY_LIST_LIMIT) {
    console.warn(JSON.stringify({ event: "crawler_detail_history_truncated", source: sourceId, limit: DETAIL_HISTORY_LIST_LIMIT }));
  }
  return normalizedRows(rows, sourceId, source);
}

function outcomeText(dialect: Dialect, field: "attempted_at" | "next_retry_at"): string {
  return dialect === "mysql"
    ? `(CASE WHEN JSON_VALID(raw_payload) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.enrichment.outcome.${field}')), 'null') END)`
    : `(CASE WHEN json_valid(raw_payload) THEN json_extract(raw_payload, '$.enrichment.outcome.${field}') END)`;
}

/** No usable stored text: empty, the title again, or a bare SAM description link. */
function blankText(column: "description" | "full_description"): string {
  return `(TRIM(COALESCE(${column}, '')) = '' OR LOWER(TRIM(${column})) = LOWER(TRIM(title))`
    + ` OR ${column} LIKE 'https://api.sam.gov/%noticedesc%')`;
}

/**
 * One page of backfill candidates: rows with no usable stored body that are due, oldest attempt
 * (else first sighting) first. It approximates `missingBody`/`historyDue`, which re-check every
 * row. MySQL compares the JSON text and the column under one binary collation.
 */
export function detailBackfillQuery(dialect: Dialect, sourceId: string, now: Date, page: number): { sql: string; values: unknown[] } {
  const [scope, scopeValues] = sourceIdPredicate(dialect, sourceId);
  const attempted = outcomeText(dialect, "attempted_at");
  const order = dialect === "mysql"
    ? `COALESCE(CONVERT(${attempted} USING utf8mb4) COLLATE utf8mb4_bin, CONVERT(first_seen_at USING utf8mb4) COLLATE utf8mb4_bin)`
    : `COALESCE(${attempted}, first_seen_at)`;
  return {
    sql: `SELECT * FROM bids WHERE ${scope} AND ${blankText("description")} AND ${blankText("full_description")}`
      + ` AND COALESCE(${outcomeText(dialect, "next_retry_at")}, '') <= ? ORDER BY ${order}, id LIMIT ? OFFSET ?`,
    values: [...scopeValues, now.toISOString(), DETAIL_BACKFILL_PAGE_SIZE, page * DETAIL_BACKFILL_PAGE_SIZE],
  };
}

/** Backfill candidates for one run: at most `limit`, read a page at a time. */
export async function loadDetailBackfillCandidates(
  store: DetailHistoryStore,
  sourceId: string,
  source: CrawlableSource | undefined,
  options: { limit: number; now?: Date },
): Promise<DetailHistoryRecord[]> {
  const now = options.now ?? new Date();
  const dialect: Dialect = store.mysql ? "mysql" : "sqlite";
  const candidates: DetailHistoryRecord[] = [];
  for (let page = 0; page < DETAIL_BACKFILL_MAX_PAGES && candidates.length < options.limit; page += 1) {
    const { sql, values } = detailBackfillQuery(dialect, sourceId, now, page);
    const rows = await selectRows(store, sql, values);
    for (const row of normalizedRows(rows, sourceId, source)) {
      if (candidates.length < options.limit && missingBody(row) && historyDue(row, now)) candidates.push(row);
    }
    if (rows.length < DETAIL_BACKFILL_PAGE_SIZE) break;
  }
  return candidates;
}

/** Historical retries can never prove that absent open records have disappeared. */
export function fenceDetailBackfillPayload(payload: CrawlerJsonRunPayload): CrawlerJsonRunPayload {
  const pagination = payload.metadata?.pagination;
  return {
    ...payload,
    metadata: {
      ...(payload.metadata ?? {}),
      mode: "detail_backfill",
      pagination: { ...(pagination && typeof pagination === "object" ? pagination : {}), complete: false, stopped_reason: "detail_backfill" },
    },
  };
}
```

- [ ] **Step 4: Run the detail-history tests**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/crawler/detail-history.test.ts`

Expected: PASS.

- [ ] **Step 5: Use the right loader in each runner**

`frontend/src/server/crawler/state-runner.ts`: change the `./detail-history` import to:

```ts
import { detailAttemptBudget, fenceDetailBackfillPayload, loadDetailBackfillCandidates, loadDetailHistory, type DetailHistoryRecord, type DetailHistoryStore } from "./detail-history";
```

and in `runCrawlTask` replace:

```ts
  const detailHistory = options.detailHistory ?? (options.historyStore ? await loadDetailHistory(options.historyStore, source.id, source) : undefined);
```

with:

```ts
  // List runs reuse recent history; backfill runs read only their attempt budget of candidates.
  const detailHistory = options.detailHistory ?? (options.historyStore
    ? options.detailBackfillOnly
      ? await loadDetailBackfillCandidates(options.historyStore, source.id, source, { limit: detailAttemptBudget(source) })
      : await loadDetailHistory(options.historyStore, source.id, source)
    : undefined);
```

`frontend/src/server/crawler/sam-gov-runner.ts`: change the `./detail-history` import to:

```ts
import { fenceDetailBackfillPayload, loadDetailBackfillCandidates, loadDetailHistory, type DetailHistoryRecord, type DetailHistoryStore } from "./detail-history";
```

Add below the imports:

```ts
/** fetch-sam-gov's own `--max-descriptions` default. */
const SAM_DEFAULT_MAX_DESCRIPTIONS = 25;
```

Then in `runSamGovCrawler` replace:

```ts
  let detailHistory = options.detailHistory;
  if (!detailHistory && options.historyStore) {
    detailHistory = await loadDetailHistory(options.historyStore, "sam_gov");
  } else if (!detailHistory && !options.outputJson) {
    if (useMysqlImport) {
      detailHistory = await loadDetailHistory({ mysql: resolveMysqlPool() }, "sam_gov");
    } else if (existsSync(databasePath)) {
      const database = createDatabase(databasePath);
      try {
        detailHistory = await loadDetailHistory({ database }, "sam_gov");
      } finally {
        database.$client.close();
      }
    }
  }
```

with:

```ts
  // List runs reuse recent history; backfill runs read only their attempt budget of candidates.
  const loadHistory = (store: DetailHistoryStore) => options.detailBackfillOnly
    ? loadDetailBackfillCandidates(store, "sam_gov", undefined, { limit: options.maxDescriptions ?? SAM_DEFAULT_MAX_DESCRIPTIONS })
    : loadDetailHistory(store, "sam_gov");
  let detailHistory = options.detailHistory;
  if (!detailHistory && options.historyStore) {
    detailHistory = await loadHistory(options.historyStore);
  } else if (!detailHistory && !options.outputJson) {
    if (useMysqlImport) {
      detailHistory = await loadHistory({ mysql: resolveMysqlPool() });
    } else if (existsSync(databasePath)) {
      const database = createDatabase(databasePath);
      try {
        detailHistory = await loadHistory({ database });
      } finally {
        database.$client.close();
      }
    }
  }
```

`frontend/src/server/crawler/sam-gov-runner.test.ts`: in the `vi.mock("./detail-history", …)` factory, replace:

```ts
  return { ...original, loadDetailHistory: vi.fn(async () => []) };
```

with:

```ts
  return { ...original, loadDetailHistory: vi.fn(async () => []), loadDetailBackfillCandidates: vi.fn(async () => []) };
```

`frontend/src/server/crawler/configured-runner.ts` needs four edits.

1. Replace these two imports:

   ```ts
   import { getBidDescription } from "@/lib/bid-description";
   import { loadDetailHistory, type DetailHistoryRecord } from "./detail-history";
   ```

   with:

   ```ts
   import { historyAge, loadDetailBackfillCandidates } from "./detail-history";
   ```

2. Delete the local functions `missingBody`, `historyOutcome`, `historyDue` and `historyAge`; they now live in `detail-history.ts`.

3. In the automatic-backfill queue, replace:

   ```ts
         const history = await loadDetailHistory({ database: options.database, mysql: options.mysql }, source.id, source);
         const ready = history.filter((row) => missingBody(row) && historyDue(row, now));
         if (ready.length) queue.push({ source, oldest: ready.reduce((oldest, row) => Math.min(oldest, historyAge(row)), Infinity) });
   ```

   with:

   ```ts
         const [oldest] = await loadDetailBackfillCandidates({ database: options.database, mysql: options.mysql }, source.id, source, { limit: 1, now });
         if (oldest) queue.push({ source, oldest: historyAge(oldest) });
   ```

4. In the per-source loop, replace:

   ```ts
       if (options.detailBackfillOnly) {
         const history = await loadDetailHistory({ database: options.database, mysql: options.mysql }, source.id, source);
         if (!history.some(missingBody)) continue;
       }
   ```

   with:

   ```ts
       if (options.detailBackfillOnly) {
         // Nothing due: a run would only record `deferred` outcomes for rows still cooling down.
         const [candidate] = await loadDetailBackfillCandidates({ database: options.database, mysql: options.mysql }, source.id, source, { limit: 1, now });
         if (!candidate) continue;
       }
   ```

After the edits, run `grep -n "getBidDescription\|DetailHistoryRecord\|loadDetailHistory" frontend/src/server/crawler/configured-runner.ts`. Expected: no output. If anything else in the file still uses one of these names, keep that import.

`frontend/src/server/crawler/configured-runner.test.ts`: add this test directly after the test "optionally retries historical bodies in the worker using the same remaining budget and spacing". It uses that `describe`'s own `insertSource`, `noopMatcher`, `noopNotifier` and `NOW`.

```ts
  it("skips a history-only source whose body-less rows are all cooling down", async () => {
    insertSource("cooling_source", { providerFamily: "bidnet", fetchConfig: JSON.stringify({ enrichment: { enabled: true } }) });
    testDb.db.insert(bids).values({
      id: "cooling_source:old", source: "cooling_source", sourceBidId: "old", dedupeKey: "cooling_source:old",
      title: "Road repair", description: "Road repair", issuerName: "County", issuerType: "state", stateCode: "CA",
      sourceUrl: "https://public.example/bid/old", firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW,
      rawPayload: JSON.stringify({ enrichment: { outcome: { attempted_at: NOW, next_retry_at: "2099-01-01T00:00:00+00:00" } } }),
    }).run();
    let ran = false;
    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db, owner: "cooling-test", now: new Date(NOW), detailBackfillOnly: true, sourceIds: ["cooling_source"],
      matcher: noopMatcher, notifier: noopNotifier,
      runCrawlerSourceOnce: (async (_db: AppDatabase, options: RunCrawlerSourceOnceOptions) => {
        ran = true;
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });
    expect(ran).toBe(false);
  });
```

- [ ] **Step 6: Run the crawler and route suites**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/server/crawler src/app/api/crawler scripts`

Expected: PASS, including the two existing backfill tests in `configured-runner.test.ts`. Their "Road repair" title-echo rows are candidates, because `blankText` treats a body equal to the title as missing.

- [ ] **Step 7: Write the failing Python budget tests**

Create `crawler/tests/test_detail_backfill_budget.py`:

```python
"""P0-4: a backfill run prints at most its attempt budget of candidates, oldest attempt first."""

import io
import json

from apsi_crawler import cli


def _state_row(index):
    return {
        "id": f"old_source:{index:02d}", "source_bid_id": f"{index:02d}", "dedupe_key": f"old_source:{index:02d}",
        "source": "Old Source", "issuer_name": "County Roads Agency", "issuer_type": "county", "state_code": "CA",
        "title": f"Road repair {index:02d}", "description": "", "full_description": None,
        "source_url": f"https://public.example/bid/{index:02d}", "first_seen_at": f"2026-09-{index:02d}T00:00:00+00:00",
        "lifecycle_status": "closed", "is_active": 0, "raw_payload": {}, "attachments": [],
    }


def test_state_backfill_prints_at_most_its_attempt_budget_oldest_first(monkeypatch, capsys):
    monkeypatch.setattr(cli, "resolve_adapter", lambda *args: (_ for _ in ()).throw(AssertionError("must not fetch list")))
    request = {
        "task_id": "budget", "source_id": "old_source", "label": "Old Source", "state_code": "CA", "provider_family": "unknown",
        "jurisdiction_level": "county", "fetch_config": {"enrichment": {"max_details_per_run": 3}},
        "detail_history": [_state_row(index) for index in range(28, 0, -1)], "detail_backfill_only": True,
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(request)))
    assert cli.main(["fetch-task"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert [bid["id"] for bid in output["bids"]] == ["old_source:01", "old_source:02", "old_source:03"]


def test_sam_backfill_prints_at_most_max_descriptions_oldest_first(monkeypatch, capsys):
    monkeypatch.delenv("SAM_API_KEY", raising=False)
    rows = [{
        "id": f"sam_gov:n{index:02d}", "source_bid_id": f"n{index:02d}", "dedupe_key": f"sam_gov:n{index:02d}", "source": "SAM.gov",
        "issuer_name": "Department of the Interior", "issuer_type": "federal", "state_code": "US",
        "title": f"Trail maintenance {index:02d}", "description": "", "full_description": None,
        "source_url": f"https://sam.gov/opp/n{index:02d}/view", "first_seen_at": f"2026-09-{index:02d}T00:00:00+00:00",
        "raw_payload": {"description": f"https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=n{index:02d}"}, "attachments": [],
    } for index in range(10, 0, -1)]
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(rows)))
    assert cli.main(["fetch-sam-gov", "--output-json", "--posted-from", "09/01/2026", "--posted-to", "09/30/2026",
                     "--detail-history-stdin", "--detail-backfill-only", "--max-descriptions", "2"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert [bid["id"] for bid in output["bids"]] == ["sam_gov:n01", "sam_gov:n02"]
```

- [ ] **Step 8: Run them to verify they fail**

Run: `cd $WT/crawler && $PY -m pytest tests/test_detail_backfill_budget.py -q`

Expected: 2 failed. All 28 and all 10 candidates are printed, in input order.

- [ ] **Step 9: Implement in `cli.py`**

In `crawler/apsi_crawler/cli.py`, replace the two imports:

```python
from apsi_crawler.enrichment import enrich_bids
```

```python
from apsi_crawler.detail_backfill import apply_detail_history, historical_candidates, outcome_of
```

with:

```python
from apsi_crawler.enrichment import enrich_bids, parse_enrichment_config
```

```python
from apsi_crawler.detail_backfill import apply_detail_history, detail_priority, historical_candidates, outcome_of
```

Add this helper directly above `def _require_non_empty_bids`:

```python
def _oldest_candidates(candidates, budget):
    """A backfill run's attempt budget of candidates, oldest attempt first; the rest wait."""
    timestamp = now_iso()
    return sorted(candidates, key=lambda row: detail_priority(row, timestamp))[:max(budget, 0)]
```

In `fetch_sam_gov`, replace:

```python
            bids = enrich_sam_gov_bids(historical_candidates(detail_history, "sam_gov"), resolved_key,
                                       max_descriptions=max_descriptions)
```

with:

```python
            bids = enrich_sam_gov_bids(_oldest_candidates(historical_candidates(detail_history, "sam_gov"), max_descriptions),
                                       resolved_key, max_descriptions=max_descriptions)
```

In `fetch_task`, replace:

```python
            bids = historical_candidates(payload.get("detail_history"), source.id, source)
```

with:

```python
            budget = parse_enrichment_config(payload.get("fetch_config"))["max_details_per_run"]
            bids = _oldest_candidates(historical_candidates(payload.get("detail_history"), source.id, source), budget)
```

- [ ] **Step 10: Run the Python tests**

Run: `cd $WT/crawler && $PY -m pytest tests/test_detail_backfill_budget.py -q && $PY -m pytest -q`

Expected: 2 passed, then the full suite passes.

- [ ] **Step 11: Write and run the real-MySQL integration test**

Create `frontend/src/server/crawler/detail-history.mysql.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { loadDetailBackfillCandidates, loadDetailHistory } from "./detail-history";

const NOW = "2026-10-08T00:00:00.000Z";

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("bounded detail history on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  let mysql: ReturnType<typeof createMysqlPool>;

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  const insert = (id: string, values: { description?: string; firstSeenAt?: string; lastSeenAt?: string; rawPayload?: string | null } = {}) => {
    const sourceBidId = id.slice(id.indexOf(":") + 1);
    return mysql.query(
      "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, raw_payload, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, "SAM.gov", sourceBidId, id, "Trail maintenance", values.description ?? "", "Department of the Interior", "federal", "US",
        `https://sam.gov/opp/${sourceBidId}/view`, values.rawPayload ?? null, values.firstSeenAt ?? NOW, values.lastSeenAt ?? NOW, NOW, NOW],
    );
  };
  const attempt = (attemptedAt: string | null, nextRetryAt: string | null) =>
    JSON.stringify({ enrichment: { outcome: { attempted_at: attemptedAt, next_retry_at: nextRetryAt } } });

  it("selects due body-less rows in attempt order and bounds list history by the newest sighting", async () => {
    await insert("sam_gov:never", { firstSeenAt: "2026-09-01T00:00:00.000Z", rawPayload: "not json" });
    await insert("sam_gov:nullattempt", { firstSeenAt: "2026-09-10T00:00:00.000Z", rawPayload: attempt(null, null) });
    await insert("sam_gov:retried", { firstSeenAt: "2026-08-01T00:00:00.000Z", rawPayload: attempt("2026-09-15T00:00:00+00:00", "2026-09-15T01:00:00+00:00") });
    await insert("sam_gov:link", { firstSeenAt: "2026-09-20T00:00:00.000Z", description: "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=link" });
    await insert("sam_gov:echo", { firstSeenAt: "2026-09-25T00:00:00.000Z", description: "Trail Maintenance" });
    await insert("sam_gov:cooling", { rawPayload: attempt("2026-10-07T23:00:00+00:00", "2026-10-08T23:00:00+00:00") });
    await insert("sam_gov:complete", { description: "Clear brush and repair twelve miles of trail tread." });
    await insert("sam_gov:stale", { lastSeenAt: "2026-09-01T00:00:00.000Z", description: "Clear brush on the north loop." });
    await insert("sam_gov_extra:1");

    const candidates = await loadDetailBackfillCandidates({ mysql }, "sam_gov", undefined, { limit: 10, now: new Date(NOW) });
    expect(candidates.map((row) => row.id)).toEqual(["sam_gov:never", "sam_gov:nullattempt", "sam_gov:retried", "sam_gov:link", "sam_gov:echo"]);

    const history = await loadDetailHistory({ mysql }, "sam_gov");
    expect(history.map((row) => row.id).sort()).toEqual([
      "sam_gov:complete", "sam_gov:cooling", "sam_gov:echo", "sam_gov:link", "sam_gov:never", "sam_gov:nullattempt", "sam_gov:retried",
    ]);
  });
});
```

Run it without the env var. Expected: 1 skipped.

Then run the Shared commands MySQL block with `<files>` = `src/server/crawler/detail-history.mysql.integration.test.ts`. Expected: 1 passed, `exit=0`.

These exact rows were checked before the plan was written, on MySQL 8 (`utf8mb4_0900_ai_ci`) and on SQLite 3.53. Both return this order, and both read through the primary key.

- [ ] **Step 12: Run the whole frontend suite, then commit**

Run: `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run`

Expected: PASS.

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence/.claude/worktrees/data-usability-p0
git add frontend/src/server/crawler/detail-history.ts frontend/src/server/crawler/detail-history.test.ts frontend/src/server/crawler/detail-history.mysql.integration.test.ts frontend/src/server/crawler/state-runner.ts frontend/src/server/crawler/sam-gov-runner.ts frontend/src/server/crawler/sam-gov-runner.test.ts frontend/src/server/crawler/configured-runner.ts frontend/src/server/crawler/configured-runner.test.ts crawler/apsi_crawler/cli.py crawler/tests/test_detail_backfill_budget.py
git commit -m "fix(crawler): bounded detail history — recent rows for list runs, budgeted due candidates for backfill"
```

---

### Task 5: One description classifier with a shared contract (P0-5)

**Files:**
- Modify: `frontend/src/lib/bid-description.ts` (`getBidDescriptionIssue` and its patterns)
- Create: `frontend/src/lib/bid-description.contract.test.ts`
- Modify: `crawler/apsi_crawler/content_quality.py` (append `body_issue`)
- Modify: `crawler/apsi_crawler/detail_backfill.py` (`valid_body_text` and its imports only)
- Create: `crawler/tests/fixtures/description_quality_contract.json`
- Create: `crawler/tests/test_description_quality_contract.py`

**Interfaces:**
- Consumes: Task 2's version of `detail_backfill.py` (do not touch `apply_detail_history` or `historical_candidates`).
- Produces:
  - `body_issue(value, title) -> str | None` in `apsi_crawler.content_quality`. It returns exactly the codes of `getBidDescriptionIssue`.
  - `valid_body_text(value, title)` returns `body_issue(value, title) is None`.
  - `getBidDescriptionIssue`'s signature is unchanged.

- [ ] **Step 1: Write the shared contract fixture**

Create `crawler/tests/fixtures/description_quality_contract.json`:

```json
{
  "title": "Road repair",
  "cases": [
    {"name": "short real scope", "text": "Supply and install two backup generators.", "issue": null},
    {"name": "signing and striping", "text": "Signing and striping of County Road 12.", "issue": null},
    {"name": "sign installation", "text": "Sign installation and maintenance services.", "issue": null},
    {"name": "login.gov integration", "text": "Login.gov integration services for the state portal.", "issue": null},
    {"name": "unauthorized vehicle towing", "text": "Unauthorized vehicle towing and storage services.", "issue": null},
    {"name": "register of deeds", "text": "Register of Deeds document imaging and indexing.", "issue": null},
    {"name": "register pump warranties", "text": "Register pump warranties with the city.", "issue": null},
    {"name": "forbidden drive", "text": "Forbidden Drive trail restoration.", "issue": null},
    {"name": "error page redesign", "text": "Error 404 page redesign for the city website.", "issue": null},
    {"name": "address inside a description", "text": "100 Main Street, repaving and drainage improvements for the downtown corridor, Springfield, IL 62701", "issue": null},
    {"name": "instructions after scope", "text": "Repair pumps; log in to submit your offer.", "issue": null},
    {"name": "registration requirement in scope", "text": "You must be registered in SAM.gov to submit a bid. The county seeks asphalt paving.", "issue": null},
    {"name": "solicitation type with scope", "text": "RFP for 12 pumps.", "issue": null},
    {"name": "chinese scope", "text": "购买五台水泵。", "issue": null},
    {"name": "empty", "text": "", "issue": "missing_body"},
    {"name": "title echo", "text": "Road repair.", "issue": "title_echo"},
    {"name": "html error page", "text": "<!doctype html><html><body>Login</body></html>", "issue": "restricted_or_error_body"},
    {"name": "html fragment", "text": "<html><body>Bid details</body></html>", "issue": "restricted_or_error_body"},
    {"name": "sam description link", "text": "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=one", "issue": "body_url"},
    {"name": "description pending", "text": "Description pending", "issue": "placeholder_body"},
    {"name": "combined synopsis with spaces", "text": "Combined Synopsis / Solicitation", "issue": "placeholder_body"},
    {"name": "solicitation type with colon", "text": "RFP:", "issue": "placeholder_body"},
    {"name": "not applicable", "text": "N/A", "issue": "placeholder_body"},
    {"name": "bare log in", "text": "Log in", "issue": "restricted_or_error_body"},
    {"name": "login required", "text": "Login required.", "issue": "restricted_or_error_body"},
    {"name": "please log in to view", "text": "Please log in to view the solicitation details.", "issue": "restricted_or_error_body"},
    {"name": "sign in to see", "text": "Sign in to see this solicitation", "issue": "restricted_or_error_body"},
    {"name": "log in to a named portal", "text": "Please log in to BidNet Direct to view this bid.", "issue": "restricted_or_error_body"},
    {"name": "you must sign in", "text": "You must sign in to view bid documents.", "issue": "restricted_or_error_body"},
    {"name": "register to view", "text": "Register to view details.", "issue": "restricted_or_error_body"},
    {"name": "register with the portal", "text": "Please register with the portal to view this opportunity.", "issue": "restricted_or_error_body"},
    {"name": "create an account", "text": "Create an account to access documents.", "issue": "restricted_or_error_body"},
    {"name": "access denied", "text": "Access denied", "issue": "restricted_or_error_body"},
    {"name": "access denied sentence", "text": "Access denied. You do not have permission to view this page.", "issue": "restricted_or_error_body"},
    {"name": "forbidden", "text": "Forbidden", "issue": "restricted_or_error_body"},
    {"name": "error 404 page", "text": "Error 404 - Page not found", "issue": "restricted_or_error_body"},
    {"name": "browser check", "text": "Checking your browser before accessing this site.", "issue": "restricted_or_error_body"},
    {"name": "just a moment", "text": "Just a moment...", "issue": "restricted_or_error_body"},
    {"name": "enable javascript", "text": "Enable JavaScript to view this page.", "issue": "restricted_or_error_body"},
    {"name": "portal metadata", "text": "Purchase Method: Open Market", "issue": "metadata_body"},
    {"name": "navigation with inner spaces", "text": "Home | About   us | Contact us", "issue": "navigation_body"},
    {"name": "navigation lines", "text": "Home\nAbout\nPrivacy Policy", "issue": "navigation_body"},
    {"name": "separators only", "text": "| ·", "issue": "navigation_body"},
    {"name": "address only", "text": "123 Main Street, Springfield, IL 62701", "issue": "address_body"},
    {"name": "address with suite", "text": "1200 Main St., Suite 100, Springfield, IL 62701", "issue": "address_body"}
  ]
}
```

- [ ] **Step 2: Write both contract tests**

Create `frontend/src/lib/bid-description.contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getBidDescription, getBidDescriptionIssue } from "./bid-description";

const contract = JSON.parse(readFileSync(path.resolve("../crawler/tests/fixtures/description_quality_contract.json"), "utf8")) as {
  title: string;
  cases: Array<{ name: string; text: string; issue: string | null }>;
};

describe("shared Python / TypeScript description contract", () => {
  it.each(contract.cases)("$name", ({ text, issue }) => {
    expect(getBidDescriptionIssue(text, contract.title)).toBe(issue);
    expect(getBidDescription({ title: contract.title, description: text })).toBe(issue === null ? text.trim() : "");
  });
});
```

Create `crawler/tests/test_description_quality_contract.py`:

```python
import json
from pathlib import Path

import pytest

from apsi_crawler.content_quality import body_issue
from apsi_crawler.detail_backfill import valid_body_text

CONTRACT = json.loads((Path(__file__).parent / "fixtures/description_quality_contract.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CONTRACT["cases"], ids=lambda case: case["name"])
def test_shared_description_contract(case):
    assert body_issue(case["text"], CONTRACT["title"]) == case["issue"]
    assert valid_body_text(case["text"], CONTRACT["title"]) is (case["issue"] is None)
```

- [ ] **Step 3: Run them to verify they fail**

Run:
- `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/lib/bid-description.contract.test.ts`
- `cd $WT/crawler && $PY -m pytest tests/test_description_quality_contract.py -q`

Expected:
- TS FAILs on "signing and striping", "sign installation", "login.gov integration", "unauthorized vehicle towing" and "address inside a description".
- Python fails to import `body_issue`.

- [ ] **Step 4: Rewrite the TS classifier**

In `frontend/src/lib/bid-description.ts`, replace everything from `export function isSamDescriptionLink` through the end of `getBidDescriptionIssue` with the block below. Keep the `BidDescription` type and `EDGE_PUNCTUATION` above it, and `getBidDescription` below it, unchanged.

```ts
// Mirrored rule for rule by crawler/apsi_crawler/content_quality.py `body_issue`;
// crawler/tests/fixtures/description_quality_contract.json is the shared contract.
const HTML_BODY = /^(?:<!doctype\b|<html\b|<head\b|<body\b)/i;
const URL_BODY = /^https?:\/\/\S+$/i;
const PLACEHOLDER_BODIES = [
  /^(?:(?:solicitation|short|full|bulletin|bid|project)\s+)?(?:description|desc|summary|scope of work|statement of work)[:\s]*$/i,
  /^(?:solicitation|presolicitation|combined synopsis\s*\/\s*solicitation|sources sought|special notice|award notice|sale of surplus property|ifb|rfp|rfq|itb|rfi)[.:\s]*$/i,
  /^(?:n\/a|none|null|not (?:available|provided)|no description(?: available)?|description (?:not available|pending)|tbd|待补|暂无(?:正文|描述))\.?$/i,
];
// A notice counts only as the whole notice: "log in" / "sign in" / "register" must lead to
// "to view|see|access|download", "required" or the end, and an error phrase must end at
// punctuation or the end. "Signing and striping…", "Login.gov integration…", "Register of
// Deeds…" and "Unauthorized vehicle towing…" are procurement scope.
const RESTRICTED_BODIES = [
  /^(?:please\s+)?(?:log\s*in|sign\s*in)(?:(?:\s+(?:to|with|on|at)\s+(?:the\s+)?[\w.]+(?:\s+[\w.]+){0,3})?\s+(?:or\s+register\s+)?to\s+(?:view|see|access|download)\b|\s+required\b|\s*[.!]?$)/i,
  /^you (?:must|need to) (?:log\s*in|sign\s*in)\b/i,
  /^(?:please\s+)?(?:register|create an account)(?:(?:\s+(?:with|on|at)\s+(?:the\s+)?[\w.]+(?:\s+[\w.]+){0,3})?\s+(?:or\s+(?:log\s*in|sign\s*in)\s+)?to\s+(?:view|see|access|download)\b|\s*[.!]?$)/i,
  /^(?:access denied|forbidden|unauthorized|error (?:403|404|500)|page not found)(?:\s*[.!:\-–—]|$)/i,
  /^(?:checking your browser\b|just a moment(?:\s*(?:\.\.\.|…|[.!])|$)|enable javascript(?:\s+(?:to|and)\b|\s*[.!]?$)|verify (?:you are|that you are) human\b)/i,
];
const METADATA_BODY = /^(?:purchase method|type code|bid type|informal bid flag|allow electronic quote)\s*(?::|：|$)/i;
const NAVIGATION_PART = /^(?:home|about(?: us)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?|copyright.*|all rights reserved|login|sign in|register)$/i;
// Only a text that is one street address and nothing else.
const ADDRESS_BODY = /^\d+[a-z]?\s+(?:[\w.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\.?(?:\s*,?\s*(?:suite|ste|unit|room|rm|floor|fl)\.?\s*#?[\w-]+)?\s*,\s*[a-z][a-z .'-]*,?\s+[a-z]{2}\s+\d{5}(?:-\d{4})?\.?$/i;

export function isSamDescriptionLink(value: string): boolean {
  return /^https?:\/\/api\.sam\.gov\/(?:prod\/)?opportunities\/v1\/noticedesc(?:\?[^\s]*)?$/i.test(value.trim());
}

function comparable(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLowerCase() || "";
}

/** Reject known portal placeholders, not short procurement scope. Length is not a quality gate. */
export function getBidDescriptionIssue(value: string | null | undefined, title?: string | null): string | null {
  const text = comparable(value);
  const identity = text.replace(EDGE_PUNCTUATION, "");
  if (!identity) return "missing_body";
  if (identity === comparable(title).replace(EDGE_PUNCTUATION, "")) return "title_echo";
  if (HTML_BODY.test(text)) return "restricted_or_error_body";
  if (URL_BODY.test(text)) return "body_url";
  if (PLACEHOLDER_BODIES.some((pattern) => pattern.test(text))) return "placeholder_body";
  if (RESTRICTED_BODIES.some((pattern) => pattern.test(text))) return "restricted_or_error_body";
  if (METADATA_BODY.test(text)) return "metadata_body";
  const navigation = (value ?? "").trim().split(/\s*[|\n·]\s*/).map(comparable).filter(Boolean);
  if (navigation.every((part) => NAVIGATION_PART.test(part))) return "navigation_body";
  if (ADDRESS_BODY.test(text)) return "address_body";
  return null;
}
```

None of these patterns has the `g` flag, which would make `.test()` stateful through `lastIndex`. Keep it that way.

- [ ] **Step 5: Add `body_issue` to the Python crawler**

Append to the end of `crawler/apsi_crawler/content_quality.py`. It already imports `re` and defines `comparable_text` and `echo_key`.

```python


# Description classifier, mirrored rule for rule by frontend/src/lib/bid-description.ts
# `getBidDescriptionIssue`; tests/fixtures/description_quality_contract.json is the shared
# contract. re.ASCII keeps \w, \b and \d identical to JavaScript's.
_HTML_BODY_RE = re.compile(r"(?:<!doctype\b|<html\b|<head\b|<body\b)", re.ASCII)
_URL_BODY_RE = re.compile(r"https?://\S+", re.ASCII)
_PLACEHOLDER_BODY_RES = tuple(re.compile(pattern, re.ASCII) for pattern in (
    r"(?:(?:solicitation|short|full|bulletin|bid|project)\s+)?(?:description|desc|summary|scope of work|statement of work)[:\s]*",
    r"(?:solicitation|presolicitation|combined synopsis\s*/\s*solicitation|sources sought|special notice|award notice|sale of surplus property|ifb|rfp|rfq|itb|rfi)[.:\s]*",
    r"(?:n/a|none|null|not (?:available|provided)|no description(?: available)?|description (?:not available|pending)|tbd|待补|暂无(?:正文|描述))\.?",
))
_RESTRICTED_BODY_RES = tuple(re.compile(pattern, re.ASCII) for pattern in (
    r"(?:please\s+)?(?:log\s*in|sign\s*in)(?:(?:\s+(?:to|with|on|at)\s+(?:the\s+)?[\w.]+(?:\s+[\w.]+){0,3})?\s+(?:or\s+register\s+)?to\s+(?:view|see|access|download)\b|\s+required\b|\s*[.!]?$)",
    r"you (?:must|need to) (?:log\s*in|sign\s*in)\b",
    r"(?:please\s+)?(?:register|create an account)(?:(?:\s+(?:with|on|at)\s+(?:the\s+)?[\w.]+(?:\s+[\w.]+){0,3})?\s+(?:or\s+(?:log\s*in|sign\s*in)\s+)?to\s+(?:view|see|access|download)\b|\s*[.!]?$)",
    r"(?:access denied|forbidden|unauthorized|error (?:403|404|500)|page not found)(?:\s*[.!:\-–—]|$)",
    r"(?:checking your browser\b|just a moment(?:\s*(?:\.\.\.|…|[.!])|$)|enable javascript(?:\s+(?:to|and)\b|\s*[.!]?$)|verify (?:you are|that you are) human\b)",
))
_METADATA_BODY_RE = re.compile(r"(?:purchase method|type code|bid type|informal bid flag|allow electronic quote)\s*(?::|：|$)", re.ASCII)
_NAVIGATION_PART_RE = re.compile(r"(?:home|about(?: us)?|contact(?: us)?|privacy(?: policy)?|terms(?: of (?:use|service))?|copyright.*|all rights reserved|login|sign in|register)", re.ASCII)
_ADDRESS_BODY_RE = re.compile(r"\d+[a-z]?\s+(?:[\w.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\.?(?:\s*,?\s*(?:suite|ste|unit|room|rm|floor|fl)\.?\s*#?[\w-]+)?\s*,\s*[a-z][a-z .'-]*,?\s+[a-z]{2}\s+\d{5}(?:-\d{4})?\.?", re.ASCII)


def body_issue(value, title):
    """Why a description is not procurement content, or None when it is."""
    identity = echo_key(value)
    if not identity:
        return "missing_body"
    if identity == echo_key(title):
        return "title_echo"
    text = comparable_text(value)
    if _HTML_BODY_RE.match(text):
        return "restricted_or_error_body"
    if _URL_BODY_RE.fullmatch(text):
        return "body_url"
    if any(pattern.fullmatch(text) for pattern in _PLACEHOLDER_BODY_RES):
        return "placeholder_body"
    if any(pattern.match(text) for pattern in _RESTRICTED_BODY_RES):
        return "restricted_or_error_body"
    if _METADATA_BODY_RE.match(text):
        return "metadata_body"
    # An empty list counts as navigation, exactly like JavaScript's [].every(...).
    parts = [part for part in (comparable_text(piece) for piece in re.split(r"\s*[|\n·]\s*", value.strip())) if part]
    if all(_NAVIGATION_PART_RE.fullmatch(part) for part in parts):
        return "navigation_body"
    if _ADDRESS_BODY_RE.fullmatch(text):
        return "address_body"
    return None
```

- [ ] **Step 6: Make `valid_body_text` delegate**

In `crawler/apsi_crawler/detail_backfill.py`, replace the imports:

```python
import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from apsi_crawler.content_quality import comparable_text, same_text, useful_text
```

with:

```python
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from apsi_crawler.content_quality import body_issue, same_text
```

Replace the whole `valid_body_text` function (its docstring and all its regex checks) with:

```python
def valid_body_text(value, title):
    """Match the shared display quality gate; short procurement scope is valid."""
    return body_issue(value, title) is None
```

Then run `grep -n "re\.\|comparable_text\|useful_text" crawler/apsi_crawler/detail_backfill.py`. Expected: no output. If anything else in the file still uses one of these names, keep that import.

- [ ] **Step 7: Run the contract and the existing classifier tests**

Run:
- `cd $WT/crawler && $PY -m pytest tests/test_description_quality_contract.py tests/test_detail_backfill.py tests/test_data_quality.py -q && $PY -m pytest -q`
- `cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run src/lib src/server/crawler/persistence-merge.test.ts src/server/crawler/data-quality.test.ts`

Expected:
- Python: 45 contract cases pass, the existing tests pass, and the full suite passes.
- TS: all pass.

Python 3.9 compatibility: `python3 -c "import sys; sys.path.insert(0, '$WT/crawler'); import apsi_crawler.content_quality, apsi_crawler.detail_backfill"` prints nothing.

- [ ] **Step 8: Commit**

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence/.claude/worktrees/data-usability-p0
git add frontend/src/lib/bid-description.ts frontend/src/lib/bid-description.contract.test.ts crawler/apsi_crawler/content_quality.py crawler/apsi_crawler/detail_backfill.py crawler/tests/fixtures/description_quality_contract.json crawler/tests/test_description_quality_contract.py
git commit -m "fix(quality): one description classifier for TS and Python, recognizing only whole access notices and address-only text"
```

---

### Task 6: CI wiring, docs, gates and hand-off

**Files:**
- Modify: `frontend/package.json` (`test:crawler-integration`)
- Modify: `docs/operations/detail-backfill.md` (append a section)
- Modify: `docs/qa/crawler-data-usability-fixes-2026-10-01.md` (append a section)

- [ ] **Step 1: Run the two real-MySQL files in CI's integration suite**

In `frontend/package.json`, replace:

```json
    "test:crawler-integration": "RUN_CRAWLER_INTEGRATION=1 vitest run src/server/crawler/enrichment-pipeline.integration.test.ts src/server/crawler/bidnet-lifecycle.integration.test.ts",
```

with:

```json
    "test:crawler-integration": "RUN_CRAWLER_INTEGRATION=1 vitest run src/server/crawler/enrichment-pipeline.integration.test.ts src/server/crawler/bidnet-lifecycle.integration.test.ts src/server/db/local-issuer-type-backfill.mysql.integration.test.ts src/server/crawler/detail-history.mysql.integration.test.ts",
```

- [ ] **Step 2: Append to `docs/operations/detail-backfill.md`**

```markdown

## 历史读取上限（2026-10-12 P0 修复）

- 列表运行只读本源最近一次出现（`MAX(last_seen_at)`）之前 30 天内出现过的记录，按最近出现排序，最多 5,000 行；达到上限时记 `crawler_detail_history_truncated` 事件。以本源最近一次出现为基准而不是当前时间，所以 worker 停机后恢复时窗口不会变空。
- 补采运行只读"没有可用正文且已到重试时间"的记录：正文为空、正文就是标题，或是裸 SAM 描述链接。按上次尝试时间（没有则用首次出现时间）从旧到新排序，最多取本次的尝试预算：`max_details_per_run` 经平台预算收紧后的值；SAM 为 `--max-descriptions`，默认 25。每页 200 行，最多读 10 页，跳过身份已不符合登记的行，所以这些行挡不住后面的有效候选。
- SQLite 用主键区间 `[<source_id>:, <source_id>;)`；MySQL 用转义后的前缀 `LIKE`，两者都走主键。MySQL 默认的 `utf8mb4_0900_ai_ci` 排序把 `;` 排在 `:` 之前，所以不能用区间写法。
- 候选全部还在冷却期的源，本轮直接跳过，不再为了记录 `deferred` 而运行。
- Python 端按同一预算再截断一次输出，一次补采的 stdout 不会超过预算条数。
```

- [ ] **Step 3: Append to `docs/qa/crawler-data-usability-fixes-2026-10-01.md`**

```markdown

## P0 修复（2026-10-12）

2026-10-09 代码审查发现 5 个上线阻塞问题，修复见 `fix/data-usability-p0`，计划见 `docs/superpowers/plans/2026-10-12-data-usability-p0-fixes.md`：

1. 旧的县、市、镇招标存成 `issuer_type = 'state'`，被新门禁隐藏（本地 7,230 条中 1,355 条）。迁移按已登记地方源的级别回填，两种数据库各一条幂等语句。**部署顺序：先跑 `npm run db:mysql:migrate`，再让新代码接流量**，否则回填之前这些招标不可见。
2. 补采复用历史时不再带上上一轮的 `applied_fields`，详情抓取失败不会再抹掉已验证的正文。
3. SAM.gov 运行只记录附件链接，归档交给附件修复 worker。
4. 详情历史读取有上限：列表运行读最近 30 天、最多 5,000 行；补采只读本轮预算内的到期候选。
5. 正文判定规则在 TypeScript 和 Python 两边统一，共享契约是 `crawler/tests/fixtures/description_quality_contract.json`（45 例）。访问提示和报错只有整句出现才算，只有整段是地址才算地址。

回填后仍不可见、留待后续处理的有 37 条：22 条 `ny_contract_reporter` 发布方为"Unknown state agency"；11 条已关闭的 `bidnet_co_city_aurora` 仍带旧 FIPS `0803455`（审查 P1-8）；另有 4 条演示数据。
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sakya/workspace/AI-powered-Procurement-Intelligence/.claude/worktrees/data-usability-p0
git add frontend/package.json docs/operations/detail-backfill.md docs/qa/crawler-data-usability-fixes-2026-10-01.md
git commit -m "docs: P0 fix notes; run the real-MySQL P0 checks in the crawler integration suite"
```

- [ ] **Step 5: Run every gate (controller)**

```bash
REPO=/Users/sakya/workspace/AI-powered-Procurement-Intelligence; WT=$REPO/.claude/worktrees/data-usability-p0; PY=$REPO/services/scrapling-extractor/.venv/bin/python
cd $WT/frontend && PATH=/usr/local/bin:$PATH npm run lint
cd $WT/frontend && PATH=/usr/local/bin:$PATH npx vitest run 2>&1 | tail -4
cd $WT/crawler && $PY -m pytest -q 2>&1 | tail -2
cd $WT/frontend && PATH=/usr/local/bin:$PATH npx tsc --noEmit -p . 2>&1 | grep -oE '^[^(]+\(' | sort -u | comm -13 $WT/.superpowers/sdd/2026-10-12-data-usability-p0-fixes/tsc-baseline.txt -
```

Expected:
- lint: clean.
- Vitest: all pass, with 2 skipped files more than baseline (the two new `*.mysql.integration.test.ts`).
- Crawler: all pass.
- The `comm` line prints nothing, i.e. no file has tsc errors that it did not have at BASE.

Then run `cd $WT/frontend && PATH=/usr/local/bin:$PATH npm run build`. If it fails for a reason unrelated to this branch, such as the symlinked `node_modules`, record the error in the ledger and rely on the tsc comparison above.

Then run the full opt-in integration suite on a throwaway MySQL. Use the Shared commands block, but replace its `npx vitest run <files>` with:

```bash
CRAWLER_INTEGRATION_PYTHON=$PY npm run test:crawler-integration
```

Keep `CRAWLER_INTEGRATION_MYSQL_URL=…` and `PATH=…` in front of it. Expected: all files pass, including the two new ones.

- [ ] **Step 6: Final whole-branch review**

Dispatch the final code reviewer on the most capable model over `BASE..HEAD` of `fix/data-usability-p0`. Point it at:
- this plan's "Decisions taken in this plan";
- the Global Constraints;
- the ledger's deferred minors.

- [ ] **Step 7 (optional; ask the user first): Preview P0-1 on local `winbids`, read-only**

```bash
PW=$(docker exec winbids-mysql printenv MYSQL_ROOT_PASSWORD)
docker exec -e MYSQL_PWD="$PW" winbids-mysql mysql -uroot winbids -e "SELECT data_sources.jurisdiction_level AS level, COUNT(*) AS bids FROM bids JOIN data_sources ON data_sources.id = SUBSTRING_INDEX(bids.id, ':', 1) WHERE bids.issuer_type = 'state' AND LOCATE(':', bids.id) > 1 AND data_sources.jurisdiction_level IN ('county', 'city', 'township', 'special_district') AND UPPER(data_sources.state_code) = UPPER(bids.state_code) AND (bids.jurisdiction_level IS NULL OR bids.jurisdiction_level = '' OR bids.jurisdiction_level = data_sources.jurisdiction_level) GROUP BY data_sources.jurisdiction_level"
```

Expected, from the 2026-10-09 export: city 703, county 555, township 71. This is a `SELECT` only. Never run `db:mysql:migrate` against `winbids` as part of this plan; the data fix reaches `winbids` only when the merged work is deployed.

- [ ] **Step 8: Hand off**

Report to the user:
- the branch `fix/data-usability-p0` and its commits;
- the gate results;
- any finding parked in the ledger.

Do not merge into `codex/data-usability-20261001`, rebase onto `main`, or push without the user's instruction.

---

## Not in this plan

- **Review P1 items 6–12 and all P2 items.** These include:
  - existing intents disappearing when a bid is not analysable;
  - backfill error isolation in the worker;
  - registry corrections (the 11 Aurora rows);
  - title-only rows counting as usable;
  - `manual-crawl.ts` cancel and throttle;
  - the `data_sources` read on every single-bid request;
  - saved "state" alerts that no longer match local bids.

  Items 6 and 12 need a product decision first.
- **The other 26 rows still hidden after Task 1:** 22 NY Contract Reporter rows and 4 seed/demo rows; the 11 Aurora rows are counted under P1-8 above.
- **Rebasing onto local `main`** (9 commits ahead; the merge was checked clean on 2026-10-09).
- **The Phase-1 items still open on `main`:**
  - a `sol-table`/template guard for verified-empty pages;
  - a platform-wide delisting circuit breaker;
  - `incomplete_reasons`;
  - a budgeted manual batch route.
- **SAM attachment links without the API key:** whether they download at all. Check one real link before relying on the repair worker for SAM attachments.
- **The size of a SAM list run's own stdout,** which carries every bid in the 30-day window. This plan does not change it.
