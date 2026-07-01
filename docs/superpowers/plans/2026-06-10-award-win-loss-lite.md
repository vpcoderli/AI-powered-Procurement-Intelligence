# Award / Win-Loss Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow Award / Win-Loss Lite panel to Intent detail so teams can record award outcome, winner, amount, tabulation link, loss reason, and next action after submission.

**Architecture:** Store one manual `award_outcomes` snapshot per intent, scoped to the user's workspace organization and linked back to bid/intent/user. Expose a small intent-scoped GET/PATCH API at `/api/intents/[id]/award`, route it through existing feature gating, and render it as an extracted `AwardWinLossPanel` on the Intent detail page. Keep all outcome intelligence deterministic and user-entered; no scraping, competitive intelligence engine, or AI learning loop is part of this Lite slice.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle SQLite schema, SQLite migration runner, MySQL DDL conversion/runtime path, Vitest, existing auth/feature gate helpers, existing Intent detail panel patterns, i18n dictionaries.

---

## Scope Guard

This plan is for a follow-up implementation worker. The current Worker D deliverable is only this plan document.

Implementation workers should avoid billing, AI internals, production operations docs, and unrelated UI refactors. If `docs/product-requirements/*` remains reserved for the controller, complete code/tests first and hand off the status-doc update as the final integration step.

## Existing Patterns To Reuse

- Intent-scoped paid workflow modules already use `frontend/src/server/<module>`, `frontend/src/app/api/intents/[id]/<module>/route.ts`, `frontend/src/lib/api/intents.ts`, extracted panels under `frontend/src/components/intents`, static page wiring tests, and feature coverage in `frontend/src/server/auth/feature-gate-routes.ts`.
- MySQL support is service/repository selected at runtime, not route-local SQL. `frontend/src/server/db/mysql.ts` converts the SQLite migration DDL into MySQL DDL and has column migrations only for legacy column additions.
- Existing unimplemented entitlement key `award.tabulation.analyze` should gate this Lite module. Do not add a new feature key unless product explicitly decides Award / Win-Loss Lite belongs below Enterprise.

## Data Model Recommendation

Create one table named `award_outcomes`, with one active row per `intent_id`.

Recommended fields:

```ts
awardOutcomes = sqliteTable("award_outcomes", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  intentId: text("intent_id").notNull().references(() => intentToBid.id, { onDelete: "cascade" }),
  bidId: text("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("awaiting_award"),
  awardNoticeUrl: text("award_notice_url").notNull().default(""),
  tabulationArtifactId: text("tabulation_artifact_id").references(() => supplierArtifacts.id, { onDelete: "set null" }),
  tabulationArtifactUrl: text("tabulation_artifact_url").notNull().default(""),
  winnerName: text("winner_name").notNull().default(""),
  awardAmountCents: integer("award_amount_cents"),
  currency: text("currency").notNull().default("USD"),
  lossReason: text("loss_reason").notNull().default("unknown"),
  lossReasonNotes: text("loss_reason_notes").notNull().default(""),
  nextAction: text("next_action").notNull().default("capture_tabulation"),
  nextActionDueAt: text("next_action_due_at"),
  notes: text("notes").notNull().default(""),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

Recommended indexes:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_award_outcomes_intent_id ON award_outcomes(intent_id);
CREATE INDEX IF NOT EXISTS idx_award_outcomes_organization_id ON award_outcomes(organization_id);
CREATE INDEX IF NOT EXISTS idx_award_outcomes_user_id ON award_outcomes(user_id);
CREATE INDEX IF NOT EXISTS idx_award_outcomes_status ON award_outcomes(status);
CREATE INDEX IF NOT EXISTS idx_award_outcomes_next_action_due_at ON award_outcomes(next_action_due_at);
```

Recommended status enum:

```ts
export const AWARD_OUTCOME_STATUSES = [
  "awaiting_award",
  "awarded_to_us",
  "awarded_to_competitor",
  "cancelled",
  "no_award",
  "unknown",
] as const;
```

Recommended loss reason taxonomy:

```ts
export const LOSS_REASON_CODES = [
  "price_uncompetitive",
  "technical_score",
  "compliance_gap",
  "past_performance",
  "incumbent_or_relationship",
  "schedule_or_capacity",
  "small_business_or_set_aside",
  "scope_fit",
  "buyer_cancelled_or_no_award",
  "unknown",
] as const;
```

Recommended next action enum:

```ts
export const AWARD_NEXT_ACTIONS = [
  "capture_tabulation",
  "request_debrief",
  "update_pricing",
  "fix_compliance_gap",
  "refresh_past_performance",
  "requalify_future_bid",
  "archive",
  "none",
] as const;
```

Validation rules:

- `awardAmountCents` must be `null` or an integer `>= 0`.
- `awardNoticeUrl` and `tabulationArtifactUrl` must be empty strings or `http://` / `https://` URLs.
- `tabulationArtifactId` must be `null` or an existing non-deleted `supplier_artifacts.id` for the same `intentId`.
- `winnerName` is expected for `awarded_to_competitor`; `winnerName` can be the user's organization name or a short label for `awarded_to_us`.
- `lossReason` is meaningful only for `awarded_to_competitor`, `cancelled`, or `no_award`; keep it as `"unknown"` for `awaiting_award` unless the user explicitly selects another reason.
- `nextActionDueAt` must be `null` or an ISO/date string accepted by existing date-input conventions.

## API Recommendation

Use `/api/intents/[id]/award`.

Rationale: the resource is the award outcome for an intent, and "win-loss" is the interpretation of that outcome. Keeping one route avoids parallel `/award` and `/win-loss` state drifting.

Recommended route behavior:

- `GET /api/intents/[id]/award`
  - Requires authenticated principal.
  - Requires `requireFeature(principal, "award.tabulation.analyze")`.
  - Returns `{ outcome }`.
  - Creates a default `awaiting_award` row on first access, matching the existing Lite module pattern.
- `PATCH /api/intents/[id]/award`
  - Requires authenticated principal and same feature gate.
  - Accepts partial manual outcome fields.
  - Returns `{ outcome }`.
  - Rejects invalid enums, invalid URLs, negative amounts, and cross-intent tabulation artifacts with `INVALID_REQUEST`.

Recommended request body:

```ts
export interface UpdateAwardOutcomeInput {
  status?: AwardOutcomeStatus;
  awardNoticeUrl?: string;
  tabulationArtifactId?: string | null;
  tabulationArtifactUrl?: string;
  winnerName?: string;
  awardAmountCents?: number | null;
  currency?: string;
  lossReason?: LossReasonCode;
  lossReasonNotes?: string;
  nextAction?: AwardNextAction;
  nextActionDueAt?: string | null;
  notes?: string;
  decidedAt?: string | null;
}
```

## UI Recommendation

Create `frontend/src/components/intents/AwardWinLossPanel.tsx` and mount it in `frontend/src/app/intents/[id]/page.tsx` after `DeadlineNotificationsPanel` and before the Knowledge Station section. This makes the module read as a post-submission workflow step while preserving existing large sections.

Keep page changes small:

- Import `AwardWinLossPanel`.
- Add `awardOutcomeFeature = useFeature("award.tabulation.analyze")`.
- Add `awardOutcome`, loading/saving/error/notice state.
- Add one `useEffect` to call `fetchAwardOutcome(intentId)` when the feature is enabled.
- Add one handler `handleAwardOutcomeUpdate(patch)` that calls `updateAwardOutcome`.
- Render `<AwardWinLossPanel ... />` with props, using existing `lockedFeatureMessage("award.tabulation.analyze")`.

Panel controls:

- Summary row: status, winner, amount, next action due date.
- Status select using `AWARD_OUTCOME_STATUSES`.
- Award notice URL input with external link preview when safe.
- Tabulation artifact select from `artifactVault?.artifacts ?? []`, plus optional external tabulation URL.
- Winner and award amount inputs.
- Loss reason select and notes textarea.
- Next action select, next-action due date input, and general notes textarea.
- Locked, loading, empty/default, error, and save notice states using `UniversalState` and existing panel styling.

## Implementation Order

1. SQLite/MySQL migration and schema.
2. Server types and enum guards.
3. Repository functions for SQLite and MySQL.
4. Service validation, default seeding, workspace scoping, and artifact-link validation.
5. API route plus feature coverage.
6. Client helpers.
7. Intent page state/effect/handler wiring and extracted UI panel.
8. i18n dictionary labels.
9. Status docs update, only where the integration owner permits it.
10. Focused tests, then shared regression gate.

## TDD Task Breakdown

### Task 1: Schema And Migration

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`
- Modify: `frontend/src/server/db/mysql.test.ts`

- [ ] **Step 1: Write failing SQLite schema assertions**

Add expectations to `frontend/src/server/db/schema.test.ts` under `"creates supplier profile and intent tables"`:

```ts
expect(tables).toContain("award_outcomes");

const awardOutcomeColumns = testDb.db.$client
  .prepare("PRAGMA table_info(award_outcomes)")
  .all()
  .map((row) => (row as { name: string }).name);

expect(awardOutcomeColumns).toEqual(expect.arrayContaining([
  "id",
  "organization_id",
  "intent_id",
  "bid_id",
  "user_id",
  "status",
  "award_notice_url",
  "tabulation_artifact_id",
  "tabulation_artifact_url",
  "winner_name",
  "award_amount_cents",
  "currency",
  "loss_reason",
  "loss_reason_notes",
  "next_action",
  "next_action_due_at",
  "notes",
  "decided_at",
  "created_at",
  "updated_at",
]));

expect(
  testDb.db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get("idx_award_outcomes_intent_id"),
).toEqual({ name: "idx_award_outcomes_intent_id" });
```

Run: `cd frontend && npm test -- src/server/db/schema.test.ts`

Expected: FAIL because `award_outcomes` does not exist.

- [ ] **Step 2: Add Drizzle schema and SQLite migration**

Add `awardOutcomes` to `schema.ts` near other intent workflow tables. Add matching `CREATE TABLE IF NOT EXISTS award_outcomes` and indexes to the main SQLite DDL block in `migrate.ts`. Use a unique intent index, not a user+intent index, because workspace members should see one shared outcome for the intent.

Run: `cd frontend && npm test -- src/server/db/schema.test.ts`

Expected: PASS, including legacy migration tests.

- [ ] **Step 3: Write failing MySQL DDL assertion**

Add to `frontend/src/server/db/mysql.test.ts`:

```ts
expect(joined).toContain("CREATE TABLE IF NOT EXISTS award_outcomes");
expect(joined).toContain("award_notice_url LONGTEXT NOT NULL DEFAULT ('')");
expect(joined).toContain("idx_award_outcomes_intent_id");
```

Run: `cd frontend && npm test -- src/server/db/mysql.test.ts`

Expected: PASS after Step 2 because MySQL DDL is converted from SQLite DDL. If it fails, adjust the SQLite DDL so indexed columns convert to `VARCHAR(191)` and long text defaults use converter-safe defaults.

- [ ] **Step 4: Commit schema work**

Run: `git add frontend/src/server/db/schema.ts frontend/src/server/db/migrate.ts frontend/src/server/db/schema.test.ts frontend/src/server/db/mysql.test.ts && git commit -m "feat: add award outcome schema"`

Expected: commit contains only schema/migration/test files for this task.

### Task 2: Award Types And Repository

**Files:**
- Create: `frontend/src/server/awards/types.ts`
- Create: `frontend/src/server/awards/repository.ts`
- Create: `frontend/src/server/awards/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

`repository.test.ts` should cover:

- SQLite `findAwardOutcomeRow(db, organizationId, intentId)` returns the single row for that org/intent.
- SQLite `upsertAwardOutcomeRow(db, row)` creates a row and updates the same `intentId` without duplicating.
- MySQL `findAwardOutcomeRowFromMysql(mysql, organizationId, intentId)` aliases snake_case columns into camelCase.
- MySQL `upsertAwardOutcomeRowFromMysql(mysql, row)` uses `ON DUPLICATE KEY UPDATE` on the unique intent index.

Run: `cd frontend && npm test -- src/server/awards/repository.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Add public types and guards**

In `types.ts`, define `AWARD_OUTCOME_STATUSES`, `LOSS_REASON_CODES`, `AWARD_NEXT_ACTIONS`, `AwardOutcome`, `UpdateAwardOutcomeInput`, `AwardOutcomeResponse`, and guard functions:

```ts
export function isAwardOutcomeStatus(value: unknown): value is AwardOutcomeStatus {
  return typeof value === "string" && AWARD_OUTCOME_STATUSES.includes(value as AwardOutcomeStatus);
}
```

Repeat the guard pattern for loss reasons and next actions.

- [ ] **Step 3: Add SQLite and MySQL repository functions**

Repository functions to expose:

```ts
export function findAwardOutcomeRow(db: AppDatabase, organizationId: string, intentId: string): AwardOutcomeRow | undefined;
export function upsertAwardOutcomeRow(db: AppDatabase, row: AwardOutcomeRow): AwardOutcomeRow;
export async function findAwardOutcomeRowFromMysql(mysql: MysqlAwardRepository, organizationId: string, intentId: string): Promise<AwardOutcomeRow | null>;
export async function upsertAwardOutcomeRowFromMysql(mysql: MysqlAwardRepository, row: AwardOutcomeRow): Promise<AwardOutcomeRow>;
```

Keep the MySQL interface local and compatible with existing repositories:

```ts
interface MysqlAwardRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}
```

Run: `cd frontend && npm test -- src/server/awards/repository.test.ts`

Expected: PASS with both SQLite and mocked MySQL cases.

- [ ] **Step 4: Commit repository work**

Run: `git add frontend/src/server/awards/types.ts frontend/src/server/awards/repository.ts frontend/src/server/awards/repository.test.ts && git commit -m "feat: add award outcome repository"`

Expected: commit contains only award type/repository files.

### Task 3: Award Service

**Files:**
- Create: `frontend/src/server/awards/service.ts`
- Create: `frontend/src/server/awards/service.test.ts`

- [ ] **Step 1: Write failing service tests**

`service.test.ts` should cover:

- `getAwardOutcome(db, userId, intentId)` creates an `awaiting_award` row on first access.
- Existing outcome is returned without overwriting manual fields.
- `updateAwardOutcome(db, userId, intentId, input)` persists `awarded_to_us` with winner/amount/notice URL.
- `updateAwardOutcome` persists `awarded_to_competitor` with winner/loss reason/next action.
- Invalid status, invalid loss reason, invalid next action, invalid URL, and negative `awardAmountCents` throw `AwardOutcomeValidationError`.
- A `tabulationArtifactId` from another intent is rejected.
- Missing or inaccessible intent throws `IntentNotFoundError`.

Run: `cd frontend && npm test -- src/server/awards/service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement default seeding and hydration**

Service functions:

```ts
export async function getAwardOutcome(db: AppDatabase, userId: string, intentId: string): Promise<AwardOutcome>;
export async function updateAwardOutcome(
  db: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateAwardOutcomeInput,
): Promise<AwardOutcome>;
```

Use `getUserIntent(db, userId, intentId)` for intent access, then `ensureUserWorkspace` or `ensureMysqlUserWorkspace` for `organizationId`. Create default row with:

```ts
{
  status: "awaiting_award",
  awardNoticeUrl: "",
  tabulationArtifactId: null,
  tabulationArtifactUrl: "",
  winnerName: "",
  awardAmountCents: null,
  currency: "USD",
  lossReason: "unknown",
  lossReasonNotes: "",
  nextAction: "capture_tabulation",
  nextActionDueAt: null,
  notes: "",
  decidedAt: null,
}
```

- [ ] **Step 3: Implement validation**

Validation should be explicit and deterministic:

```ts
if (input.status !== undefined && !isAwardOutcomeStatus(input.status)) {
  throw new AwardOutcomeValidationError("Award outcome status is invalid.");
}
```

Use equivalent checks for loss reason, next action, amount, URLs, and artifact ownership.

Run: `cd frontend && npm test -- src/server/awards/service.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit service work**

Run: `git add frontend/src/server/awards/service.ts frontend/src/server/awards/service.test.ts && git commit -m "feat: add award outcome service"`

Expected: commit contains only service files.

### Task 4: API Route And Feature Coverage

**Files:**
- Create: `frontend/src/app/api/intents/[id]/award/route.ts`
- Create: `frontend/src/app/api/intents/[id]/award/route.test.ts`
- Modify: `frontend/src/server/auth/feature-gate-routes.ts`
- Modify: `frontend/src/server/db/mysql-route-coverage.test.ts`

- [ ] **Step 1: Write failing route tests**

Use the same mocked-principal shape as quote/deadline route tests. Cover:

- GET returns `{ outcome }` for authenticated principal with `features: ["award.tabulation.analyze"]`.
- GET returns `FEATURE_NOT_AVAILABLE` when the feature is missing.
- PATCH accepts a partial outcome update.
- PATCH rejects malformed enum or negative amount with `INVALID_REQUEST`.

Run: `cd frontend && npm test -- 'src/app/api/intents/[id]/award/route.test.ts'`

Expected: FAIL because route does not exist.

- [ ] **Step 2: Implement route**

Use the existing route helpers pattern:

```ts
requireFeature(principal, "award.tabulation.analyze");
const { id } = await context.params;
const outcome = await getAwardOutcome(db, principal.userId, id);
return jsonWithPrincipalCookie({ outcome }, principal);
```

PATCH should parse only known keys from `UpdateAwardOutcomeInput` and reject unknown non-object bodies.

Run: `cd frontend && npm test -- 'src/app/api/intents/[id]/award/route.test.ts'`

Expected: PASS.

- [ ] **Step 3: Register feature coverage**

Add to `FEATURE_API_COVERAGE`:

```ts
{
  sourcePath: "../../app/api/intents/[id]/award/route.ts",
  feature: "award.tabulation.analyze",
  methods: ["GET", "PATCH"],
}
```

Remove `"award.tabulation.analyze"` from `UNIMPLEMENTED_PAID_FEATURE_API_COVERAGE`.

Add `"intents/[id]/award/route.ts"` to `SERVICE_LEVEL_MYSQL_ROUTES` in `mysql-route-coverage.test.ts` with reason `"award outcome service selects MySQL repositories at runtime"`.

Run: `cd frontend && npm test -- src/server/auth/feature-gate-coverage.test.ts src/server/db/mysql-route-coverage.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit API work**

Run: `git add 'frontend/src/app/api/intents/[id]/award/route.ts' 'frontend/src/app/api/intents/[id]/award/route.test.ts' frontend/src/server/auth/feature-gate-routes.ts frontend/src/server/db/mysql-route-coverage.test.ts && git commit -m "feat: expose award outcome API"`

Expected: commit contains route and coverage files only.

### Task 5: Client Helpers

**Files:**
- Modify: `frontend/src/lib/api/intents.ts`
- Modify: `frontend/src/lib/api/intents.test.ts`

- [ ] **Step 1: Write failing client tests**

Add tests:

```ts
it("fetches award outcome with an encoded intent id", async () => {
  const body = { outcome: { intentId: "intent/with space", status: "awaiting_award" } };
  mockFetch.mockResolvedValueOnce(jsonResponse(body));

  const result = await fetchAwardOutcome("intent/with space");

  expect(result).toEqual(body);
  expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/award");
});
```

Add a PATCH test for `updateAwardOutcome("intent/with space", { status: "awarded_to_competitor", lossReason: "price_uncompetitive" })`.

Run: `cd frontend && npm test -- src/lib/api/intents.test.ts`

Expected: FAIL because client helpers do not exist.

- [ ] **Step 2: Add client helpers**

Add imports from `@/server/awards/types` and functions:

```ts
export async function fetchAwardOutcome(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/award`);
  return parseResponse<AwardOutcomeResponse>(response);
}

export async function updateAwardOutcome(id: string, input: UpdateAwardOutcomeInput) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/award`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AwardOutcomeResponse>(response);
}
```

Run: `cd frontend && npm test -- src/lib/api/intents.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit client work**

Run: `git add frontend/src/lib/api/intents.ts frontend/src/lib/api/intents.test.ts && git commit -m "feat: add award outcome client"`

Expected: commit contains only client helper changes.

### Task 6: Intent UI Panel And i18n

**Files:**
- Create: `frontend/src/components/intents/AwardWinLossPanel.tsx`
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/app/intents/[id]/page.test.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Write failing static wiring tests**

In `page.test.ts`, add `AwardWinLossPanel.tsx` to `readIntentComponent` checks. Assert page contains:

```ts
expect(page).toContain('import { AwardWinLossPanel } from "@/components/intents/AwardWinLossPanel"');
expect(page).toContain("fetchAwardOutcome");
expect(page).toContain("updateAwardOutcome");
expect(page).toContain('useFeature("award.tabulation.analyze")');
expect(page).toContain("awardOutcome");
expect(page).toContain("handleAwardOutcomeUpdate");
expect(panel).toContain('t("intentsPage.awardWinLoss")');
expect(panel).toContain('t("intentsPage.awardNoticeUrl")');
expect(panel).toContain('t("intentsPage.lossReason")');
expect(panel).toContain('t("intentsPage.nextAction")');
expect(panel).toContain('code="plan_limit"');
expect(panel).toContain('code="error"');
```

In `page.test.tsx`, assert the extracted panel boundary:

```ts
expect(page).toContain('import { AwardWinLossPanel } from "@/components/intents/AwardWinLossPanel"');
expect(page).toContain("<AwardWinLossPanel");
```

Run: `cd frontend && npm test -- 'src/app/intents/[id]/page.test.ts' 'src/app/intents/[id]/page.test.tsx'`

Expected: FAIL because panel and wiring do not exist.

- [ ] **Step 2: Build `AwardWinLossPanel`**

Panel props:

```ts
interface AwardWinLossPanelProps {
  availableArtifacts: ArtifactVault["artifacts"];
  error: Error | null;
  featureEnabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  lockedMessage: string;
  notice: string;
  onUpdate: (patch: UpdateAwardOutcomeInput) => void;
  outcome: AwardOutcome | null;
  t: Translator;
}
```

Use existing controls: `Badge`, `Button`, `Input`, `Select`, `UniversalState`, and a `Trophy` or `Medal` lucide icon. Keep the panel self-contained and avoid adding another large inline section to the already-large Intent page.

- [ ] **Step 3: Wire Intent page**

Add state:

```ts
const [awardOutcome, setAwardOutcome] = useState<AwardOutcome | null>(null);
const [isAwardOutcomeLoading, setIsAwardOutcomeLoading] = useState(false);
const [isAwardOutcomeSaving, setIsAwardOutcomeSaving] = useState(false);
const [awardOutcomeError, setAwardOutcomeError] = useState<Error | null>(null);
const [awardOutcomeNotice, setAwardOutcomeNotice] = useState("");
const awardOutcomeFeature = useFeature("award.tabulation.analyze");
```

Add a feature-gated effect and `handleAwardOutcomeUpdate` that mirrors quote/deadline handlers. Render:

```tsx
<AwardWinLossPanel
  availableArtifacts={artifactVault?.artifacts ?? []}
  error={awardOutcomeError}
  featureEnabled={awardOutcomeFeature.enabled}
  isLoading={isAwardOutcomeLoading}
  isSaving={isAwardOutcomeSaving}
  lockedMessage={lockedFeatureMessage("award.tabulation.analyze")}
  notice={awardOutcomeNotice}
  onUpdate={(patch) => void handleAwardOutcomeUpdate(patch)}
  outcome={awardOutcome}
  t={t}
/>
```

- [ ] **Step 4: Add English and Chinese dictionary keys**

Required keys include:

```text
intentsPage.awardWinLoss
intentsPage.awardWinLossDescription
intentsPage.awardOutcomeStatus
intentsPage.awardNoticeUrl
intentsPage.tabulationArtifact
intentsPage.tabulationArtifactUrl
intentsPage.winnerName
intentsPage.awardAmount
intentsPage.lossReason
intentsPage.lossReasonNotes
intentsPage.nextAction
intentsPage.nextActionDueAt
intentsPage.awardNotes
intentsPage.saveAwardOutcome
intentsPage.awardOutcomeLoading
intentsPage.awardOutcomeSaved
intentsPage.awardOutcomeError
intentsPage.awardOutcomeEmpty
intentsPage.awardStatuses.*
intentsPage.lossReasons.*
intentsPage.awardNextActions.*
```

Run: `cd frontend && npm test -- 'src/app/intents/[id]/page.test.ts' 'src/app/intents/[id]/page.test.tsx'`

Expected: PASS.

- [ ] **Step 5: Commit UI work**

Run: `git add frontend/src/components/intents/AwardWinLossPanel.tsx 'frontend/src/app/intents/[id]/page.tsx' 'frontend/src/app/intents/[id]/page.test.ts' 'frontend/src/app/intents/[id]/page.test.tsx' frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts && git commit -m "feat: add award win loss panel"`

Expected: commit contains only Intent UI and dictionary changes.

### Task 7: Documentation And Final Verification

**Files:**
- Modify if assigned by controller: `docs/product-requirements/winbids-implementation-status.md`
- Modify if assigned by controller: `docs/product-requirements/winbids-next-development-plan.md`

- [ ] **Step 1: Update status docs only if ownership is clear**

If the controller allows product-requirements docs edits, mark Award / Win-Loss Lite as implemented under Procurement Workflow Depth and leave advanced tabulation analysis as not implemented. If docs ownership is reserved, write a short handoff note in the PR/worker summary with the exact sentence the controller should apply.

Acceptance: no production docs are touched, and product docs are touched only when the controller has assigned that integration work.

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/server/db/schema.test.ts src/server/db/mysql.test.ts src/server/awards/repository.test.ts src/server/awards/service.test.ts 'src/app/api/intents/[id]/award/route.test.ts' src/server/auth/feature-gate-coverage.test.ts src/server/db/mysql-route-coverage.test.ts src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts' 'src/app/intents/[id]/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 3: Run shared regression gate**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run risk:check
git diff --check
```

Expected: PASS. If `npm run risk:check` fails because `npm audit` reports pre-existing advisories, capture the advisory IDs and confirm whether they predate this branch.

- [ ] **Step 4: Browser smoke**

Start the dev server:

```bash
cd frontend
npm run dev -- --port 3000
```

Verify in browser:

```text
http://localhost:3000/intents/[existing-intent-id]
```

Acceptance:

- A user without `award.tabulation.analyze` sees the locked Award / Win-Loss panel.
- A user with the feature sees the panel load.
- Updating status, winner, amount, loss reason, and next action persists after refresh.
- Existing Submission, Compliance, Response Workspace, Artifact Vault, Quote, Deadline, and Knowledge sections still render.

- [ ] **Step 5: Commit docs/status work**

Run only if docs changed:

```bash
git add docs/product-requirements/winbids-implementation-status.md docs/product-requirements/winbids-next-development-plan.md
git commit -m "docs: update award win loss status"
```

Expected: docs commit is separate from product code commits.

## Explicit Non-Goals

- No automatic award notice scraping.
- No automatic tabulation PDF parsing or competitive intelligence extraction.
- No price-to-win model or win probability scoring.
- No real AI learning loop from outcomes.
- No changes to billing, Stripe, credits, production worker scripts, or AI provider internals.
- No broad Intent page redesign; only extracted panel wiring and the minimal state/effect/handler needed for the new module.
- No production operations documentation changes for this Lite feature.

## Handoff Summary For Implementers

The smallest complete slice is: `award_outcomes` table, `server/awards` types/repository/service, `/api/intents/[id]/award`, `fetchAwardOutcome` / `updateAwardOutcome`, and `AwardWinLossPanel` mounted on Intent detail behind `award.tabulation.analyze`. Treat it as manual CRM-style outcome capture. The feature is done when a qualified user can record won/lost/cancelled/no-award outcome details and revisit them later from the same Intent.
