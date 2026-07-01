# Production Signoff And Workflow Depth Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the remaining P0-P3 work without blocking local feature delivery on external production credentials.

**Architecture:** Split the remaining work into four tracks: external production signoff, live source operations, local workflow depth, and docs/verification handoff. External signoff tasks are prepared and verified with dry-run scripts until credentials/environment are available; local workflow depth continues independently through TDD-backed slices. Every completed slice updates `winbids-implementation-status.md` so the next session can continue from the backlog.

**Tech Stack:** Next.js App Router, Vitest, TypeScript, SQLite/MySQL runtime paths, Stripe test-mode verifier, `source:health:check`, `risk:check`, production readiness scripts, local object-storage helpers, response workspace APIs, and Browser smoke checks.

---

## Current Baseline

- P0 Standards Alignment Lite is complete locally.
- MySQL default-runtime cutover is complete locally and smoke-verified.
- Admin versus ordinary-user route/API separation is complete locally.
- Free / Pursuit Starter / Response Builder / Enterprise gates are implemented locally.
- Anonymous personal workspace cleanup is complete locally.
- 50-state deterministic data, detail, and attachment checks pass locally.
- Response Workspace Lite, Artifact Vault Lite, Quote Workspace Lite, Deadline Notifications Lite, and Response Package Markdown export are complete locally.
- Response Package / Artifact Storage Integrity Lite is complete locally: new writes use safe local object-storage paths and downloads verify byte size plus SHA-256.

## Parallel Track Schedule

| Track | Priority | Owner Agent | Dependency | Exit Gate |
|---|---:|---|---|---|
| Track A: Stripe / Production Signoff | P0 | Agent A | Real Stripe test keys, current Stripe CLI webhook secret, production-like secret/backup variables | Stripe sandbox checkout -> webhook -> portal -> cancel passes against MySQL; `ops:production:check` passes with live-shaped values. |
| Track B: Live Source Health Operations | P1 | Agent B | Production-like network access for source probe | Persisted `source:health:check --inspect-body` report exists; 404/410 registry fixes are separated from 403/timeout/access-review notes. |
| Track C: Response Package / Artifact Workflow Depth | P2 | Agent C | No external dependency | Export review states, artifact version/delete audit events, and first richer export format slice pass tests. |
| Track D: Docs / Operations Handoff | P3 | Agent D | Runs after each track milestone | Implementation status, next plan, runbooks, risk list, and transferability docs reflect the current system. |

## Execution Rules

1. Do not wait on Stripe or production secrets before continuing Track C local feature work.
2. Do not mark Track A complete without real test-mode Stripe keys and a current `whsec_REDACTED_CURRENT_CLI_SECRET` value from `stripe listen`.
3. Treat live portal `403`, timeout, CAPTCHA, login, and bot-check pages as operations risks, not local deterministic data failures.
4. Run `npm run risk:check` after any source, auth, billing, artifact, or response package slice.
5. Update `docs/product-requirements/winbids-implementation-status.md` after every completed track milestone.

## Track A: Stripe / Production Signoff

**Purpose:** Convert already-built billing and worker foundations into repeatable production-readiness evidence.

**Files:**
- Read: `frontend/scripts/stripe-sandbox-verifier.ts`
- Read: `frontend/src/server/billing/stripe-sandbox-verifier.ts`
- Read: `docs/operations/stripe-sandbox-e2e.md`
- Read: `docs/operations/production-billing-worker-runbook.md`
- Read: `docs/transferability/secrets-and-access.md`
- Modify after execution: `docs/product-requirements/winbids-implementation-status.md`

- [ ] **Step A1: Verify Stripe sandbox inputs are present**

Run:

```bash
cd frontend
env | grep -E '^(BILLING_PROVIDER|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PRICE_PRO_MONTHLY|STRIPE_PRICE_BUSINESS_MONTHLY)='
```

Expected:

```text
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_REDACTED_TEST_KEY
STRIPE_WEBHOOK_SECRET=whsec_REDACTED_CURRENT_CLI_SECRET
STRIPE_PRICE_PRO_MONTHLY=price_REDACTED_PRO_MONTHLY
STRIPE_PRICE_BUSINESS_MONTHLY=price_REDACTED_BUSINESS_MONTHLY
```

Do not paste secret values into docs or chat output.

- [ ] **Step A2: Start local app and Stripe CLI forwarder**

Run in one terminal:

```bash
cd frontend
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Run in another terminal:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Expected: Stripe CLI prints a current `whsec_REDACTED_CURRENT_CLI_SECRET` shaped value; set that value in the shell running the verifier.

- [ ] **Step A3: Run Pro sandbox verifier**

Run:

```bash
cd frontend
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids \
npm run billing:stripe:sandbox -- --tier=pro --origin=http://localhost:3000 --timeout-ms=300000
```

Expected: verifier prints a Checkout URL, operator completes payment with a Stripe test card, webhook updates local subscription, user/org tier becomes Pro/Pursuit Starter, portal URL is generated, and cancel cleanup succeeds.

- [ ] **Step A4: Run Business sandbox verifier**

Run:

```bash
cd frontend
DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids \
npm run billing:stripe:sandbox -- --tier=business --origin=http://localhost:3000 --timeout-ms=300000
```

Expected: same as A3, but user/org tier becomes Business/Response Builder.

- [ ] **Step A5: Run production-readiness preflight with live-shaped values**

Run:

```bash
cd frontend
NODE_ENV=production \
BILLING_PROVIDER=stripe \
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids \
STRIPE_SECRET_KEY=sk_live_REDACTED_SHAPE_ONLY \
STRIPE_WEBHOOK_SECRET=whsec_REDACTED_SHAPE_ONLY \
STRIPE_PRICE_PRO_MONTHLY=price_REDACTED \
STRIPE_PRICE_BUSINESS_MONTHLY=price_REDACTED \
PRODUCTION_OWNER_BILLING=owner@example.com \
PRODUCTION_OWNER_WORKERS=owner@example.com \
PRODUCTION_OWNER_BACKUPS=owner@example.com \
PRODUCTION_BACKUP_RUNBOOK_URL=https://internal.example.com/runbooks/winbids-backup \
npm run ops:production:check
```

Expected: command passes and output redacts secret values. Replace the sample values with real production-like environment values during execution.

- [ ] **Step A6: Update signoff docs**

Modify `docs/product-requirements/winbids-implementation-status.md`:

```markdown
## Completed Phase: Stripe Sandbox / Production Signoff

本阶段完成：
- Stripe Pro sandbox E2E passed against MySQL.
- Stripe Business sandbox E2E passed against MySQL.
- Production readiness preflight passed with production-like owner/backup variables.

验证：
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run billing:stripe:sandbox -- --tier=pro`
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run billing:stripe:sandbox -- --tier=business`
- `NODE_ENV=production BILLING_PROVIDER=stripe DATABASE_URL=mysql://***:***@***:3306/winbids npm run ops:production:check`

最新还剩：
1. Low-risk live checkout/webhook validation in production.
2. Backup restore drill.
3. Worker production dry-run evidence.
```

## Track B: Live Source Health Operations

**Purpose:** Keep 50-state data real and operationally observable while separating deterministic local data quality from external portal availability.

**Files:**
- Read/modify: `docs/operations/source-health-check.md`
- Read/modify: `docs/product-requirements/winbids-implementation-status.md`
- Read/modify if registry fix is needed: `frontend/src/lib/state-crawler-sources.ts`
- Read/modify if crawler registry fix is needed: `crawler/apsi_crawler/sources/state_sources.py`

- [ ] **Step B1: Run live body-inspection probe**

Run:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body
```

Expected: command exits successfully in report-only mode and records healthy/unhealthy/skipped portal states.

- [ ] **Step B2: Classify live failures**

For each unhealthy source, classify into exactly one bucket:

```text
registry_fix_required: 404 or 410
access_review_required: 403, CAPTCHA, login, bot-check, access challenge
network_retry_required: timeout, fetch failed, DNS/TLS
source_ok: 200 with meaningful body
```

Write the summary into `docs/operations/source-health-check.md` under the latest run section.

- [ ] **Step B3: Fix registry-only URL errors**

If a source is `registry_fix_required`, update both registries:

```bash
frontend/src/lib/state-crawler-sources.ts
crawler/apsi_crawler/sources/state_sources.py
```

Then run:

```bash
cd frontend
npm test -- src/lib/state-crawler-sources.test.ts src/server/risk/checklist.test.ts
cd ..
PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py
```

Expected: registry metadata and risk tests pass.

- [ ] **Step B4: Run deterministic local 50-state gate**

Run:

```bash
cd frontend
npm run risk:check
```

Expected:

```text
PASS state-coverage: 50/50 required states
PASS state-content
PASS bid-detail-routes
PASS attachment-downloads
PASS state-url-validity
```

## Track C: Response Package / Artifact Workflow Depth

**Purpose:** Turn local Markdown package export into a stronger supplier response workflow without waiting for external systems.

**Files:**
- Modify: `frontend/src/server/response-workspace/types.ts`
- Modify: `frontend/src/server/response-workspace/repository.ts`
- Modify: `frontend/src/server/response-workspace/service.ts`
- Modify: `frontend/src/server/response-workspace/service.test.ts`
- Modify: `frontend/src/app/api/intents/[id]/response-workspace/package/exports/route.ts`
- Modify: `frontend/src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts`
- Modify: `frontend/src/app/api/intents/[id]/response-workspace/package/route.ts`
- Modify: `frontend/src/components/intents/ResponseWorkspacePanel.tsx`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/server/artifacts/service.ts`
- Modify: `frontend/src/server/artifacts/service.test.ts`
- Modify: `docs/product-requirements/winbids-implementation-status.md`

### Task C1: Export Review State

- [x] **Step C1.1: Write failing service test**

Add to `frontend/src/server/response-workspace/service.test.ts`:

```ts
it("marks response package exports as pending review before approval", async () => {
  const testDb = await createTestDatabase({ seed: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-export-review-"));

  try {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
      title: "Review package",
    });

    const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
      snapshotId: snapshotResult.snapshot.id,
    }, { storageRoot: directory });

    expect(result.exportRecord.reviewStatus).toBe("pending_review");
    expect(result.exportRecord.reviewedAt).toBeNull();
    expect(result.exportRecord.reviewedByUserId).toBeNull();
  } finally {
    await testDb.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
```

- [x] **Step C1.2: Run RED**

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts -t "pending review"
```

Expected: fail because `reviewStatus` fields do not exist yet.

- [x] **Step C1.3: Implement export review fields**

Add nullable fields to the response package export type and repository hydration:

```ts
reviewStatus: "pending_review" | "approved" | "needs_changes";
reviewedAt: string | null;
reviewedByUserId: string | null;
reviewNotes: string;
```

Store default values from `createResponsePackageExport()`:

```ts
reviewStatus: "pending_review",
reviewedAt: null,
reviewedByUserId: null,
reviewNotes: "",
```

- [x] **Step C1.4: Run GREEN**

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts
```

Expected: response workspace service tests pass.

### Task C2: Artifact Version / Delete Audit Events

- [x] **Step C2.1: Write failing artifact test**

Add to `frontend/src/server/artifacts/service.test.ts`:

```ts
it("soft deletes supplier artifacts and excludes them from the active vault", async () => {
  const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
  const file = new File(["signed w9 content"], "w9.pdf", { type: "application/pdf" });
  const created = await createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
    title: "Signed W-9",
    artifactType: "w9",
    purpose: "compliance_evidence",
    file,
  }, { storageRoot, now: new Date("2026-06-01T00:00:00.000Z") });

  await deleteSupplierArtifact(testDb.db, "anon_seed", intent.id, created.artifacts[0].id, {
    now: new Date("2026-06-02T00:00:00.000Z"),
  });

  const vault = await getArtifactVault(testDb.db, "anon_seed", intent.id);
  expect(vault.artifacts).toHaveLength(0);
});
```

- [x] **Step C2.2: Run RED**

Run:

```bash
cd frontend
npm test -- src/server/artifacts/service.test.ts -t "soft deletes"
```

Expected: fail because `deleteSupplierArtifact` does not exist.

- [x] **Step C2.3: Implement soft-delete columns and repository filters**

Add artifact row fields:

```ts
deletedAt: string | null;
deletedByUserId: string | null;
```

Update list/find queries to exclude deleted artifacts by default.

- [x] **Step C2.4: Implement service function**

Add:

```ts
export async function deleteSupplierArtifact(
  database: AppDatabase,
  userId: string,
  intentId: string,
  artifactId: string,
  options: ArtifactServiceOptions = {},
) {
  const intent = await getUserIntent(database, userId, intentId);
  if (!intent) throw new IntentNotFoundError();
  const timestamp = nowIso(options);
  // update SQLite/MySQL row deleted_at and deleted_by_user_id
}
```

- [x] **Step C2.5: Run GREEN**

Run:

```bash
cd frontend
npm test -- src/server/artifacts/service.test.ts
```

Expected: artifact service tests pass.

- [x] **Step C2.6: Connect DELETE route, UI action, and linked-artifact filters**

Delivered:

- `DELETE /api/intents/[id]/artifacts/[artifactId]` soft deletes supplier artifacts and returns the refreshed vault.
- Intent Artifact Vault UI shows a delete action with bilingual copy and deletion-in-progress state.
- Response Workspace and Quote Workspace exclude soft-deleted artifacts from linked artifact display and reject deleted artifact reuse.
- `artifact.deleted` audit events are written with intent, bid, file, type, and purpose metadata.

### Task C3: First Richer Export Format Slice

- [ ] **Step C3.1: Write failing test for ZIP export request validation**

Add to `frontend/src/server/response-workspace/service.test.ts`:

```ts
it("rejects unsupported response package export formats with a validation error", async () => {
  const testDb = await createTestDatabase({ seed: true });

  try {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
      title: "Format package",
    });

    await expect(createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
      snapshotId: snapshotResult.snapshot.id,
      format: "pptx" as never,
    })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
  } finally {
    await testDb.cleanup();
  }
});
```

- [ ] **Step C3.2: Run RED**

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts -t "unsupported response package export formats"
```

Expected: fail because export format is not modeled yet.

- [ ] **Step C3.3: Add format model**

Add:

```ts
export const RESPONSE_PACKAGE_EXPORT_FORMATS = ["markdown", "zip"] as const;
export type ResponsePackageExportFormat = (typeof RESPONSE_PACKAGE_EXPORT_FORMATS)[number];
```

Default format:

```ts
const format = input.format ?? "markdown";
```

Reject values outside the list with `ResponseWorkspaceValidationError("Unsupported response package export format.")`.

- [ ] **Step C3.4: Keep ZIP as gated placeholder until implementation**

If `format === "zip"`, return:

```ts
throw new ResponseWorkspaceValidationError("ZIP response package export is not available yet.");
```

This makes the API explicit without pretending ZIP is production-ready.

- [ ] **Step C3.5: Run GREEN**

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts
```

Expected: tests pass and Markdown default behavior remains unchanged.

## Track D: Docs / Operations Handoff

**Purpose:** Keep the project navigable as phases complete.

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`
- Modify: `docs/product-requirements/winbids-current-gap-analysis.md`
- Modify if needed: `frontend/README.md`
- Modify if needed: `docs/operations/source-health-check.md`
- Modify if needed: `docs/operations/production-billing-worker-runbook.md`

- [x] **Step D1: Update implementation status after Track C milestones complete**

Append:

```markdown
## Completed Phase: Response Package Export Review State

本阶段完成：
- Response package exports now include review status, reviewer, reviewed timestamp, and review notes.
- New exports default to pending review.
- Export review metadata is returned in snapshot export lists.

验证：
- `npm test -- src/server/response-workspace/service.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run risk:check`
- `git diff --check`

最新还剩（下一阶段优先级）：
1. First richer export format slice.
2. ZIP/PDF/DOCX response package format depth.
3. Malware scanning and production object-storage adapter.
```

- [x] **Step D2: Update next-development-plan priority**

Ensure `docs/product-requirements/winbids-next-development-plan.md` states the current next codeable task and separately lists external blockers.

- [x] **Step D3: Run docs and repo checks**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
npm audit --omit=dev --audit-level=high
cd ..
git diff --check
```

Expected: all commands pass before reporting completion.

## Recommended Immediate Next Slice

Start **Track C / Task C3: First Richer Export Format Slice** next because C2 artifact soft delete and delete audit events are complete locally, while Track A still waits on real Stripe and production-like credentials.
