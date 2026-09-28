# County Data Completeness — Phase 3 (Platform Review, Precheck Queue, Ledgered Batch Approval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin take the 952 registered-but-unapproved BidNet county/city/township rows from "governance hold" to "approved and scheduled" through one auditable path: a platform-level compliance review, a worker-driven precheck queue that spends the platform budget, and a batch approval that refuses any local source without a valid review, a fresh `ready|empty` precheck and an unchanged `base_url` — then run that path for real on the local MySQL.

**Architecture:** Three small server modules under `frontend/src/server/admin/` (`platform-reviews-repository.ts`, `precheck-queue.ts`, `ledgered-approval.ts`) each with a SQLite (Drizzle) and a MySQL (hand-written SQL) branch, exposed through three new admin routes (`platform-reviews`, `data-sources/precheck-requests`, `data-sources/approval-readiness`) and a tightened `data-sources/batch` route; one crawler module (`precheck-queue-runner.ts`) runs queued prechecks inside the worker tick after the daily lists, sharing the tick's `PlatformTickBudget`; two admin panels and one script (`npm run source:precheck`) drive it. Nothing bypasses the governance gate: registration still lands `approval_status IS NULL`, the precheck is the existing single-source precheck reused unchanged, and approval writes the same ledger columns the manual dialog writes.

**Tech Stack:** Next.js 16.2.6 App Router route handlers, Drizzle (better-sqlite3) + mysql2 hand-written SQL, Vitest (`globals: false`, node environment), React 19 client components with the admin console's inline-panel convention, i18n dictionaries `en.ts`/`zh.ts`.

Spec: `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` §7 (this phase), §5.5 (budget priorities), §10 (data model), §11 (error handling), §12.1/§12.2 (tests, acceptance), §14 (risks). Runbooks touched: `docs/operations/local-source-approval.md`, `docs/operations/source-discovery.md`, `docs/operations/data-source-compliance-ledger.md`. Prior phases: `docs/superpowers/plans/2026-09-24-county-data-completeness-phase1.md`, `…-phase2.md`.

## Global Constraints

- **Both dialects, every time.** Every read/write has a Drizzle branch (`db` from `@/server/db/client`) and a MySQL branch (`mysqlSelectMany/mysqlSelectOne/mysqlExecute` from `@/server/db/mysql-runtime` on a `MysqlDataSourcesStore`), named `foo` / `fooFromMysql`. Routes branch with the existing `resolveDatabase` / `shouldUseMysqlRuntime` pattern copied from `frontend/src/app/api/admin/data-sources/batch/route.ts`.
- **Schema.** The new table `platform_reviews` goes INSIDE the first `sqlite.exec(\`…\`)` block of `frontend/src/server/db/migrate.ts` (tables first, its index in the index cluster) so `frontend/src/server/db/mysql.ts` derives the MySQL DDL; the new column `data_sources.precheck_requested_at TEXT` goes into the initial `data_sources` CREATE TABLE, an `addDataSourceColumn("precheck_requested_at", "TEXT")` call, and a `mysqlColumnMigrations` entry `{ tableName: "data_sources", columnName: "precheck_requested_at", definition: "LONGTEXT" }`.
- **Admin routes.** Every new `frontend/src/app/api/admin/**/route.ts` imports `@/server/admin/auth`, calls `requireAdminAccess(db, request, { roles: [...] })` with a LITERAL roles array (the coverage test regex-matches it), never `resolvePrincipal`; mutating routes call `verifyCsrfSafe`/`csrfRejectedResponse` first; errors use `{ error: { code, message } }`; each file is added to exactly one array in `frontend/src/server/auth/role-route-coverage.test.ts`: `platform-reviews/route.ts` → `adminOnlyRoutes` (its POST is `roles: ["admin"]`, its GET is `roles: ["admin", "operator", "support"]`), `data-sources/precheck-requests/route.ts` → `operatorMutationRoutes` (`roles: ["admin", "operator"]`), `data-sources/approval-readiness/route.ts` → `consoleReadRoutes` (`roles: ["admin", "operator", "support"]`).
- **Platform review (spec §7.1).** Columns exactly: `id, provider_family, tos_url, tos_reviewed_at, robots_url, robots_checked_at, robots_summary, access_boundary, reviewer, legal_opinion_reference, reviewed_at, next_review_at, notes, created_by, created_at`. `access_boundary` defaults to the fixed sentence `只读公开列表与详情页；不登录、不取会员内容、不绕 WAF`. The effective review of a platform is the row with the latest `reviewed_at`; it is `valid` when its `next_review_at` is after now, otherwise `expired`; no row → `missing`. Admin creates/renews (a renewal is a new row), operator/support read only, every write is an audit event `platform_review.created`. An expired or missing review blocks batch approval of that platform's local sources; already-approved sources keep running.
- **Precheck queue (spec §7.2).** `precheck_requested_at` is only ever SET by the admin route / the script and only CLEARED by the worker after a completed precheck (a WAF challenge or an error is not completion). The worker reuses `runSourcePrecheck` from `frontend/src/server/admin/source-precheck.ts` unchanged in its verdict and write-back; it runs queued prechecks AFTER `runConfiguredCrawlerSourcesOnce` in the same tick, on the SAME `PlatformTickBudget` instance (spec §5.5 priority 2 = whatever the daily lists left), robots.txt is fetched at most once per host per tick, a WAF challenge stops that platform for the rest of the tick and pauses it via `PlatformPauseRegistry`, and the precheck notes record the `base_url` that was fetched.
- **Ledgered batch approval (spec §7.3).** For a local source (`jurisdiction_level` ∈ `county, city, township, special_district`) `action: "approve"` on `POST /api/admin/data-sources/batch` approves only when all three hold: (1) a `valid` platform review exists for `provider_family`; (2) `live_health_disposition` ∈ {`ready`, `empty`} and `live_health_reviewed_at` is at most 14 days old; (3) the `baseUrl` recorded in `live_health_notes` (`precheck.baseUrl`) equals the row's current `base_url`. On pass it writes `approval_status = approved`, `approved_for_ingestion = 1`, `is_enabled = 1`, `legal_review_status = approved_public`, `compliance_reviewer` / `tos_url` / `tos_reviewed_at` / `legal_opinion_reference` from the review, `tos_reviewed = 1`, `compliance_review_due_at = review.next_review_at`, `approval_notes = 依据平台审查 #<id>；预检 <disposition> @<live_health_reviewed_at>`. Otherwise the source is skipped with a reason and nothing is written. Federal/state sources keep the old generic approval. A batch call still carries at most 100 ids; the UI submits "approve all approvable" in chunks of 100.
- **Pending = awaiting precheck.** `--pending` / `pending: true` means: local level, `is_enabled = 1`, `approval_status` NULL or `needs_review`, `precheck_requested_at IS NULL`, and no precheck within 14 days (`live_health_reviewed_at` NULL or older).
- **No new environment variables.** Budget and pause reuse `CRAWLER_PLATFORM_BUDGETS` / `CRAWLER_PLATFORM_PAUSE_MS` / `CRAWLER_WORKER_INTERVAL_MS`.
- **Tests run offline**: Vitest `globals: false` (import `describe/it/expect/vi` explicitly), `createTestDatabase({ seed: false })` from `@/server/db/test-utils` with `await testDb.cleanup()` in `afterEach`, MySQL twins exercised with fake `{ query, execute }` stores whose return shapes copy `frontend/src/server/admin/data-sources-repository.test.ts` (what `mysqlSelectMany`/`mysqlExecute` unwrap), no network, no Python subprocess (inject `runSourcePrecheck` / `scanCompliance`).
- **UI**: every new string goes through `t()` with keys in BOTH `frontend/src/lib/i18n/dictionaries/en.ts` and `zh.ts` (`zh` is `typeof en`; `t()` does not interpolate — use `.replace("{count}", …)`); panels follow the admin console's inline `role="dialog"` / `data-testid` convention (no Radix dialog exists); pure helpers are exported and unit-tested in a co-located `*.test.ts` (node environment, no rendering).
- **Commits**: one per task, explicit pathspecs, never stage `.DS_Store`, `services/.DS_Store`, `ops-evidence/`, `frontend/data/`. **Do not add a `Co-Authored-By` trailer** (repository rule: Claude must not appear as a GitHub contributor).
- Boundaries (spec §13): nothing here logs in, solves a challenge, or bypasses the governance gate; discovery stays manual.

## Decisions this plan adds (beyond the spec text — confirm at plan review)

1. **Precheck budget cost.** A queued precheck reserves 2 requests (robots.txt + one list page) and settles with `2 + 6` when the dry run answered 404 (the tenant probe makes up to 6 requests) — the spec gives no number.
2. **Queue errors keep the flag.** A precheck that throws (crawler could not be invoked) is logged as `error`, counted, and left queued; the WAF-challenge case is likewise left queued (spec: 下个 tick 续跑). Only a returned verdict clears the flag.
3. **Readiness is served, not computed client-side.** `GET /api/admin/data-sources/approval-readiness?providerFamily=bidnet` returns the grouped counts (可批准 / 待预检 / 需修正 / 缺平台审查 / 已批准 / 已拦截) so the console and the runbook use one definition.
4. **Renewal = new row.** "续期" inserts a new `platform_reviews` row (the previous one stays as history); there is no PATCH.
5. **Repository rule on commits**: no `Co-Authored-By` trailers (differs from the phase-1/2 plan templates).

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `frontend/src/server/db/schema.ts` | 1 | `platformReviews` table; `dataSources.precheckRequestedAt` |
| `frontend/src/server/db/migrate.ts` | 1 | SQLite DDL (first block) + additive column |
| `frontend/src/server/db/mysql.ts` | 1 | MySQL additive column entry |
| `frontend/src/server/db/schema.test.ts`, `mysql.test.ts` | 1 | migration tests |
| `frontend/src/server/admin/platform-reviews-repository.ts` (+ `.test.ts`) | 2 | types, validation, effective-review rule, SQLite + MySQL create/list, audit event |
| `frontend/src/app/api/admin/platform-reviews/route.ts` (+ `.test.ts`) | 3 | GET list (+ effective map), POST create |
| `frontend/src/lib/api/admin.ts` | 3, 4, 7 | client helpers + types |
| `frontend/src/server/auth/role-route-coverage.test.ts` | 3, 4, 7 | route registry |
| `frontend/src/server/admin/precheck-queue.ts` (+ `.test.ts`) | 4 | request / list / clear queue, `pending` rule, both dialects |
| `frontend/src/server/admin/data-sources-repository.ts` | 4 | `precheckRequestedAt` on `AdminDataSource` (both list queries) |
| `frontend/src/server/admin/source-precheck.ts` (+ `.test.ts`) | 4 | `precheck.baseUrl` in notes; `precheckBaseUrlFromNotes()` |
| `frontend/src/app/api/admin/data-sources/precheck-requests/route.ts` (+ `.test.ts`) | 4 | POST mark |
| `frontend/scripts/source-precheck.ts` (+ `.test.ts`), `frontend/package.json` | 5 | `npm run source:precheck` |
| `frontend/src/server/admin/crawler-robots-fetch.ts` (+ `.test.ts`) | 6 | `createCachedRobotsFetch()` |
| `frontend/src/server/crawler/precheck-queue-runner.ts` (+ `.test.ts`) | 6 | worker step |
| `frontend/src/server/crawler/configured-runner.ts` (+ `.test.ts`) | 6 | `platformBudget` option |
| `frontend/scripts/crawler-worker.ts` | 6 | tick integration |
| `frontend/src/server/admin/ledgered-approval.ts` (+ `.test.ts`) | 7 | three checks, ledger input, readiness summary, batch write |
| `frontend/src/app/api/admin/data-sources/batch/route.ts` (+ `.test.ts`) | 7 | tightened approve |
| `frontend/src/app/api/admin/data-sources/approval-readiness/route.ts` (+ `.test.ts`) | 7 | GET summary |
| `frontend/src/components/admin/PlatformReviewsPanel.tsx` (+ `.test.ts`) | 8 | reviews list + create form |
| `frontend/src/components/admin/LedgeredApprovalPanel.tsx` (+ `.test.ts`) | 8 | readiness counts, queue prechecks, approve all in chunks |
| `frontend/src/app/admin/page.tsx`, `frontend/src/lib/i18n/dictionaries/{en,zh}.ts` | 8 | mount + strings |
| `docs/operations/local-source-approval.md`, `docs/operations/source-discovery.md`, `docs/operations/data-source-compliance-ledger.md`, `CLAUDE.md`, spec §7 addendum | 9 | documentation |
| (controller) `ops-evidence/`, runbook acceptance section | 10 | live run + acceptance |

**Waves** (parallel implementers only within a wave, disjoint files): A = Task 1 · B = Tasks 2, 4 · C = Tasks 3, 5, 6 · D = Task 7 · E = Task 8 · F = Task 9 · G = Task 10 (controller).

---

### Task 1: Schema and migrations (`platform_reviews`, `data_sources.precheck_requested_at`)

**Files:**
- Modify: `frontend/src/server/db/schema.ts` (add `precheckRequestedAt` to `dataSources` after `liveHealthReviewedAt` ~line 1375; append the `platformReviews` table after `sourceApprovalEvents`, end of file)
- Modify: `frontend/src/server/db/migrate.ts` (initial `data_sources` CREATE TABLE ~786-841; a new CREATE TABLE before the index cluster at ~856; a new CREATE INDEX in the cluster ~858-999; `addDataSourceColumn` block ~1237-1292)
- Modify: `frontend/src/server/db/mysql.ts` (`mysqlColumnMigrations`, after the `consecutive_empty_runs` entry ~line 389)
- Test: `frontend/src/server/db/schema.test.ts`, `frontend/src/server/db/mysql.test.ts`

**Interfaces:**
- Produces: Drizzle export `platformReviews` (columns below) and `dataSources.precheckRequestedAt: text("precheck_requested_at")`; SQL table `platform_reviews` and column `data_sources.precheck_requested_at` on both dialects.

- [ ] **Step 1: Failing schema tests**

Append to `frontend/src/server/db/schema.test.ts` (imports at the top of that file already provide `describe/it/expect`, `createTestDatabase`, `runMigrations`; add them if a fresh `describe` block needs them):

```ts
describe("phase-3 governance migration (spec 2026-09-24 §7)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("adds precheck_requested_at to data_sources", () => {
    const columns = (testDb.db.$client.prepare("PRAGMA table_info(data_sources)").all() as { name: string }[]).map((row) => row.name);
    expect(columns).toContain("precheck_requested_at");
  });

  it("creates platform_reviews with the spec's columns and its family/reviewed index", () => {
    const columns = (testDb.db.$client.prepare("PRAGMA table_info(platform_reviews)").all() as { name: string }[]).map((row) => row.name);
    expect(columns).toEqual([
      "id", "provider_family", "tos_url", "tos_reviewed_at", "robots_url", "robots_checked_at", "robots_summary",
      "access_boundary", "reviewer", "legal_opinion_reference", "reviewed_at", "next_review_at", "notes", "created_by", "created_at",
    ]);
    const indexes = (testDb.db.$client.prepare("PRAGMA index_list(platform_reviews)").all() as { name: string }[]).map((row) => row.name);
    expect(indexes).toContain("idx_platform_reviews_family_reviewed");
  });

  it("is idempotent when an older database is migrated twice", () => {
    expect(() => runMigrations(testDb.db)).not.toThrow();
    expect(() => runMigrations(testDb.db)).not.toThrow();
  });
});
```

Append to `frontend/src/server/db/mysql.test.ts` (next to the existing `describe("mysql migrations cover the bid lifecycle columns (2026-09-24 phase 1)")`):

```ts
describe("mysql migrations cover phase 3 governance (2026-09-24 §7)", () => {
  it("adds precheck_requested_at to existing databases", () => {
    expect(mysqlColumnMigrationStatements().join("\n")).toContain(
      "data_sources ADD COLUMN precheck_requested_at LONGTEXT",
    );
  });

  it("derives platform_reviews with key-sized indexed columns and long text elsewhere", () => {
    const table = mysqlMigrationStatements().find((statement) => statement.includes("CREATE TABLE IF NOT EXISTS platform_reviews"));
    expect(table).toBeDefined();
    expect(table).toContain("provider_family VARCHAR(191) NOT NULL");
    expect(table).toContain("reviewed_at VARCHAR(191) NOT NULL");
    expect(table).toContain("robots_summary LONGTEXT NOT NULL");
    expect(mysqlMigrationStatements().join("\n")).toContain(
      "CREATE INDEX IF NOT EXISTS idx_platform_reviews_family_reviewed ON platform_reviews(provider_family, reviewed_at)",
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd frontend && npx vitest run src/server/db/schema.test.ts src/server/db/mysql.test.ts`
Expected: the four new tests FAIL (missing column / missing table / missing statements); everything else passes.

- [ ] **Step 3: Schema**

In `frontend/src/server/db/schema.ts`, inside `dataSources`, after `liveHealthReviewedAt: text("live_health_reviewed_at"),` add:

```ts
  /** Precheck queue flag (spec 2026-09-24 §7.2): set by admins/scripts, cleared by the worker. */
  precheckRequestedAt: text("precheck_requested_at"),
```

At the end of the file add:

```ts
/** Platform-level compliance review (spec 2026-09-24 §7.1); a renewal is a new row. */
export const platformReviews = sqliteTable(
  "platform_reviews",
  {
    id: text("id").primaryKey(),
    providerFamily: text("provider_family").notNull(),
    tosUrl: text("tos_url").notNull(),
    tosReviewedAt: text("tos_reviewed_at").notNull(),
    robotsUrl: text("robots_url").notNull(),
    robotsCheckedAt: text("robots_checked_at").notNull(),
    robotsSummary: text("robots_summary").notNull(),
    accessBoundary: text("access_boundary").notNull(),
    reviewer: text("reviewer").notNull(),
    legalOpinionReference: text("legal_opinion_reference"),
    reviewedAt: text("reviewed_at").notNull(),
    nextReviewAt: text("next_review_at").notNull(),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    familyReviewedIdx: index("idx_platform_reviews_family_reviewed").on(table.providerFamily, table.reviewedAt),
  }),
);
```

- [ ] **Step 4: SQLite migrations**

In `frontend/src/server/db/migrate.ts`:
1. In the initial `CREATE TABLE IF NOT EXISTS data_sources (...)` add `precheck_requested_at TEXT,` right after `live_health_reviewed_at TEXT,`.
2. Immediately BEFORE the first `CREATE INDEX IF NOT EXISTS` of the index cluster (still inside the first `sqlite.exec` block), add:

```sql
    CREATE TABLE IF NOT EXISTS platform_reviews (
      id TEXT PRIMARY KEY,
      provider_family TEXT NOT NULL,
      tos_url TEXT NOT NULL,
      tos_reviewed_at TEXT NOT NULL,
      robots_url TEXT NOT NULL,
      robots_checked_at TEXT NOT NULL,
      robots_summary TEXT NOT NULL,
      access_boundary TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      legal_opinion_reference TEXT,
      reviewed_at TEXT NOT NULL,
      next_review_at TEXT NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
```

3. At the end of the index cluster (still inside the first block) add:

```sql
    CREATE INDEX IF NOT EXISTS idx_platform_reviews_family_reviewed ON platform_reviews(provider_family, reviewed_at);
```

4. After `addDataSourceColumn("consecutive_empty_runs", "INTEGER NOT NULL DEFAULT 0");` add:

```ts
  // Precheck queue (spec 2026-09-24 §7.2).
  addDataSourceColumn("precheck_requested_at", "TEXT");
```

- [ ] **Step 5: MySQL additive column**

In `frontend/src/server/db/mysql.ts`, after the `consecutive_empty_runs` entry of `mysqlColumnMigrations`, add:

```ts
  // Precheck queue (spec 2026-09-24 phase 3).
  { tableName: "data_sources", columnName: "precheck_requested_at", definition: "LONGTEXT" },
```

(`platform_reviews` needs no entry: it lives in the first block and `mysqlMigrationStatements()` derives it, sizing `provider_family`/`reviewed_at` as `VARCHAR(191)` because the index names them.)

- [ ] **Step 6: Run the tests**

Run: `cd frontend && npx vitest run src/server/db/`
Expected: all pass. Then `cd frontend && npm run build` is NOT required here; `npx vitest run` over `src/server/db` is the gate.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/server/db/schema.ts frontend/src/server/db/migrate.ts frontend/src/server/db/mysql.ts frontend/src/server/db/schema.test.ts frontend/src/server/db/mysql.test.ts
git commit -m "feat(db): add platform_reviews and the data_sources precheck queue flag"
```

---

### Task 2: Platform reviews repository (both dialects, audit event, effective-review rule)

**Files:**
- Create: `frontend/src/server/admin/platform-reviews-repository.ts`
- Test: `frontend/src/server/admin/platform-reviews-repository.test.ts`

**Interfaces:**
- Consumes: Task 1's `platformReviews` table; `writeAuditEvent` / `writeAuditEventFromMysql` from `@/server/events/event-log` (call shape as in `data-sources-repository.ts` ~line 963: `{ eventName, actorType, actorId, targetType, targetId, outcome, beforeAfter, occurredAt }`); `mysqlSelectMany` / `mysqlExecute` from `@/server/db/mysql-runtime`.
- Produces (used by Tasks 3, 7, 8):

```ts
export const PLATFORM_ACCESS_BOUNDARY = "只读公开列表与详情页；不登录、不取会员内容、不绕 WAF";
export interface PlatformReview { id: string; providerFamily: string; tosUrl: string; tosReviewedAt: string; robotsUrl: string; robotsCheckedAt: string; robotsSummary: string; accessBoundary: string; reviewer: string; legalOpinionReference: string | null; reviewedAt: string; nextReviewAt: string; notes: string | null; createdBy: string | null; createdAt: string }
export interface CreatePlatformReviewInput { providerFamily: string; tosUrl: string; tosReviewedAt: string; robotsUrl: string; robotsCheckedAt: string; robotsSummary: string; accessBoundary?: string; reviewer: string; legalOpinionReference?: string | null; reviewedAt?: string; nextReviewAt: string; notes?: string | null }
export class PlatformReviewValidationError extends Error { readonly issues: string[] }
export function validatePlatformReviewInput(raw: unknown, now: Date): CreatePlatformReviewInput   // throws PlatformReviewValidationError
export type PlatformReviewStatus = "valid" | "expired" | "missing";
export interface EffectivePlatformReview { status: PlatformReviewStatus; review: PlatformReview | null }
export function effectivePlatformReview(reviews: readonly PlatformReview[], providerFamily: string, now: Date): EffectivePlatformReview
export function effectivePlatformReviewsByFamily(reviews: readonly PlatformReview[], now: Date): Record<string, EffectivePlatformReview>
export type MysqlPlatformReviewsStore = Parameters<typeof mysqlSelectMany>[0] & Parameters<typeof writeAuditEventFromMysql>[0];
export function listPlatformReviews(db: AppDatabase): PlatformReview[]
export async function listPlatformReviewsFromMysql(mysql: MysqlPlatformReviewsStore): Promise<PlatformReview[]>
export interface CreatePlatformReviewOptions { actorUserId?: string | null; now?: Date }
export function createPlatformReview(db: AppDatabase, input: CreatePlatformReviewInput, options?: CreatePlatformReviewOptions): PlatformReview
export async function createPlatformReviewFromMysql(mysql: MysqlPlatformReviewsStore, input: CreatePlatformReviewInput, options?: CreatePlatformReviewOptions): Promise<PlatformReview>
```

- [ ] **Step 1: Failing tests**

`frontend/src/server/admin/platform-reviews-repository.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  PLATFORM_ACCESS_BOUNDARY,
  PlatformReviewValidationError,
  createPlatformReview,
  createPlatformReviewFromMysql,
  effectivePlatformReview,
  effectivePlatformReviewsByFamily,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  validatePlatformReviewInput,
  type PlatformReview,
} from "./platform-reviews-repository";

const NOW = new Date("2026-09-29T08:00:00.000Z");

function input(overrides: Record<string, unknown> = {}) {
  return {
    providerFamily: "bidnet",
    tosUrl: "https://www.bidnetdirect.com/tsandcs",
    tosReviewedAt: "2026-09-29",
    robotsUrl: "https://www.bidnetdirect.com/robots.txt",
    robotsCheckedAt: "2026-09-29T07:00:00.000Z",
    robotsSummary: "Disallow: /private/, /favorites; list and detail paths allowed",
    reviewer: "apsi.lily@gmail.com",
    nextReviewAt: "2027-09-29",
    ...overrides,
  };
}

function review(overrides: Partial<PlatformReview> = {}): PlatformReview {
  return {
    id: "prv_1", providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29",
    robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok",
    accessBoundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legalOpinionReference: null,
    reviewedAt: "2026-09-29T08:00:00.000Z", nextReviewAt: "2027-09-29", notes: null, createdBy: null, createdAt: "2026-09-29T08:00:00.000Z",
    ...overrides,
  };
}

describe("validatePlatformReviewInput", () => {
  it("normalises the family, defaults the boundary and reviewedAt", () => {
    const value = validatePlatformReviewInput(input({ providerFamily: " BidNet " }), NOW);
    expect(value.providerFamily).toBe("bidnet");
    expect(value.accessBoundary).toBe(PLATFORM_ACCESS_BOUNDARY);
    expect(value.reviewedAt).toBe(NOW.toISOString());
  });

  it.each([
    ["providerFamily", { providerFamily: "Bid Net!" }],
    ["tosUrl", { tosUrl: "ftp://x" }],
    ["robotsUrl", { robotsUrl: "not a url" }],
    ["reviewer", { reviewer: "  " }],
    ["robotsSummary", { robotsSummary: "" }],
    ["nextReviewAt", { nextReviewAt: "2026-01-01" }],
    ["tosReviewedAt", { tosReviewedAt: "yesterday" }],
  ])("rejects a bad %s", (field, overrides) => {
    expect(() => validatePlatformReviewInput(input(overrides), NOW)).toThrow(PlatformReviewValidationError);
    try {
      validatePlatformReviewInput(input(overrides), NOW);
    } catch (error) {
      expect((error as PlatformReviewValidationError).issues.join(" ")).toContain(field);
    }
  });

  it("rejects a non-object", () => {
    expect(() => validatePlatformReviewInput(null, NOW)).toThrow(PlatformReviewValidationError);
  });
});

describe("effectivePlatformReview", () => {
  it("is missing without a row for the family", () => {
    expect(effectivePlatformReview([review({ providerFamily: "bonfire" })], "bidnet", NOW)).toEqual({ status: "missing", review: null });
  });

  it("picks the latest reviewed_at and calls it valid while next_review_at is in the future", () => {
    const older = review({ id: "prv_old", reviewedAt: "2025-09-01T00:00:00.000Z", nextReviewAt: "2026-09-01" });
    const newer = review({ id: "prv_new", reviewedAt: "2026-09-29T08:00:00.000Z", nextReviewAt: "2027-09-29" });
    expect(effectivePlatformReview([older, newer], "bidnet", NOW)).toEqual({ status: "valid", review: newer });
  });

  it("calls the latest row expired once next_review_at has passed, even if an older row would still be valid", () => {
    const older = review({ id: "prv_old", reviewedAt: "2025-09-01T00:00:00.000Z", nextReviewAt: "2027-01-01" });
    const newer = review({ id: "prv_new", reviewedAt: "2026-06-01T00:00:00.000Z", nextReviewAt: "2026-09-01" });
    expect(effectivePlatformReview([older, newer], "bidnet", NOW)).toEqual({ status: "expired", review: newer });
  });

  it("groups by family", () => {
    const byFamily = effectivePlatformReviewsByFamily([review(), review({ id: "prv_b", providerFamily: "bonfire", nextReviewAt: "2026-01-01" })], NOW);
    expect(byFamily.bidnet.status).toBe("valid");
    expect(byFamily.bonfire.status).toBe("expired");
  });
});

describe("createPlatformReview / listPlatformReviews (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("stores the row, returns it and writes a platform_review.created audit event", () => {
    const created = createPlatformReview(testDb.db, validatePlatformReviewInput(input(), NOW), { actorUserId: "usr_admin", now: NOW });
    expect(created.id).toMatch(/^prv_/);
    expect(created.accessBoundary).toBe(PLATFORM_ACCESS_BOUNDARY);
    expect(created.createdBy).toBe("usr_admin");
    expect(listPlatformReviews(testDb.db)).toEqual([created]);

    const event = testDb.db.$client
      .prepare("SELECT event_name, target_type, target_id, actor_id FROM event_log ORDER BY created_at DESC LIMIT 1")
      .get() as { event_name: string; target_type: string; target_id: string; actor_id: string | null };
    expect(event).toMatchObject({ event_name: "platform_review.created", target_type: "platform_review", target_id: created.id, actor_id: "usr_admin" });
  });

  it("lists newest reviewed_at first", () => {
    createPlatformReview(testDb.db, validatePlatformReviewInput(input({ reviewedAt: "2025-01-01T00:00:00.000Z", nextReviewAt: "2026-01-01" }), NOW), { now: NOW });
    const newer = createPlatformReview(testDb.db, validatePlatformReviewInput(input(), NOW), { now: NOW });
    expect(listPlatformReviews(testDb.db)[0].id).toBe(newer.id);
  });
});

describe("MySQL twins", () => {
  it("inserts with the same column set and lists rows back", async () => {
    const execute = vi.fn(async () => ({ affectedRows: 1 }));
    const query = vi.fn(async () => [
      { id: "prv_1", provider_family: "bidnet", tos_url: "https://www.bidnetdirect.com/tsandcs", tos_reviewed_at: "2026-09-29", robots_url: "https://www.bidnetdirect.com/robots.txt", robots_checked_at: "2026-09-29T07:00:00.000Z", robots_summary: "ok", access_boundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legal_opinion_reference: null, reviewed_at: "2026-09-29T08:00:00.000Z", next_review_at: "2027-09-29", notes: null, created_by: null, created_at: "2026-09-29T08:00:00.000Z" },
    ]);
    const store = { execute, query } as never;

    const created = await createPlatformReviewFromMysql(store, validatePlatformReviewInput(input(), NOW), { now: NOW });
    const insert = execute.mock.calls.find((call) => String(call[1]).includes("INSERT INTO platform_reviews"));
    expect(insert).toBeDefined();
    expect(String(insert?.[1])).toContain("(id, provider_family, tos_url, tos_reviewed_at, robots_url, robots_checked_at, robots_summary, access_boundary, reviewer, legal_opinion_reference, reviewed_at, next_review_at, notes, created_by, created_at)");
    expect(created.providerFamily).toBe("bidnet");

    const rows = await listPlatformReviewsFromMysql(store);
    expect(rows[0]).toMatchObject({ id: "prv_1", providerFamily: "bidnet", nextReviewAt: "2027-09-29" });
  });
});
```

(If `event_log`'s column names differ from `event_name/target_type/target_id/actor_id`, read the `eventLog` table in `schema.ts` and use its names — the assertion, not the design, adapts.)

- [ ] **Step 2: Run to see them fail**

Run: `cd frontend && npx vitest run src/server/admin/platform-reviews-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementation**

`frontend/src/server/admin/platform-reviews-repository.ts`:

```ts
import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { platformReviews } from "@/server/db/schema";
import { writeAuditEvent, writeAuditEventFromMysql } from "@/server/events/event-log";

/** Spec 2026-09-24 §7.1: the boundary every platform review states, verbatim. */
export const PLATFORM_ACCESS_BOUNDARY = "只读公开列表与详情页；不登录、不取会员内容、不绕 WAF";

export interface PlatformReview {
  id: string;
  providerFamily: string;
  tosUrl: string;
  tosReviewedAt: string;
  robotsUrl: string;
  robotsCheckedAt: string;
  robotsSummary: string;
  accessBoundary: string;
  reviewer: string;
  legalOpinionReference: string | null;
  reviewedAt: string;
  nextReviewAt: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreatePlatformReviewInput {
  providerFamily: string;
  tosUrl: string;
  tosReviewedAt: string;
  robotsUrl: string;
  robotsCheckedAt: string;
  robotsSummary: string;
  accessBoundary?: string;
  reviewer: string;
  legalOpinionReference?: string | null;
  reviewedAt?: string;
  nextReviewAt: string;
  notes?: string | null;
}

export class PlatformReviewValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Platform review input is invalid: ${issues.join("; ")}`);
    this.name = "PlatformReviewValidationError";
    this.issues = issues;
  }
}

const FAMILY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Normalises and validates a request body; every problem is reported at once. */
export function validatePlatformReviewInput(raw: unknown, now: Date): CreatePlatformReviewInput {
  if (!raw || typeof raw !== "object") throw new PlatformReviewValidationError(["body must be an object"]);
  const body = raw as Record<string, unknown>;
  const issues: string[] = [];

  const providerFamily = typeof body.providerFamily === "string" ? body.providerFamily.trim().toLowerCase() : "";
  if (!FAMILY_PATTERN.test(providerFamily)) issues.push("providerFamily must be a lowercase slug (a-z, 0-9, _ or -)");
  if (!isHttpUrl(body.tosUrl)) issues.push("tosUrl must be an http(s) URL");
  if (!isHttpUrl(body.robotsUrl)) issues.push("robotsUrl must be an http(s) URL");
  if (!isIsoDate(body.tosReviewedAt)) issues.push("tosReviewedAt must be an ISO date");
  if (!isIsoDate(body.robotsCheckedAt)) issues.push("robotsCheckedAt must be an ISO date");
  const robotsSummary = typeof body.robotsSummary === "string" ? body.robotsSummary.trim() : "";
  if (!robotsSummary) issues.push("robotsSummary is required");
  const reviewer = typeof body.reviewer === "string" ? body.reviewer.trim() : "";
  if (!reviewer) issues.push("reviewer is required");
  const reviewedAt = body.reviewedAt === undefined || body.reviewedAt === null ? now.toISOString() : body.reviewedAt;
  if (!isIsoDate(reviewedAt)) issues.push("reviewedAt must be an ISO date");
  if (!isIsoDate(body.nextReviewAt)) {
    issues.push("nextReviewAt must be an ISO date");
  } else if (isIsoDate(reviewedAt) && Date.parse(body.nextReviewAt) <= Date.parse(reviewedAt)) {
    issues.push("nextReviewAt must be after reviewedAt");
  }
  const accessBoundary = optionalText(body.accessBoundary) ?? PLATFORM_ACCESS_BOUNDARY;

  if (issues.length > 0) throw new PlatformReviewValidationError(issues);

  return {
    providerFamily,
    tosUrl: body.tosUrl as string,
    tosReviewedAt: body.tosReviewedAt as string,
    robotsUrl: body.robotsUrl as string,
    robotsCheckedAt: body.robotsCheckedAt as string,
    robotsSummary,
    accessBoundary,
    reviewer,
    legalOpinionReference: optionalText(body.legalOpinionReference),
    reviewedAt: reviewedAt as string,
    nextReviewAt: body.nextReviewAt as string,
    notes: optionalText(body.notes),
  };
}

export type PlatformReviewStatus = "valid" | "expired" | "missing";

export interface EffectivePlatformReview {
  status: PlatformReviewStatus;
  review: PlatformReview | null;
}

/** Spec §7.1: the latest `reviewed_at` row is the platform's review; it is valid until `next_review_at`. */
export function effectivePlatformReview(
  reviews: readonly PlatformReview[],
  providerFamily: string,
  now: Date,
): EffectivePlatformReview {
  let latest: PlatformReview | null = null;
  for (const candidate of reviews) {
    if (candidate.providerFamily !== providerFamily) continue;
    if (!latest || Date.parse(candidate.reviewedAt) > Date.parse(latest.reviewedAt)) latest = candidate;
  }
  if (!latest) return { status: "missing", review: null };
  return { status: Date.parse(latest.nextReviewAt) > now.getTime() ? "valid" : "expired", review: latest };
}

export function effectivePlatformReviewsByFamily(
  reviews: readonly PlatformReview[],
  now: Date,
): Record<string, EffectivePlatformReview> {
  const byFamily: Record<string, EffectivePlatformReview> = {};
  for (const family of new Set(reviews.map((review) => review.providerFamily))) {
    byFamily[family] = effectivePlatformReview(reviews, family, now);
  }
  return byFamily;
}

export type MysqlPlatformReviewsStore = Parameters<typeof mysqlSelectMany>[0] & Parameters<typeof writeAuditEventFromMysql>[0];

export interface CreatePlatformReviewOptions {
  actorUserId?: string | null;
  now?: Date;
}

interface PlatformReviewRow {
  id: string;
  provider_family: string;
  tos_url: string;
  tos_reviewed_at: string;
  robots_url: string;
  robots_checked_at: string;
  robots_summary: string;
  access_boundary: string;
  reviewer: string;
  legal_opinion_reference: string | null;
  reviewed_at: string;
  next_review_at: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

function fromRow(row: PlatformReviewRow): PlatformReview {
  return {
    id: row.id,
    providerFamily: row.provider_family,
    tosUrl: row.tos_url,
    tosReviewedAt: row.tos_reviewed_at,
    robotsUrl: row.robots_url,
    robotsCheckedAt: row.robots_checked_at,
    robotsSummary: row.robots_summary,
    accessBoundary: row.access_boundary,
    reviewer: row.reviewer,
    legalOpinionReference: row.legal_opinion_reference ?? null,
    reviewedAt: row.reviewed_at,
    nextReviewAt: row.next_review_at,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
  };
}

function buildReview(input: CreatePlatformReviewInput, options: CreatePlatformReviewOptions): PlatformReview {
  const now = options.now ?? new Date();
  return {
    id: `prv_${randomUUID()}`,
    providerFamily: input.providerFamily,
    tosUrl: input.tosUrl,
    tosReviewedAt: input.tosReviewedAt,
    robotsUrl: input.robotsUrl,
    robotsCheckedAt: input.robotsCheckedAt,
    robotsSummary: input.robotsSummary,
    accessBoundary: input.accessBoundary ?? PLATFORM_ACCESS_BOUNDARY,
    reviewer: input.reviewer,
    legalOpinionReference: input.legalOpinionReference ?? null,
    reviewedAt: input.reviewedAt ?? now.toISOString(),
    nextReviewAt: input.nextReviewAt,
    notes: input.notes ?? null,
    createdBy: options.actorUserId ?? null,
    createdAt: now.toISOString(),
  };
}

function auditInput(review: PlatformReview, options: CreatePlatformReviewOptions) {
  return {
    eventName: "platform_review.created",
    actorType: options.actorUserId ? "user" : "system",
    actorId: options.actorUserId ?? null,
    targetType: "platform_review",
    targetId: review.id,
    outcome: "success",
    beforeAfter: { before: null, after: review },
    occurredAt: review.createdAt,
  } as const;
}

export function listPlatformReviews(db: AppDatabase): PlatformReview[] {
  return db
    .select()
    .from(platformReviews)
    .orderBy(desc(platformReviews.reviewedAt), desc(platformReviews.createdAt))
    .all()
    .map((row) => ({ ...row, legalOpinionReference: row.legalOpinionReference ?? null, notes: row.notes ?? null, createdBy: row.createdBy ?? null }));
}

export async function listPlatformReviewsFromMysql(mysql: MysqlPlatformReviewsStore): Promise<PlatformReview[]> {
  const rows = await mysqlSelectMany<PlatformReviewRow>(
    mysql,
    `SELECT id, provider_family, tos_url, tos_reviewed_at, robots_url, robots_checked_at, robots_summary, access_boundary,
            reviewer, legal_opinion_reference, reviewed_at, next_review_at, notes, created_by, created_at
       FROM platform_reviews
      ORDER BY reviewed_at DESC, created_at DESC`,
    [],
  );
  return rows.map(fromRow);
}

export function createPlatformReview(
  db: AppDatabase,
  input: CreatePlatformReviewInput,
  options: CreatePlatformReviewOptions = {},
): PlatformReview {
  const review = buildReview(input, options);
  db.insert(platformReviews).values(review).run();
  writeAuditEvent(db, auditInput(review, options));
  return review;
}

export async function createPlatformReviewFromMysql(
  mysql: MysqlPlatformReviewsStore,
  input: CreatePlatformReviewInput,
  options: CreatePlatformReviewOptions = {},
): Promise<PlatformReview> {
  const review = buildReview(input, options);
  await mysqlExecute(
    mysql,
    `INSERT INTO platform_reviews
       (id, provider_family, tos_url, tos_reviewed_at, robots_url, robots_checked_at, robots_summary, access_boundary, reviewer, legal_opinion_reference, reviewed_at, next_review_at, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      review.id, review.providerFamily, review.tosUrl, review.tosReviewedAt, review.robotsUrl, review.robotsCheckedAt,
      review.robotsSummary, review.accessBoundary, review.reviewer, review.legalOpinionReference, review.reviewedAt,
      review.nextReviewAt, review.notes, review.createdBy, review.createdAt,
    ] as never[],
  );
  await writeAuditEventFromMysql(mysql, auditInput(review, options));
  return review;
}
```

If `writeAuditEvent`'s input type rejects a literal field above (e.g. `actorType` union), read `WriteEventInput` in `frontend/src/server/events/event-log.ts` and adjust the field values — keep the event name, target type/id and before/after.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/server/admin/platform-reviews-repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/server/admin/platform-reviews-repository.ts frontend/src/server/admin/platform-reviews-repository.test.ts
git commit -m "feat(admin): platform review ledger with the effective-review rule"
```

---

### Task 3: Platform reviews admin route + client helpers

**Files:**
- Create: `frontend/src/app/api/admin/platform-reviews/route.ts`
- Test: `frontend/src/app/api/admin/platform-reviews/route.test.ts`
- Modify: `frontend/src/lib/api/admin.ts` (types + two helpers, after `precheckAdminDataSource`)
- Modify: `frontend/src/server/auth/role-route-coverage.test.ts` (`adminOnlyRoutes`)

**Interfaces:**
- Consumes: Task 2's repository.
- Produces: `GET /api/admin/platform-reviews` → `{ reviews: PlatformReview[]; effective: Record<string, EffectivePlatformReview> }` (roles admin/operator/support); `POST /api/admin/platform-reviews` body `CreatePlatformReviewInput` → 201 `{ review }` (admin only, CSRF); 400 `INVALID_REQUEST` with the validation issues joined by `; `. Client: `listAdminPlatformReviews(): Promise<AdminPlatformReviewsResponse>`, `createAdminPlatformReview(input: CreateAdminPlatformReviewInput): Promise<{ review: AdminPlatformReview }>`; types `AdminPlatformReview = PlatformReview`, `AdminEffectivePlatformReview = EffectivePlatformReview`, `CreateAdminPlatformReviewInput = CreatePlatformReviewInput` re-exported from the repository.

- [ ] **Step 1: Failing route tests**

Copy the auth-mocking preamble of `frontend/src/app/api/admin/data-sources/batch/route.test.ts` (how it stubs `requireAdminAccess` / builds a `Request` with an `Origin` header) and write `frontend/src/app/api/admin/platform-reviews/route.test.ts` with these cases, all on `createTestDatabase({ seed: false })`:

```ts
it("lists reviews with the effective map", async () => {
  createPlatformReview(testDb.db, validatePlatformReviewInput(validInput(), NOW), { now: NOW });
  const response = await createAdminPlatformReviewsGet(testDb.db)(new Request("http://localhost/api/admin/platform-reviews"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.reviews).toHaveLength(1);
  expect(body.effective.bidnet.status).toBe("valid");
});

it("creates a review for an admin and returns 201", async () => {
  const response = await createAdminPlatformReviewsPost(testDb.db)(jsonRequest("POST", validInput()));
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.review.providerFamily).toBe("bidnet");
  expect(listPlatformReviews(testDb.db)).toHaveLength(1);
});

it("answers 400 INVALID_REQUEST with every validation issue", async () => {
  const response = await createAdminPlatformReviewsPost(testDb.db)(jsonRequest("POST", { ...validInput(), tosUrl: "nope", reviewer: "" }));
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.error.code).toBe("INVALID_REQUEST");
  expect(body.error.message).toContain("tosUrl");
  expect(body.error.message).toContain("reviewer");
});

it("rejects a non-admin POST with the auth guard's 403", async () => {
  // Same shape as batch/route.test.ts's "403s when requireAdminAccess rejects" (lines ~112-125): the stubbed
  // guard throws the same AdminAuthError that test builds; assert response.status === 403 and body.error.code === "FORBIDDEN".
});

it("rejects a POST without a same-origin Origin header (CSRF)", async () => {
  // Build the Request without Origin/Referer, exactly as the CSRF case in "[id]/precheck/route.test.ts" does,
  // and assert the status/code that csrfRejectedResponse() returns there.
});
```

- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run src/app/api/admin/platform-reviews/route.test.ts` → FAIL (module not found).

- [ ] **Step 3: Route**

`frontend/src/app/api/admin/platform-reviews/route.ts`:

```ts
import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess, type AdminAccessPrincipal } from "@/server/admin/auth";
import {
  PlatformReviewValidationError,
  createPlatformReview,
  createPlatformReviewFromMysql,
  effectivePlatformReviewsByFamily,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  validatePlatformReviewInput,
  type MysqlPlatformReviewsStore,
} from "@/server/admin/platform-reviews-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) return errorResponse(error.code, error.message, error.status);
  if (error instanceof PlatformReviewValidationError) return errorResponse("INVALID_REQUEST", error.issues.join("; "), 400);
  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;
  const client = await import("@/server/db/client");
  return client.db;
}

function actorUserIdForAdminAccess(access: AdminAccessPrincipal) {
  return access.kind === "admin" ? access.userId : null;
}

export function createAdminPlatformReviewsGet(database?: AppDatabase, mysql?: MysqlPlatformReviewsStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const store = shouldUseMysqlRuntime() ? mysql ?? (resolveMysqlPool() as unknown as MysqlPlatformReviewsStore) : null;
      const reviews = store ? await listPlatformReviewsFromMysql(store) : listPlatformReviews(resolvedDb);
      return NextResponse.json({ reviews, effective: effectivePlatformReviewsByFamily(reviews, new Date()) });
    } catch (error) {
      return routeError(error);
    }
  };
}

export function createAdminPlatformReviewsPost(database?: AppDatabase, mysql?: MysqlPlatformReviewsStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function POST(request: Request) {
    if (!verifyCsrfSafe(request)) return csrfRejectedResponse();

    try {
      const resolvedDb = await resolveDatabase(database);
      const access = await requireAdminAccess(resolvedDb, request, { roles: ["admin"] });
      const now = new Date();
      const input = validatePlatformReviewInput(await request.json().catch(() => null), now);
      const options = { actorUserId: actorUserIdForAdminAccess(access), now };
      const store = shouldUseMysqlRuntime() ? mysql ?? (resolveMysqlPool() as unknown as MysqlPlatformReviewsStore) : null;
      const review = store
        ? await createPlatformReviewFromMysql(store, input, options)
        : createPlatformReview(resolvedDb, input, options);
      return NextResponse.json({ review }, { status: 201 });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminPlatformReviewsGet();
export const POST = createAdminPlatformReviewsPost();
```

(If `resolveMysqlPool()`'s return type already satisfies `MysqlPlatformReviewsStore`, drop the `as unknown as` cast — the batch route passes the pool straight through, so it very likely does.)

- [ ] **Step 4: Registry + client**

In `frontend/src/server/auth/role-route-coverage.test.ts` add `"../../app/api/admin/platform-reviews/route.ts",` to `adminOnlyRoutes` in sorted position (after `.../data-sources/batch/route.ts`).

In `frontend/src/lib/api/admin.ts` add to the type-import block `import type { PlatformReview, EffectivePlatformReview, CreatePlatformReviewInput } from "@/server/admin/platform-reviews-repository";`, re-export them (`export type AdminPlatformReview = PlatformReview; export type AdminEffectivePlatformReview = EffectivePlatformReview; export type CreateAdminPlatformReviewInput = CreatePlatformReviewInput;`), and add:

```ts
export interface AdminPlatformReviewsResponse {
  reviews: AdminPlatformReview[];
  effective: Record<string, AdminEffectivePlatformReview>;
}

export async function listAdminPlatformReviews() {
  const response = await fetch("/api/admin/platform-reviews");
  return parseResponse<AdminPlatformReviewsResponse>(response);
}

export async function createAdminPlatformReview(input: CreateAdminPlatformReviewInput) {
  const response = await fetch("/api/admin/platform-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<{ review: AdminPlatformReview }>(response);
}
```

- [ ] **Step 5: Run tests** — `cd frontend && npx vitest run src/app/api/admin/platform-reviews src/server/auth/role-route-coverage.test.ts src/server/db/mysql-route-coverage.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/admin/platform-reviews/route.ts frontend/src/app/api/admin/platform-reviews/route.test.ts frontend/src/lib/api/admin.ts frontend/src/server/auth/role-route-coverage.test.ts
git commit -m "feat(admin): platform review API (list, create) and client helpers"
```

---

### Task 4: Precheck queue — repository, DTO field, precheck notes `baseUrl`, request route

**Files:**
- Create: `frontend/src/server/admin/precheck-queue.ts`
- Test: `frontend/src/server/admin/precheck-queue.test.ts`
- Modify: `frontend/src/server/admin/data-sources-repository.ts` (`AdminDataSource.precheckRequestedAt`; every place that maps a row to `AdminDataSource` and both MySQL `SELECT` column lists — find them with `grep -n "liveHealthReviewedAt\|live_health_reviewed_at" frontend/src/server/admin/data-sources-repository.ts`)
- Modify: `frontend/src/server/admin/source-precheck.ts` (notes gain `baseUrl`; new export `precheckBaseUrlFromNotes`) and `frontend/src/server/admin/source-precheck.test.ts`
- Create: `frontend/src/app/api/admin/data-sources/precheck-requests/route.ts` (+ `route.test.ts`)
- Modify: `frontend/src/lib/api/admin.ts` (helper `requestAdminSourcePrechecks`), `frontend/src/server/auth/role-route-coverage.test.ts` (`operatorMutationRoutes`)

**Interfaces:**
- Consumes: Task 1's column; `MysqlDataSourcesStore`, `AdminDataSource` from `./data-sources-repository`.
- Produces (used by Tasks 5, 6, 7, 8):

```ts
// precheck-queue.ts
export const PRECHECK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const LOCAL_JURISDICTION_LEVELS: readonly string[] = ["county", "city", "township", "special_district"];
export const MAX_REQUESTED_IDS = 500;
export class PrecheckRequestInputError extends Error {}
export interface RequestPrechecksInput { sourceIds?: string[]; providerFamily?: string | null; pending?: boolean }
export function normalizeRequestPrechecksInput(raw: unknown): RequestPrechecksInput          // throws PrecheckRequestInputError
export function isPrecheckFresh(liveHealthReviewedAt: string | null, now: Date): boolean       // within 14 days
export interface PendingCandidateRow { id: string; providerFamily: string | null; jurisdictionLevel: string | null; approvalStatus: string | null; isEnabled: boolean; liveHealthReviewedAt: string | null; precheckRequestedAt: string | null }
export function isPendingPrecheck(row: PendingCandidateRow, now: Date): boolean
export function selectPrecheckTargets(db: AppDatabase, input: RequestPrechecksInput, now: Date): string[]
export async function selectPrecheckTargetsFromMysql(mysql: MysqlDataSourcesStore, input: RequestPrechecksInput, now: Date): Promise<string[]>
export interface RequestPrechecksResult { requestedCount: number; sourceIds: string[] }
export function requestPrechecks(db: AppDatabase, input: RequestPrechecksInput, now: Date): RequestPrechecksResult
export async function requestPrechecksFromMysql(mysql: MysqlDataSourcesStore, input: RequestPrechecksInput, now: Date): Promise<RequestPrechecksResult>
export interface QueuedPrecheck { id: string; providerFamily: string | null; baseUrl: string | null; precheckRequestedAt: string }
export function listQueuedPrechecks(db: AppDatabase, limit?: number): QueuedPrecheck[]          // ORDER BY precheck_requested_at ASC, id ASC; default limit 200
export async function listQueuedPrechecksFromMysql(mysql: MysqlDataSourcesStore, limit?: number): Promise<QueuedPrecheck[]>
export function clearPrecheckRequest(db: AppDatabase, id: string, requestedAt: string): boolean  // only when the stored timestamp still equals requestedAt
export async function clearPrecheckRequestFromMysql(mysql: MysqlDataSourcesStore, id: string, requestedAt: string): Promise<boolean>
// source-precheck.ts
export function precheckBaseUrlFromNotes(notes: string | null): string | null
```

- [ ] **Step 1: Failing tests**

`frontend/src/server/admin/precheck-queue.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import {
  PrecheckRequestInputError,
  clearPrecheckRequest,
  clearPrecheckRequestFromMysql,
  isPendingPrecheck,
  isPrecheckFresh,
  listQueuedPrechecks,
  listQueuedPrechecksFromMysql,
  normalizeRequestPrechecksInput,
  requestPrechecks,
  requestPrechecksFromMysql,
  selectPrecheckTargets,
} from "./precheck-queue";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const FRESH = "2026-09-20T00:00:00.000Z"; // 9 days old
const STALE = "2026-09-01T00:00:00.000Z"; // 28 days old

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    issuerType: "county",
    stateCode: "MI",
    baseUrl: `https://www.bidnetdirect.com/mitn/${id}/solicitations/open-bids`,
    providerFamily: "bidnet",
    jurisdictionLevel: "county",
    isEnabled: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("pure rules", () => {
  it("isPrecheckFresh honours the 14-day window", () => {
    expect(isPrecheckFresh(null, NOW)).toBe(false);
    expect(isPrecheckFresh(FRESH, NOW)).toBe(true);
    expect(isPrecheckFresh(STALE, NOW)).toBe(false);
    expect(isPrecheckFresh("garbage", NOW)).toBe(false);
  });

  it.each([
    ["unapproved local, never prechecked", { approvalStatus: null, liveHealthReviewedAt: null }, true],
    ["needs_review local, stale precheck", { approvalStatus: "needs_review", liveHealthReviewedAt: STALE }, true],
    ["fresh precheck", { approvalStatus: null, liveHealthReviewedAt: FRESH }, false],
    ["already approved", { approvalStatus: "approved", liveHealthReviewedAt: null }, false],
    ["blocked", { approvalStatus: "blocked", liveHealthReviewedAt: null }, false],
    ["disabled", { approvalStatus: null, liveHealthReviewedAt: null, isEnabled: false }, false],
    ["already queued", { approvalStatus: null, liveHealthReviewedAt: null, precheckRequestedAt: NOW.toISOString() }, false],
    ["state level", { approvalStatus: null, liveHealthReviewedAt: null, jurisdictionLevel: "state" }, false],
  ])("isPendingPrecheck: %s", (_label, overrides, expected) => {
    expect(
      isPendingPrecheck(
        { id: "x", providerFamily: "bidnet", jurisdictionLevel: "county", approvalStatus: null, isEnabled: true, liveHealthReviewedAt: null, precheckRequestedAt: null, ...overrides },
        NOW,
      ),
    ).toBe(expected);
  });

  it("normalizeRequestPrechecksInput accepts ids or a pending family, nothing else", () => {
    expect(normalizeRequestPrechecksInput({ sourceIds: [" a ", "b", "a"] })).toEqual({ sourceIds: ["a", "b"], providerFamily: null, pending: false });
    expect(normalizeRequestPrechecksInput({ providerFamily: "BidNet", pending: true })).toEqual({ sourceIds: [], providerFamily: "bidnet", pending: true });
    expect(() => normalizeRequestPrechecksInput({})).toThrow(PrecheckRequestInputError);
    expect(() => normalizeRequestPrechecksInput({ providerFamily: "bidnet" })).toThrow(PrecheckRequestInputError);
    expect(() => normalizeRequestPrechecksInput({ sourceIds: Array.from({ length: 501 }, (_, i) => `s${i}`) })).toThrow(PrecheckRequestInputError);
  });
});

describe("SQLite queue", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      row("bidnet_mi_a"),
      row("bidnet_mi_b", { liveHealthReviewedAt: FRESH }),
      row("bidnet_mi_c", { approvalStatus: "approved" }),
      row("bidnet_mi_d", { liveHealthReviewedAt: STALE, approvalStatus: "needs_review" }),
      row("bonfire_oh_e", { providerFamily: "bonfire" }),
      row("state_mi", { jurisdictionLevel: "state", issuerType: "state" }),
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("selects and marks the pending sources of a family", () => {
    expect(selectPrecheckTargets(testDb.db, { providerFamily: "bidnet", pending: true }, NOW)).toEqual(["bidnet_mi_a", "bidnet_mi_d"]);
    const result = requestPrechecks(testDb.db, { providerFamily: "bidnet", pending: true }, NOW);
    expect(result).toEqual({ requestedCount: 2, sourceIds: ["bidnet_mi_a", "bidnet_mi_d"] });
    expect(listQueuedPrechecks(testDb.db).map((entry) => entry.id)).toEqual(["bidnet_mi_a", "bidnet_mi_d"]);
    // idempotent: nothing new the second time
    expect(requestPrechecks(testDb.db, { providerFamily: "bidnet", pending: true }, NOW).requestedCount).toBe(0);
  });

  it("marks explicit ids regardless of freshness but never twice, ignoring unknown ids", () => {
    const result = requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_b", "bidnet_mi_c", "nope"] }, NOW);
    expect(result.sourceIds).toEqual(["bidnet_mi_b", "bidnet_mi_c"]);
    expect(requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_b"] }, NOW).requestedCount).toBe(0);
  });

  it("lists oldest request first and clears only a matching timestamp", () => {
    requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_b"] }, new Date("2026-09-29T09:00:00.000Z"));
    requestPrechecks(testDb.db, { sourceIds: ["bidnet_mi_a"] }, NOW);
    const queued = listQueuedPrechecks(testDb.db);
    expect(queued.map((entry) => entry.id)).toEqual(["bidnet_mi_a", "bidnet_mi_b"]);
    expect(queued[0]).toMatchObject({ providerFamily: "bidnet", baseUrl: expect.stringContaining("bidnet_mi_a") });
    expect(clearPrecheckRequest(testDb.db, "bidnet_mi_a", "2000-01-01T00:00:00.000Z")).toBe(false);
    expect(clearPrecheckRequest(testDb.db, "bidnet_mi_a", NOW.toISOString())).toBe(true);
    expect(listQueuedPrechecks(testDb.db).map((entry) => entry.id)).toEqual(["bidnet_mi_b"]);
  });
});

describe("MySQL twins", () => {
  it("selects with the pending predicate, updates only unmarked ids, lists and clears", async () => {
    const query = vi.fn(async (_sql: string) => [
      { id: "bidnet_mi_a", provider_family: "bidnet", jurisdiction_level: "county", approval_status: null, is_enabled: 1, live_health_reviewed_at: null, precheck_requested_at: null, base_url: "https://x/a" },
      { id: "bidnet_mi_b", provider_family: "bidnet", jurisdiction_level: "county", approval_status: null, is_enabled: 1, live_health_reviewed_at: FRESH, precheck_requested_at: null, base_url: "https://x/b" },
    ]);
    const execute = vi.fn(async () => ({ affectedRows: 1 }));
    const store = { query, execute } as never;

    const result = await requestPrechecksFromMysql(store, { providerFamily: "bidnet", pending: true }, NOW);
    expect(result.sourceIds).toEqual(["bidnet_mi_a"]);
    const update = execute.mock.calls[0];
    expect(String(update[1])).toContain("UPDATE data_sources SET precheck_requested_at = ?");
    expect(String(update[1])).toContain("AND precheck_requested_at IS NULL");

    query.mockResolvedValueOnce([{ id: "bidnet_mi_a", provider_family: "bidnet", base_url: "https://x/a", precheck_requested_at: NOW.toISOString() }]);
    expect(await listQueuedPrechecksFromMysql(store)).toEqual([{ id: "bidnet_mi_a", providerFamily: "bidnet", baseUrl: "https://x/a", precheckRequestedAt: NOW.toISOString() }]);

    execute.mockResolvedValueOnce({ affectedRows: 0 } as never);
    expect(await clearPrecheckRequestFromMysql(store, "bidnet_mi_a", "stale")).toBe(false);
  });
});
```

Add to `frontend/src/server/admin/source-precheck.test.ts` (inside its existing `describe`, reusing its fixtures):

```ts
it("records the fetched base_url in the precheck notes", async () => {
  await runSourcePrecheck({ database: testDb.db, sourceId: SOURCE_ID, now: NOW, runCrawlTask, discoverTenant, scanCompliance });
  const stored = testDb.db.select({ notes: dataSources.liveHealthNotes }).from(dataSources).where(eq(dataSources.id, SOURCE_ID)).get();
  expect(precheckBaseUrlFromNotes(stored?.notes ?? null)).toBe(BASE_URL);
});

it("precheckBaseUrlFromNotes tolerates garbage", () => {
  expect(precheckBaseUrlFromNotes(null)).toBeNull();
  expect(precheckBaseUrlFromNotes("not json")).toBeNull();
  expect(precheckBaseUrlFromNotes(JSON.stringify({ precheck: { verdict: "ready" } }))).toBeNull();
});
```

(`SOURCE_ID`, `BASE_URL`, `runCrawlTask`, `discoverTenant`, `scanCompliance` are whatever names that test file already uses for its seeded source and fakes — reuse them.)

`frontend/src/app/api/admin/data-sources/precheck-requests/route.test.ts` — same preamble as the batch route test; cases: (a) `{ providerFamily: "bidnet", pending: true }` marks the two pending rows and answers `{ requestedCount: 2, sourceIds: [...] }`; (b) `{ sourceIds: ["x"] }` for an unknown id answers `{ requestedCount: 0, sourceIds: [] }`; (c) `{}` → 400 `INVALID_REQUEST`; (d) missing Origin → CSRF rejection; (e) support role → 403 (stub the guard).

- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run src/server/admin/precheck-queue.test.ts src/server/admin/source-precheck.test.ts "src/app/api/admin/data-sources/precheck-requests"` → FAIL.

- [ ] **Step 3: `precheck-queue.ts`**

```ts
import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import type { MysqlDataSourcesStore } from "./data-sources-repository";

/** Spec 2026-09-24 §7.3 check 2: a precheck older than this cannot back a batch approval. */
export const PRECHECK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const LOCAL_JURISDICTION_LEVELS: readonly string[] = ["county", "city", "township", "special_district"];
export const MAX_REQUESTED_IDS = 500;
const FAMILY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export class PrecheckRequestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrecheckRequestInputError";
  }
}

export interface RequestPrechecksInput {
  sourceIds?: string[];
  providerFamily?: string | null;
  pending?: boolean;
}

export function normalizeRequestPrechecksInput(raw: unknown): RequestPrechecksInput {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sourceIds = Array.isArray(body.sourceIds)
    ? Array.from(new Set(body.sourceIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)))
    : [];
  const providerFamily = typeof body.providerFamily === "string" ? body.providerFamily.trim().toLowerCase() : null;
  const pending = body.pending === true;

  if (sourceIds.length > MAX_REQUESTED_IDS) throw new PrecheckRequestInputError(`at most ${MAX_REQUESTED_IDS} sourceIds per request`);
  if (providerFamily !== null && !FAMILY_PATTERN.test(providerFamily)) throw new PrecheckRequestInputError("providerFamily must be a lowercase slug");
  if (sourceIds.length === 0 && !(providerFamily && pending)) {
    throw new PrecheckRequestInputError("pass sourceIds, or providerFamily together with pending: true");
  }
  return { sourceIds, providerFamily, pending };
}

export function isPrecheckFresh(liveHealthReviewedAt: string | null, now: Date): boolean {
  if (!liveHealthReviewedAt) return false;
  const at = Date.parse(liveHealthReviewedAt);
  return Number.isFinite(at) && now.getTime() - at <= PRECHECK_MAX_AGE_MS;
}

export interface PendingCandidateRow {
  id: string;
  providerFamily: string | null;
  jurisdictionLevel: string | null;
  approvalStatus: string | null;
  isEnabled: boolean;
  liveHealthReviewedAt: string | null;
  precheckRequestedAt: string | null;
}

/** "Awaiting precheck" (plan Global Constraints): local, enabled, not approved/blocked, not queued, no fresh precheck. */
export function isPendingPrecheck(row: PendingCandidateRow, now: Date): boolean {
  return (
    LOCAL_JURISDICTION_LEVELS.includes(row.jurisdictionLevel ?? "") &&
    row.isEnabled &&
    (row.approvalStatus === null || row.approvalStatus === "needs_review") &&
    row.precheckRequestedAt === null &&
    !isPrecheckFresh(row.liveHealthReviewedAt, now)
  );
}

function candidateFromDrizzle(row: typeof dataSources.$inferSelect): PendingCandidateRow {
  return {
    id: row.id,
    providerFamily: row.providerFamily ?? null,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    approvalStatus: row.approvalStatus ?? null,
    isEnabled: row.isEnabled === 1,
    liveHealthReviewedAt: row.liveHealthReviewedAt ?? null,
    precheckRequestedAt: row.precheckRequestedAt ?? null,
  };
}

export function selectPrecheckTargets(db: AppDatabase, input: RequestPrechecksInput, now: Date): string[] {
  if (input.sourceIds && input.sourceIds.length > 0) {
    return db
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(and(inArray(dataSources.id, input.sourceIds), isNull(dataSources.precheckRequestedAt)))
      .orderBy(asc(dataSources.id))
      .all()
      .map((row) => row.id);
  }
  const rows = db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.providerFamily, input.providerFamily ?? ""),
        inArray(dataSources.jurisdictionLevel, [...LOCAL_JURISDICTION_LEVELS]),
        eq(dataSources.isEnabled, 1),
        or(isNull(dataSources.approvalStatus), eq(dataSources.approvalStatus, "needs_review")),
        isNull(dataSources.precheckRequestedAt),
      ),
    )
    .orderBy(asc(dataSources.id))
    .all();
  return rows.map(candidateFromDrizzle).filter((row) => isPendingPrecheck(row, now)).map((row) => row.id);
}

export interface RequestPrechecksResult {
  requestedCount: number;
  sourceIds: string[];
}

export function requestPrechecks(db: AppDatabase, input: RequestPrechecksInput, now: Date): RequestPrechecksResult {
  const ids = selectPrecheckTargets(db, input, now);
  if (ids.length > 0) {
    db.update(dataSources)
      .set({ precheckRequestedAt: now.toISOString(), updatedAt: now.toISOString() })
      .where(and(inArray(dataSources.id, ids), isNull(dataSources.precheckRequestedAt)))
      .run();
  }
  return { requestedCount: ids.length, sourceIds: ids };
}

interface MysqlCandidateRow {
  id: string;
  provider_family: string | null;
  jurisdiction_level: string | null;
  approval_status: string | null;
  is_enabled: number;
  live_health_reviewed_at: string | null;
  precheck_requested_at: string | null;
}

const MYSQL_CANDIDATE_COLUMNS = "id, provider_family, jurisdiction_level, approval_status, is_enabled, live_health_reviewed_at, precheck_requested_at";

function placeholders(count: number) {
  return Array.from({ length: count }, () => "?").join(", ");
}

export async function selectPrecheckTargetsFromMysql(
  mysql: MysqlDataSourcesStore,
  input: RequestPrechecksInput,
  now: Date,
): Promise<string[]> {
  if (input.sourceIds && input.sourceIds.length > 0) {
    const rows = await mysqlSelectMany<{ id: string }>(
      mysql,
      `SELECT id FROM data_sources WHERE id IN (${placeholders(input.sourceIds.length)}) AND precheck_requested_at IS NULL ORDER BY id`,
      input.sourceIds,
    );
    return rows.map((row) => row.id);
  }
  const rows = await mysqlSelectMany<MysqlCandidateRow>(
    mysql,
    `SELECT ${MYSQL_CANDIDATE_COLUMNS} FROM data_sources
      WHERE provider_family = ?
        AND jurisdiction_level IN (${placeholders(LOCAL_JURISDICTION_LEVELS.length)})
        AND is_enabled = 1
        AND (approval_status IS NULL OR approval_status = 'needs_review')
        AND precheck_requested_at IS NULL
      ORDER BY id`,
    [input.providerFamily ?? "", ...LOCAL_JURISDICTION_LEVELS],
  );
  return rows
    .map((row) => ({
      id: row.id,
      providerFamily: row.provider_family,
      jurisdictionLevel: row.jurisdiction_level,
      approvalStatus: row.approval_status,
      isEnabled: row.is_enabled === 1,
      liveHealthReviewedAt: row.live_health_reviewed_at,
      precheckRequestedAt: row.precheck_requested_at,
    }))
    .filter((row) => isPendingPrecheck(row, now))
    .map((row) => row.id);
}

export async function requestPrechecksFromMysql(
  mysql: MysqlDataSourcesStore,
  input: RequestPrechecksInput,
  now: Date,
): Promise<RequestPrechecksResult> {
  const ids = await selectPrecheckTargetsFromMysql(mysql, input, now);
  for (let start = 0; start < ids.length; start += 200) {
    const chunk = ids.slice(start, start + 200);
    await mysqlExecute(
      mysql,
      `UPDATE data_sources SET precheck_requested_at = ?, updated_at = ? WHERE id IN (${placeholders(chunk.length)}) AND precheck_requested_at IS NULL`,
      [now.toISOString(), now.toISOString(), ...chunk] as never[],
    );
  }
  return { requestedCount: ids.length, sourceIds: ids };
}

export interface QueuedPrecheck {
  id: string;
  providerFamily: string | null;
  baseUrl: string | null;
  precheckRequestedAt: string;
}

export function listQueuedPrechecks(db: AppDatabase, limit = 200): QueuedPrecheck[] {
  return db
    .select({ id: dataSources.id, providerFamily: dataSources.providerFamily, baseUrl: dataSources.baseUrl, precheckRequestedAt: dataSources.precheckRequestedAt })
    .from(dataSources)
    .where(isNotNull(dataSources.precheckRequestedAt))
    .orderBy(asc(dataSources.precheckRequestedAt), asc(dataSources.id))
    .limit(limit)
    .all()
    .map((row) => ({ id: row.id, providerFamily: row.providerFamily ?? null, baseUrl: row.baseUrl ?? null, precheckRequestedAt: row.precheckRequestedAt as string }));
}

export async function listQueuedPrechecksFromMysql(mysql: MysqlDataSourcesStore, limit = 200): Promise<QueuedPrecheck[]> {
  const rows = await mysqlSelectMany<{ id: string; provider_family: string | null; base_url: string | null; precheck_requested_at: string }>(
    mysql,
    `SELECT id, provider_family, base_url, precheck_requested_at FROM data_sources
      WHERE precheck_requested_at IS NOT NULL ORDER BY precheck_requested_at ASC, id ASC LIMIT ${Math.max(1, Math.floor(limit))}`,
    [],
  );
  return rows.map((row) => ({ id: row.id, providerFamily: row.provider_family ?? null, baseUrl: row.base_url ?? null, precheckRequestedAt: row.precheck_requested_at }));
}

export function clearPrecheckRequest(db: AppDatabase, id: string, requestedAt: string): boolean {
  const result = db
    .update(dataSources)
    .set({ precheckRequestedAt: null })
    .where(and(eq(dataSources.id, id), eq(dataSources.precheckRequestedAt, requestedAt)))
    .run();
  return result.changes > 0;
}

export async function clearPrecheckRequestFromMysql(mysql: MysqlDataSourcesStore, id: string, requestedAt: string): Promise<boolean> {
  const result = await mysqlExecute(
    mysql,
    "UPDATE data_sources SET precheck_requested_at = NULL WHERE id = ? AND precheck_requested_at = ?",
    [id, requestedAt] as never[],
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
}
```

(If `mysqlExecute`'s return type differs, read `frontend/src/server/db/mysql-runtime.ts` and adapt the `affectedRows` read; if `MysqlDataSourcesStore` lacks a method these helpers need, widen the parameter type to `Parameters<typeof mysqlSelectMany>[0] & Parameters<typeof mysqlExecute>[0]`.)

- [ ] **Step 4: DTO + notes + route + client + registry**

1. `data-sources-repository.ts`: add `precheckRequestedAt: string | null;` to `AdminDataSource` after `liveHealthReviewedAt`; in every row→DTO mapping add `precheckRequestedAt: row.precheckRequestedAt ?? null` (Drizzle) / `row.precheck_requested_at ?? null` (MySQL) and add `precheck_requested_at` to both MySQL `SELECT` column lists that feed `AdminDataSource`. Run `npx vitest run src/server/admin/data-sources-repository.test.ts` to confirm nothing else asserts the full DTO shape (fix any `toEqual` on the full object by adding the field).
2. `source-precheck.ts`: in the `writeBack.liveHealth.notes` JSON add `baseUrl: source.baseUrl,` as the first key of `precheck`; export:

```ts
/** The base_url a stored precheck actually fetched (spec §7.3 check 3); null for pre-phase-3 notes. */
export function precheckBaseUrlFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as { precheck?: { baseUrl?: unknown } };
    return typeof parsed?.precheck?.baseUrl === "string" ? parsed.precheck.baseUrl : null;
  } catch {
    return null;
  }
}
```

3. `frontend/src/app/api/admin/data-sources/precheck-requests/route.ts` — same skeleton as the batch route (`errorResponse`, `routeError`, `resolveDatabase`, `shouldUseMysqlRuntime`), `PrecheckRequestInputError` → 400 `INVALID_REQUEST`:

```ts
export function createAdminPrecheckRequestsPost(database?: AppDatabase, mysql?: MysqlDataSourcesStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function POST(request: Request) {
    if (!verifyCsrfSafe(request)) return csrfRejectedResponse();

    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });
      const input = normalizeRequestPrechecksInput(await request.json().catch(() => null));
      const now = new Date();
      const store = shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : null;
      const result = store ? await requestPrechecksFromMysql(store, input, now) : requestPrechecks(resolvedDb, input, now);
      return NextResponse.json(result);
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createAdminPrecheckRequestsPost();
```

4. `admin.ts` client: 

```ts
export interface RequestAdminSourcePrechecksInput { sourceIds?: string[]; providerFamily?: string; pending?: boolean }
export interface RequestAdminSourcePrechecksResponse { requestedCount: number; sourceIds: string[] }

export async function requestAdminSourcePrechecks(input: RequestAdminSourcePrechecksInput) {
  const response = await fetch("/api/admin/data-sources/precheck-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse<RequestAdminSourcePrechecksResponse>(response);
}
```

5. `role-route-coverage.test.ts`: add `"../../app/api/admin/data-sources/precheck-requests/route.ts",` to `operatorMutationRoutes` (sorted, after `.../[id]/precheck/route.ts`).

- [ ] **Step 5: Run tests** — `cd frontend && npx vitest run src/server/admin "src/app/api/admin/data-sources" src/server/auth/role-route-coverage.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/server/admin/precheck-queue.ts frontend/src/server/admin/precheck-queue.test.ts frontend/src/server/admin/data-sources-repository.ts frontend/src/server/admin/source-precheck.ts frontend/src/server/admin/source-precheck.test.ts "frontend/src/app/api/admin/data-sources/precheck-requests/route.ts" "frontend/src/app/api/admin/data-sources/precheck-requests/route.test.ts" frontend/src/lib/api/admin.ts frontend/src/server/auth/role-route-coverage.test.ts
git commit -m "feat(admin): precheck queue flag, request route and base_url provenance in precheck notes"
```

---

### Task 5: `npm run source:precheck` (queue marking script)

**Files:**
- Create: `frontend/scripts/source-precheck.ts`
- Test: `frontend/scripts/source-precheck.test.ts`
- Modify: `frontend/package.json` (`"source:precheck": "tsx scripts/source-precheck.ts",` right after `"source:register"`)

**Interfaces:**
- Consumes: Task 4's `normalizeRequestPrechecksInput`, `selectPrecheckTargets(FromMysql)`, `requestPrechecks(FromMysql)`.
- Produces: `parseSourcePrecheckArgs(argv: string[]): SourcePrecheckArgs`, `formatSourcePrecheckHelp(): string`, `runSourcePrecheckCommand(args, deps): Promise<RequestPrechecksResult>` where `deps = { database?: AppDatabase; mysql?: MysqlDataSourcesStore; now?: Date; log?: (line: string) => void }`.

- [ ] **Step 1: Failing tests** (`frontend/scripts/source-precheck.test.ts`, mirroring `register-sources.test.ts`'s `createTestDatabase` usage):

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { dataSources } from "../src/server/db/schema";
import { formatSourcePrecheckHelp, parseSourcePrecheckArgs, runSourcePrecheckCommand } from "./source-precheck";

const NOW = new Date("2026-09-29T08:00:00.000Z");

describe("parseSourcePrecheckArgs", () => {
  it("reads --provider/--pending, repeatable --source, --dry-run, both flag spellings", () => {
    expect(parseSourcePrecheckArgs(["--provider", "bidnet", "--pending"])).toEqual({ providerFamily: "bidnet", pending: true, sourceIds: [], dryRun: false, help: false });
    expect(parseSourcePrecheckArgs(["--provider=bidnet", "--pending", "--dry-run"])).toMatchObject({ providerFamily: "bidnet", dryRun: true });
    expect(parseSourcePrecheckArgs(["--source", "a", "--source=b"])).toMatchObject({ sourceIds: ["a", "b"] });
    expect(parseSourcePrecheckArgs(["--help"]).help).toBe(true);
  });

  it("rejects unknown flags and a provider without --pending", () => {
    expect(() => parseSourcePrecheckArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(() => parseSourcePrecheckArgs(["--provider", "bidnet"])).toThrow(/--pending/);
    expect(formatSourcePrecheckHelp()).toContain("--pending");
  });
});

describe("runSourcePrecheckCommand (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      { id: "bidnet_mi_a", label: "A", issuerType: "county", stateCode: "MI", providerFamily: "bidnet", jurisdictionLevel: "county", isEnabled: 1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
      { id: "bidnet_mi_b", label: "B", issuerType: "county", stateCode: "MI", providerFamily: "bidnet", jurisdictionLevel: "county", isEnabled: 1, approvalStatus: "approved", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("dry-run lists without writing; the real run marks and reports", async () => {
    const lines: string[] = [];
    const dry = await runSourcePrecheckCommand(parseSourcePrecheckArgs(["--provider", "bidnet", "--pending", "--dry-run"]), { database: testDb.db, now: NOW, log: (line) => lines.push(line) });
    expect(dry).toEqual({ requestedCount: 1, sourceIds: ["bidnet_mi_a"] });
    expect(lines.join("\n")).toContain("Dry run");
    expect(testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).all().every((row) => row.at === null)).toBe(true);

    const real = await runSourcePrecheckCommand(parseSourcePrecheckArgs(["--provider", "bidnet", "--pending"]), { database: testDb.db, now: NOW, log: (line) => lines.push(line) });
    expect(real.sourceIds).toEqual(["bidnet_mi_a"]);
    expect(lines.at(-1)).toContain("Queued 1");
  });
});
```

- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run scripts/source-precheck.test.ts` → FAIL.

- [ ] **Step 3: Script**

```ts
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import type { MysqlDataSourcesStore } from "../src/server/admin/data-sources-repository";
import {
  normalizeRequestPrechecksInput,
  requestPrechecks,
  requestPrechecksFromMysql,
  selectPrecheckTargets,
  selectPrecheckTargetsFromMysql,
  type RequestPrechecksResult,
} from "../src/server/admin/precheck-queue";

export interface SourcePrecheckArgs {
  providerFamily: string | null;
  pending: boolean;
  sourceIds: string[];
  dryRun: boolean;
  help: boolean;
}

export function formatSourcePrecheckHelp(): string {
  return [
    "Usage: npm run source:precheck -- [--provider <family> --pending] [--source <id> ...] [--dry-run]",
    "",
    "Marks data_sources.precheck_requested_at (spec 2026-09-24 §7.2). Nothing is fetched here: the",
    "crawler worker runs the queued prechecks within the platform budget and clears the flag.",
    "",
    "  --provider <family>   platform (provider_family), e.g. bidnet; requires --pending",
    "  --pending             every local source of that platform awaiting a precheck (unapproved,",
    "                        enabled, not yet queued, no precheck within 14 days)",
    "  --source <id>         queue one source id (repeatable)",
    "  --dry-run             print what would be queued, write nothing",
    "",
    "Example: npm run source:precheck -- --provider bidnet --pending",
  ].join("\n");
}

export function parseSourcePrecheckArgs(argv: string[]): SourcePrecheckArgs {
  const args: SourcePrecheckArgs = { providerFamily: null, pending: false, sourceIds: [], dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inline] = raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      index += 1;
      if (index >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[index];
    };
    if (flag === "--provider") args.providerFamily = value().trim().toLowerCase();
    else if (flag === "--source") args.sourceIds.push(value().trim());
    else if (flag === "--pending") args.pending = true;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown argument: ${raw}`);
  }
  if (!args.help && args.providerFamily && !args.pending) throw new Error("--provider requires --pending (only the pending set is queued platform-wide)");
  if (!args.help && !args.providerFamily && args.sourceIds.length === 0) throw new Error("pass --source <id> or --provider <family> --pending");
  return args;
}

export interface SourcePrecheckCommandDeps {
  database?: AppDatabase;
  mysql?: MysqlDataSourcesStore;
  now?: Date;
  log?: (line: string) => void;
}

export async function runSourcePrecheckCommand(args: SourcePrecheckArgs, deps: SourcePrecheckCommandDeps): Promise<RequestPrechecksResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? new Date();
  const input = normalizeRequestPrechecksInput({ sourceIds: args.sourceIds, providerFamily: args.providerFamily, pending: args.pending });
  const dialect = deps.mysql ? "MySQL" : "SQLite";

  if (args.dryRun) {
    const ids = deps.mysql ? await selectPrecheckTargetsFromMysql(deps.mysql, input, now) : selectPrecheckTargets(deps.database as AppDatabase, input, now);
    log(`Dry run (${dialect}): ${ids.length} sources would be queued`);
    for (const id of ids) log(`  ${id}`);
    return { requestedCount: ids.length, sourceIds: ids };
  }

  const result = deps.mysql ? await requestPrechecksFromMysql(deps.mysql, input, now) : requestPrechecks(deps.database as AppDatabase, input, now);
  const preview = result.sourceIds.slice(0, 20).join(", ") + (result.sourceIds.length > 20 ? ", …" : "");
  log(`Queued ${result.requestedCount} sources for precheck (${dialect})${preview ? `: ${preview}` : ""}`);
  return result;
}

async function main() {
  let args: SourcePrecheckArgs;
  try {
    args = parseSourcePrecheckArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error(formatSourcePrecheckHelp());
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(formatSourcePrecheckHelp());
    return;
  }

  if (isMysqlDatabaseUrlConfigured()) {
    try {
      await runSourcePrecheckCommand(args, { mysql: resolveMysqlPool() });
    } finally {
      await closeResolvedMysqlPool();
    }
    return;
  }

  const db = createDatabase();
  runMigrations(db);
  try {
    await runSourcePrecheckCommand(args, { database: db });
  } finally {
    db.$client.close();
  }
}

if (process.argv[1]?.endsWith("source-precheck.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
```

Note (as with `register-sources.ts`): the script does not load `.env.local`; export `DATABASE_URL` to target MySQL.

- [ ] **Step 4: package.json + tests** — add the script entry; run `cd frontend && npx vitest run scripts/source-precheck.test.ts` → PASS; run `npm run source:precheck -- --help` → prints the help, exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/source-precheck.ts frontend/scripts/source-precheck.test.ts frontend/package.json
git commit -m "feat(scripts): npm run source:precheck marks the precheck queue"
```

---

### Task 6: Worker runs the precheck queue on the tick's leftover budget

**Files:**
- Modify: `frontend/src/server/admin/crawler-robots-fetch.ts` (add `createCachedRobotsFetch`) + Test: `frontend/src/server/admin/crawler-robots-fetch.test.ts` (create if absent)
- Create: `frontend/src/server/crawler/precheck-queue-runner.ts` + Test: `frontend/src/server/crawler/precheck-queue-runner.test.ts`
- Modify: `frontend/src/server/crawler/configured-runner.ts` (`platformBudget` option, ~lines 42-61 and ~97) + `frontend/src/server/crawler/configured-runner.test.ts`
- Modify: `frontend/scripts/crawler-worker.ts` (tick loop ~lines 253-268)

**Interfaces:**
- Consumes: Task 4's `listQueuedPrechecks(FromMysql)`, `clearPrecheckRequest(FromMysql)`; `runSourcePrecheck` + `RunSourcePrecheckOptions` from `@/server/admin/source-precheck`; `scanSourceCompliance` from `@/server/source-validity/robots-compliance-scan`; `PlatformTickBudget` (`isBudgeted(family)`, `reserve(family, cost): number | null`, `settle(family, reserved, actual)`), `PlatformPauseRegistry` (`pause(family, untilMs)`, `pausedUntil(family, nowMs)`), `platformPauseMs()`, `platformBudgetsFromEnv()` from `@/server/crawler/platform-budget`.
- Produces:

```ts
// crawler-robots-fetch.ts
export function createCachedRobotsFetch(inner: typeof fetch): typeof fetch & { hits: () => number; misses: () => number };
// precheck-queue-runner.ts
export const PRECHECK_BUDGET_COST = 2;        // robots.txt + one list page
export const PRECHECK_DISCOVERY_COST = 6;     // tenant probe after a 404 (DISCOVERY_MAX_REQUESTS in source-precheck.ts)
export const DEFAULT_PRECHECKS_PER_TICK = 50;
export function precheckRequestCost(result: SourcePrecheckResult): number;
export interface QueuedPrecheckOutcome { sourceId: string; providerFamily: string | null; outcome: "done" | "challenge" | "error"; verdict: SourcePrecheckVerdict | null; error: string | null }
export interface RunQueuedPrechecksOnceResult { queued: number; processed: QueuedPrecheckOutcome[]; skipped: { budget: number; paused: number }; stoppedFamilies: string[] }
export interface RunQueuedPrechecksOnceOptions { database: AppDatabase; mysql?: MysqlDataSourcesStore; now?: Date; budget: PlatformTickBudget; pauses: PlatformPauseRegistry; clock?: () => number; pauseMs?: number; maxPerTick?: number; runSourcePrecheck?: typeof runSourcePrecheck; robotsFetch?: typeof fetch }
export async function runQueuedPrechecksOnce(options: RunQueuedPrechecksOnceOptions): Promise<RunQueuedPrechecksOnceResult>;
// configured-runner.ts
RunConfiguredCrawlerSourcesOnceOptions.platformBudget?: PlatformTickBudget   // shared with the precheck step; default: constructed as today
```

- [ ] **Step 1: Failing tests**

`frontend/src/server/admin/crawler-robots-fetch.test.ts` (append if the file exists):

```ts
import { describe, expect, it, vi } from "vitest";
import { createCachedRobotsFetch } from "./crawler-robots-fetch";

describe("createCachedRobotsFetch", () => {
  it("fetches each robots URL once per instance and replays the body", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) =>
      new Response(`body for ${String(input)}`, { status: 200, headers: { "content-type": "text/plain" } }));
    const cached = createCachedRobotsFetch(inner as unknown as typeof fetch);

    const first = await cached("https://www.bidnetdirect.com/robots.txt");
    const second = await cached("https://www.bidnetdirect.com/robots.txt");
    const other = await cached("https://bonfirehub.com/robots.txt");

    expect(inner).toHaveBeenCalledTimes(2);
    expect(await first.text()).toBe("body for https://www.bidnetdirect.com/robots.txt");
    expect(await second.text()).toBe("body for https://www.bidnetdirect.com/robots.txt");
    expect(second.headers.get("content-type")).toBe("text/plain");
    expect(await other.text()).toContain("bonfirehub");
    expect(cached.hits()).toBe(1);
    expect(cached.misses()).toBe(2);
  });
});
```

`frontend/src/server/crawler/precheck-queue-runner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import type { SourcePrecheckResult } from "@/server/admin/source-precheck";
import { PlatformPauseRegistry, PlatformTickBudget } from "./platform-budget";
import { PRECHECK_BUDGET_COST, PRECHECK_DISCOVERY_COST, precheckRequestCost, runQueuedPrechecksOnce } from "./precheck-queue-runner";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const TICK_MS = 15 * 60 * 1000;

function precheck(sourceId: string, overrides: Partial<SourcePrecheckResult["fetch"]> = {}, verdict: SourcePrecheckResult["verdict"] = "ready"): SourcePrecheckResult {
  return {
    sourceId, checkedAt: NOW.toISOString(), verdict, reasons: [],
    robots: { status: "clear", flagged: false, flagReason: null },
    fetch: { status: "ok", items: 3, sample: [], listMethod: "scrapling", errorCode: null, errorMessage: null, httpStatus: 200, wafChallenge: false, ...overrides },
    suggestedBaseUrl: null,
  };
}

function row(id: string, family: string, requestedAt: string) {
  return { id, label: id, issuerType: "county", stateCode: "MI", providerFamily: family, jurisdictionLevel: "county", isEnabled: 1, baseUrl: `https://x/${id}`, precheckRequestedAt: requestedAt, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
}

describe("runQueuedPrechecksOnce", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([
      row("bidnet_a", "bidnet", "2026-09-29T07:00:00.000Z"),
      row("bidnet_b", "bidnet", "2026-09-29T07:01:00.000Z"),
      row("bidnet_c", "bidnet", "2026-09-29T07:02:00.000Z"),
      row("bonfire_d", "bonfire", "2026-09-29T07:03:00.000Z"),
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("processes in request order, clears finished flags, stops a family on a WAF challenge and pauses it", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: { sourceId: string }) =>
      sourceId === "bidnet_b" ? precheck(sourceId, { status: "failed", httpStatus: 202, wafChallenge: true }, "needs_fix") : precheck(sourceId));
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS); // 15 per tick
    const pauses = new PlatformPauseRegistry();

    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses, clock: () => NOW.getTime(), pauseMs: 1000, runSourcePrecheck, robotsFetch: vi.fn() as never });

    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bidnet_a", "bidnet_b", "bonfire_d"]);
    expect(typeof runSourcePrecheck.mock.calls[0][0].scanCompliance).toBe("function");
    expect(result.processed.map((entry) => [entry.sourceId, entry.outcome])).toEqual([["bidnet_a", "done"], ["bidnet_b", "challenge"], ["bonfire_d", "done"]]);
    expect(result.skipped).toEqual({ budget: 0, paused: 1 });
    expect(result.stoppedFamilies).toEqual(["bidnet"]);
    expect(pauses.pausedUntil("bidnet", NOW.getTime())).not.toBeNull();

    const flags = Object.fromEntries(testDb.db.select({ id: dataSources.id, at: dataSources.precheckRequestedAt }).from(dataSources).all().map((entry) => [entry.id, entry.at]));
    expect(flags.bidnet_a).toBeNull();
    expect(flags.bidnet_b).not.toBeNull(); // challenge: retried after the pause
    expect(flags.bidnet_c).not.toBeNull(); // never reached this tick
    expect(flags.bonfire_d).toBeNull();
  });

  it("skips a budgeted family whose tick allowance is exhausted and leaves the flag", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: { sourceId: string }) => precheck(sourceId));
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS); // 15 per tick …
    expect(budget.reserve("bidnet", 15)).toBe(15);                              // … all spent by the daily lists
    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never });
    expect(result.skipped.budget).toBe(3);
    expect(runSourcePrecheck.mock.calls.map((call) => call[0].sourceId)).toEqual(["bonfire_d"]);
  });

  it("settles the budget with the discovery cost after a 404 and keeps an errored source queued", async () => {
    const runSourcePrecheck = vi.fn(async ({ sourceId }: { sourceId: string }) => {
      if (sourceId === "bidnet_a") return precheck(sourceId, { status: "failed", httpStatus: 404 }, "needs_fix");
      if (sourceId === "bidnet_b") throw new Error("python3 not found");
      return precheck(sourceId);
    });
    const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), TICK_MS);
    const settle = vi.spyOn(budget, "settle");
    const result = await runQueuedPrechecksOnce({ database: testDb.db, now: NOW, budget, pauses: new PlatformPauseRegistry(), runSourcePrecheck, robotsFetch: vi.fn() as never });
    expect(settle).toHaveBeenCalledWith("bidnet", PRECHECK_BUDGET_COST, PRECHECK_BUDGET_COST + PRECHECK_DISCOVERY_COST);
    expect(result.processed.find((entry) => entry.sourceId === "bidnet_b")).toMatchObject({ outcome: "error", error: "python3 not found" });
    const flag = testDb.db.select({ at: dataSources.precheckRequestedAt }).from(dataSources).all().find((entry) => entry.at !== null);
    expect(flag).toBeDefined();
  });

  it("precheckRequestCost adds the tenant probe only after a 404", () => {
    expect(precheckRequestCost(precheck("x"))).toBe(PRECHECK_BUDGET_COST);
    expect(precheckRequestCost(precheck("x", { status: "failed", httpStatus: 404 }, "needs_fix"))).toBe(PRECHECK_BUDGET_COST + PRECHECK_DISCOVERY_COST);
  });
});
```

Append to `frontend/src/server/crawler/configured-runner.test.ts` (using that file's existing fixtures for a due bidnet source and its `runCrawlerSourceOnce` fake):

```ts
it("uses a caller-supplied PlatformTickBudget so a later step in the same tick sees what the crawl spent", async () => {
  const budget = new PlatformTickBudget(new Map([["bidnet", 60]]), 15 * 60 * 1000);
  await runConfiguredCrawlerSourcesOnce({ ...baseOptions, platformBudget: budget });
  expect(budget.reserve("bidnet", 15)).toBeNull();   // the crawl reserved at least one request out of 15
});
```

- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run src/server/admin/crawler-robots-fetch.test.ts src/server/crawler/precheck-queue-runner.test.ts src/server/crawler/configured-runner.test.ts` → FAIL.

- [ ] **Step 3: `createCachedRobotsFetch`** (append to `crawler-robots-fetch.ts`):

```ts
/**
 * One tick's robots.txt answers, memoised by URL (spec 2026-09-24 §7.2: "同一主机的 robots.txt 每轮只取一次").
 * The cached entry stores status, headers and body so every caller gets a fresh Response.
 */
export function createCachedRobotsFetch(inner: typeof fetch): typeof fetch & { hits: () => number; misses: () => number } {
  const cache = new Map<string, Promise<{ status: number; headers: [string, string][]; body: string }>>();
  let hits = 0;
  let misses = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let entry = cache.get(url);
    if (entry) {
      hits += 1;
    } else {
      misses += 1;
      entry = inner(input, init).then(async (response) => ({
        status: response.status,
        headers: [...response.headers.entries()],
        body: await response.text(),
      }));
      cache.set(url, entry);
    }
    const snapshot = await entry;
    return new Response(snapshot.body, { status: snapshot.status, headers: snapshot.headers });
  }) as typeof fetch & { hits: () => number; misses: () => number };
  fetchImpl.hits = () => hits;
  fetchImpl.misses = () => misses;
  return fetchImpl;
}
```

- [ ] **Step 4: `precheck-queue-runner.ts`**

```ts
import type { MysqlDataSourcesStore } from "@/server/admin/data-sources-repository";
import { createCachedRobotsFetch, createCrawlerBackedRobotsFetch } from "@/server/admin/crawler-robots-fetch";
import {
  clearPrecheckRequest,
  clearPrecheckRequestFromMysql,
  listQueuedPrechecks,
  listQueuedPrechecksFromMysql,
} from "@/server/admin/precheck-queue";
import {
  runSourcePrecheck as defaultRunSourcePrecheck,
  type RunSourcePrecheckOptions,
  type SourcePrecheckResult,
  type SourcePrecheckVerdict,
} from "@/server/admin/source-precheck";
import type { AppDatabase } from "@/server/db/client";
import { scanSourceCompliance } from "@/server/source-validity/robots-compliance-scan";
import { PlatformPauseRegistry, PlatformTickBudget, platformPauseMs } from "./platform-budget";

/** robots.txt + one list page. */
export const PRECHECK_BUDGET_COST = 2;
/** The tenant probe a 404 triggers (DISCOVERY_MAX_REQUESTS in source-precheck.ts). */
export const PRECHECK_DISCOVERY_COST = 6;
export const DEFAULT_PRECHECKS_PER_TICK = 50;

export function precheckRequestCost(result: SourcePrecheckResult): number {
  return PRECHECK_BUDGET_COST + (result.fetch.httpStatus === 404 ? PRECHECK_DISCOVERY_COST : 0);
}

export interface QueuedPrecheckOutcome {
  sourceId: string;
  providerFamily: string | null;
  outcome: "done" | "challenge" | "error";
  verdict: SourcePrecheckVerdict | null;
  error: string | null;
}

export interface RunQueuedPrechecksOnceResult {
  queued: number;
  processed: QueuedPrecheckOutcome[];
  skipped: { budget: number; paused: number };
  stoppedFamilies: string[];
}

export interface RunQueuedPrechecksOnceOptions {
  database: AppDatabase;
  mysql?: MysqlDataSourcesStore;
  now?: Date;
  /** The tick's budget, shared with runConfiguredCrawlerSourcesOnce (spec §5.5 priority 2: leftovers). */
  budget: PlatformTickBudget;
  /** The worker's lifetime registry. */
  pauses: PlatformPauseRegistry;
  clock?: () => number;
  pauseMs?: number;
  maxPerTick?: number;
  runSourcePrecheck?: typeof defaultRunSourcePrecheck;
  robotsFetch?: typeof fetch;
}

/**
 * Spec 2026-09-24 §7.2. Runs queued prechecks oldest-first inside whatever budget the daily lists
 * left. A finished precheck (any verdict) clears the flag; a WAF challenge pauses the platform,
 * leaves the flag and stops that family for this tick; an exception leaves the flag too.
 */
export async function runQueuedPrechecksOnce(options: RunQueuedPrechecksOnceOptions): Promise<RunQueuedPrechecksOnceResult> {
  const now = options.now ?? new Date();
  const clock = options.clock ?? (() => Date.now());
  const pauseMs = options.pauseMs ?? platformPauseMs();
  const runPrecheck = options.runSourcePrecheck ?? defaultRunSourcePrecheck;
  const robotsFetch = createCachedRobotsFetch(options.robotsFetch ?? createCrawlerBackedRobotsFetch());
  const scanCompliance: NonNullable<RunSourcePrecheckOptions["scanCompliance"]> = (inputs, scanOptions) =>
    scanSourceCompliance(inputs, { ...scanOptions, fetchImpl: robotsFetch });
  const limit = options.maxPerTick ?? DEFAULT_PRECHECKS_PER_TICK;

  const queued = options.mysql
    ? await listQueuedPrechecksFromMysql(options.mysql, limit)
    : listQueuedPrechecks(options.database, limit);
  const result: RunQueuedPrechecksOnceResult = { queued: queued.length, processed: [], skipped: { budget: 0, paused: 0 }, stoppedFamilies: [] };

  for (const entry of queued) {
    const family = entry.providerFamily;
    if (family && (result.stoppedFamilies.includes(family) || options.pauses.pausedUntil(family, clock()) !== null)) {
      result.skipped.paused += 1;
      continue;
    }
    let reserved = 0;
    if (options.budget.isBudgeted(family)) {
      const granted = options.budget.reserve(family, PRECHECK_BUDGET_COST);
      if (granted === null) {
        result.skipped.budget += 1;
        continue;
      }
      reserved = granted;
    }

    try {
      const precheck = await runPrecheck({ database: options.database, mysql: options.mysql, sourceId: entry.id, now, scanCompliance });
      if (options.budget.isBudgeted(family)) options.budget.settle(family, reserved, precheckRequestCost(precheck));

      if (precheck.fetch.wafChallenge) {
        result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "challenge", verdict: precheck.verdict, error: null });
        if (family) {
          options.pauses.pause(family, clock() + pauseMs);
          result.stoppedFamilies.push(family);
        }
        continue;
      }

      const cleared = options.mysql
        ? await clearPrecheckRequestFromMysql(options.mysql, entry.id, entry.precheckRequestedAt)
        : clearPrecheckRequest(options.database, entry.id, entry.precheckRequestedAt);
      result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "done", verdict: precheck.verdict, error: cleared ? null : "re-queued while running" });
    } catch (error) {
      // Nothing is known about what was fetched; charge the reservation and keep the source queued.
      if (options.budget.isBudgeted(family)) options.budget.settle(family, reserved, PRECHECK_BUDGET_COST);
      result.processed.push({ sourceId: entry.id, providerFamily: family, outcome: "error", verdict: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  console.info(
    JSON.stringify({
      event: "crawler_precheck_queue_processed",
      queued: result.queued,
      done: result.processed.filter((entry) => entry.outcome === "done").length,
      challenge: result.processed.filter((entry) => entry.outcome === "challenge").length,
      error: result.processed.filter((entry) => entry.outcome === "error").length,
      skippedBudget: result.skipped.budget,
      skippedPaused: result.skipped.paused,
      stoppedFamilies: result.stoppedFamilies,
      robotsFetches: robotsFetch.misses(),
    }),
  );
  return result;
}
```

Check `PlatformPauseRegistry.pausedUntil`'s actual return type in `platform-budget.ts` (the plan assumes `number | null`); if it returns `undefined` for "not paused", compare with `!= null`.

- [ ] **Step 5: Share the budget** — in `configured-runner.ts` add to `RunConfiguredCrawlerSourcesOnceOptions`:

```ts
  /** Spec §5.5: one budget per tick, shared with the precheck step that runs after the lists; default: built here. */
  platformBudget?: PlatformTickBudget;
```

and change the construction line to `const budget = options.platformBudget ?? new PlatformTickBudget(options.platformBudgets ?? platformBudgetsFromEnv(), options.tickMs ?? DEFAULT_TICK_MS);`.

- [ ] **Step 6: Worker tick** — in `frontend/scripts/crawler-worker.ts` import `PlatformTickBudget, platformBudgetsFromEnv` (extend the existing `platform-budget` import) and `runQueuedPrechecksOnce` from `../src/server/crawler/precheck-queue-runner`; replace the loop body with:

```ts
    while (!stopping) {
      // One budget per tick: the daily lists spend first, the precheck queue gets what is left (spec §5.5).
      const budget = new PlatformTickBudget(platformBudgetsFromEnv(), intervalMs());
      const results = await runConfiguredCrawlerSourcesOnce({
        database: db,
        mysql,
        owner: owner(),
        stateRunnerOptions: { limit: parseStateCrawlerLimit() },
        runCrawlerSourceOnce: retryingRunCrawlerSourceOnce,
        notifier,
        platformPauses,
        platformBudget: budget,
        tickMs: intervalMs(),
      });
      workerLogger.info("crawler_run_completed", { results });

      try {
        const prechecks = await runQueuedPrechecksOnce({ database: db, mysql, budget, pauses: platformPauses });
        workerLogger.info("crawler_precheck_queue_completed", { prechecks });
      } catch (error) {
        workerLogger.error("crawler_precheck_queue_failed", { error });
        captureException(error, { worker: "crawler", step: "precheck_queue" }); // drop `step` if the context type rejects it
      }

      if (!stopping) {
        await sleep(intervalMs());
      }
    }
```

(`mysql` here is the pool from `resolveMysqlPool()`; if its type does not satisfy `MysqlDataSourcesStore`, pass it as `mysql as MysqlDataSourcesStore | undefined` after checking `MysqlDataSourcesStore`'s members — do not `as never`.)

- [ ] **Step 7: Run tests** — `cd frontend && npx vitest run src/server/crawler src/server/admin/crawler-robots-fetch.test.ts && npm run worker:crawler:check` → tests PASS; the check prints its JSON and exits 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/server/admin/crawler-robots-fetch.ts frontend/src/server/admin/crawler-robots-fetch.test.ts frontend/src/server/crawler/precheck-queue-runner.ts frontend/src/server/crawler/precheck-queue-runner.test.ts frontend/src/server/crawler/configured-runner.ts frontend/src/server/crawler/configured-runner.test.ts frontend/scripts/crawler-worker.ts
git commit -m "feat(crawler): worker runs queued prechecks on the tick's leftover platform budget"
```

---

### Task 7: Ledgered batch approval, readiness summary, tightened batch route

**Files:**
- Create: `frontend/src/server/admin/ledgered-approval.ts` + Test: `frontend/src/server/admin/ledgered-approval.test.ts`
- Modify: `frontend/src/app/api/admin/data-sources/batch/route.ts` + `route.test.ts`
- Create: `frontend/src/app/api/admin/data-sources/approval-readiness/route.ts` + `route.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`, `frontend/src/server/auth/role-route-coverage.test.ts` (`consoleReadRoutes`)

**Interfaces:**
- Consumes: Task 2 (`listPlatformReviews(FromMysql)`, `effectivePlatformReviewsByFamily`, `EffectivePlatformReview`, `PlatformReview`), Task 4 (`LOCAL_JURISDICTION_LEVELS`, `isPrecheckFresh`, `precheckBaseUrlFromNotes`, `AdminDataSource.precheckRequestedAt`), `listAdminDataSources(FromMysql)` and `updateAdminDataSource(FromMysql)` from `./data-sources-repository`.
- Produces:

```ts
export type LedgeredApprovalReason = "not_local" | "already_approved" | "blocked" | "missing_platform_review" | "platform_review_expired" | "precheck_missing" | "precheck_stale" | "precheck_needs_fix" | "base_url_changed";
export interface LedgeredApprovalEvaluation { eligible: boolean; reason: LedgeredApprovalReason | null; review: PlatformReview | null }
export function isLocalSource(source: Pick<AdminDataSource, "jurisdictionLevel">): boolean
export function evaluateLedgeredApproval(source: AdminDataSource, effective: EffectivePlatformReview | undefined, now: Date): LedgeredApprovalEvaluation
export function approvalNoteFor(review: PlatformReview, source: AdminDataSource): string
export function ledgeredApprovalInput(source: AdminDataSource, review: PlatformReview): UpdateAdminDataSourceInput
export type ApprovalReadinessBucket = "approvable" | "awaiting_precheck" | "needs_fix" | "missing_platform_review" | "approved" | "blocked";
export function readinessBucket(evaluation: LedgeredApprovalEvaluation): ApprovalReadinessBucket
export interface ApprovalReadinessEntry { id: string; label: string; providerFamily: string; jurisdictionLevel: string | null; bucket: ApprovalReadinessBucket; reason: LedgeredApprovalReason | null; precheckRequestedAt: string | null; liveHealthDisposition: string | null; liveHealthReviewedAt: string | null }
export interface ApprovalReadinessSummary { providerFamily: string | null; platformReview: EffectivePlatformReview | null; counts: Record<ApprovalReadinessBucket, number>; sources: ApprovalReadinessEntry[] }
export function summarizeApprovalReadiness(sources: readonly AdminDataSource[], reviews: readonly PlatformReview[], now: Date, providerFamily: string | null): ApprovalReadinessSummary   // local sources only, filtered by family when given
export interface LedgeredBatchOutcome { sourceId: string; outcome: "approved" | "skipped" | "not_found"; reason: LedgeredApprovalReason | null; source: AdminDataSource | null }
export interface ApproveSourcesWithLedgerOptions { actorUserId: string | null; now?: Date; genericInput: UpdateAdminDataSourceInput }
export async function approveSourcesWithLedger(store: { database: AppDatabase; mysql?: MysqlDataSourcesStore & MysqlPlatformReviewsStore }, sourceIds: readonly string[], options: ApproveSourcesWithLedgerOptions): Promise<LedgeredBatchOutcome[]>
```

Batch route response for `action: "approve"` becomes `{ updatedCount, skippedCount, outcomes: Array<{ sourceId, outcome, reason }>, sources }`; `hold` is unchanged; any `not_found` id still answers 404 `DATA_SOURCE_NOT_FOUND` for the whole request (as before). `GET /api/admin/data-sources/approval-readiness?providerFamily=bidnet` → `ApprovalReadinessSummary`. Client: `getAdminApprovalReadiness(providerFamily?: string): Promise<AdminApprovalReadinessSummary>`; `BatchUpdateAdminDataSourcesResponse` gains `skippedCount?: number; outcomes?: AdminLedgeredBatchOutcome[]`.

- [ ] **Step 1: Failing tests**

`frontend/src/server/admin/ledgered-approval.test.ts` — build an `AdminDataSource` factory once (every field of the interface with a plain default; copy the field list from `data-sources-repository.ts:51-117`):

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import type { AdminDataSource } from "./data-sources-repository";
import { PLATFORM_ACCESS_BOUNDARY, createPlatformReview, validatePlatformReviewInput, type EffectivePlatformReview, type PlatformReview } from "./platform-reviews-repository";
import { approveSourcesWithLedger, evaluateLedgeredApproval, ledgeredApprovalInput, readinessBucket, summarizeApprovalReadiness } from "./ledgered-approval";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const FRESH = "2026-09-25T00:00:00.000Z";
const STALE = "2026-09-01T00:00:00.000Z";
const URL_A = "https://www.bidnetdirect.com/mitn/a/solicitations/open-bids";

function review(overrides: Partial<PlatformReview> = {}): PlatformReview {
  return { id: "prv_1", providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok", accessBoundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legalOpinionReference: "LEGAL-42", reviewedAt: "2026-09-29T08:00:00.000Z", nextReviewAt: "2027-09-29", notes: null, createdBy: null, createdAt: "2026-09-29T08:00:00.000Z", ...overrides };
}
const VALID: EffectivePlatformReview = { status: "valid", review: review() };
const EXPIRED: EffectivePlatformReview = { status: "expired", review: review({ nextReviewAt: "2026-01-01" }) };

function notes(baseUrl: string | null) {
  return JSON.stringify({ precheck: { baseUrl, verdict: "empty" } });
}

function source(overrides: Partial<AdminDataSource> = {}): AdminDataSource {
  return {
    id: "bidnet_mi_a", label: "A", issuerType: "county", stateCode: "MI", baseUrl: URL_A, isEnabled: true, cadence: "daily", fetchConfig: {},
    jurisdictionLevel: "county", jurisdictionName: "A County", lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0,
    crawlerSourceId: null, crawlerAdapterKind: "none", crawlerMaturity: "none", crawlerCapabilities: [], crawlerBaseUrl: null,
    sourceAuthority: null, trustStatus: null, evidenceMode: null, validityNotes: null, providerFamily: "bidnet", accessMode: "public",
    sourceType: "portal", sourceConfidence: "unknown", activationStatus: "inactive", requiresBrowser: false, requiresManual: false,
    requiresLogin: false, supportsQuery: false, supportsPagination: false, supportsAttachmentMetadata: false, supportsDetailPageFetch: false,
    fallbackNotes: null, approvedForIngestion: false, approvalStatus: "needs_review", accessPattern: "list", legalReviewStatus: "not_reviewed",
    sourceOwner: "", approvalNotes: null, lastApprovalReviewedAt: null, liveHealthOwner: null, liveHealthDisposition: "empty",
    liveHealthNextReviewAt: null, liveHealthNotes: notes(URL_A), liveHealthReviewedAt: FRESH, precheckRequestedAt: null,
    robotsTxtStatus: "clear", robotsTxtCheckedAt: FRESH, robotsTxtHash: null, robotsTxtDisallowsCrawledPaths: false, robotsTxtFlagReason: null,
    tosReviewed: null, tosReviewedAt: null, tosUrl: null, complianceReviewer: null, legalOpinionReference: null, complianceReviewDueAt: null,
    complianceNotes: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), latestLog: null, latestLiveHealth: null,
    sourceHealthTrend: null, approvalHistory: [],
    ...overrides,
  } as AdminDataSource;
}

describe("evaluateLedgeredApproval", () => {
  it.each([
    ["eligible", {}, VALID, true, null],
    ["state source", { jurisdictionLevel: "state" }, VALID, false, "not_local"],
    ["already approved", { approvalStatus: "approved" }, VALID, false, "already_approved"],
    ["blocked", { approvalStatus: "blocked" }, VALID, false, "blocked"],
    ["no review", {}, undefined, false, "missing_platform_review"],
    ["expired review", {}, EXPIRED, false, "platform_review_expired"],
    ["never prechecked", { liveHealthDisposition: null, liveHealthReviewedAt: null }, VALID, false, "precheck_missing"],
    ["needs_fix", { liveHealthDisposition: "needs_fix" }, VALID, false, "precheck_needs_fix"],
    ["stale", { liveHealthReviewedAt: STALE }, VALID, false, "precheck_stale"],
    ["base_url moved", { baseUrl: "https://www.bidnetdirect.com/mitn/a2/solicitations/open-bids" }, VALID, false, "base_url_changed"],
    ["pre-phase-3 notes", { liveHealthNotes: JSON.stringify({ precheck: { verdict: "empty" } }) }, VALID, false, "base_url_changed"],
  ])("%s", (_label, overrides, effective, eligible, reason) => {
    const evaluation = evaluateLedgeredApproval(source(overrides as Partial<AdminDataSource>), effective, NOW);
    expect(evaluation.eligible).toBe(eligible);
    expect(evaluation.reason).toBe(reason);
  });
});

describe("ledgeredApprovalInput / readinessBucket", () => {
  it("copies the ledger from the platform review and writes the spec's note", () => {
    expect(ledgeredApprovalInput(source(), review())).toEqual({
      approvalStatus: "approved", approvedForIngestion: true, isEnabled: true, legalReviewStatus: "approved_public",
      complianceReviewer: "apsi.lily@gmail.com", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewed: true, tosReviewedAt: "2026-09-29",
      legalOpinionReference: "LEGAL-42", complianceReviewDueAt: "2027-09-29",
      approvalNotes: `依据平台审查 #prv_1；预检 empty @${FRESH}`,
    });
  });

  it("maps reasons to console buckets", () => {
    expect(readinessBucket({ eligible: true, reason: null, review: review() })).toBe("approvable");
    expect(readinessBucket({ eligible: false, reason: "precheck_stale", review: review() })).toBe("awaiting_precheck");
    expect(readinessBucket({ eligible: false, reason: "base_url_changed", review: review() })).toBe("awaiting_precheck");
    expect(readinessBucket({ eligible: false, reason: "precheck_needs_fix", review: review() })).toBe("needs_fix");
    expect(readinessBucket({ eligible: false, reason: "platform_review_expired", review: review() })).toBe("missing_platform_review");
    expect(readinessBucket({ eligible: false, reason: "already_approved", review: null })).toBe("approved");
  });

  it("summarizes local sources of one family", () => {
    const summary = summarizeApprovalReadiness(
      [source(), source({ id: "b", liveHealthDisposition: "needs_fix" }), source({ id: "c", providerFamily: "bonfire" }), source({ id: "s", jurisdictionLevel: "state" })],
      [review()], NOW, "bidnet",
    );
    expect(summary.counts).toEqual({ approvable: 1, awaiting_precheck: 0, needs_fix: 1, missing_platform_review: 0, approved: 0, blocked: 0 });
    expect(summary.sources.map((entry) => entry.id)).toEqual(["bidnet_mi_a", "b"]);
    expect(summary.platformReview?.status).toBe("valid");
  });
});

describe("approveSourcesWithLedger (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    const base = { issuerType: "county", stateCode: "MI", providerFamily: "bidnet", jurisdictionLevel: "county", isEnabled: 1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    testDb.db.insert(dataSources).values([
      { ...base, id: "bidnet_mi_a", label: "A", baseUrl: URL_A, liveHealthDisposition: "empty", liveHealthReviewedAt: FRESH, liveHealthNotes: notes(URL_A) },
      { ...base, id: "bidnet_mi_b", label: "B", baseUrl: "https://x/b", liveHealthDisposition: "needs_fix", liveHealthReviewedAt: FRESH, liveHealthNotes: notes("https://x/b") },
      { ...base, id: "state_mi", label: "MI", issuerType: "state", jurisdictionLevel: "state", providerFamily: null },
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("approves eligible local sources with the ledger, skips the rest with reasons, keeps the generic path for state sources", async () => {
    createPlatformReview(testDb.db, validatePlatformReviewInput({ providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok", reviewer: "apsi.lily@gmail.com", nextReviewAt: "2027-09-29" }, NOW), { now: NOW });
    const generic = { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "generic" } as const;

    const outcomes = await approveSourcesWithLedger({ database: testDb.db }, ["bidnet_mi_a", "bidnet_mi_b", "state_mi", "ghost"], { actorUserId: null, now: NOW, genericInput: generic });

    expect(outcomes.map((entry) => [entry.sourceId, entry.outcome, entry.reason])).toEqual([
      ["bidnet_mi_a", "approved", null], ["bidnet_mi_b", "skipped", "precheck_needs_fix"], ["state_mi", "approved", null], ["ghost", "not_found", null],
    ]);
    const a = testDb.db.select().from(dataSources).all().find((row) => row.id === "bidnet_mi_a");
    expect(a).toMatchObject({ approvalStatus: "approved", approvedForIngestion: 1, isEnabled: 1, legalReviewStatus: "approved_public", complianceReviewer: "apsi.lily@gmail.com", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewed: 1, complianceReviewDueAt: "2027-09-29" });
    expect(a?.approvalNotes).toMatch(/^依据平台审查 #prv_/);
    const b = testDb.db.select().from(dataSources).all().find((row) => row.id === "bidnet_mi_b");
    expect(b?.approvalStatus).toBeNull();
    const events = testDb.db.$client.prepare("SELECT source_id FROM source_approval_events ORDER BY source_id").all() as { source_id: string }[];
    expect(events.map((event) => event.source_id)).toEqual(["bidnet_mi_a", "state_mi"]);
  });
});
```

Batch route test (`batch/route.test.ts`) — add: (a) a county row without a platform review answers 200 with `updatedCount: 0, skippedCount: 1, outcomes: [{ sourceId, outcome: "skipped", reason: "missing_platform_review" }]` and leaves the row unapproved; (b) after `createPlatformReview(...)` and with a fresh `empty` precheck whose notes carry the row's `baseUrl`, the same call answers `updatedCount: 1` and the row carries `complianceReviewer`/`tosUrl`/`complianceReviewDueAt` from the review; (c) the existing "approves two seeded state sources" test keeps passing (generic path) and its response now also has `skippedCount: 0`; (d) `hold` unchanged.

Readiness route test (`approval-readiness/route.test.ts`): seed one approvable + one needs_fix bidnet row + a review; `GET ...?providerFamily=bidnet` → 200 with `counts.approvable === 1`, `counts.needs_fix === 1`, `platformReview.status === "valid"`; without a family → all local sources; support role allowed (console read).

- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run src/server/admin/ledgered-approval.test.ts "src/app/api/admin/data-sources/batch" "src/app/api/admin/data-sources/approval-readiness"` → FAIL.

- [ ] **Step 3: `ledgered-approval.ts`**

```ts
import type { AppDatabase } from "@/server/db/client";
import {
  listAdminDataSources,
  listAdminDataSourcesFromMysql,
  updateAdminDataSource,
  updateAdminDataSourceFromMysql,
  type AdminDataSource,
  type MysqlDataSourcesStore,
  type UpdateAdminDataSourceInput,
} from "./data-sources-repository";
import {
  effectivePlatformReviewsByFamily,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  type EffectivePlatformReview,
  type MysqlPlatformReviewsStore,
  type PlatformReview,
} from "./platform-reviews-repository";
import { LOCAL_JURISDICTION_LEVELS, isPrecheckFresh } from "./precheck-queue";
import { precheckBaseUrlFromNotes } from "./source-precheck";

export type LedgeredApprovalReason =
  | "not_local" | "already_approved" | "blocked" | "missing_platform_review" | "platform_review_expired"
  | "precheck_missing" | "precheck_stale" | "precheck_needs_fix" | "base_url_changed";

export interface LedgeredApprovalEvaluation {
  eligible: boolean;
  reason: LedgeredApprovalReason | null;
  review: PlatformReview | null;
}

export function isLocalSource(source: Pick<AdminDataSource, "jurisdictionLevel">): boolean {
  return LOCAL_JURISDICTION_LEVELS.includes(source.jurisdictionLevel ?? "");
}

/** Spec 2026-09-24 §7.3: the three checks, in order, for one local source. */
export function evaluateLedgeredApproval(
  source: AdminDataSource,
  effective: EffectivePlatformReview | undefined,
  now: Date,
): LedgeredApprovalEvaluation {
  if (!isLocalSource(source)) return { eligible: false, reason: "not_local", review: null };
  if (source.approvalStatus === "approved") return { eligible: false, reason: "already_approved", review: null };
  if (source.approvalStatus === "blocked") return { eligible: false, reason: "blocked", review: null };
  if (!effective || effective.status === "missing" || !effective.review) return { eligible: false, reason: "missing_platform_review", review: null };
  if (effective.status === "expired") return { eligible: false, reason: "platform_review_expired", review: effective.review };
  const review = effective.review;
  if (!source.liveHealthDisposition || !source.liveHealthReviewedAt) return { eligible: false, reason: "precheck_missing", review };
  if (source.liveHealthDisposition !== "ready" && source.liveHealthDisposition !== "empty") return { eligible: false, reason: "precheck_needs_fix", review };
  if (!isPrecheckFresh(source.liveHealthReviewedAt, now)) return { eligible: false, reason: "precheck_stale", review };
  const precheckedUrl = precheckBaseUrlFromNotes(source.liveHealthNotes);
  if (!precheckedUrl || precheckedUrl !== source.baseUrl) return { eligible: false, reason: "base_url_changed", review };
  return { eligible: true, reason: null, review };
}

export function approvalNoteFor(review: PlatformReview, source: AdminDataSource): string {
  return `依据平台审查 #${review.id}；预检 ${source.liveHealthDisposition} @${source.liveHealthReviewedAt}`;
}

export function ledgeredApprovalInput(source: AdminDataSource, review: PlatformReview): UpdateAdminDataSourceInput {
  return {
    approvalStatus: "approved",
    approvedForIngestion: true,
    isEnabled: true,
    legalReviewStatus: "approved_public",
    complianceReviewer: review.reviewer,
    tosUrl: review.tosUrl,
    tosReviewed: true,
    tosReviewedAt: review.tosReviewedAt,
    legalOpinionReference: review.legalOpinionReference,
    complianceReviewDueAt: review.nextReviewAt,
    approvalNotes: approvalNoteFor(review, source),
  };
}

export type ApprovalReadinessBucket = "approvable" | "awaiting_precheck" | "needs_fix" | "missing_platform_review" | "approved" | "blocked";

export function readinessBucket(evaluation: LedgeredApprovalEvaluation): ApprovalReadinessBucket {
  if (evaluation.eligible) return "approvable";
  switch (evaluation.reason) {
    case "already_approved": return "approved";
    case "blocked": return "blocked";
    case "missing_platform_review":
    case "platform_review_expired": return "missing_platform_review";
    case "precheck_needs_fix": return "needs_fix";
    default: return "awaiting_precheck"; // precheck_missing | precheck_stale | base_url_changed
  }
}

export interface ApprovalReadinessEntry {
  id: string;
  label: string;
  providerFamily: string;
  jurisdictionLevel: string | null;
  bucket: ApprovalReadinessBucket;
  reason: LedgeredApprovalReason | null;
  precheckRequestedAt: string | null;
  liveHealthDisposition: string | null;
  liveHealthReviewedAt: string | null;
}

export interface ApprovalReadinessSummary {
  providerFamily: string | null;
  platformReview: EffectivePlatformReview | null;
  counts: Record<ApprovalReadinessBucket, number>;
  sources: ApprovalReadinessEntry[];
}

const EMPTY_COUNTS = (): Record<ApprovalReadinessBucket, number> => ({ approvable: 0, awaiting_precheck: 0, needs_fix: 0, missing_platform_review: 0, approved: 0, blocked: 0 });

export function summarizeApprovalReadiness(
  sources: readonly AdminDataSource[],
  reviews: readonly PlatformReview[],
  now: Date,
  providerFamily: string | null,
): ApprovalReadinessSummary {
  const effectiveByFamily = effectivePlatformReviewsByFamily(reviews, now);
  const counts = EMPTY_COUNTS();
  const entries: ApprovalReadinessEntry[] = [];
  for (const source of sources) {
    if (!isLocalSource(source)) continue;
    if (providerFamily && source.providerFamily !== providerFamily) continue;
    const evaluation = evaluateLedgeredApproval(source, effectiveByFamily[source.providerFamily], now);
    const bucket = readinessBucket(evaluation);
    counts[bucket] += 1;
    entries.push({
      id: source.id, label: source.label, providerFamily: source.providerFamily, jurisdictionLevel: source.jurisdictionLevel,
      bucket, reason: evaluation.reason, precheckRequestedAt: source.precheckRequestedAt,
      liveHealthDisposition: source.liveHealthDisposition, liveHealthReviewedAt: source.liveHealthReviewedAt,
    });
  }
  return {
    providerFamily,
    platformReview: providerFamily ? effectiveByFamily[providerFamily] ?? { status: "missing", review: null } : null,
    counts,
    sources: entries,
  };
}

export interface LedgeredBatchOutcome {
  sourceId: string;
  outcome: "approved" | "skipped" | "not_found";
  reason: LedgeredApprovalReason | null;
  source: AdminDataSource | null;
}

export interface ApproveSourcesWithLedgerOptions {
  actorUserId: string | null;
  now?: Date;
  /** What a non-local (federal/state) source still gets — the batch route's old generic input. */
  genericInput: UpdateAdminDataSourceInput;
}

export async function approveSourcesWithLedger(
  store: { database: AppDatabase; mysql?: MysqlDataSourcesStore & MysqlPlatformReviewsStore },
  sourceIds: readonly string[],
  options: ApproveSourcesWithLedgerOptions,
): Promise<LedgeredBatchOutcome[]> {
  const now = options.now ?? new Date();
  const { sources } = store.mysql ? await listAdminDataSourcesFromMysql(store.mysql) : await listAdminDataSources(store.database);
  const reviews = store.mysql ? await listPlatformReviewsFromMysql(store.mysql) : listPlatformReviews(store.database);
  const effectiveByFamily = effectivePlatformReviewsByFamily(reviews, now);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const update = (id: string, input: UpdateAdminDataSourceInput) =>
    store.mysql
      ? updateAdminDataSourceFromMysql(store.mysql, id, input, { actorUserId: options.actorUserId })
      : updateAdminDataSource(store.database, id, input, { actorUserId: options.actorUserId });

  const outcomes: LedgeredBatchOutcome[] = [];
  for (const sourceId of sourceIds) {
    const source = byId.get(sourceId);
    if (!source) {
      outcomes.push({ sourceId, outcome: "not_found", reason: null, source: null });
      continue;
    }
    if (!isLocalSource(source)) {
      outcomes.push({ sourceId, outcome: "approved", reason: null, source: await update(sourceId, options.genericInput) });
      continue;
    }
    const evaluation = evaluateLedgeredApproval(source, effectiveByFamily[source.providerFamily], now);
    if (!evaluation.eligible || !evaluation.review) {
      outcomes.push({ sourceId, outcome: "skipped", reason: evaluation.reason, source });
      continue;
    }
    outcomes.push({ sourceId, outcome: "approved", reason: null, source: await update(sourceId, ledgeredApprovalInput(source, evaluation.review)) });
  }
  return outcomes;
}
```

- [ ] **Step 4: Batch route** — in `batch/route.ts` import `approveSourcesWithLedger` and, inside the `try`, replace the loop with:

```ts
      if (body.action === "approve") {
        const outcomes = await approveSourcesWithLedger(
          { database: resolvedDb, mysql: store ?? undefined },
          body.sourceIds,
          { actorUserId, genericInput: input },
        );
        if (outcomes.some((entry) => entry.outcome === "not_found")) {
          return errorResponse("DATA_SOURCE_NOT_FOUND", "Data source was not found.", 404);
        }
        const approved = outcomes.filter((entry) => entry.outcome === "approved");
        return NextResponse.json({
          updatedCount: approved.length,
          skippedCount: outcomes.length - approved.length,
          outcomes: outcomes.map(({ sourceId, outcome, reason }) => ({ sourceId, outcome, reason })),
          sources: approved.map((entry) => entry.source),
        });
      }

      for (const sourceId of body.sourceIds) { /* hold: unchanged */ }
```

(Keep `inputForBatchAction` — its `approve` branch is now the `genericInput` for federal/state rows. If `store`'s type is the raw pool, cast once as `MysqlDataSourcesStore & MysqlPlatformReviewsStore` after confirming both are structural `{ query, execute }` types.)

- [ ] **Step 5: Readiness route** — `frontend/src/app/api/admin/data-sources/approval-readiness/route.ts` with the same skeleton (`resolveDatabase`, `shouldUseMysqlRuntime`, `errorResponse`, `routeError`):

```ts
export function createAdminApprovalReadinessGet(database?: AppDatabase, mysql?: MysqlDataSourcesStore & MysqlPlatformReviewsStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const providerFamily = new URL(request.url).searchParams.get("providerFamily")?.trim().toLowerCase() || null;
      const store = shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : null;
      const { sources } = store ? await listAdminDataSourcesFromMysql(store) : await listAdminDataSources(resolvedDb);
      const reviews = store ? await listPlatformReviewsFromMysql(store) : listPlatformReviews(resolvedDb);
      return NextResponse.json(summarizeApprovalReadiness(sources, reviews, new Date(), providerFamily));
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminApprovalReadinessGet();
```

Register it in `consoleReadRoutes` (`"../../app/api/admin/data-sources/approval-readiness/route.ts",` sorted before `.../data-sources/route.ts`).

- [ ] **Step 6: Client** — in `admin.ts`: re-export `ApprovalReadinessSummary`, `ApprovalReadinessEntry`, `ApprovalReadinessBucket`, `LedgeredApprovalReason` as `AdminApprovalReadinessSummary` etc.; extend `BatchUpdateAdminDataSourcesResponse` with `skippedCount?: number; outcomes?: Array<{ sourceId: string; outcome: "approved" | "skipped" | "not_found"; reason: LedgeredApprovalReason | null }>;` and add:

```ts
export async function getAdminApprovalReadiness(providerFamily?: string) {
  const response = await fetch(`/api/admin/data-sources/approval-readiness${buildQueryString({ providerFamily })}`);
  return parseResponse<AdminApprovalReadinessSummary>(response);
}
```

- [ ] **Step 7: Run tests** — `cd frontend && npx vitest run src/server/admin "src/app/api/admin/data-sources" src/server/auth/role-route-coverage.test.ts src/server/db/mysql-route-coverage.test.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/server/admin/ledgered-approval.ts frontend/src/server/admin/ledgered-approval.test.ts "frontend/src/app/api/admin/data-sources/batch/route.ts" "frontend/src/app/api/admin/data-sources/batch/route.test.ts" "frontend/src/app/api/admin/data-sources/approval-readiness/route.ts" "frontend/src/app/api/admin/data-sources/approval-readiness/route.test.ts" frontend/src/lib/api/admin.ts frontend/src/server/auth/role-route-coverage.test.ts
git commit -m "feat(admin): ledgered batch approval with the three spec checks and a readiness summary"
```

---

### Task 8: Admin console — platform reviews panel, ledgered approval panel, i18n

**Files:**
- Create: `frontend/src/components/admin/PlatformReviewsPanel.tsx` + Test: `frontend/src/components/admin/PlatformReviewsPanel.test.ts` (pure helpers only, node environment)
- Create: `frontend/src/components/admin/LedgeredApprovalPanel.tsx` + Test: `frontend/src/components/admin/LedgeredApprovalPanel.test.ts`
- Modify: `frontend/src/app/admin/page.tsx` (data-sources section, ~line 3736, above `JurisdictionBatchRunPanel`)
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`, `frontend/src/lib/i18n/dictionaries/zh.ts` (`admin.*` subtree)

**Interfaces:**
- Consumes: Task 3 (`listAdminPlatformReviews`, `createAdminPlatformReview`, `AdminPlatformReview`, `AdminEffectivePlatformReview`, `CreateAdminPlatformReviewInput`), Task 4 (`requestAdminSourcePrechecks`), Task 7 (`getAdminApprovalReadiness`, `batchUpdateAdminDataSources` with `outcomes`, `AdminApprovalReadinessSummary`), `AdminApiError`, `useLanguage` from `@/lib/i18n/LanguageContext`, `Button`/`Badge`/`Table*`/`Input`/`Label` from `@/components/ui/*`.
- Produces (exported for tests):

```ts
// PlatformReviewsPanel.tsx
export interface PlatformReviewForm { providerFamily: string; tosUrl: string; tosReviewedAt: string; robotsUrl: string; robotsCheckedAt: string; robotsSummary: string; legalOpinionReference: string; nextReviewAt: string; notes: string }
export function defaultPlatformReviewForm(now: Date, providerFamily?: string): PlatformReviewForm   // tosReviewedAt = today (yyyy-mm-dd), robotsCheckedAt = now ISO, nextReviewAt = today + 12 months
export function buildPlatformReviewInput(form: PlatformReviewForm, reviewer: string): CreateAdminPlatformReviewInput  // trims; empty legal/notes → null
export function platformReviewStatusTone(status: "valid" | "expired" | "missing"): string   // emerald / rose / amber Badge classes
export function PlatformReviewsPanel(props: { canManage: boolean; reviewerEmail: string | null; disabled?: boolean }): JSX.Element
// LedgeredApprovalPanel.tsx
export const APPROVAL_BATCH_CHUNK_SIZE = 100;
export function chunkSourceIds(ids: readonly string[], size?: number): string[][]
export function approvableIds(summary: AdminApprovalReadinessSummary): string[]
export interface OutcomeTally { approved: number; skipped: number; byReason: Record<string, number> }
export function tallyOutcomes(outcomes: readonly { outcome: string; reason: string | null }[], into?: OutcomeTally): OutcomeTally
export function providerFamiliesOf(sources: readonly { providerFamily: string | null; jurisdictionLevel: string | null }[]): string[]  // unique families of local sources, sorted, "bidnet" first when present
export function LedgeredApprovalPanel(props: { providerFamilies: string[]; canApprove: boolean; canRequestPrechecks: boolean; disabled?: boolean }): JSX.Element
```

- [ ] **Step 1: Failing helper tests**

`PlatformReviewsPanel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPlatformReviewInput, defaultPlatformReviewForm, platformReviewStatusTone } from "./PlatformReviewsPanel";

const NOW = new Date("2026-09-29T08:00:00.000Z");

describe("PlatformReviewsPanel helpers", () => {
  it("defaults dates to today, now and today + 12 months", () => {
    const form = defaultPlatformReviewForm(NOW, "bidnet");
    expect(form).toMatchObject({ providerFamily: "bidnet", tosReviewedAt: "2026-09-29", robotsCheckedAt: NOW.toISOString(), nextReviewAt: "2027-09-29", legalOpinionReference: "", notes: "" });
  });

  it("builds the request with trimmed values and nulls for empty optionals", () => {
    const input = buildPlatformReviewInput({ ...defaultPlatformReviewForm(NOW, " BidNet "), tosUrl: " https://www.bidnetdirect.com/tsandcs ", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsSummary: " ok " }, "apsi.lily@gmail.com");
    expect(input).toMatchObject({ providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", robotsSummary: "ok", reviewer: "apsi.lily@gmail.com", legalOpinionReference: null, notes: null });
  });

  it("tones statuses", () => {
    expect(platformReviewStatusTone("valid")).toContain("emerald");
    expect(platformReviewStatusTone("expired")).toContain("rose");
    expect(platformReviewStatusTone("missing")).toContain("amber");
  });
});
```

`LedgeredApprovalPanel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APPROVAL_BATCH_CHUNK_SIZE, approvableIds, chunkSourceIds, providerFamiliesOf, tallyOutcomes } from "./LedgeredApprovalPanel";

describe("LedgeredApprovalPanel helpers", () => {
  it("chunks ids by 100 by default", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `s${index}`);
    const chunks = chunkSourceIds(ids);
    expect(APPROVAL_BATCH_CHUNK_SIZE).toBe(100);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(chunkSourceIds([], 3)).toEqual([]);
  });

  it("collects approvable ids from a summary", () => {
    const summary = { providerFamily: "bidnet", platformReview: null, counts: { approvable: 1, awaiting_precheck: 1, needs_fix: 0, missing_platform_review: 0, approved: 0, blocked: 0 }, sources: [
      { id: "a", bucket: "approvable" }, { id: "b", bucket: "awaiting_precheck" },
    ] } as never;
    expect(approvableIds(summary)).toEqual(["a"]);
  });

  it("tallies outcomes across chunks", () => {
    const tally = tallyOutcomes([{ outcome: "approved", reason: null }, { outcome: "skipped", reason: "precheck_stale" }]);
    expect(tallyOutcomes([{ outcome: "skipped", reason: "precheck_stale" }], tally)).toEqual({ approved: 1, skipped: 2, byReason: { precheck_stale: 2 } });
  });

  it("lists local families with bidnet first", () => {
    expect(providerFamiliesOf([
      { providerFamily: "bonfire", jurisdictionLevel: "city" }, { providerFamily: "bidnet", jurisdictionLevel: "county" },
      { providerFamily: null, jurisdictionLevel: "state" }, { providerFamily: "bidnet", jurisdictionLevel: "township" },
    ])).toEqual(["bidnet", "bonfire"]);
  });
});
```

- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run src/components/admin/PlatformReviewsPanel.test.ts src/components/admin/LedgeredApprovalPanel.test.ts` → FAIL.

- [ ] **Step 3: i18n keys** — add to the `admin` subtree of BOTH dictionaries (zh values must differ from en):

| key | en | zh |
| --- | --- | --- |
| `admin.platformReviewsTitle` | Platform compliance reviews | 平台合规审查 |
| `admin.platformReviewsDescription` | One review per platform covers every local source approved in batch; batch approval stops when it expires. | 每个平台一条审查，覆盖该平台所有批量批准的本地源；审查到期后批量批准即停止。 |
| `admin.platformReviewFamily` | Platform | 平台 |
| `admin.platformReviewStatus` | Status | 状态 |
| `admin.platformReviewStatus_valid` | Valid | 有效 |
| `admin.platformReviewStatus_expired` | Expired | 已到期 |
| `admin.platformReviewStatus_missing` | Missing | 缺失 |
| `admin.platformReviewReviewer` | Reviewer | 复核人 |
| `admin.platformReviewReviewedAt` | Reviewed | 审查日期 |
| `admin.platformReviewNextReviewAt` | Next review | 下次复核 |
| `admin.platformReviewTos` | Terms of service | 服务条款 |
| `admin.platformReviewRobots` | robots.txt | robots.txt |
| `admin.platformReviewRobotsSummary` | robots.txt summary | robots.txt 摘要 |
| `admin.platformReviewAccessBoundary` | Access boundary | 访问边界 |
| `admin.platformReviewLegalReference` | Legal opinion reference | 法务意见参考 |
| `admin.platformReviewNotes` | Notes | 备注 |
| `admin.platformReviewNew` | New review | 新建审查 |
| `admin.platformReviewRenew` | Renew | 续期 |
| `admin.platformReviewSubmit` | Save review | 保存审查 |
| `admin.platformReviewCancel` | Cancel | 取消 |
| `admin.platformReviewSaved` | Review saved. | 审查已保存。 |
| `admin.platformReviewEmpty` | No platform review yet. | 还没有平台审查。 |
| `admin.platformReviewReadOnly` | Only admins can create or renew a review. | 只有管理员可以新建或续期审查。 |
| `admin.ledgeredApprovalTitle` | Batch approval with ledger | 带台账的批量批准 |
| `admin.ledgeredApprovalDescription` | A local source is approved only with a valid platform review, a ready/empty precheck within 14 days and an unchanged address. | 只有平台审查有效、14 天内预检为 ready/empty、地址未变的本地源才会被批准。 |
| `admin.ledgeredApprovalFamily` | Platform | 平台 |
| `admin.ledgeredApprovalBucket_approvable` | Approvable | 可批准 |
| `admin.ledgeredApprovalBucket_awaiting_precheck` | Awaiting precheck | 待预检 |
| `admin.ledgeredApprovalBucket_needs_fix` | Needs fix | 需修正 |
| `admin.ledgeredApprovalBucket_missing_platform_review` | Missing platform review | 缺平台审查 |
| `admin.ledgeredApprovalBucket_approved` | Approved | 已批准 |
| `admin.ledgeredApprovalBucket_blocked` | Blocked | 已拦截 |
| `admin.ledgeredApprovalQueuePrechecks` | Queue prechecks for pending sources | 为待预检源入队 |
| `admin.ledgeredApprovalQueued` | Queued {count} sources; the crawler worker runs them within the platform budget. | 已入队 {count} 个源，由爬虫 worker 在平台预算内执行。 |
| `admin.ledgeredApprovalApproveAll` | Approve all approvable ({count}) | 批准全部可批准项（{count}） |
| `admin.ledgeredApprovalProgress` | Submitted {done} of {total} | 已提交 {done} / {total} |
| `admin.ledgeredApprovalResult` | Approved {approved}, skipped {skipped}. | 已批准 {approved}，跳过 {skipped}。 |
| `admin.ledgeredApprovalReason_missing_platform_review` | no valid platform review | 无有效平台审查 |
| `admin.ledgeredApprovalReason_platform_review_expired` | platform review expired | 平台审查已到期 |
| `admin.ledgeredApprovalReason_precheck_missing` | never prechecked | 尚未预检 |
| `admin.ledgeredApprovalReason_precheck_stale` | precheck older than 14 days | 预检超过 14 天 |
| `admin.ledgeredApprovalReason_precheck_needs_fix` | precheck needs fix | 预检需修正 |
| `admin.ledgeredApprovalReason_base_url_changed` | address changed since precheck | 预检后地址已变 |
| `admin.ledgeredApprovalReason_already_approved` | already approved | 已批准 |
| `admin.ledgeredApprovalReason_blocked` | blocked | 已拦截 |
| `admin.ledgeredApprovalReviewExpiredHint` | The platform review is expired or missing; renew it above before approving. | 平台审查已到期或缺失，先在上方续期再批准。 |
| `admin.ledgeredApprovalRefresh` | Refresh | 刷新 |
| `admin.ledgeredApprovalFailed` | Batch approval failed: {message} | 批量批准失败：{message} |

- [ ] **Step 4: `PlatformReviewsPanel.tsx`** — `"use client"`; `useLanguage()`; on mount `listAdminPlatformReviews()` → `reviews`, `effective`; a table (one row per review, newest first, `Badge` with `platformReviewStatusTone(effective[family].status)` only on the newest row of each family); "New review" / per-family "Renew" opens an inline `<div role="dialog" aria-label={t("admin.platformReviewsTitle")} data-testid="platform-review-form">` (same convention as `ApproveLocalSourceDialog.tsx`) with `Input`s for every `PlatformReviewForm` field, `accessBoundary` shown read-only (`PLATFORM_ACCESS_BOUNDARY` imported as a type-free constant from `@/server/admin/platform-reviews-repository` is NOT allowed in a client component — copy the sentence into the panel as `ACCESS_BOUNDARY_TEXT` and let the server default fill it), submit → `createAdminPlatformReview(buildPlatformReviewInput(form, reviewerEmail ?? ""))` → reload; `AdminApiError.message` rendered verbatim in a `role="alert"` block; `canManage === false` hides the buttons and shows `t("admin.platformReviewReadOnly")`.

Helpers:

```ts
export function defaultPlatformReviewForm(now: Date, providerFamily = "bidnet"): PlatformReviewForm {
  const today = now.toISOString().slice(0, 10);
  const next = new Date(now);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return { providerFamily, tosUrl: "", tosReviewedAt: today, robotsUrl: "", robotsCheckedAt: now.toISOString(), robotsSummary: "", legalOpinionReference: "", nextReviewAt: next.toISOString().slice(0, 10), notes: "" };
}

export function buildPlatformReviewInput(form: PlatformReviewForm, reviewer: string): CreateAdminPlatformReviewInput {
  const optional = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    providerFamily: form.providerFamily.trim().toLowerCase(),
    tosUrl: form.tosUrl.trim(),
    tosReviewedAt: form.tosReviewedAt.trim(),
    robotsUrl: form.robotsUrl.trim(),
    robotsCheckedAt: form.robotsCheckedAt.trim(),
    robotsSummary: form.robotsSummary.trim(),
    reviewer: reviewer.trim(),
    legalOpinionReference: optional(form.legalOpinionReference),
    nextReviewAt: form.nextReviewAt.trim(),
    notes: optional(form.notes),
  };
}

export function platformReviewStatusTone(status: "valid" | "expired" | "missing"): string {
  if (status === "valid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "expired") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}
```

- [ ] **Step 5: `LedgeredApprovalPanel.tsx`** — `"use client"`; family selector (buttons styled like `JurisdictionBatchRunPanel`'s chips); loads `getAdminApprovalReadiness(family)`; renders six count tiles (`t(\`admin.ledgeredApprovalBucket_${bucket}\`)`), the platform review status badge with `t("admin.ledgeredApprovalReviewExpiredHint")` when not `valid`; "Queue prechecks" (`canRequestPrechecks`) → `requestAdminSourcePrechecks({ providerFamily: family, pending: true })` → `t("admin.ledgeredApprovalQueued").replace("{count}", …)` → reload; "Approve all approvable (N)" (`canApprove`, disabled when N = 0 or review not valid) →

```ts
const ids = approvableIds(summary);
const tally: OutcomeTally = { approved: 0, skipped: 0, byReason: {} };
let done = 0;
for (const chunk of chunkSourceIds(ids)) {
  const response = await batchUpdateAdminDataSources({ sourceIds: chunk, action: "approve" });
  tallyOutcomes(response.outcomes ?? chunk.map((sourceId) => ({ sourceId, outcome: "approved", reason: null })), tally);
  done += chunk.length;
  setProgress(t("admin.ledgeredApprovalProgress").replace("{done}", String(done)).replace("{total}", String(ids.length)));
}
```

then the result line and a per-reason list (`t(\`admin.ledgeredApprovalReason_${reason}\`)`), then reload. Errors: `AdminApiError.message` into `t("admin.ledgeredApprovalFailed").replace("{message}", …)`.

Helpers:

```ts
export const APPROVAL_BATCH_CHUNK_SIZE = 100;

export function chunkSourceIds(ids: readonly string[], size = APPROVAL_BATCH_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += size) chunks.push(ids.slice(start, start + size));
  return chunks;
}

export function approvableIds(summary: AdminApprovalReadinessSummary): string[] {
  return summary.sources.filter((entry) => entry.bucket === "approvable").map((entry) => entry.id);
}

export interface OutcomeTally { approved: number; skipped: number; byReason: Record<string, number> }

export function tallyOutcomes(outcomes: readonly { outcome: string; reason: string | null }[], into: OutcomeTally = { approved: 0, skipped: 0, byReason: {} }): OutcomeTally {
  for (const entry of outcomes) {
    if (entry.outcome === "approved") into.approved += 1;
    else {
      into.skipped += 1;
      const key = entry.reason ?? entry.outcome;
      into.byReason[key] = (into.byReason[key] ?? 0) + 1;
    }
  }
  return into;
}

const LOCAL_LEVELS = new Set(["county", "city", "township", "special_district"]);

export function providerFamiliesOf(sources: readonly { providerFamily: string | null; jurisdictionLevel: string | null }[]): string[] {
  const families = new Set(sources.filter((source) => source.providerFamily && LOCAL_LEVELS.has(source.jurisdictionLevel ?? "")).map((source) => source.providerFamily as string));
  return [...families].sort((a, b) => (a === "bidnet" ? -1 : b === "bidnet" ? 1 : a.localeCompare(b)));
}
```

- [ ] **Step 6: Mount in `page.tsx`** — import both panels and `providerFamiliesOf`; inside the data-sources `<section>` right after its header `<div>` and before `{canRunOperations && (<JurisdictionBatchRunPanel …/>)}` add:

```tsx
          <PlatformReviewsPanel canManage={isAdmin} reviewerEmail={user?.email ?? null} disabled={isRunning} />
          <LedgeredApprovalPanel
            providerFamilies={providerFamiliesOf(allSources)}
            canApprove={isAdmin}
            canRequestPrechecks={canRunOperations}
            disabled={isRunning || runningSourceId !== null}
          />
```

(`user`, `isAdmin`, `canRunOperations`, `allSources`, `isRunning`, `runningSourceId` already exist in `AdminPage`; if `user.email` is not on the auth user type, pass `null` and let the panel require the reviewer to be typed.)

- [ ] **Step 7: Verify** — `cd frontend && npx vitest run src/components/admin src/lib/i18n && npm run lint && npm run i18n:check` (the i18n scan must not report the new keys as untranslated or byte-identical — `admin.platformReviewRobots` is the one intentional identical value; if the scan flags it, change zh to `robots.txt 文件`). Then `npm run build` (typechecks the panels). Start `npm run dev` and open `/admin` in a browser (ADMIN_UI_LOCAL_BYPASS + a real session as the runbook notes): both panels render, the review form saves, the counts load.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/admin/PlatformReviewsPanel.tsx frontend/src/components/admin/PlatformReviewsPanel.test.ts frontend/src/components/admin/LedgeredApprovalPanel.tsx frontend/src/components/admin/LedgeredApprovalPanel.test.ts frontend/src/app/admin/page.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin-ui): platform review panel and ledgered batch approval panel"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/operations/local-source-approval.md` (new `## 8. 批量接入（阶段 3）` before the "首轮实测" section; extend `## 6. 相关环境变量` only if a variable's meaning changed — none did)
- Modify: `docs/operations/source-discovery.md` (§4 flow block: after `source:register` add the queue → worker → batch approval steps with the commands)
- Modify: `docs/operations/data-source-compliance-ledger.md` (a "平台审查（`platform_reviews`）" subsection: columns, effective rule, how batch approval copies the ledger)
- Modify: `CLAUDE.md` — the "List extraction & local-source approval" paragraph gains: `platform_reviews` (§7.1 rule), `data_sources.precheck_requested_at` + `npm run source:precheck -- --provider bidnet --pending` + the worker step (`precheck-queue-runner.ts`, leftover budget, robots once per host per tick, challenge → pause and keep the flag), the ledgered batch approval's three checks and the `approval-readiness` route; the "Workers" bullet for `crawler-worker.ts` mentions the precheck step.
- Modify: `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` — add `### 实施补充（阶段 3）` at the end of §7 listing this plan's five decisions.

**Interfaces:** Consumes Tasks 1–8 as built — verify every command, route, flag, bucket name and reason string against the code before writing.

- [ ] **Step 1: Runbook section (`local-source-approval.md` §8)** — Chinese, in the file's voice, covering: (1) 平台审查：字段、`有效 / 到期 / 缺失` 规则、只有 admin 能建、每次写审计事件、到期后批量批准停止而已批准源照常运行；管理端面板位置与 `POST /api/admin/platform-reviews` 的 curl 示例（用 `ADMIN_UI_LOCAL_BYPASS`）。(2) 预检入队：`npm run source:precheck -- --provider bidnet --pending`（先 `--dry-run`，脚本不读 `.env.local`）、管理端"为待预检源入队"按钮、`pending` 的定义、worker 每 tick 在日常列表之后用剩余预算跑队列（每次 2 个请求，404 后 +6）、robots 每主机每 tick 一次、挑战即停并暂停平台、标记只在完成后清除；预算算术：默认 `bidnet=60`/小时 ≈ 每 15 分钟 15 次 → 每 tick 约 7 次预检，952 个源约需 34 小时，`CRAWLER_PLATFORM_BUDGETS=bidnet=120` 可缩短（写明这是 §14 待实测的容忍度风险）。(3) 带台账批量批准：三项检查、写入的台账列、`approval_notes` 模板、六个分组的含义与处理（可批准 → 批准；待预检 → 入队；需修正 → 单源处理；缺平台审查 → 先建/续期）、"批准全部可批准项"按 100 一批、跳过原因表（九个 reason 的中文含义）。(4) 与单源表单的关系：非平台源与例外情况仍走第 3 节的表单。

- [ ] **Step 2: Other docs** as listed above; CLAUDE.md stays one paragraph per topic.

- [ ] **Step 3: Verify** — every route path, script flag, i18n bucket name and reason string in the docs exists in the code (`grep -rn` each one); `npm run lint` unaffected.

- [ ] **Step 4: Commit**

```bash
git add docs/operations/local-source-approval.md docs/operations/source-discovery.md docs/operations/data-source-compliance-ledger.md CLAUDE.md docs/superpowers/specs/2026-09-24-county-data-completeness-design.md
git commit -m "docs: platform reviews, precheck queue and ledgered batch approval runbook"
```

---

### Task 10: Verification and the first batch run (controller only)

- [ ] **Step 1: Gates**

```bash
cd frontend && npm run lint && npm run test && npm run build
cd ../crawler && python3 -m pytest -q
```
Expected: all pass (crawler unchanged: 855).

- [ ] **Step 2: Migrate the local MySQL** (`winbids`, Docker container `winbids-mysql`; `DATABASE_URL` exported from `frontend/.env.local`):

```bash
cd frontend && npm run db:mysql:migrate && npm run db:mysql:smoke
```
Expected: `platform_reviews` created, `data_sources.precheck_requested_at` added, smoke passes. Confirm with `SHOW COLUMNS FROM data_sources LIKE 'precheck_requested_at'` and `SHOW CREATE TABLE platform_reviews`.

- [ ] **Step 3: Create the BidNet platform review** (dev server `apsi-frontend`, `ADMIN_UI_LOCAL_BYPASS=true`): first fetch robots through the crawler for the summary —

```bash
cd crawler && echo '{"base_url":"https://www.bidnetdirect.com/participating-buyers"}' | python3 -m apsi_crawler.cli fetch-robots
```

then `POST /api/admin/platform-reviews` with `providerFamily: "bidnet"`, `tosUrl: "https://www.bidnetdirect.com/tsandcs"`, `tosReviewedAt: <today>`, `robotsUrl: "https://www.bidnetdirect.com/robots.txt"`, `robotsCheckedAt: <now>`, `robotsSummary: <the Disallow list from fetch-robots, one line>`, `reviewer: "apsi.lily@gmail.com"`, `nextReviewAt: <today + 1 year>`, `notes: "2026-09-16 六源与 2026-09-28 两源沿用同一 ToS；阶段 3 首条平台审查"`. Expected 201; `GET` shows `effective.bidnet.status === "valid"`.

- [ ] **Step 4: Queue the pending BidNet sources**

```bash
cd frontend && npm run source:precheck -- --provider bidnet --pending --dry-run
cd frontend && npm run source:precheck -- --provider bidnet --pending
```
Expected: 952 queued (the eight approved and the three blocked rows are excluded). `GET /api/admin/data-sources/approval-readiness?providerFamily=bidnet` → `awaiting_precheck: 952`, `platformReview.status: valid`.

- [ ] **Step 5: Run the worker** (background, MySQL mode, default budget):

```bash
cd frontend && npm run worker:crawler
```
Watch the per-tick logs `crawler_run_completed` / `crawler_precheck_queue_completed` (`done`, `challenge`, `skippedBudget`, `robotsFetches` — robots must be 1 per tick for BidNet). Record the first three ticks' numbers. On a `challenge`: confirm the family is paused for `CRAWLER_PLATFORM_PAUSE_MS` and resumes afterwards (spec §12.2 phase 3, second clause). Do NOT run any manual BidNet crawl or precheck concurrently.

- [ ] **Step 6: Batch-approve in rounds** — after each few ticks: readiness counts; "Approve all approvable" (panel, or `POST /api/admin/data-sources/batch` in chunks of 100 with `action: "approve"`); record `approved` / `skipped` and the skip reasons; spot-check three approved rows (`compliance_reviewer`, `tos_url`, `compliance_review_due_at`, `approval_notes` template, `source_approval_events` rows). Keep going until `awaiting_precheck` is 0 or the remaining rows are all `needs_fix` (record those with their precheck reasons — expected mostly 404 tenants and WAF; they stay unapproved, per §11).

- [ ] **Step 7: Acceptance (spec §12.2, phase 3)** — 48 h after the first approval round, run against MySQL:

```sql
SELECT COUNT(*) approved,
       SUM(last_success_at IS NOT NULL AND last_success_at >= last_approval_reviewed_at) ran_after_approval
  FROM data_sources
 WHERE provider_family = 'bidnet' AND approval_status = 'approved' AND jurisdiction_level IN ('county','city','township');
```
Expected: `ran_after_approval / approved ≥ 0.95` (record the exact ratio; if `last_approval_reviewed_at` is not set by the ledgered path, use the newest `source_approval_events.created_at` per source instead). Also record: the number of throttle pauses observed and that crawling resumed after each; the share of tenants whose first run found open bids (spec §14 risk 2); whether 60 requests/hour drew any challenge (risk 1). Write all of it into `docs/operations/local-source-approval.md` as `## 阶段 3 首轮实测（2026-09-…）` and commit (no trailer), then push `main`.

- [ ] **Step 8: Update memory/ledger** — the local MySQL state (how many approved, how many needs_fix and why) goes to the governance memory file; nothing else.

---

## Self-review notes (kept for the record)

- Spec coverage: §7.1 → Tasks 1–3, 8 (panel), 9; §7.2 → Tasks 1, 4, 5, 6, 8 (queue button), 9; §7.3 → Tasks 7, 8, 9; §7.4 flow → Task 9; §11 rows "预检 needs_fix"/"平台审查过期"/"WAF 挑战" → Tasks 6, 7; §12.1 TS tests "平台审查增改与过期；批量批准三项检查与旧接口收紧；预检队列" → Tasks 2, 4, 6, 7 tests; §12.2 phase 3 → Task 10; §14 risks 1–2 → Task 10 step 7.
- Type consistency: `MysqlPlatformReviewsStore` (Task 2) is what Tasks 3 and 7 pass; `LOCAL_JURISDICTION_LEVELS`/`isPrecheckFresh` (Task 4) are what Task 7 imports; `precheckBaseUrlFromNotes` (Task 4) is used by Task 7; `RunSourcePrecheckOptions["scanCompliance"]` (existing export) is what Task 6 types its wrapper with; `AdminApprovalReadinessSummary` (Task 7 client alias) is what Task 8's helpers take.
- Known assumption to verify at Task 6: `PlatformPauseRegistry.pausedUntil` returns `null` when not paused, and `PlatformTickBudget.reserve` returns `null` only when the remaining allowance is below the requested cost.
