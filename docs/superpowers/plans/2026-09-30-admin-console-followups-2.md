# Admin console follow-ups (batch 2) — implementation plan

Date: 2026-09-30. Closes the items the first follow-up batch (`2026-09-30-admin-console-followups.md`, merged into local `main` at 80468c6) left open. No change to phase-3 governance rules, approval writes, the precheck queue or the crawler gate; optional props on the phase-3 panels (the same kind as `canApprove` / `onPrecheckCompleted`) are allowed.

**Branch:** `feat/admin-console-followups-2` from local `main` (80468c6). Merge back locally only (no push).

## Global constraints

- Both dialects for any server change. UI: every visible string through `t()` with keys in both `frontend/src/lib/i18n/dictionaries/en.ts` and `zh.ts` (zh ≠ en), new keys appended at the end of the `admin` object; `t()` does not interpolate; the console's zh status vocabulary is 已启用 / 已停用 (states) vs 启用 / 停用 (actions). Effects follow `react-hooks/set-state-in-effect`. No new libraries.
- Tests: Vitest node env; pure helpers, source-text assertions, or `renderToStaticMarkup` with a real `LanguageProvider` and typed hook stubs. Never source `frontend/.env.local`; never connect to the live MySQL (`winbids-mysql`, 3306).
- Gates (from `frontend/`): the task's tests; `npm run lint` 0; the non-test type gate prints nothing and the total stays at 281; `npm run i18n:check` exit 0 with (a) 8, (b) 0 under `src/components/admin`, (c) 0.
- Commits: explicit pathspecs; never stage `.DS_Store`, `ops-evidence/`, `frontend/data/`, `data/`; **no `Co-Authored-By` trailer**.

## Task E — the source detail's busy lock covers panel-owned writes

Files: `frontend/src/components/admin/SourcePrecheckPanel.tsx`, `frontend/src/components/admin/ApproveLocalSourceDialog.tsx`, `frontend/src/components/admin/CrawlerConfigPanel.tsx` (+ their tests), `frontend/src/components/admin/sources/SourceDetailView.tsx` (+ tests).

Today the detail page disables every action while one of its own header/card actions (`pending`) is in flight, but a write started inside a reused panel — running a precheck, adopting the suggested base URL, submitting the ledgered approval dialog, saving the crawler config — is not tracked, so the header's Run / Enable-Disable / Hold / Approve and the live-health card stay clickable meanwhile. Add an optional `onBusyChange?: (busy: boolean) => void` to each of the three components (the dialog's is forwarded by the precheck panel), called with `true` when such a write starts and `false` when it settles (success or failure; exactly once each way; never from render). The detail view keeps a count or set of busy panels and treats "any panel busy" like `pending !== null` for every control it owns. Behaviour of other mounts is unchanged (the prop is optional). Tests: pure/behaviour tests that each write reports busy then idle (also on failure), and the detail wiring.

## Task F — users: override panel feature switch; consistent zh status words

Files: `frontend/src/components/admin/sections/UsersSection.tsx` (+ test), `frontend/src/components/admin/sources/SourcesListView.tsx` (+ tests) only for the column header, dictionaries.

1. `openFeatureOverrides` refills the form after the load with the feature captured when the panel opened, and the feature select is not disabled while loading, so switching features mid-load refills the form with the old feature's reason/expiry while Enable saves the new feature. Fix: disable the feature select while the overrides load, and refill with the feature that is selected when the load completes.
2. `admin.enabled` ("启用") and `admin.disabled` ("已禁用") are used as status values (user status cell, the users' status filter options) and as column headers (users table, source list). Use the console's status vocabulary: status values 已启用 / 已停用; column headers a noun such as "启用状态" (en keeps "Enabled" if it reads right). Split keys where one key is used both as a header and as a value; keep English sensible. Check every use under `frontend/src` (static and dynamic) and every test pinning the old strings.

## Task H — translate server-written text in the state-quality and risk sections

Files: `frontend/src/components/admin/sections/RiskCheckSection.tsx` (+ tests), dictionaries. Read-only references: `frontend/src/server/risk/checklist.ts` (each `check(id, label, ok, summary, details)`), `frontend/src/server/source-validity/state-data-quality.ts` (`recommendedActionForReason(code)` over the 17 `StateDataQualityReasonCode`s, `ownerHintForReason(code)`, and the three attachment-specific action strings near L456/481/504).

The server returns English for risk-check labels, state-quality recommended actions and owner hints, so the zh console shows English there. Translate them client-side by their stable codes — risk-check label by check `id`, recommended action by `reasonCode`, owner hint by its slug — with keys like `admin.riskCheckLabel_<id>`, `admin.stateQualityAction_<reasonCode>`, `admin.stateQualityOwner_<slug>`, falling back to the server text for any id/code the dictionary does not know (future checks). Summaries, details and evidence (which carry counts and ids) stay as stored. A test must fail if a server check id or reason code has no dictionary entry (read the ids/codes from the server modules or their exported types, so a new server check is noticed).

## Task I — mysql2 graceful close; production pool sizing note

Files: `frontend/src/server/db/mysql.ts` (+ `mysql.test.ts`), `docs/transferability/environment-variables.md`, `docs/operations/aws-deployment-runbook.md`.

1. Evaluate `gracefulEnd: true` on the pool (mysql2 3.22.4) against a THROWAWAY MySQL 8 container only (`docker run -d --rm -e MYSQL_ROOT_PASSWORD=$(openssl rand -hex 16) -p 127.0.0.1::3306 mysql:8`, wait for TCP `SELECT 1`, read the port with `docker port`, `docker stop` afterwards; never `winbids-mysql`): with a small pool (limit 3, maxIdle 1, idleTimeout 2 s), open 3 connections, release them, wait for the reaper, and compare `SHOW GLOBAL STATUS LIKE 'Aborted_clients'` with and without the option; also confirm normal queries and `pool.end()` behave. If it removes the aborted-client churn and nothing else changes, enable it in `createMysqlPool` with a unit test on the options; otherwise leave it off and record why in the env doc.
2. Add a production sizing note to the AWS runbook next to the RDS / task-count settings: every process holds one pool of `MYSQL_CONNECTION_LIMIT` (default 10); size so that (web tasks + worker tasks) × limit + migration/one-shot headroom stays well below the RDS instance's `max_connections`, with the arithmetic for the runbook's own task counts.

## Controller steps

1. Run E, F, H, I in parallel on disjoint files (F and H both append dictionary keys at the `admin` tail: keep both at merge), review each, cherry-pick onto the branch.
2. Final review; one fix wave; full gates (`npm run test`, lint, type gate, `npm run build`, `i18n:check`); restart the dev server and walk the users, risk/quality and source-detail pages.
3. Fast-forward local `main`; no push.
