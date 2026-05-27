# WinBids Phase 1A Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1A bid pursuit loop: supplier profile, match score, Intent to Bid, and deterministic bid brief/checklist.

**Architecture:** Extend the existing modular monolith. Store supplier profiles and intent records in SQLite through Drizzle schema/migration additions, expose focused Next.js API routes, and connect client pages through small API wrappers. Keep AI brief/checklist deterministic in server code for this phase.

**Tech Stack:** Next.js App Router, React client pages, TypeScript, Drizzle ORM, SQLite, Vitest, existing shadcn-style UI components, existing i18n dictionaries.

---

## File Structure

Create:

- `frontend/src/server/profile/types.ts` — supplier profile DTOs, defaults, validation helpers.
- `frontend/src/server/profile/repository.ts` — SQLite read/upsert functions for `supplier_profiles`.
- `frontend/src/server/profile/service.ts` — current-user profile operations and completion scoring.
- `frontend/src/server/profile/service.test.ts` — service tests.
- `frontend/src/app/api/company/profile/route.ts` — `GET` and `PUT` profile API.
- `frontend/src/app/api/company/profile/route.test.ts` — API route tests.
- `frontend/src/lib/api/profile.ts` — browser client for profile API.
- `frontend/src/lib/api/profile.test.ts` — client wrapper tests.
- `frontend/src/server/match/types.ts` — match result types.
- `frontend/src/server/match/service.ts` — deterministic match score calculation.
- `frontend/src/server/match/service.test.ts` — match tests.
- `frontend/src/app/api/bids/[id]/match/route.ts` — bid match API.
- `frontend/src/app/api/bids/[id]/match/route.test.ts` — match API route tests.
- `frontend/src/lib/api/match.ts` — browser client for match API.
- `frontend/src/lib/api/match.test.ts` — client wrapper tests.
- `frontend/src/server/intents/types.ts` — intent DTOs and status types.
- `frontend/src/server/intents/brief-generator.ts` — deterministic brief/checklist/risk generator.
- `frontend/src/server/intents/brief-generator.test.ts` — generator tests.
- `frontend/src/server/intents/repository.ts` — intent persistence.
- `frontend/src/server/intents/service.ts` — create/list/get/update intent workflows.
- `frontend/src/server/intents/service.test.ts` — intent service tests.
- `frontend/src/app/api/bids/[id]/intent/route.ts` — create intent API.
- `frontend/src/app/api/intents/route.ts` — list intents API.
- `frontend/src/app/api/intents/[id]/route.ts` — get/update intent API.
- `frontend/src/app/api/intents/route.test.ts` — list route tests.
- `frontend/src/app/api/intents/[id]/route.test.ts` — detail/update route tests.
- `frontend/src/lib/api/intents.ts` — browser client for intents.
- `frontend/src/lib/api/intents.test.ts` — client wrapper tests.
- `frontend/src/app/profile/page.tsx` — supplier profile page.
- `frontend/src/app/profile/page.test.ts` — static page content test.
- `frontend/src/app/intents/page.tsx` — intent list page.
- `frontend/src/app/intents/[id]/page.tsx` — intent workspace page.
- `frontend/src/app/intents/page.test.ts` — static page content test.

Modify:

- `frontend/src/server/db/schema.ts` — add `supplierProfiles` and `intentToBid`.
- `frontend/src/server/db/migrate.ts` — create new tables and indexes.
- `frontend/src/server/db/schema.test.ts` — assert new tables exist.
- `frontend/src/server/db/seed.ts` — seed a default anonymous supplier profile.
- `frontend/src/components/layout/app-sidebar.tsx` — add Profile and Intent navigation items.
- `frontend/src/lib/i18n/dictionaries/en.ts` — add common/profile/intent/detail labels.
- `frontend/src/lib/i18n/dictionaries/zh.ts` — add Chinese labels matching `Dictionary`.
- `frontend/src/app/bids/[id]/page.tsx` — show pursuit panel, match score, intent action, brief/checklist after intent creation.
- `frontend/src/lib/api/bids.ts` only if shared error handling needs new error codes.
- `docs/operation-guide.md` — add Phase 1A usage notes after implementation.

Do not modify:

- `.DS_Store`
- `frontend/data/notification-outbox/`
- crawler source code
- existing static UI/UE route except if tests reveal global layout breakage

---

### Task 1: Database Schema and Migration

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`
- Modify: `frontend/src/server/db/seed.ts`

- [ ] **Step 1: Write the failing schema test**

Add assertions to `frontend/src/server/db/schema.test.ts` that migrated test DB includes both new tables:

```ts
it("creates supplier profile and intent tables", async () => {
  const testDb = await createTestDatabase({ seed: false });

  const tables = testDb.db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);

  expect(tables).toContain("supplier_profiles");
  expect(tables).toContain("intent_to_bid");

  testDb.cleanup();
});
```

- [ ] **Step 2: Run the schema test and verify failure**

Run:

```bash
cd frontend
npm test -- src/server/db/schema.test.ts
```

Expected: FAIL because `supplier_profiles` and `intent_to_bid` do not exist.

- [ ] **Step 3: Add Drizzle schema definitions**

Add to `frontend/src/server/db/schema.ts` after `savedBids`:

```ts
export const supplierProfiles = sqliteTable("supplier_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull().default(""),
  businessTypes: text("business_types").notNull().default("[]"),
  categories: text("categories").notNull().default("[]"),
  keywords: text("keywords").notNull().default("[]"),
  certifications: text("certifications").notNull().default("[]"),
  serviceStates: text("service_states").notNull().default("[]"),
  minContractValue: integer("min_contract_value"),
  maxContractValue: integer("max_contract_value"),
  riskPreferences: text("risk_preferences").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const intentToBid = sqliteTable(
  "intent_to_bid",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("intent_added"),
    aiBidBrief: text("ai_bid_brief").notNull().default(""),
    keyDatesJson: text("key_dates_json").notNull().default("{}"),
    initialChecklistJson: text("initial_checklist_json").notNull().default("[]"),
    riskFlagsJson: text("risk_flags_json").notNull().default("[]"),
    matchScoreSnapshotJson: text("match_score_snapshot_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    userBidIdx: uniqueIndex("idx_intent_to_bid_user_bid").on(table.userId, table.bidId),
    userIdx: index("idx_intent_to_bid_user_id").on(table.userId),
    bidIdx: index("idx_intent_to_bid_bid_id").on(table.bidId),
  }),
);
```

- [ ] **Step 4: Add SQL migrations**

Add matching SQL to `frontend/src/server/db/migrate.ts` before index creation completes:

```sql
CREATE TABLE IF NOT EXISTS supplier_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL DEFAULT '',
  business_types TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  certifications TEXT NOT NULL DEFAULT '[]',
  service_states TEXT NOT NULL DEFAULT '[]',
  min_contract_value INTEGER,
  max_contract_value INTEGER,
  risk_preferences TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intent_to_bid (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'intent_added',
  ai_bid_brief TEXT NOT NULL DEFAULT '',
  key_dates_json TEXT NOT NULL DEFAULT '{}',
  initial_checklist_json TEXT NOT NULL DEFAULT '[]',
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  match_score_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_to_bid_user_bid ON intent_to_bid(user_id, bid_id);
CREATE INDEX IF NOT EXISTS idx_intent_to_bid_user_id ON intent_to_bid(user_id);
CREATE INDEX IF NOT EXISTS idx_intent_to_bid_bid_id ON intent_to_bid(bid_id);
```

- [ ] **Step 5: Seed a default profile**

In `frontend/src/server/db/seed.ts`, after inserting `anon_seed`, insert:

```ts
db.insert(supplierProfiles)
  .values({
    userId: "anon_seed",
    companyName: "Demo Supply Co.",
    businessTypes: JSON.stringify(["distributor", "service provider"]),
    categories: JSON.stringify(["cloud", "cybersecurity", "logistics", "medical supplies"]),
    keywords: JSON.stringify(["cloud", "security", "logistics", "analytics", "emergency"]),
    certifications: JSON.stringify(["SBE"]),
    serviceStates: JSON.stringify(["US", "CA", "TX", "NY", "FL", "IL"]),
    minContractValue: 25_000,
    maxContractValue: 5_000_000,
    riskPreferences: JSON.stringify(["avoid missing attachments", "watch short deadlines"]),
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
  })
  .onConflictDoUpdate({
    target: supplierProfiles.userId,
    set: {
      companyName: "Demo Supply Co.",
      businessTypes: JSON.stringify(["distributor", "service provider"]),
      categories: JSON.stringify(["cloud", "cybersecurity", "logistics", "medical supplies"]),
      keywords: JSON.stringify(["cloud", "security", "logistics", "analytics", "emergency"]),
      certifications: JSON.stringify(["SBE"]),
      serviceStates: JSON.stringify(["US", "CA", "TX", "NY", "FL", "IL"]),
      minContractValue: 25_000,
      maxContractValue: 5_000_000,
      riskPreferences: JSON.stringify(["avoid missing attachments", "watch short deadlines"]),
      updatedAt: SEED_TIMESTAMP,
    },
  })
  .run();
```

Also update imports:

```ts
import { bidAttachments, bids, dataSources, supplierProfiles, users } from "./schema";
```

- [ ] **Step 6: Run schema tests**

Run:

```bash
cd frontend
npm test -- src/server/db/schema.test.ts src/server/db/seed.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/server/db/schema.ts frontend/src/server/db/migrate.ts frontend/src/server/db/schema.test.ts frontend/src/server/db/seed.ts
git commit -m "feat: add phase 1a pursuit schema"
```

---

### Task 2: Supplier Profile API and Service

**Files:**
- Create: `frontend/src/server/profile/types.ts`
- Create: `frontend/src/server/profile/repository.ts`
- Create: `frontend/src/server/profile/service.ts`
- Create: `frontend/src/server/profile/service.test.ts`
- Create: `frontend/src/app/api/company/profile/route.ts`
- Create: `frontend/src/app/api/company/profile/route.test.ts`
- Create: `frontend/src/lib/api/profile.ts`
- Create: `frontend/src/lib/api/profile.test.ts`

- [ ] **Step 1: Write failing profile service tests**

Create `frontend/src/server/profile/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { getSupplierProfile, upsertSupplierProfile } from "./service";

describe("supplier profile service", () => {
  it("returns an empty profile shape when the user has no profile", async () => {
    const testDb = await createTestDatabase({ seed: false });

    const profile = await getSupplierProfile(testDb.db, "user_profile_empty");

    expect(profile.userId).toBe("user_profile_empty");
    expect(profile.companyName).toBe("");
    expect(profile.keywords).toEqual([]);
    expect(profile.completionScore).toBe(0);

    testDb.cleanup();
  });

  it("upserts a supplier profile and computes completion", async () => {
    const testDb = await createTestDatabase({ seed: false });

    const profile = await upsertSupplierProfile(testDb.db, "user_profile_full", {
      companyName: "Acme Supply",
      businessTypes: ["distributor"],
      categories: ["cloud", "security"],
      keywords: ["cloud", "cybersecurity"],
      certifications: ["SBE"],
      serviceStates: ["CA", "TX"],
      minContractValue: 10000,
      maxContractValue: 250000,
      riskPreferences: ["short deadlines"],
    });

    expect(profile.companyName).toBe("Acme Supply");
    expect(profile.completionScore).toBeGreaterThanOrEqual(80);

    testDb.cleanup();
  });
});
```

- [ ] **Step 2: Run service test and verify failure**

Run:

```bash
cd frontend
npm test -- src/server/profile/service.test.ts
```

Expected: FAIL because profile service files do not exist.

- [ ] **Step 3: Implement profile types**

Create `frontend/src/server/profile/types.ts`:

```ts
export interface SupplierProfileInput {
  companyName?: string;
  businessTypes?: string[];
  categories?: string[];
  keywords?: string[];
  certifications?: string[];
  serviceStates?: string[];
  minContractValue?: number | null;
  maxContractValue?: number | null;
  riskPreferences?: string[];
}

export interface SupplierProfile extends Required<Omit<SupplierProfileInput, "minContractValue" | "maxContractValue">> {
  userId: string;
  minContractValue: number | null;
  maxContractValue: number | null;
  completionScore: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SupplierProfileResponse {
  profile: SupplierProfile;
}
```

- [ ] **Step 4: Implement repository and service**

Repository should:

- Use `ensureUser`.
- Safely parse JSON arrays.
- Store arrays as JSON text.
- Return empty profile when no row exists.

Service should:

- Trim strings.
- Drop blank array values.
- Clamp numeric values to non-negative integers or `null`.
- Calculate completion from 8 fields: company, business types, categories, keywords, certifications, service states, contract range, risk preferences.

- [ ] **Step 5: Implement API route**

Create `frontend/src/app/api/company/profile/route.ts`:

```ts
import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { getSupplierProfile, upsertSupplierProfile } from "@/server/profile/service";

function invalidRequest(message: string) {
  return NextResponse.json({ error: { code: "INVALID_REQUEST", message } }, { status: 400 });
}

export async function GET(request: Request) {
  const principal = await resolvePrincipal(db, request);
  const profile = await getSupplierProfile(db, principal.userId);
  const response = NextResponse.json({ profile });
  if (principal.kind === "anonymous" && principal.anonymousCookie) {
    response.headers.append("set-cookie", principal.anonymousCookie);
  }
  return response;
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return invalidRequest("Profile body is required.");
  }

  const principal = await resolvePrincipal(db, request);
  const profile = await upsertSupplierProfile(db, principal.userId, body);
  const response = NextResponse.json({ profile });
  if (principal.kind === "anonymous" && principal.anonymousCookie) {
    response.headers.append("set-cookie", principal.anonymousCookie);
  }
  return response;
}
```

- [ ] **Step 6: Add API route and client tests**

Route tests should assert:

- `GET` returns empty profile for anonymous user.
- `PUT` stores profile and returns score.
- invalid body returns `400`.

Client tests should mock `fetch` and verify:

```ts
await fetchSupplierProfile();
await updateSupplierProfile({ companyName: "Acme Supply", keywords: ["cloud"] });
```

- [ ] **Step 7: Run profile tests**

Run:

```bash
cd frontend
npm test -- src/server/profile/service.test.ts src/app/api/company/profile/route.test.ts src/lib/api/profile.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/server/profile frontend/src/app/api/company/profile frontend/src/lib/api/profile.ts frontend/src/lib/api/profile.test.ts
git commit -m "feat: add supplier profile API"
```

---

### Task 3: Match Score V1

**Files:**
- Create: `frontend/src/server/match/types.ts`
- Create: `frontend/src/server/match/service.ts`
- Create: `frontend/src/server/match/service.test.ts`
- Create: `frontend/src/app/api/bids/[id]/match/route.ts`
- Create: `frontend/src/app/api/bids/[id]/match/route.test.ts`
- Create: `frontend/src/lib/api/match.ts`
- Create: `frontend/src/lib/api/match.test.ts`

- [ ] **Step 1: Write failing match service tests**

Create `frontend/src/server/match/service.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import { calculateBidMatch } from "./service";

describe("match score service", () => {
  it("scores a bid higher when profile state and keywords match", () => {
    const bid = MOCK_BIDS.find((item) => item.stateCode === "CA")!;

    const result = calculateBidMatch(bid, {
      userId: "user_match",
      companyName: "Cloud Supply",
      businessTypes: ["distributor"],
      categories: ["cloud infrastructure"],
      keywords: ["cloud", "infrastructure"],
      certifications: [],
      serviceStates: ["CA"],
      minContractValue: null,
      maxContractValue: null,
      riskPreferences: [],
      completionScore: 75,
      createdAt: null,
      updatedAt: null,
    });

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.explanation).toContain("matches your service states");
  });

  it("returns missing-profile hints for an empty profile", () => {
    const result = calculateBidMatch(MOCK_BIDS[0], {
      userId: "user_empty",
      companyName: "",
      businessTypes: [],
      categories: [],
      keywords: [],
      certifications: [],
      serviceStates: [],
      minContractValue: null,
      maxContractValue: null,
      riskPreferences: [],
      completionScore: 0,
      createdAt: null,
      updatedAt: null,
    });

    expect(result.score).toBeLessThan(50);
    expect(result.missingProfileHints).toContain("Add keywords to improve bid matching.");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
cd frontend
npm test -- src/server/match/service.test.ts
```

Expected: FAIL because match service does not exist.

- [ ] **Step 3: Implement match types and service**

`calculateBidMatch(bid, profile)` should return:

```ts
export interface BidMatchResult {
  bidId: string;
  score: number;
  confidence: "low" | "medium" | "high";
  components: {
    geography: number;
    keywords: number;
    category: number;
    certifications: number;
    contractValue: number;
    deadline: number;
  };
  explanation: string;
  riskNotes: string[];
  missingProfileHints: string[];
}
```

Scoring rule:

- geography max 20
- keywords max 30
- category max 15
- certifications max 10
- contractValue max 10
- deadline max 15

Use `Math.min(100, total)` and no random values.

- [ ] **Step 4: Implement match API route**

`GET /api/bids/:id/match` should:

- Resolve principal.
- Load bid with `getBidByIdFromRepository`.
- Load profile with `getSupplierProfile`.
- Return `{ match }`.
- Return `404` when bid is missing.

- [ ] **Step 5: Add client wrapper**

Create `frontend/src/lib/api/match.ts`:

```ts
import type { BidMatchResponse } from "@/server/match/types";
import { ApiError } from "./bids";

export async function fetchBidMatch(id: string) {
  const response = await fetch(`/api/bids/${encodeURIComponent(id)}/match`);
  const body = await response.json();

  if (!response.ok) {
    throw new ApiError(response.status, body.error?.code ?? "INTERNAL_ERROR", body.error?.message ?? "Request failed");
  }

  return body as BidMatchResponse;
}
```

- [ ] **Step 6: Run match tests**

Run:

```bash
cd frontend
npm test -- src/server/match/service.test.ts src/app/api/bids/[id]/match/route.test.ts src/lib/api/match.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/server/match frontend/src/app/api/bids/[id]/match frontend/src/lib/api/match.ts frontend/src/lib/api/match.test.ts
git commit -m "feat: add bid match scoring"
```

---

### Task 4: Intent to Bid Service and APIs

**Files:**
- Create: `frontend/src/server/intents/types.ts`
- Create: `frontend/src/server/intents/brief-generator.ts`
- Create: `frontend/src/server/intents/brief-generator.test.ts`
- Create: `frontend/src/server/intents/repository.ts`
- Create: `frontend/src/server/intents/service.ts`
- Create: `frontend/src/server/intents/service.test.ts`
- Create: `frontend/src/app/api/bids/[id]/intent/route.ts`
- Create: `frontend/src/app/api/intents/route.ts`
- Create: `frontend/src/app/api/intents/[id]/route.ts`
- Create: `frontend/src/app/api/intents/route.test.ts`
- Create: `frontend/src/app/api/intents/[id]/route.test.ts`
- Create: `frontend/src/lib/api/intents.ts`
- Create: `frontend/src/lib/api/intents.test.ts`

- [ ] **Step 1: Write failing brief generator test**

Create `frontend/src/server/intents/brief-generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import { generateIntentBrief } from "./brief-generator";

describe("intent brief generator", () => {
  it("generates a brief, checklist, dates, and risk flags", () => {
    const result = generateIntentBrief({
      bid: MOCK_BIDS[0],
      match: {
        bidId: MOCK_BIDS[0].id,
        score: 72,
        confidence: "medium",
        components: { geography: 10, keywords: 20, category: 10, certifications: 0, contractValue: 10, deadline: 15 },
        explanation: "Good fit.",
        riskNotes: ["Review attachments."],
        missingProfileHints: [],
      },
    });

    expect(result.aiBidBrief).toContain(MOCK_BIDS[0].issuerName);
    expect(result.initialChecklist).toContain("Read the full solicitation and all attachments.");
    expect(result.keyDates.deadlineDate).toBe(MOCK_BIDS[0].deadlineDate);
    expect(result.riskFlags.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write failing intent service tests**

Create `frontend/src/server/intents/service.test.ts` with tests for:

- create intent stores generated fields.
- create intent is idempotent for same user/bid.
- list intents returns only the user’s intents.
- update status rejects unsupported status.

- [ ] **Step 3: Run and verify failure**

Run:

```bash
cd frontend
npm test -- src/server/intents/brief-generator.test.ts src/server/intents/service.test.ts
```

Expected: FAIL because intent files do not exist.

- [ ] **Step 4: Implement brief generator**

`generateIntentBrief` returns:

```ts
export interface GeneratedIntentContent {
  aiBidBrief: string;
  keyDates: {
    publishedDate: string;
    deadlineDate: string;
  };
  initialChecklist: string[];
  riskFlags: string[];
}
```

Use deterministic rules:

- always include 7 checklist items from the spec.
- add `Deadline is within 7 days.` when applicable.
- add `No attachments are available.` when attachments are empty.
- add `Estimated value is missing.` when `bid.amount` is blank.
- add `Contact information is incomplete.` when contact email or phone is blank.

- [ ] **Step 5: Implement repository and service**

Service API:

```ts
export async function createIntentForBid(database: AppDatabase, userId: string, bidId: string): Promise<IntentDetail>
export async function listUserIntents(database: AppDatabase, userId: string): Promise<IntentSummary[]>
export async function getUserIntent(database: AppDatabase, userId: string, intentId: string): Promise<IntentDetail | undefined>
export async function updateIntentStatus(database: AppDatabase, userId: string, intentId: string, status: IntentStatus): Promise<IntentDetail>
```

Id format:

```ts
const id = `intent_${crypto.randomUUID()}`;
```

Use `crypto.randomUUID()` from `node:crypto`.

- [ ] **Step 6: Implement API routes**

Routes:

- `POST /api/bids/[id]/intent` returns `{ intent }`.
- `GET /api/intents` returns `{ intents }`.
- `GET /api/intents/[id]` returns `{ intent }`.
- `PATCH /api/intents/[id]` accepts `{ status }` and returns `{ intent }`.

Supported status values:

```ts
["intent_added", "needs_review", "questions_needed", "sourcing_needed", "pursuit_decision_needed"]
```

- [ ] **Step 7: Implement client wrapper**

Create:

```ts
export async function createIntent(bidId: string)
export async function fetchIntents()
export async function fetchIntent(id: string)
export async function updateIntentStatus(id: string, status: IntentStatus)
```

- [ ] **Step 8: Run intent tests**

Run:

```bash
cd frontend
npm test -- src/server/intents/brief-generator.test.ts src/server/intents/service.test.ts src/app/api/bids/[id]/intent/route.test.ts src/app/api/intents/route.test.ts src/app/api/intents/[id]/route.test.ts src/lib/api/intents.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/server/intents frontend/src/app/api/bids/[id]/intent frontend/src/app/api/intents frontend/src/lib/api/intents.ts frontend/src/lib/api/intents.test.ts
git commit -m "feat: add intent to bid workflow APIs"
```

---

### Task 5: Profile UI and Navigation

**Files:**
- Create: `frontend/src/app/profile/page.tsx`
- Create: `frontend/src/app/profile/page.test.ts`
- Modify: `frontend/src/components/layout/app-sidebar.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Write failing static page test**

Create `frontend/src/app/profile/page.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

describe("profile page", () => {
  it("renders supplier profile fields and saves through the profile API", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("fetchSupplierProfile");
    expect(page).toContain("updateSupplierProfile");
    expect(page).toContain("companyName");
    expect(page).toContain("serviceStates");
    expect(page).toContain("completionScore");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
cd frontend
npm test -- src/app/profile/page.test.ts
```

Expected: FAIL because profile page does not exist.

- [ ] **Step 3: Implement profile page**

Implement a client page that:

- loads `fetchSupplierProfile` in `useEffect`.
- renders inputs for company name, keywords, categories, certifications, service states, min/max contract values, and risk preferences.
- stores arrays as comma-separated text in the form.
- saves through `updateSupplierProfile`.
- shows completion score.

Use existing `Button`, `Card`, `Input`, `Label`, and `Skeleton`.

- [ ] **Step 4: Add sidebar items**

In `frontend/src/components/layout/app-sidebar.tsx`, add:

```ts
import { ClipboardList, UserRound } from "lucide-react";
```

Add menu items:

```ts
{
  title: t("common.profile"),
  url: "/profile",
  icon: UserRound,
},
{
  title: t("common.intents"),
  url: "/intents",
  icon: ClipboardList,
},
```

- [ ] **Step 5: Add i18n labels**

Add to `common` in both dictionaries:

```ts
profile: "Supplier Profile",
intents: "Intent to Bid",
```

Chinese:

```ts
profile: "供应商资料",
intents: "投标意向",
```

Add `profilePage` dictionaries for page labels.

- [ ] **Step 6: Run tests**

Run:

```bash
cd frontend
npm test -- src/app/profile/page.test.ts
npm run lint
```

Expected: PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/profile frontend/src/components/layout/app-sidebar.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: add supplier profile page"
```

---

### Task 6: Intent List and Workspace UI

**Files:**
- Create: `frontend/src/app/intents/page.tsx`
- Create: `frontend/src/app/intents/[id]/page.tsx`
- Create: `frontend/src/app/intents/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Write failing intent page test**

Create `frontend/src/app/intents/page.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intent pages", () => {
  it("lists intents and links to workspace details", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchIntents");
    expect(page).toContain("/intents/");
    expect(page).toContain("Intent to Bid");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
cd frontend
npm test -- src/app/intents/page.test.ts
```

Expected: FAIL because page does not exist.

- [ ] **Step 3: Implement list page**

The list page should:

- call `fetchIntents`.
- show title, empty state, loading state, error state.
- render cards with bid title, agency, status, score snapshot, deadline, and link to `/intents/${intent.id}`.

- [ ] **Step 4: Implement detail workspace page**

The detail page should:

- call `fetchIntent`.
- show bid title, agency, source link.
- show status select or compact button group.
- show AI brief, key dates, checklist, risk flags, match snapshot.
- call `updateIntentStatus` on status change.

- [ ] **Step 5: Add i18n labels**

Add `intentsPage` dictionary keys for:

- title
- description
- emptyTitle
- emptyDescription
- openWorkspace
- status
- checklist
- riskFlags
- keyDates
- matchSnapshot
- brief
- saveStatus

- [ ] **Step 6: Run UI tests**

Run:

```bash
cd frontend
npm test -- src/app/intents/page.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/intents frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: add intent workspace pages"
```

---

### Task 7: Bid Detail Pursuit Panel Integration

**Files:**
- Modify: `frontend/src/app/bids/[id]/page.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`
- Create: `frontend/src/app/bids/[id]/page.test.ts`

- [ ] **Step 1: Write failing bid detail static test**

Create `frontend/src/app/bids/[id]/page.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bid detail pursuit panel", () => {
  it("loads match score and creates intent from the detail page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchBidMatch");
    expect(page).toContain("createIntent");
    expect(page).toContain("Add to Intent");
    expect(page).toContain("match.score");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
cd frontend
npm test -- src/app/bids/[id]/page.test.ts
```

Expected: FAIL because the current detail page has no pursuit panel.

- [ ] **Step 3: Load match score in bid detail**

In `frontend/src/app/bids/[id]/page.tsx`:

- import `fetchBidMatch` and `createIntent`.
- add `match`, `intent`, `isCreatingIntent`, and `pursuitError` state.
- after loading bid, call `fetchBidMatch(bidId)`.

- [ ] **Step 4: Add pursuit panel UI**

Render a `Card` below title/metadata actions:

- Score large number.
- Confidence badge.
- Explanation.
- Risk notes.
- Missing profile hints with link to `/profile`.
- Button `Add to Intent`.
- After create success, show link to `/intents/${intent.id}`.

- [ ] **Step 5: Show generated brief/checklist after intent creation**

When `intent` exists, render:

- `intent.aiBidBrief`
- `intent.initialChecklist`
- `intent.riskFlags`

This first version can show generated content only after pressing `Add to Intent`; full existing-intent lookup can be added in Phase 1B.

- [ ] **Step 6: Run bid detail test**

Run:

```bash
cd frontend
npm test -- src/app/bids/[id]/page.test.ts
```

Expected: PASS.

- [ ] **Step 7: Browser-check manually**

With dev server running:

```text
http://localhost:3000/bids/<known-seeded-bid-id>
```

Expected:

- pursuit panel appears.
- match score loads.
- add to intent creates an intent.
- workspace link opens.
- no layout overlap at desktop width.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/bids/[id]/page.tsx frontend/src/app/bids/[id]/page.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: connect bid detail to pursuit workflow"
```

---

### Task 8: Documentation and Full Verification

**Files:**
- Modify: `docs/operation-guide.md`

- [ ] **Step 1: Update operation guide**

Add a section after basic usage:

```md
## Phase 1A Pursuit Workflow

1. Open `/profile` and complete the supplier profile.
2. Open `/search` and choose an opportunity.
3. Open the bid detail page.
4. Review the match score and explanation.
5. Click `Add to Intent`.
6. Open `/intents` and select the new workspace.
7. Review the generated brief, checklist, risk flags, and key dates.
```

- [ ] **Step 2: Run targeted test suite**

Run:

```bash
cd frontend
npm test -- src/server/profile/service.test.ts src/server/match/service.test.ts src/server/intents/service.test.ts src/server/intents/brief-generator.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
cd frontend
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run lint**

Run:

```bash
cd frontend
npm run lint
```

Expected: no errors and no warnings.

- [ ] **Step 5: Run production build**

Run:

```bash
cd frontend
npm run build
```

Expected: build exits 0 and lists app routes including `/profile`, `/intents`, `/intents/[id]`, and existing routes.

- [ ] **Step 6: Run migration on local dev database**

Run:

```bash
cd frontend
npm run db:migrate
```

Expected: exits 0. Existing data remains available.

- [ ] **Step 7: Browser smoke test**

Verify in browser:

- `/profile` loads and saves profile.
- `/search` still loads bids.
- `/bids/<known-id>` shows pursuit panel.
- `Add to Intent` creates intent.
- `/intents` lists the new intent.
- `/intents/<intent-id>` opens workspace.
- `/saved`, `/admin`, `/generative-art-static` still load.

- [ ] **Step 8: Commit docs and any smoke-test fixes**

```bash
git add docs/operation-guide.md
git commit -m "docs: add phase 1a workflow instructions"
```

If no docs-only changes remain because they were committed with an earlier task, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Supplier Profile v1: Task 2 and Task 5.
- Match Score v1: Task 3 and Task 7.
- Intent to Bid creation/list/detail/status: Task 4 and Task 6.
- Deterministic AI Brief/Checklist: Task 4 and Task 7.
- Bid detail pursuit panel: Task 7.
- Operation instructions: Task 8.

Risk controls:

- Existing anonymous principal behavior is reused.
- Real LLM integration is excluded.
- Existing crawler/admin/static routes are not modified.
- Search-card intent action is excluded from Phase 1A.
- `.DS_Store` and `frontend/data/notification-outbox/` are not touched.

Verification:

- Each task includes failing tests before implementation.
- Final verification requires targeted tests, full tests, lint, build, migration, and browser smoke testing.
