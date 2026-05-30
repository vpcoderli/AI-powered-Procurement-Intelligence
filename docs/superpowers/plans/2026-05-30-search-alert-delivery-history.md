# Search Alert Delivery History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Search Alerts trustworthy by showing recent digest delivery history, including sent, failed, duplicate, and preference-skipped outcomes.

**Architecture:** Add a lightweight `search_alert_digest_runs` table that records one digest outcome per matched alert notification attempt. The notification service writes the run record while queueing/sending/skipping notifications, and the Search Alerts service hydrates recent runs into the existing alert list response for Settings.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle SQLite, Vitest, existing notification outbox, existing Settings Search Alerts UI.

---

### Task 1: Digest Run Persistence

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`
- Create: `frontend/src/server/search-alerts/digest-history.ts`
- Test: `frontend/src/server/search-alerts/digest-history.test.ts`

- [x] Write failing tests that insert digest run records and list recent runs by alert/user scope.
- [x] Add `search_alert_digest_runs` schema, migration DDL, and indexes.
- [x] Implement `recordSearchAlertDigestRun` and `listSearchAlertDigestRunsForUser`.

### Task 2: Notification Service Writes History

**Files:**
- Modify: `frontend/src/server/notifications/service.ts`
- Modify: `frontend/src/server/notifications/service.test.ts`
- Modify: `frontend/src/server/search-alerts/types.ts`

- [x] Write failing tests for sent, failed, no-email skip, notification preference skip, and duplicate digest history.
- [x] Record digest status, match count, notification id, safe skip reason, and matched bid ids.
- [x] Keep existing outbox and `lastNotifiedAt` behavior unchanged.

### Task 3: API And Client Hydration

**Files:**
- Modify: `frontend/src/server/search-alerts/service.ts`
- Modify: `frontend/src/server/search-alerts/service.test.ts`
- Modify: `frontend/src/app/api/search-alerts/route.test.ts`
- Modify: `frontend/src/lib/api/search-alerts.test.ts`

- [x] Write failing tests that `listSearchAlerts` includes recent digest history.
- [x] Hydrate up to three recent digest runs per alert.
- [x] Preserve existing API shape with additive `digestHistory`.

### Task 4: Settings UI And Docs

**Files:**
- Modify: `frontend/src/app/settings/page.tsx`
- Modify: `frontend/src/app/settings/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] Write failing static UI test for delivery history labels and render paths.
- [x] Show latest digest status, match count, sent/failed/skipped reason, and empty history state for each alert.
- [x] Mark this phase complete and move the next recommended phase to Product 2 amendment/addenda refresh or crawler source quality monitoring.
