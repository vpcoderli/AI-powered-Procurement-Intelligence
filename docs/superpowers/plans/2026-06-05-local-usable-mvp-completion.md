# Local Usable MVP Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the local usable MVP by turning the current 80% local implementation into a regression-tested MySQL-backed demo baseline with explicit response package formats, stronger submission completion state, auth/tier smoke coverage, and synchronized docs.

**Architecture:** Keep the MVP completion work in narrow, independently testable slices. The existing Next.js App Router APIs remain unchanged where possible; new behavior is added through explicit request fields, persisted metadata columns, service-level validation, and focused UI copy. SQLite and MySQL runtime paths must remain compatible.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Drizzle SQLite schema, MySQL runtime SQL helpers, local object storage, i18n dictionaries, `risk:check`, `source:health:check`, and browser/API smoke checks.

---

## File Structure

- Modify: `frontend/src/server/response-workspace/types.ts`
  - Define `ResponsePackageExportFormat = "markdown" | "zip"`.
  - Add `format` to export input/response types.
- Modify: `frontend/src/server/db/schema.ts`
  - Add `format` to `response_package_exports`.
- Modify: `frontend/src/server/db/migrate.ts`
  - Add SQLite migration/backfill for `response_package_exports.format`.
- Modify: `frontend/scripts/migrate-mysql.ts`
  - Add MySQL migration/backfill for `response_package_exports.format`.
- Modify: `frontend/src/server/response-workspace/repository.ts`
  - Persist and hydrate export format in SQLite/MySQL repository paths.
- Modify: `frontend/src/server/response-workspace/service.ts`
  - Validate export format, keep Markdown as the only working local format, and reject ZIP with a clear validation error.
- Modify: `frontend/src/app/api/intents/[id]/response-workspace/package/exports/route.ts`
  - Parse optional `format`.
- Modify: `frontend/src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts`
  - Cover default Markdown and unsupported ZIP behavior.
- Modify: `frontend/src/lib/api/intents.ts`
  - Send optional export `format`.
- Modify: `frontend/src/components/intents/ResponseWorkspacePanel.tsx`
  - Surface export format metadata and keep ZIP disabled or unavailable.
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
  - Add response package format copy.
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`
  - Add response package format copy.
- Modify: `frontend/src/server/submission/types.ts`
  - Add submission status and transition types.
- Modify: `frontend/src/server/db/schema.ts`
  - Add `status` to `submission_paths`.
- Modify: `frontend/src/server/db/migrate.ts`
  - Add SQLite migration/backfill for `submission_paths.status`.
- Modify: `frontend/scripts/migrate-mysql.ts`
  - Add MySQL migration/backfill for `submission_paths.status`.
- Modify: `frontend/src/server/submission/repository.ts`
  - Persist status in SQLite/MySQL paths and expose confirmation history consistently.
- Modify: `frontend/src/server/submission/service.ts`
  - Enforce valid state transitions and derive recovery state when confirmation is incomplete.
- Modify: `frontend/src/app/api/intents/[id]/submission/route.ts`
  - Accept status updates in PATCH.
- Modify: `frontend/src/app/api/intents/[id]/submission/confirm/route.ts`
  - Return updated submission status with the confirmation response.
- Modify: `frontend/src/app/intents/[id]/page.tsx`
  - Display submission status, latest confirmation, and confirmation history.
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
  - Static coverage for status display and locked state.
- Modify: `frontend/src/app/page.test.ts`
  - Keep public/signed-in/admin dashboard boundary coverage.
- Modify: `frontend/src/server/risk/checklist.test.ts`
  - Add a regression test for active state detail/download checks if missing after implementation.
- Modify: `docs/product-requirements/winbids-local-usable-mvp-plan.md`
  - Mark completion status after each phase.
- Modify: `docs/product-requirements/winbids-implementation-status.md`
  - Record exact completed local MVP phases and verification commands.
- Modify: `docs/product-requirements/winbids-next-development-plan.md`
  - Point the next phase to local MVP completion until it is done.

## Task 1: Response Package Export Format Contract

**Files:**
- Modify: `frontend/src/server/response-workspace/types.ts`
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/scripts/migrate-mysql.ts`
- Modify: `frontend/src/server/response-workspace/repository.ts`
- Modify: `frontend/src/server/response-workspace/service.ts`
- Test: `frontend/src/server/response-workspace/service.test.ts`
- Test: `frontend/src/server/db/schema.test.ts`
- Test: `frontend/src/server/response-workspace/repository.test.ts`

- [ ] **Step 1: Write failing service tests for default Markdown and unsupported ZIP**

Add two tests to `frontend/src/server/response-workspace/service.test.ts` near the existing export tests:

```ts
it("defaults response package exports to markdown format", async () => {
  const testDb = await createTestDatabase({ seed: true });
  const exportRoot = await mkdtemp(path.join(os.tmpdir(), "response-package-format-"));

  try {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
      title: "Default markdown package",
    });

    const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
      snapshotId: snapshot.id,
    }, { exportRoot });

    expect(result.exportRecord.format).toBe("markdown");
    expect(result.exportRecord.fileName).toMatch(/\.md$/);
    expect(result.exportRecord.contentType).toBe("text/markdown; charset=utf-8");
  } finally {
    await rm(exportRoot, { recursive: true, force: true });
    await testDb.cleanup();
  }
});

it("rejects unsupported zip response package exports with a clear validation error", async () => {
  const testDb = await createTestDatabase({ seed: true });

  try {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
      title: "Zip package",
    });

    await expect(createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
      snapshotId: snapshot.id,
      format: "zip",
    })).rejects.toThrow("ZIP response package export is not available in the local MVP.");
  } finally {
    await testDb.cleanup();
  }
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts
```

Expected: FAIL because `format` is not yet typed, persisted, or returned.

- [ ] **Step 3: Add response package format types**

In `frontend/src/server/response-workspace/types.ts`, add:

```ts
export const RESPONSE_PACKAGE_EXPORT_FORMATS = ["markdown", "zip"] as const;
export type ResponsePackageExportFormat = (typeof RESPONSE_PACKAGE_EXPORT_FORMATS)[number];

export function isResponsePackageExportFormat(value: unknown): value is ResponsePackageExportFormat {
  return typeof value === "string" && RESPONSE_PACKAGE_EXPORT_FORMATS.includes(value as ResponsePackageExportFormat);
}
```

Update `ResponsePackageExport` and `CreateResponsePackageExportInput`:

```ts
export interface ResponsePackageExport {
  id: string;
  snapshotId: string;
  intentId: string;
  bidId: string;
  userId: string;
  requestedByUserId: string;
  status: "ready";
  format: ResponsePackageExportFormat;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  readiness: ResponsePackageReadinessSummary;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
  downloadedAt: string | null;
  reviewStatus: "pending_review" | "approved" | "needs_changes";
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNotes: string;
}

export interface CreateResponsePackageExportInput {
  snapshotId: string;
  format?: ResponsePackageExportFormat;
}
```

- [ ] **Step 4: Persist format in SQLite and MySQL migrations**

In `frontend/src/server/db/schema.ts`, add to `responsePackageExports`:

```ts
format: text("format").notNull().default("markdown"),
```

In the `CREATE TABLE IF NOT EXISTS response_package_exports` block in `frontend/src/server/db/migrate.ts`, add:

```sql
format TEXT NOT NULL DEFAULT 'markdown',
```

In the existing `addResponsePackageExportColumn` section, add:

```ts
addResponsePackageExportColumn("format", "TEXT NOT NULL DEFAULT 'markdown'");
```

In `frontend/scripts/migrate-mysql.ts`, add the MySQL equivalent:

```sql
ALTER TABLE response_package_exports
ADD COLUMN format varchar(32) NOT NULL DEFAULT 'markdown';
```

Guard it with the existing column-detection pattern used in that script.

- [ ] **Step 5: Persist and hydrate format in repository paths**

In `frontend/src/server/response-workspace/repository.ts`, add `format` to:

- `ResponsePackageExportRow` input inserts.
- SQLite insert values.
- MySQL `INSERT INTO response_package_exports` column list and values.
- SQLite/MySQL select projections.
- `toResponsePackageExportRow` or equivalent MySQL row mapper.

Use `"markdown"` when an old row has a missing/null format.

- [ ] **Step 6: Validate format in service**

In `frontend/src/server/response-workspace/service.ts`, import `ResponsePackageExportFormat` and add:

```ts
function normalizeResponsePackageExportFormat(value: unknown): ResponsePackageExportFormat {
  if (value === undefined || value === null || value === "") return "markdown";
  if (value === "markdown" || value === "zip") return value;
  throw new ResponseWorkspaceValidationError("Unsupported response package export format.");
}
```

In `createResponsePackageExport`, before rendering Markdown:

```ts
const format = normalizeResponsePackageExportFormat(input.format);

if (format === "zip") {
  throw new ResponseWorkspaceValidationError("ZIP response package export is not available in the local MVP.");
}
```

Set `format` on `exportRow`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts src/server/db/schema.test.ts src/server/response-workspace/repository.test.ts
```

Expected: PASS.

## Task 2: Response Package API and UI Format Display

**Files:**
- Modify: `frontend/src/app/api/intents/[id]/response-workspace/package/exports/route.ts`
- Modify: `frontend/src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts`
- Modify: `frontend/src/lib/api/intents.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`
- Modify: `frontend/src/components/intents/ResponseWorkspacePanel.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Add failing route/client tests**

In `frontend/src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts`, add:

```ts
it("passes an optional markdown export format to the response package service", async () => {
  const request = new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports", {
    method: "POST",
    body: JSON.stringify({ snapshotId: "response_package_snapshot_1", format: "markdown" }),
  });

  await POST(request, { params: Promise.resolve({ id: "intent_1" }) });

  expect(createResponsePackageExport).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(String),
    "intent_1",
    { snapshotId: "response_package_snapshot_1", format: "markdown" },
  );
});

it("rejects invalid response package export formats at the route boundary", async () => {
  const request = new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports", {
    method: "POST",
    body: JSON.stringify({ snapshotId: "response_package_snapshot_1", format: "pdf" }),
  });

  const response = await POST(request, { params: Promise.resolve({ id: "intent_1" }) });

  expect(response.status).toBe(400);
});
```

In `frontend/src/lib/api/intents.test.ts`, extend the export test to expect:

```ts
body: JSON.stringify({ snapshotId: "response_package_snapshot_1", format: "markdown" }),
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd frontend
npm test -- src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts src/lib/api/intents.test.ts
```

Expected: FAIL because the route/client do not yet parse/send `format`.

- [ ] **Step 3: Parse format in the route**

In `parseCreateExport`, return:

```ts
const format = source.format;
if (format !== undefined && format !== "markdown" && format !== "zip") return null;

return {
  snapshotId: source.snapshotId,
  ...(format ? { format } : {}),
};
```

- [ ] **Step 4: Send format from the API client**

In `frontend/src/lib/api/intents.ts`, update the create-export input type and request body so callers can pass:

```ts
{
  snapshotId: input.snapshotId,
  ...(input.format ? { format: input.format } : {}),
}
```

- [ ] **Step 5: Surface format in the panel**

In `frontend/src/components/intents/ResponseWorkspacePanel.tsx`, render a small format badge on each export row:

```tsx
<span className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-black uppercase text-slate-500">
  {t(`intentsPage.responsePackageExportFormats.${exportRecord.format}`)}
</span>
```

Add dictionary entries:

```ts
responsePackageExportFormats: {
  markdown: "Markdown",
  zip: "ZIP",
},
```

For Chinese:

```ts
responsePackageExportFormats: {
  markdown: "Markdown",
  zip: "ZIP",
},
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts src/lib/api/intents.test.ts src/app/intents/[id]/page.test.ts
```

Expected: PASS.

## Task 3: Submission Completion Lite

**Files:**
- Modify: `frontend/src/server/submission/types.ts`
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/scripts/migrate-mysql.ts`
- Modify: `frontend/src/server/submission/repository.ts`
- Modify: `frontend/src/server/submission/service.ts`
- Modify: `frontend/src/app/api/intents/[id]/submission/route.ts`
- Modify: `frontend/src/app/api/intents/[id]/submission/confirm/route.ts`
- Test: `frontend/src/server/submission/generator.test.ts`
- Test: `frontend/src/server/submission/repository.test.ts`
- Test: `frontend/src/app/api/intents/[id]/submission/route.test.ts`
- Test: `frontend/src/app/api/intents/[id]/submission/confirm/route.test.ts`

- [ ] **Step 1: Add failing service and route tests**

Add a service test that expects:

```ts
expect(submission.status).toBe("draft");
```

after `getOrCreateSubmissionGuidance`.

Add a confirmation route test that expects the POST response to include:

```ts
expect(body.submission.status).toBe("submitted");
expect(body.confirmation.confirmationReference).toBe("REF-1");
```

Add a PATCH route test that rejects invalid status:

```ts
body: JSON.stringify({ status: "archived" })
```

Expected response: `400 INVALID_REQUEST`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd frontend
npm test -- src/server/submission/repository.test.ts src/app/api/intents/[id]/submission/route.test.ts src/app/api/intents/[id]/submission/confirm/route.test.ts
```

Expected: FAIL because `status` is not yet part of submission paths/responses.

- [ ] **Step 3: Add status types**

In `frontend/src/server/submission/types.ts`, add:

```ts
export const SUBMISSION_STATUSES = ["draft", "ready", "submitted", "needs_recovery"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === "string" && SUBMISSION_STATUSES.includes(value as SubmissionStatus);
}
```

Add `status: SubmissionStatus` to `SubmissionGuidance`.

Add `status?: SubmissionStatus` to `UpdateSubmissionGuidanceInput`.

Change `SubmissionConfirmationResponse` to:

```ts
export interface SubmissionConfirmationResponse {
  confirmation: SubmissionConfirmation;
  submission: SubmissionGuidance;
}
```

- [ ] **Step 4: Add status persistence**

In `frontend/src/server/db/schema.ts`, add:

```ts
status: text("status").notNull().default("draft"),
```

to `submissionPaths`.

In `frontend/src/server/db/migrate.ts`, add:

```sql
status TEXT NOT NULL DEFAULT 'draft',
```

to the `CREATE TABLE IF NOT EXISTS submission_paths` block and add a guarded backfill:

```ts
const submissionPathColumns = new Set(
  sqlite
    .prepare("PRAGMA table_info(submission_paths)")
    .all()
    .map((row) => (row as { name: string }).name),
);

if (!submissionPathColumns.has("status")) {
  sqlite.exec("ALTER TABLE submission_paths ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'");
}
```

In `frontend/scripts/migrate-mysql.ts`, add the MySQL equivalent with the script's existing column-detection helper:

```sql
ALTER TABLE submission_paths
ADD COLUMN status varchar(32) NOT NULL DEFAULT 'draft';
```

- [ ] **Step 5: Update repository hydration**

In `frontend/src/server/submission/repository.ts`, include `status` in:

- `MysqlSubmissionPathRow`.
- `toSubmissionPathRow`.
- `SELECT` projections.
- SQLite insert/update values.
- MySQL insert/update SQL.

Use `"draft"` as the fallback for missing old rows.

- [ ] **Step 6: Enforce transitions in service**

In `frontend/src/server/submission/service.ts`, add:

```ts
function normalizeSubmissionStatus(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "draft" || value === "ready" || value === "submitted" || value === "needs_recovery") return value;
  throw new Error("Invalid submission status.");
}

function nextStatusAfterConfirmation(input: CreateSubmissionConfirmationInput) {
  return input.confirmationReference?.trim() ? "submitted" : "needs_recovery";
}
```

When creating a path, set status to `"draft"`.

When PATCH includes status, persist it after validation.

When creating a confirmation, update the submission path status to `nextStatusAfterConfirmation(input)` and return both `confirmation` and refreshed `submission`.

- [ ] **Step 7: Parse status in the submission route**

In `frontend/src/app/api/intents/[id]/submission/route.ts`, import `isSubmissionStatus` and extend `parseUpdate`:

```ts
if ("status" in source) {
  if (!isSubmissionStatus(source.status)) return null;
  input.status = source.status;
}
```

In `frontend/src/app/api/intents/[id]/submission/confirm/route.ts`, return:

```ts
return jsonWithPrincipalCookie({ confirmation: result.confirmation, submission: result.submission }, principal, { status: 201 });
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/server/submission/repository.test.ts src/server/submission/generator.test.ts src/app/api/intents/[id]/submission/route.test.ts src/app/api/intents/[id]/submission/confirm/route.test.ts
```

Expected: PASS.

## Task 4: Intent Submission UI Status and History

**Files:**
- Modify: `frontend/src/lib/api/intents.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Add static tests for UI status copy**

In `frontend/src/app/intents/[id]/page.test.ts`, add:

```ts
it("renders submission status and confirmation history copy", () => {
  const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
  const en = readFileSync(new URL("../../../lib/i18n/dictionaries/en.ts", import.meta.url), "utf8");

  expect(page).toContain("submission.status");
  expect(page).toContain("submissionStatus");
  expect(page).toContain("submissionConfirmationHistory");
  expect(en).toContain("submissionConfirmationHistory");
});
```

- [ ] **Step 2: Run focused test and verify failure**

Run:

```bash
cd frontend
npm test -- src/app/intents/[id]/page.test.ts src/lib/api/intents.test.ts
```

Expected: FAIL because UI copy/status is not yet surfaced.

- [ ] **Step 3: Update API client typing**

In `frontend/src/lib/api/intents.ts`, update `confirmSubmission` return type to match the new `{ confirmation, submission }` response.

- [ ] **Step 4: Render status and history**

In `frontend/src/app/intents/[id]/page.tsx`, near the existing submission panel, render:

```tsx
<p className="text-xs font-black uppercase text-slate-400">
  {t("intentsPage.submissionStatus")}
</p>
<p className="mt-1 text-sm font-black text-slate-950">
  {submission ? t(`intentsPage.submissionStatuses.${submission.status}`) : t("intentsPage.submissionUnavailable")}
</p>
```

When confirmations are available, render a compact history list headed by:

```tsx
{t("intentsPage.submissionConfirmationHistory")}
```

If the API currently only exposes latest confirmation on the page, display the latest confirmation first and keep service/API work responsible for exposing full history in Task 3.

- [ ] **Step 5: Add dictionary copy**

In both dictionaries, add:

```ts
submissionStatus: "Submission status",
submissionConfirmationHistory: "Confirmation history",
submissionStatuses: {
  draft: "Draft",
  ready: "Ready",
  submitted: "Submitted",
  needs_recovery: "Needs recovery",
},
```

Chinese:

```ts
submissionStatus: "提交状态",
submissionConfirmationHistory: "确认历史",
submissionStatuses: {
  draft: "草稿",
  ready: "已就绪",
  submitted: "已提交",
  needs_recovery: "需补救",
},
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/app/intents/[id]/page.test.ts src/lib/api/intents.test.ts
```

Expected: PASS.

## Task 5: Auth/Tier Local MVP Smoke Hardening

**Files:**
- Modify: `frontend/src/app/page.test.ts`
- Modify: `frontend/src/app/layout.test.ts`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/server/db/mysql-route-coverage.test.ts`

- [ ] **Step 1: Add smoke assertions for local MVP boundaries**

In existing static tests, verify these strings remain present:

```ts
expect(page).toContain("if (!auth.user)");
expect(page).toContain("PublicHome");
expect(page).toContain("isAdminUser");
expect(page).toContain("adminConsoleRoles");
expect(page).toContain("lockedFeatureMessage");
expect(page).toContain("AUTH_REQUIRED");
```

Do not add brittle pixel/layout assertions; this smoke is about product boundary.

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/app/page.test.ts src/app/layout.test.ts src/app/intents/[id]/page.test.ts src/server/db/mysql-route-coverage.test.ts
```

Expected: PASS.

## Task 6: 50-State Local Data Validity Verification

**Files:**
- Modify only if tests reveal a gap: `frontend/src/server/risk/checklist.ts`
- Modify only if tests reveal a gap: `frontend/src/server/risk/checklist.test.ts`
- Modify: `docs/operations/source-health-check.md`
- Modify: `docs/product-requirements/winbids-local-usable-mvp-plan.md`

- [ ] **Step 1: Run deterministic local source checks**

Run:

```bash
cd frontend
npm run risk:check
```

Expected: PASS. The report must include state coverage, non-empty state bid content, bid detail lookup, safe attachment routes, source governance, source-validity metadata, and URL validity.

- [ ] **Step 2: Run live source health as an operational report**

Run:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body
```

Expected: command completes with a report. Live failures such as 403, timeout, CAPTCHA, bot-check, or empty body are recorded as operational risks, not silent local MVP success.

- [ ] **Step 3: Update docs with the latest source-health interpretation**

In `docs/operations/source-health-check.md`, add a dated note with:

- Command used.
- Whether deterministic `risk:check` passed.
- Count of live source failures by severity.
- Any fallback states that need official-source promotion.

In `docs/product-requirements/winbids-local-usable-mvp-plan.md`, update P2 status if checks pass.

## Task 7: Local MVP Documentation Sync

**Files:**
- Modify: `docs/product-requirements/README.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-local-usable-mvp-plan.md`

- [ ] **Step 1: Update requirement docs**

Set the current recommendation to:

```md
Complete the Local Usable MVP baseline first: Response Package Format Slice, Submission Completion Lite, auth/tier smoke, 50-state deterministic checks, and docs handoff.
```

- [ ] **Step 2: Record exact verification commands**

In implementation status, add the exact command list that passed:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run db:mysql:migrate
npm run db:mysql:smoke
npm run workers:check
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

- [ ] **Step 3: Run docs whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS.

## Final Verification

After all tasks are implemented, run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run db:mysql:migrate
npm run db:mysql:smoke
npm run workers:check
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected:

- All tests pass.
- Build and lint pass.
- SQLite and MySQL migrations pass.
- MySQL smoke passes.
- Worker preflight passes.
- Risk check passes.
- No high-severity production dependency audit findings.
- No whitespace errors.

## Self-Review

Spec coverage:

- Response package format modeling: Tasks 1-2.
- Submission completion state/history: Tasks 3-4.
- Auth/tier local MVP boundary: Task 5.
- 50-state data/detail/download/source validity: Task 6.
- Documentation and project plan synchronization: Task 7.

Placeholder scan:

- The plan does not use TBD/TODO placeholders.
- ZIP behavior is explicitly unsupported for local MVP and validated as such.
- Production-only items remain deferred, not hidden as local MVP work.

Type consistency:

- `ResponsePackageExportFormat` is used by API input, service, row hydration, and UI display.
- `SubmissionStatus` is used by API input, service, row hydration, and UI display.
