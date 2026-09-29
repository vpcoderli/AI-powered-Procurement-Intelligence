# Admin console follow-ups — implementation plan

Date: 2026-09-30. Follows the admin console redesign (`2026-09-29-admin-console-redesign.md`, merged into local `main` at 3d10e75). Every item here is a limitation that redesign's final review and acceptance walkthrough parked on purpose; none changes a phase-3 governance rule, approval write, the precheck queue or the crawler gate.

**Branch:** `feat/admin-console-followups` from local `main` (3d10e75). Merge back locally only (no push).

## Global constraints

- Both dialects for any server change (SQLite/Drizzle and MySQL/hand-written SQL); a new table index goes inside the FIRST `sqlite.exec(\`…\`)` block of `frontend/src/server/db/migrate.ts` so the derived MySQL DDL picks it up.
- UI: every visible string through `t()` with keys in both `frontend/src/lib/i18n/dictionaries/en.ts` and `zh.ts` (zh ≠ en), appended at the end of the `admin` object; `t()` does not interpolate. Effects follow `react-hooks/set-state-in-effect` (`queueMicrotask`). No new libraries.
- Tests: Vitest node env; pure helpers, source-text assertions, or `renderToStaticMarkup` with a real `LanguageProvider` and typed hook stubs. Never source `frontend/.env.local`.
- Gates (from `frontend/`): the task's tests; `npm run lint` (0 errors); `npx tsc -p tsconfig.json --noEmit --incremental false 2>&1 | grep 'error TS' | grep -E -v '\.test\.(ts|tsx)\('` prints nothing and the total stays at the 281 pre-existing test-file errors; `npm run build` for UI changes.
- Commits: explicit pathspecs; never stage `.DS_Store`, `ops-evidence/`, `frontend/data/`, `data/`; **no `Co-Authored-By` trailer**.

## Task A — MySQL pool survives hot reload; crawler-log time index (server)

Files: `frontend/src/server/db/mysql.ts`, `frontend/src/server/db/mysql.test.ts`, `frontend/src/server/db/migrate.ts`, and whichever existing test pins the derived MySQL DDL or the SQLite index list.

1. `resolveMysqlPool()` caches the pool on `globalThis` (e.g. `globalThis.__apsiMysqlPool`) instead of only a module variable, so Next dev hot reloads reuse one pool; `resetMysqlPoolForTests()` and `closeResolvedMysqlPool()` clear the global too. Keep the `databaseUrl` parameter semantics. In `createMysqlPool`, set mysql2's `maxIdle` and `idleTimeout` explicitly (e.g. `maxIdle` = min(4, connectionLimit), `idleTimeout` 60 000 ms; overridable by `MYSQL_MAX_IDLE` / `MYSQL_IDLE_TIMEOUT_MS`) so idle connections are released. Test: after `vi.resetModules()` and a re-import, `resolveMysqlPool()` returns the same instance; `closeResolvedMysqlPool()` clears it. (2026-09-29: a long-lived dev server held 147 of 151 connections.)
2. Add `CREATE INDEX IF NOT EXISTS idx_crawler_logs_started ON crawler_logs(started_at, id);` next to the existing crawler_logs indexes inside the first `sqlite.exec` block, so the overview's run counts and the unfiltered runs log (`ORDER BY started_at DESC, id DESC` with the `(before, beforeId)` cursor) stop scanning the whole table. Update any test that pins the index list or the derived MySQL DDL. The controller applies it to the local MySQL (`npm run db:mysql:migrate`) and checks `EXPLAIN`.

## Task B — source detail: approval dialog only for admins; refresh after a precheck (UI)

Files: `frontend/src/components/admin/SourcePrecheckPanel.tsx` (+ its test), `frontend/src/components/admin/sources/SourceDetailView.tsx` (+ its tests).

1. `SourcePrecheckPanel` gains an optional `canApprove?: boolean` (default `true`, so any other mount keeps today's behaviour). When false, it does not render `ApproveLocalSourceDialog` (whose PATCH is admin-only and answers 403 to operators). `SourceDetailView` passes `canApprove={isAdmin}`.
2. `SourcePrecheckPanel` gains an optional `onPrecheckCompleted?: () => void`, called once after a precheck request succeeds (the server has written the precheck result into the row's live-health columns). `SourceDetailView` passes a handler that re-reads the detail (so the readiness box, header badges and live-health card show the new precheck without a manual reload); it must not remount the precheck panel or wipe its fresh result.
3. Tests: panel source-text or render test for both props (dialog hidden when `canApprove` is false; callback fired only on success); detail-view assertion of the wiring.

## Task C — source list selection on Back/Forward; Bid QA unparseable date input (UI)

Files: `frontend/src/components/admin/sources/SourcesListView.tsx` (+ tests), `frontend/src/components/admin/sections/BidQaSection.tsx` (+ test), `frontend/src/components/admin/admin-format.ts` (+ test) if a helper is needed.

1. The list clears its selection whenever the canonical query changes, including browser Back/Forward (today only `navigate()` clears it, so rows selected before Back stay checked and the bulk bar acts on them). Pure helper or effect-free approach preferred (e.g. key the selection state on the canonical query string); no setState-in-effect violation.
2. Bid QA corrections: a non-empty date input value that `endOfDayIsoFromDateInput` cannot turn into a date (e.g. a 5-/6-digit year typed in desktop Chrome) must not be sent as `null` (which clears the deadline). Treat it as invalid: `bidQaCorrectionsFor` returns no correction for it and "Save corrections" stays disabled for that row (reuse the existing disabled path; add a short visible hint only if it needs no more than one new key, appended at the end of `admin` in both dictionaries). Tests for the helper: invalid non-empty date → not sent / not savable; empty → clears as today; valid → sent.

## Task D — admin copy in the dictionary; scanner covers admin components; small cleanups (i18n)

Files: `frontend/src/components/admin/sections/ConfigRegistrySection.tsx`, `frontend/src/components/admin/sections/RiskCheckSection.tsx` (state matrix and any other hard-coded English UI chrome in these two sections), `frontend/src/lib/i18n/dictionaries/en.ts`, `zh.ts`, `frontend/scripts/i18n-coverage-scan.ts` (+ its test if any), and the sections' tests.

1. Move the hard-coded English UI chrome of the config registry and the state-portal quality/risk sections (titles such as "Config Registry"/"Config Matrix", button labels, column headers, empty/validation messages written in the component) into `admin.*` keys with real zh translations. Data coming from the API (config entry titles, descriptions, JSON) stays as stored.
2. Extend `npm run i18n:check` to scan `src/components/admin/**` as well as `src/app/**` for hard-coded JSX strings, and report the admin-components findings (expected: none left after item 1, apart from genuine false positives you document).
3. Cleanups: delete the orphaned `admin.runSamGov` key (verify no static or dynamic use under `frontend/src`); align the batch-run panel's zh level labels with the rest of the console (`batchRunLevel_county` → "县", `batchRunLevel_township` → "镇/乡", matching `coverageLevel_*`).

## Controller steps

1. Run A, B, C, D in parallel on disjoint files (worktrees), review each, cherry-pick onto the branch (dictionary tails from C and D may conflict: keep both).
2. Final review of the whole branch; one fix wave; full gates (full `npm run test`, lint, type gate, build, `i18n:check`); apply Task A's index to the local MySQL (`npm run db:mysql:migrate`, then `EXPLAIN` of the overview's crawl-run count and the unfiltered runs page); restart the dev server and walk the affected pages.
3. Fast-forward local `main`; no push.
