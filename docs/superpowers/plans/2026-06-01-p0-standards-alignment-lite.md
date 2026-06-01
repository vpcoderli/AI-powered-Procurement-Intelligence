# P0 Standards Alignment Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align WinBids with the refreshed Drive Phase II P0 standards before adding more workflow modules.

**Architecture:** Add the smallest durable foundations for transferability docs, configuration, audit/events, universal UX states, and source ingestion governance. Keep the work additive: do not replace existing feature gates, crawler registry, billing, notification, or admin flows; wrap and extend them with shared primitives.

**Tech Stack:** Next.js App Router, TypeScript, SQLite/Drizzle-style schema files under `frontend/src/server/db`, Vitest, existing admin/auth/session helpers, existing risk-check command, Markdown docs under `docs/`.

---

## File Structure

### Documentation

- Create: `docs/transferability/README.md`
- Create: `docs/transferability/setup-guide.md`
- Create: `docs/transferability/environment-variables.md`
- Create: `docs/transferability/deployment-guide.md`
- Create: `docs/transferability/data-model-and-migrations.md`
- Create: `docs/transferability/runbook.md`
- Create: `docs/transferability/known-limitations.md`
- Create: `docs/transferability/aws-service-map.md`
- Create: `docs/transferability/secrets-and-access.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-current-gap-analysis.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

### Config Registry

- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Create: `frontend/src/server/config/registry.ts`
- Create: `frontend/src/server/config/registry.test.ts`
- Create: `frontend/src/app/api/admin/config/route.ts`
- Create: `frontend/src/app/api/admin/config/[id]/route.ts`

### Audit/Event Foundation

- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Create: `frontend/src/server/events/event-log.ts`
- Create: `frontend/src/server/events/event-log.test.ts`
- Create: `frontend/src/server/http/request-context.ts`
- Create: `frontend/src/server/http/request-context.test.ts`

### Universal UX States

- Create: `frontend/src/components/universal-state.tsx`
- Create: `frontend/src/components/universal-state.test.tsx`
- Create: `frontend/src/lib/universal-state.ts`
- Modify: `frontend/src/app/admin/page.tsx`

Note: this slice first wired `UniversalState` into `/admin`; the follow-up P0 deepening pass now also covers `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` primary states.

### Source Governance

- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/lib/state-crawler-sources.ts`
- Modify: `frontend/src/server/risk/checklist.ts`
- Modify: `frontend/src/server/admin/data-sources-repository.ts`
- Modify: `frontend/src/app/admin/page.tsx`

---

## Task 1: Transferability Pack Skeleton

**Files:**
- Create: `docs/transferability/README.md`
- Create: `docs/transferability/setup-guide.md`
- Create: `docs/transferability/environment-variables.md`
- Create: `docs/transferability/deployment-guide.md`
- Create: `docs/transferability/data-model-and-migrations.md`
- Create: `docs/transferability/runbook.md`
- Create: `docs/transferability/known-limitations.md`
- Create: `docs/transferability/aws-service-map.md`
- Create: `docs/transferability/secrets-and-access.md`

- [ ] **Step 1: Create the transferability directory and docs**

Use the content structure already named in `docs/product-requirements/winbids-next-development-plan.md`. Each file must include concrete local commands or ownership notes and must not contain real secrets.

- [ ] **Step 2: Verify the docs mention local and future production boundaries**

Run:

```bash
rg -n "local|production|secret|environment|deploy|rollback|backup|restore" docs/transferability
```

Expected: each required operational topic appears in at least one transferability document.

- [ ] **Step 3: Commit the documentation skeleton**

```bash
git add docs/transferability docs/product-requirements/winbids-next-development-plan.md
git commit -m "docs: add transferability pack skeleton"
```

## Task 2: Config Registry Foundation

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Create: `frontend/src/server/config/registry.ts`
- Create: `frontend/src/server/config/registry.test.ts`
- Create: `frontend/src/app/api/admin/config/route.ts`
- Create: `frontend/src/app/api/admin/config/[id]/route.ts`

- [ ] **Step 1: Write failing registry tests**

Cover these behaviors in `frontend/src/server/config/registry.test.ts`:

- seeded defaults can be listed by module and key;
- active config wins over expired config;
- org-scoped config overrides global config;
- invalid module/key updates are rejected;
- update requests require a change reason.

Run:

```bash
cd frontend
npm test -- src/server/config/registry.test.ts
```

Expected: FAIL because the registry does not exist yet.

- [ ] **Step 2: Add schema and migration**

Add a `config_registry` table with:

- `id`
- `scope_type`
- `scope_id`
- `module`
- `config_key`
- `config_value_json`
- `schema_version`
- `status`
- `effective_from`
- `effective_to`
- `created_by`
- `updated_by`
- `change_reason`
- `audit_event_id`
- `created_at`
- `updated_at`

- [ ] **Step 3: Implement registry helpers**

Create helpers in `frontend/src/server/config/registry.ts`:

- `listConfigEntries`
- `getEffectiveConfigValue`
- `upsertConfigEntry`
- `seedDefaultConfigEntries`

- [ ] **Step 4: Add admin APIs**

Add admin-only endpoints:

- `GET /api/admin/config`
- `POST /api/admin/config`
- `PATCH /api/admin/config/[id]`

Use existing admin/session helpers and return structured error codes for validation failures.

- [ ] **Step 5: Verify config registry**

Run:

```bash
cd frontend
npm test -- src/server/config/registry.test.ts
npm run db:migrate
```

Expected: PASS and migration completes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/server/db frontend/src/server/config frontend/src/app/api/admin/config
git commit -m "feat: add config registry foundation"
```

## Task 3: Audit/Event Foundation

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Create: `frontend/src/server/events/event-log.ts`
- Create: `frontend/src/server/events/event-log.test.ts`
- Create: `frontend/src/server/http/request-context.ts`
- Create: `frontend/src/server/http/request-context.test.ts`

- [ ] **Step 1: Write failing event tests**

Cover:

- event payload includes event id, name, timestamp, environment, actor, target, source, outcome, severity, request id, correlation id, and safe metadata;
- metadata sanitizer removes secrets, tokens, passwords, and raw stack traces;
- duplicate idempotency key does not create duplicate event rows;
- request context creates stable request/correlation ids.

Run:

```bash
cd frontend
npm test -- src/server/events/event-log.test.ts src/server/http/request-context.test.ts
```

Expected: FAIL because the event foundation does not exist.

- [ ] **Step 2: Add schema and migration**

Add:

- `event_log`
- `event_outbox`

Keep activity/integration/usage/AI-output events as typed categories in the first slice instead of separate tables unless the implementation needs separate tables immediately.

- [ ] **Step 3: Implement event writer**

Create:

- `writeEvent`
- `writeAuditEvent`
- `sanitizeEventMetadata`
- `createRequestContext`

- [ ] **Step 4: Wire first high-risk events**

Add event writes for:

- admin config changes;
- permission denied on admin config routes;
- source approval status changes if Task 5 is implemented in the same branch;
- plan limit reached in existing quota gates if the edit stays small.

- [ ] **Step 5: Verify event foundation**

Run:

```bash
cd frontend
npm test -- src/server/events/event-log.test.ts src/server/http/request-context.test.ts
npm run db:migrate
```

Expected: PASS and migration completes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/server/db frontend/src/server/events frontend/src/server/http frontend/src/app/api/admin/config
git commit -m "feat: add event logging foundation"
```

## Task 4: Universal UX State Foundation

**Files:**
- Create: `frontend/src/lib/universal-state.ts`
- Create: `frontend/src/components/universal-state.tsx`
- Create: `frontend/src/components/universal-state.test.tsx`
- Modify: `frontend/src/app/admin/page.tsx`

- [ ] **Step 1: Write failing component tests**

Cover rendering for:

- loading;
- empty;
- error with trace id;
- permission denied;
- AI unavailable;
- low confidence;
- upload failed;
- source unavailable;
- duplicate opportunity;
- expired deadline;
- plan limit.

Run:

```bash
cd frontend
npm test -- src/components/universal-state.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement shared state model and component**

Use a stable `UniversalStateCode` union in `frontend/src/lib/universal-state.ts` and a reusable `UniversalState` component with props for title, message, severity, trace id, metadata, and actions.

- [ ] **Step 3: Apply to the first live page**

Replace obvious auth/error duplicates on:

- `/admin`

Do not redesign the page in this task. `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` remain follow-up rollout targets.

- [ ] **Step 4: Verify UX state tests**

Run:

```bash
cd frontend
npm test -- src/components/universal-state.test.tsx
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/universal-state.ts frontend/src/components/universal-state.tsx frontend/src/components/universal-state.test.tsx frontend/src/app
git commit -m "feat: add universal UX state foundation"
```

## Task 5: Source Ingestion Governance

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/lib/state-crawler-sources.ts`
- Modify: `frontend/src/server/risk/checklist.ts`
- Modify: `frontend/src/server/admin/data-sources-repository.ts`
- Modify: `frontend/src/app/admin/page.tsx`

- [ ] **Step 1: Write failing source governance tests**

Cover:

- source registry entries expose approval status;
- unapproved source is blocked from production-ready status;
- login-required or restricted source is marked `needs_review` or `blocked`;
- risk check fails when an enabled production source lacks approval metadata.

Run:

```bash
cd frontend
npm test -- src/lib/state-crawler-sources.test.ts src/server/admin/data-sources-repository.test.ts src/server/risk/checklist.test.ts
```

Expected: FAIL until source governance metadata is added.

- [ ] **Step 2: Add source approval metadata**

Add fields to data source records or source metadata:

- `approved_for_ingestion`
- `approval_status`
- `access_pattern`
- `legal_review_status`
- `source_owner`
- `approval_notes`
- `last_approval_reviewed_at`

- [ ] **Step 3: Update registry defaults**

Set safe defaults:

- verified public sources: approved when already documented as public and stable;
- beta sources: `needs_review` unless current source notes prove public allowed access;
- login, paid, restricted, browser-check, CAPTCHA, or terms-uncertain sources: blocked or needs-review.

- [ ] **Step 4: Surface governance in Admin and risk checks**

Admin should show approval/source availability state. `npm run risk:check` should fail when enabled sources required for production readiness have missing or blocked approval state.

- [ ] **Step 5: Verify source governance**

Run:

```bash
cd frontend
npm test -- src/lib/state-crawler-sources.test.ts src/server/admin/data-sources-repository.test.ts src/server/risk/checklist.test.ts
npm run risk:check
```

Expected: PASS for documented local-safe source set.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/server/db frontend/src/lib/state-crawler-sources.ts frontend/src/server/admin/data-sources-repository.ts frontend/src/server/risk/checklist.ts frontend/src/app/admin/page.tsx
git commit -m "feat: add source ingestion governance"
```

## Task 6: Status Docs and Full Verification

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-current-gap-analysis.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [ ] **Step 1: Update status docs**

Move completed items from P0 Foundation Standards Alignment into the completed section and update the recommended next phase. If all P0A tasks are complete, next phase should become **Artifact Vault Lite**.

- [ ] **Step 2: Run full verification**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: all commands pass. If `npm audit` reports production high/critical issues, fix or document the exact blocker before completion.

- [ ] **Step 3: Commit final docs**

```bash
git add docs/product-requirements docs/superpowers/plans/2026-06-01-p0-standards-alignment-lite.md
git commit -m "docs: update P0 standards roadmap"
```

## Self-Review Checklist

- Each Drive Phase II standard maps to at least one task.
- No task requires real production secrets.
- Source governance does not bypass login, CAPTCHA, paid, restricted, or legally uncertain sources.
- Config registry is additive and does not remove the existing entitlement map.
- Event logging sanitizes sensitive data before storage.
- Universal UX state work covers reusable components before broad page polish.
- Risk checks remain the handoff gate after crawler, auth, billing, and frontend changes.
