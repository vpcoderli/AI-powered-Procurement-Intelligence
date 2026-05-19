# APSi Operations Notifications State Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local operations foundation for scheduled crawler runs, notification outbox delivery, fixture-backed state sources, and an admin/operator workspace.

**Architecture:** Keep crawler data import in Python, operational orchestration in TypeScript, and shared state in SQLite. Manual API routes and worker scripts call the same orchestrator so locking, matching, notifications, and results stay consistent. Admin UI reads source health and writes source enablement through server-side APIs with conservative authorization.

**Tech Stack:** Python 3, pytest, Next.js App Router, TypeScript, Drizzle ORM, better-sqlite3, SQLite, Vitest, lucide-react.

---

## File Structure

### Shared Database

- Modify `frontend/src/server/db/schema.ts`: add `crawlerLocks` and `notificationOutbox` Drizzle tables.
- Modify `frontend/src/server/db/migrate.ts`: create `crawler_locks` and `notification_outbox` tables and indexes.
- Modify `frontend/src/server/db/schema.test.ts`: assert new tables can be created and constrained.

### Scheduler and Worker Foundation

- Create `frontend/src/server/crawler/lock-repository.ts`: acquire/release per-source locks with stale lock replacement.
- Create `frontend/src/server/crawler/lock-repository.test.ts`: lock behavior tests.
- Create `frontend/src/server/crawler/orchestrator.ts`: shared single-run orchestration.
- Create `frontend/src/server/crawler/orchestrator.test.ts`: success/failure/locked orchestration tests.
- Modify `frontend/src/app/api/crawler/sam-gov/run/route.ts`: route calls orchestrator instead of directly calling runner and matcher.
- Modify `frontend/src/app/api/crawler/sam-gov/run/route.test.ts`: update route expectations.
- Create `frontend/scripts/run-crawler-once.ts`: local one-shot runner.
- Create `frontend/scripts/crawler-worker.ts`: local loop runner.
- Modify `frontend/package.json`: add `crawler:once` and `worker:crawler` scripts.

### Notifications

- Create `frontend/src/server/notifications/types.ts`: provider and outbox types.
- Create `frontend/src/server/notifications/outbox-repository.ts`: enqueue/update/list notification outbox rows.
- Create `frontend/src/server/notifications/outbox-repository.test.ts`: dedupe/status tests.
- Create `frontend/src/server/notifications/renderer.ts`: alert digest subject/body rendering.
- Create `frontend/src/server/notifications/renderer.test.ts`: render tests.
- Create `frontend/src/server/notifications/providers/file.ts`: local file provider.
- Create `frontend/src/server/notifications/providers/console.ts`: console provider.
- Create `frontend/src/server/notifications/provider.ts`: env-driven provider factory.
- Create `frontend/src/server/notifications/service.ts`: match result to outbox/send pipeline.
- Create `frontend/src/server/notifications/service.test.ts`: skip/dedupe/send tests.
- Modify `frontend/src/server/search-alerts/matcher.ts`: include matched alert details and bid ids while preserving existing counts.
- Modify `frontend/src/server/search-alerts/matcher.test.ts`: cover details.

### State Sources

- Create `crawler/apsi_crawler/sources/base.py`: source metadata helpers.
- Create `crawler/apsi_crawler/sources/state_sources.py`: CA/TX/NY/FL/IL metadata.
- Modify `crawler/apsi_crawler/sources/registry.py`: register SAM.gov and state fixture loaders.
- Create `crawler/apsi_crawler/normalizers/state_bids.py`: state bid normalization.
- Create `crawler/apsi_crawler/spiders/state_fixture.py`: load generic state opportunity fixtures.
- Modify `crawler/apsi_crawler/cli.py`: allow `import-fixture --source <state-source-id>` to import registered state fixtures.
- Create `crawler/tests/fixtures/ca_caleprocure_opportunities.json`.
- Create `crawler/tests/fixtures/tx_esbd_opportunities.json`.
- Create `crawler/tests/fixtures/ny_contract_reporter_opportunities.json`.
- Create `crawler/tests/fixtures/fl_mfmp_opportunities.json`.
- Create `crawler/tests/fixtures/il_bidbuy_opportunities.json`.
- Create `crawler/tests/test_state_sources.py`.
- Create `crawler/tests/test_state_normalizers.py`.
- Create `crawler/tests/test_state_fixture_import.py`.

### Admin and Operator UI

- Create `frontend/src/server/admin/auth.ts`: `requireAdmin` helper with local bypass.
- Create `frontend/src/server/admin/data-sources-repository.ts`: data source summary, update enablement, recent logs.
- Create `frontend/src/server/admin/data-sources-repository.test.ts`.
- Create `frontend/src/app/api/admin/data-sources/route.ts`.
- Create `frontend/src/app/api/admin/data-sources/route.test.ts`.
- Create `frontend/src/app/api/admin/data-sources/[id]/route.ts`.
- Create `frontend/src/app/api/admin/data-sources/[id]/route.test.ts`.
- Create `frontend/src/app/api/admin/crawler-logs/route.ts`.
- Create `frontend/src/app/api/admin/crawler-logs/route.test.ts`.
- Create `frontend/src/app/admin/page.tsx`.
- Create `frontend/src/lib/api/admin.ts`.
- Create `frontend/src/lib/api/admin.test.ts`.
- Modify `frontend/src/components/layout/app-sidebar.tsx`: add Admin link.
- Modify `frontend/src/lib/i18n/dictionaries/en.ts`: add admin dictionary keys.
- Modify `frontend/src/lib/i18n/dictionaries/zh.ts`: add matching Chinese dictionary keys.

## Task 1: Shared Database Schema

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests asserting:

```ts
expect(() =>
  testDb.db.insert(crawlerLocks).values({
    source: "SAM.gov",
    owner: "worker_1",
    acquiredAt: "2026-05-19T00:00:00.000Z",
    expiresAt: "2026-05-19T00:10:00.000Z",
  }).run(),
).not.toThrow();

expect(() =>
  testDb.db.insert(notificationOutbox).values({
    id: "notification_1",
    alertId: "alert_1",
    userId: "user_1",
    channel: "email",
    recipient: "buyer@example.com",
    frequency: "daily",
    dedupeKey: "alert_1:2026-05-19:email",
    subject: "APSi daily bid matches",
    bodyText: "1 matching bid",
    matchedBidIds: JSON.stringify(["bid_1"]),
    status: "pending",
    attemptCount: 0,
    createdAt: "2026-05-19T00:00:00.000Z",
  }).run(),
).not.toThrow();
```

- [ ] **Step 2: Run red test**

Run: `cd frontend && npm test -- src/server/db/schema.test.ts`

Expected: FAIL because `crawlerLocks` and `notificationOutbox` are not exported.

- [ ] **Step 3: Implement schema and migrations**

Add `crawlerLocks` and `notificationOutbox` to `schema.ts`; add matching SQL in `runMigrations`. Use `source` as the `crawler_locks` primary key and a unique index on `notification_outbox.dedupe_key`.

- [ ] **Step 4: Run green test**

Run: `cd frontend && npm test -- src/server/db/schema.test.ts`

Expected: PASS.

## Task 2: Crawler Lock Repository and Orchestrator

**Files:**
- Create: `frontend/src/server/crawler/lock-repository.ts`
- Create: `frontend/src/server/crawler/lock-repository.test.ts`
- Create: `frontend/src/server/crawler/orchestrator.ts`
- Create: `frontend/src/server/crawler/orchestrator.test.ts`
- Modify: `frontend/src/app/api/crawler/sam-gov/run/route.ts`
- Modify: `frontend/src/app/api/crawler/sam-gov/run/route.test.ts`
- Create: `frontend/scripts/run-crawler-once.ts`
- Create: `frontend/scripts/crawler-worker.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write failing lock tests**

Cover:

```ts
const first = acquireCrawlerLock(testDb.db, {
  source: "SAM.gov",
  owner: "owner_1",
  acquiredAt: "2026-05-19T00:00:00.000Z",
  expiresAt: "2026-05-19T00:10:00.000Z",
});
const second = acquireCrawlerLock(testDb.db, {
  source: "SAM.gov",
  owner: "owner_2",
  acquiredAt: "2026-05-19T00:01:00.000Z",
  expiresAt: "2026-05-19T00:11:00.000Z",
});
expect(first.acquired).toBe(true);
expect(second.acquired).toBe(false);
```

- [ ] **Step 2: Run red lock tests**

Run: `cd frontend && npm test -- src/server/crawler/lock-repository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement lock repository**

Implement `acquireCrawlerLock(db, input)` and `releaseCrawlerLock(db, input)`. Acquire succeeds when no row exists or `expiresAt <= acquiredAt`. Release deletes only when owner matches.

- [ ] **Step 4: Write failing orchestrator tests**

Cover:

```ts
const result = await runCrawlerSourceOnce(testDb.db, {
  source: "SAM.gov",
  owner: "test_owner",
  runner: async () => ({ ok: true, source: "SAM.gov", status: "success", stdout: "done", stderr: "" }),
  matcher: async () => ({ evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }),
  notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
});
expect(result.status).toBe("success");
```

- [ ] **Step 5: Implement orchestrator and update manual route**

`runCrawlerSourceOnce` acquires lock, runs runner, runs matcher and notifier on success, releases lock in `finally`, and returns `locked` when lock is held. Update `POST /api/crawler/sam-gov/run` to call this orchestrator.

- [ ] **Step 6: Add scripts**

Add `frontend/scripts/run-crawler-once.ts`, `frontend/scripts/crawler-worker.ts`, and package scripts:

```json
"crawler:once": "tsx scripts/run-crawler-once.ts",
"worker:crawler": "tsx scripts/crawler-worker.ts"
```

- [ ] **Step 7: Run green tests**

Run: `cd frontend && npm test -- src/server/crawler/lock-repository.test.ts src/server/crawler/orchestrator.test.ts src/app/api/crawler/sam-gov/run/route.test.ts`

Expected: PASS.

## Task 3: Notification Outbox and Local Providers

**Files:**
- Create: `frontend/src/server/notifications/types.ts`
- Create: `frontend/src/server/notifications/outbox-repository.ts`
- Create: `frontend/src/server/notifications/outbox-repository.test.ts`
- Create: `frontend/src/server/notifications/renderer.ts`
- Create: `frontend/src/server/notifications/renderer.test.ts`
- Create: `frontend/src/server/notifications/providers/file.ts`
- Create: `frontend/src/server/notifications/providers/console.ts`
- Create: `frontend/src/server/notifications/provider.ts`
- Create: `frontend/src/server/notifications/service.ts`
- Create: `frontend/src/server/notifications/service.test.ts`
- Modify: `frontend/src/server/search-alerts/matcher.ts`
- Modify: `frontend/src/server/search-alerts/matcher.test.ts`

- [ ] **Step 1: Write failing outbox repository tests**

Cover insert dedupe:

```ts
const first = enqueueNotification(testDb.db, input);
const second = enqueueNotification(testDb.db, input);
expect(first.created).toBe(true);
expect(second.created).toBe(false);
```

- [ ] **Step 2: Run red outbox tests**

Run: `cd frontend && npm test -- src/server/notifications/outbox-repository.test.ts`

Expected: FAIL because the notification module does not exist.

- [ ] **Step 3: Implement outbox repository**

Implement `enqueueNotification`, `markNotificationSent`, and `markNotificationFailed` using `notificationOutbox`.

- [ ] **Step 4: Write renderer and provider tests**

Renderer should produce subject/body with alert name and bid links. File provider should write a stable JSON file to a supplied output directory.

- [ ] **Step 5: Implement renderer and providers**

Add `createNotificationProvider()` that chooses `file` by default, `console` when `NOTIFICATION_PROVIDER=console`, and a custom outbox path via `NOTIFICATION_OUTBOX_DIR`.

- [ ] **Step 6: Extend matcher details**

Preserve existing counts and add `matches: Array<{ alertId; userId; frequency; notificationChannel; bidIds; bids; query }>` so notifications can render actual bids.

- [ ] **Step 7: Implement notification service**

`sendMatchedAlertNotifications(db, matchResult, provider)` skips users without email, enqueues deduped notifications, sends created rows, updates outbox status, and updates `alerts.lastNotifiedAt` after successful sends.

- [ ] **Step 8: Run green notification tests**

Run: `cd frontend && npm test -- src/server/notifications src/server/search-alerts/matcher.test.ts`

Expected: PASS.

## Task 4: State Source Registry and Fixture Imports

**Files:**
- Create: `crawler/apsi_crawler/sources/base.py`
- Create: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/apsi_crawler/sources/registry.py`
- Create: `crawler/apsi_crawler/normalizers/state_bids.py`
- Create: `crawler/apsi_crawler/spiders/state_fixture.py`
- Modify: `crawler/apsi_crawler/cli.py`
- Create fixtures and tests listed in the File Structure section.

- [ ] **Step 1: Write failing source registry tests**

Assert `get_source("ca_caleprocure")` returns label `Cal eProcure`, issuer type `state`, and state code `CA`.

- [ ] **Step 2: Run red registry test**

Run: `cd crawler && python3 -m pytest tests/test_state_sources.py -v`

Expected: FAIL because state sources do not exist.

- [ ] **Step 3: Implement source metadata and registry**

Register `sam_gov`, `ca_caleprocure`, `tx_esbd`, `ny_contract_reporter`, `fl_mfmp`, and `il_bidbuy`. Preserve compatibility for `DEFAULT_SOURCE = "SAM.gov"`.

- [ ] **Step 4: Write failing normalizer and import tests**

Each fixture should import one bid and assert:

```python
assert bid["issuer_type"] == "state"
assert bid["state_code"] == "CA"
assert bid["dedupe_key"] == "ca_caleprocure:ca-001"
```

- [ ] **Step 5: Implement state fixture loader and normalizer**

Load generic fixture records with fields like `id`, `title`, `description`, `agency`, `postedDate`, `deadlineDate`, `sourceUrl`, `attachments`, and source metadata.

- [ ] **Step 6: Update CLI import path**

Allow:

```bash
python3 -m apsi_crawler.cli import-fixture --database /tmp/apsi.sqlite --source ca_caleprocure --fixture tests/fixtures/ca_caleprocure_opportunities.json
```

- [ ] **Step 7: Run green crawler tests**

Run: `cd crawler && python3 -m pytest`

Expected: PASS.

## Task 5: Admin Authorization, APIs, and UI

**Files:**
- Create: `frontend/src/server/admin/auth.ts`
- Create: `frontend/src/server/admin/data-sources-repository.ts`
- Create: `frontend/src/server/admin/data-sources-repository.test.ts`
- Create: `frontend/src/app/api/admin/data-sources/route.ts`
- Create: `frontend/src/app/api/admin/data-sources/route.test.ts`
- Create: `frontend/src/app/api/admin/data-sources/[id]/route.ts`
- Create: `frontend/src/app/api/admin/data-sources/[id]/route.test.ts`
- Create: `frontend/src/app/api/admin/crawler-logs/route.ts`
- Create: `frontend/src/app/api/admin/crawler-logs/route.test.ts`
- Create: `frontend/src/app/admin/page.tsx`
- Create: `frontend/src/lib/api/admin.ts`
- Create: `frontend/src/lib/api/admin.test.ts`
- Modify: `frontend/src/components/layout/app-sidebar.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Write failing admin repository/API tests**

Cover:

```ts
expect(await listAdminDataSources(testDb.db)).toEqual(
  expect.objectContaining({ summary: expect.objectContaining({ totalSources: expect.any(Number) }) }),
);
```

and API denial for missing admin/bypass.

- [ ] **Step 2: Run red admin tests**

Run: `cd frontend && npm test -- src/server/admin src/app/api/admin src/lib/api/admin.test.ts`

Expected: FAIL because admin modules do not exist.

- [ ] **Step 3: Implement admin auth and repositories**

`requireAdmin(db, request)` allows `ADMIN_UI_LOCAL_BYPASS=true` in non-production or authenticated `users.role === "admin"`. Repository lists sources, merges latest logs, updates `isEnabled`, and lists recent crawler logs without returning stacks by default.

- [ ] **Step 4: Implement admin APIs**

Add:

- `GET /api/admin/data-sources`
- `PATCH /api/admin/data-sources/[id]`
- `GET /api/admin/crawler-logs`

- [ ] **Step 5: Implement admin client and page**

Add `/admin` with summary cards, data source table, run action, enable switches, recent logs, loading/error states, and English/Chinese dictionary keys.

- [ ] **Step 6: Run green admin tests**

Run: `cd frontend && npm test -- src/server/admin src/app/api/admin src/lib/api/admin.test.ts`

Expected: PASS.

## Task 6: Integration Verification and Commit

- [ ] **Step 1: Run crawler tests**

Run: `cd crawler && python3 -m pytest`

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run: `cd frontend && npm test`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `cd frontend && npm run lint`

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `cd frontend && npm run build`

Expected: PASS.

- [ ] **Step 5: Browser smoke test**

Run: `cd frontend && npm run dev`, open `/admin`, verify English/Chinese text, table layout, and “Run now” loading/success behavior.

- [ ] **Step 6: Clean runtime artifacts**

Remove `.pytest_cache`, `frontend/data/apsi.sqlite*`, and generated notification outbox files unless they are intentional fixtures.

- [ ] **Step 7: Commit**

```bash
git add crawler frontend docs/superpowers/plans/2026-05-19-apsi-operations-notifications-state-admin.md
git commit -m "feat: add operations notifications state admin foundation"
```

## Parallel Agent Ownership

- Worker Agent 1 owns Task 1 and Task 2: frontend DB schema, locks, orchestrator, scripts, and SAM.gov route migration.
- Worker Agent 2 owns Task 3: notifications and matcher details.
- Worker Agent 3 owns Task 4: crawler state source registry, normalizers, fixtures, and Python tests.
- Worker Agent 4 owns Task 5: admin auth, APIs, UI, i18n, and admin tests.

Agents are not alone in the codebase. They must not revert edits made by others and must adapt to shared files carefully. Shared files that need coordination are `frontend/src/server/db/schema.ts`, `frontend/src/server/db/migrate.ts`, `frontend/src/server/search-alerts/matcher.ts`, `frontend/package.json`, and dictionary files.

## Self-Review

- Spec coverage: scheduler/worker, notification outbox, state source foundation, admin UI/API, authorization, and verification are covered.
- Placeholder scan: no placeholder task depends on undefined future work.
- Type consistency: orchestrator, matcher, notification, source, and admin names are stable across tasks.
