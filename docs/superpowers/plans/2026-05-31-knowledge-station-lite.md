# Knowledge Station Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Enterprise-gated Knowledge Station Lite with deterministic Intent workflow coaching, reusable knowledge item persistence, protected APIs, Intent UI, and a minimal knowledge library.

**Architecture:** Add an organization-scoped `knowledge_items` table, a focused `server/knowledge` module for persistence, and a browser-safe `lib/knowledge/coach.ts` helper for deterministic coach generation. Expose `GET/POST /api/knowledge` behind the existing `knowledge_station` feature gate, then render an Intent-level panel and `/knowledge` library that reuse the current auth/session and locked-state patterns.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Drizzle SQLite schema, better-sqlite3 migrations, Vitest, existing WinBids i18n/auth/feature-gate helpers.

---

## File Structure

- Modify `frontend/src/server/db/schema.ts`: add `knowledgeItems` Drizzle table.
- Modify `frontend/src/server/db/migrate.ts`: create `knowledge_items` table and indexes.
- Modify `frontend/src/server/db/schema.test.ts`: assert migration creates the new table/indexes.
- Create `frontend/src/server/knowledge/types.ts`: shared Knowledge Station item, input, response, coach card types.
- Create `frontend/src/server/knowledge/repository.ts`: low-level database create/list helpers.
- Create `frontend/src/server/knowledge/service.ts`: validation, normalization, and organization scoping.
- Create `frontend/src/server/knowledge/service.test.ts`: service/repository behavior tests.
- Create `frontend/src/lib/knowledge/coach.ts`: browser-safe deterministic workflow coach generation from an `IntentDetail`.
- Create `frontend/src/app/api/knowledge/route.ts`: gated list/create API.
- Create `frontend/src/app/api/knowledge/route.test.ts`: auth, feature gate, validation, happy-path route tests.
- Modify `frontend/src/server/auth/feature-gate-routes.ts`: register `knowledge_station` API coverage and remove it from unimplemented paid features.
- Create `frontend/src/lib/api/knowledge.ts`: browser API client helpers.
- Modify `frontend/src/app/intents/[id]/page.tsx`: add Knowledge Station panel to the Intent workflow.
- Modify `frontend/src/app/intents/page.test.ts`: static rendering tests for panel copy and links.
- Create `frontend/src/app/knowledge/page.tsx`: minimal Knowledge Station library page.
- Create `frontend/src/app/knowledge/page.test.ts`: static rendering test for the library page.
- Modify `frontend/src/components/layout/app-sidebar.tsx`: show Knowledge Station navigation for users with feature access.
- Modify `frontend/src/lib/i18n/translations.ts`: add English/Chinese labels.
- Modify `docs/product-requirements/winbids-implementation-status.md`: mark this phase complete after implementation.

## Task 1: Database Schema And Migration

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/db/schema.test.ts`

- [ ] **Step 1: Add failing schema test**

Add this test near the migration assertions in `frontend/src/server/db/schema.test.ts`:

```ts
it("creates the knowledge_items table and indexes", async () => {
  const testDb = await createTestDatabase();

  try {
    const tables = testDb.db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    const indexes = testDb.db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => (row as { name: string }).name);
    const columns = testDb.db.$client
      .prepare("PRAGMA table_info(knowledge_items)")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain("knowledge_items");
    expect(columns).toEqual(expect.arrayContaining([
      "id",
      "organization_id",
      "created_by_user_id",
      "title",
      "body",
      "type",
      "tags_json",
      "source_kind",
      "source_intent_id",
      "source_bid_id",
      "source_url",
      "metadata_json",
      "created_at",
      "updated_at",
    ]));
    expect(indexes).toEqual(expect.arrayContaining([
      "idx_knowledge_items_organization_id",
      "idx_knowledge_items_created_by_user_id",
      "idx_knowledge_items_source_intent_id",
      "idx_knowledge_items_source_bid_id",
      "idx_knowledge_items_created_at",
    ]));
  } finally {
    await testDb.cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/server/db/schema.test.ts`

Expected: FAIL because `knowledge_items` does not exist.

- [ ] **Step 3: Add Drizzle table**

In `frontend/src/server/db/schema.ts`, add `knowledgeItems` after `creditUsageEvents` or near other organization-scoped tables:

```ts
export const knowledgeItems = sqliteTable(
  "knowledge_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    type: text("type").notNull(),
    tagsJson: text("tags_json").notNull().default("[]"),
    sourceKind: text("source_kind").notNull(),
    sourceIntentId: text("source_intent_id").references(() => intentToBid.id, { onDelete: "set null" }),
    sourceBidId: text("source_bid_id").references(() => bids.id, { onDelete: "set null" }),
    sourceUrl: text("source_url"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    organizationIdx: index("idx_knowledge_items_organization_id").on(table.organizationId),
    creatorIdx: index("idx_knowledge_items_created_by_user_id").on(table.createdByUserId),
    sourceIntentIdx: index("idx_knowledge_items_source_intent_id").on(table.sourceIntentId),
    sourceBidIdx: index("idx_knowledge_items_source_bid_id").on(table.sourceBidId),
    createdIdx: index("idx_knowledge_items_created_at").on(table.createdAt),
  }),
);
```

- [ ] **Step 4: Add SQL migration**

In `frontend/src/server/db/migrate.ts`, add this SQL after the organization/bid/intent tables are created:

```sql
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_kind TEXT NOT NULL,
  source_intent_id TEXT REFERENCES intent_to_bid(id) ON DELETE SET NULL,
  source_bid_id TEXT REFERENCES bids(id) ON DELETE SET NULL,
  source_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add indexes in the existing index block:

```sql
CREATE INDEX IF NOT EXISTS idx_knowledge_items_organization_id ON knowledge_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_by_user_id ON knowledge_items(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_intent_id ON knowledge_items(source_intent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_bid_id ON knowledge_items(source_bid_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON knowledge_items(created_at);
```

- [ ] **Step 5: Run test to verify pass**

Run: `cd frontend && npm test -- src/server/db/schema.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/server/db/schema.ts frontend/src/server/db/migrate.ts frontend/src/server/db/schema.test.ts
git commit -m "feat: add knowledge item storage"
```

## Task 2: Knowledge Service And Workflow Coach

**Files:**
- Create: `frontend/src/server/knowledge/types.ts`
- Create: `frontend/src/server/knowledge/repository.ts`
- Create: `frontend/src/server/knowledge/service.ts`
- Create: `frontend/src/server/knowledge/service.test.ts`
- Create: `frontend/src/lib/knowledge/coach.ts`

- [ ] **Step 1: Write failing service tests**

Create `frontend/src/server/knowledge/service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import { generateWorkflowCoachCards } from "@/lib/knowledge/coach";
import { createKnowledgeItem, listKnowledgeItems } from "./service";

describe("knowledge service", () => {
  it("creates and lists organization-scoped knowledge items", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const item = await createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: " Past performance snippet ",
        body: " Reuse this wording for similar contracts. ",
        type: "template_snippet",
        tags: [" Past Performance ", "", "proposal"],
        sourceKind: "manual",
      });
      const result = await listKnowledgeItems(testDb.db, { organizationId: "org_seed", q: "performance" });

      expect(item.title).toBe("Past performance snippet");
      expect(item.body).toBe("Reuse this wording for similar contracts.");
      expect(item.tags).toEqual(["Past Performance", "proposal"]);
      expect(result.items.map((entry) => entry.id)).toContain(item.id);
    } finally {
      await testDb.cleanup();
    }
  });

  it("filters by source intent, bid, and type", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      await createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Compliance lesson",
        body: "Check required forms before pricing.",
        type: "lesson",
        tags: ["compliance"],
        sourceKind: "intent",
        sourceIntentId: intent.id,
        sourceBidId: intent.bid.id,
      });
      const result = await listKnowledgeItems(testDb.db, {
        organizationId: "org_seed",
        intentId: intent.id,
        bidId: intent.bid.id,
        type: "lesson",
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ sourceIntentId: intent.id, sourceBidId: intent.bid.id });
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects empty title/body and invalid item types", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: " ",
        body: "Body",
        type: "lesson",
        tags: [],
        sourceKind: "manual",
      })).rejects.toThrow("Knowledge title is required.");

      await expect(createKnowledgeItem(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        title: "Title",
        body: "Body",
        type: "bad_type",
        tags: [],
        sourceKind: "manual",
      })).rejects.toThrow("Unsupported knowledge item type.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("generates deterministic workflow coach cards from an intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const cards = generateWorkflowCoachCards(intent);

      expect(cards.length).toBeGreaterThanOrEqual(3);
      expect(cards.map((card) => card.category)).toEqual(expect.arrayContaining(["deadline", "readiness", "decision"]));
      expect(cards.every((card) => card.title && card.guidance && card.suggestedAction)).toBe(true);
    } finally {
      await testDb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/server/knowledge/service.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Create knowledge types**

Create `frontend/src/server/knowledge/types.ts`:

```ts
export const KNOWLEDGE_ITEM_TYPES = ["workflow_note", "template_snippet", "requirement", "lesson"] as const;
export const KNOWLEDGE_SOURCE_KINDS = ["manual", "intent", "bid", "generated_coach"] as const;
export const WORKFLOW_COACH_CATEGORIES = ["deadline", "readiness", "compliance", "documents", "decision"] as const;
export const WORKFLOW_COACH_SEVERITIES = ["info", "warning", "critical"] as const;

export type KnowledgeItemType = (typeof KNOWLEDGE_ITEM_TYPES)[number];
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];
export type WorkflowCoachCategory = (typeof WORKFLOW_COACH_CATEGORIES)[number];
export type WorkflowCoachSeverity = (typeof WORKFLOW_COACH_SEVERITIES)[number];

export interface KnowledgeItem {
  id: string;
  organizationId: string;
  createdByUserId: string;
  title: string;
  body: string;
  type: KnowledgeItemType;
  tags: string[];
  sourceKind: KnowledgeSourceKind;
  sourceIntentId: string | null;
  sourceBidId: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeItemInput {
  organizationId: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  tags?: unknown;
  sourceKind: string;
  sourceIntentId?: string | null;
  sourceBidId?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListKnowledgeItemsInput {
  organizationId: string;
  intentId?: string | null;
  bidId?: string | null;
  q?: string | null;
  type?: string | null;
  limit?: number | null;
}

export interface KnowledgeListResponse {
  items: KnowledgeItem[];
}

export interface WorkflowCoachCard {
  id: string;
  category: WorkflowCoachCategory;
  severity: WorkflowCoachSeverity;
  title: string;
  guidance: string;
  suggestedAction: string;
  sourceLabel?: string;
  href?: string;
}

export interface KnowledgeStationResponse {
  coachCards: WorkflowCoachCard[];
  knowledge: KnowledgeItem[];
}
```

- [ ] **Step 4: Create repository and service implementation**

Create `frontend/src/server/knowledge/repository.ts` with Drizzle insert/list helpers using `knowledgeItems`.

Create `frontend/src/server/knowledge/service.ts` with:

```ts
export class KnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeValidationError";
  }
}

export function isKnowledgeItemType(value: unknown): value is KnowledgeItemType {
  return typeof value === "string" && KNOWLEDGE_ITEM_TYPES.includes(value as KnowledgeItemType);
}

export function isKnowledgeSourceKind(value: unknown): value is KnowledgeSourceKind {
  return typeof value === "string" && KNOWLEDGE_SOURCE_KINDS.includes(value as KnowledgeSourceKind);
}
```

The service must:

- trim title/body;
- reject empty title/body;
- reject unsupported `type` and `sourceKind`;
- cap title at 160 characters and body at 5000 characters;
- normalize tags from an array of strings to unique trimmed strings, max 12 tags, each max 40 characters;
- default `metadata` to `{}`;
- default `limit` to 25 and cap it at 100;
- query only by `organizationId`;
Create `frontend/src/lib/knowledge/coach.ts` with `generateWorkflowCoachCards(intent: IntentDetail): WorkflowCoachCard[]`. The helper must import only browser-safe types/helpers and generate cards from intent deadline, match score, checklist/risk flags, attachments/source URL, and generated recommendation fields available on `IntentDetail`.

- [ ] **Step 5: Run service tests**

Run: `cd frontend && npm test -- src/server/knowledge/service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/server/knowledge frontend/src/lib/knowledge/coach.ts frontend/src/server/db/schema.ts frontend/src/server/db/migrate.ts frontend/src/server/db/schema.test.ts
git commit -m "feat: add knowledge station service"
```

## Task 3: Protected Knowledge API And Feature Coverage

**Files:**
- Create: `frontend/src/app/api/knowledge/route.ts`
- Create: `frontend/src/app/api/knowledge/route.test.ts`
- Modify: `frontend/src/server/auth/feature-gate-routes.ts`
- Modify: `frontend/src/lib/api/knowledge.ts`

- [ ] **Step 1: Write failing route tests**

Create `frontend/src/app/api/knowledge/route.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@/server/auth/principal";
import * as principal from "@/server/auth/principal";
import { createTestDatabase } from "@/server/db/test-utils";
import { createKnowledgeRouteHandlers } from "./route";

const enterprisePrincipal: Principal = {
  kind: "user",
  userId: "anon_seed",
  organizationId: "org_seed",
  role: "user",
  tier: "enterprise",
  features: ["bid_search", "knowledge_station"],
};

vi.mock("@/server/auth/principal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/principal")>();
  return { ...actual, requirePrincipal: vi.fn() };
});

describe("/api/knowledge", () => {
  it("rejects users without knowledge_station", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      vi.mocked(principal.requirePrincipal).mockResolvedValueOnce({
        ...enterprisePrincipal,
        features: ["bid_search"],
      });
      const { GET } = createKnowledgeRouteHandlers(testDb.db);
      const response = await GET(new Request("http://localhost/api/knowledge"));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error.feature).toBe("knowledge_station");
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates and lists knowledge items for enterprise users", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      vi.mocked(principal.requirePrincipal).mockResolvedValue(enterprisePrincipal);
      const { GET, POST } = createKnowledgeRouteHandlers(testDb.db);
      const createResponse = await POST(new Request("http://localhost/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Portal checklist",
          body: "Confirm vendor portal login before final pricing.",
          type: "workflow_note",
          tags: ["portal"],
          sourceKind: "manual",
        }),
      }));
      const listResponse = await GET(new Request("http://localhost/api/knowledge?q=portal"));
      const createBody = await createResponse.json();
      const listBody = await listResponse.json();

      expect(createResponse.status).toBe(201);
      expect(createBody.item.title).toBe("Portal checklist");
      expect(listBody.items.map((item: { id: string }) => item.id)).toContain(createBody.item.id);
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns invalid request for unsupported type", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      vi.mocked(principal.requirePrincipal).mockResolvedValueOnce(enterprisePrincipal);
      const { POST } = createKnowledgeRouteHandlers(testDb.db);
      const response = await POST(new Request("http://localhost/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Title", body: "Body", type: "bad", sourceKind: "manual" }),
      }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("INVALID_REQUEST");
    } finally {
      await testDb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run route and coverage tests to verify failure**

Run: `cd frontend && npm test -- src/app/api/knowledge/route.test.ts src/server/auth/feature-gate-coverage.test.ts`

Expected: FAIL because route/client/coverage do not exist or `knowledge_station` is still unimplemented.

- [ ] **Step 3: Create route**

Create `frontend/src/app/api/knowledge/route.ts` with exported factory:

```ts
import { NextResponse } from "next/server";
import { requireFeature, FeatureAccessError, featureErrorResponse } from "@/server/auth/feature-gate";
import { requirePrincipal } from "@/server/auth/principal";
import { getDatabase, type AppDatabase } from "@/server/db/client";
import { createKnowledgeItem, KnowledgeValidationError, listKnowledgeItems } from "@/server/knowledge/service";

function errorResponse(error: unknown) {
  if (error instanceof FeatureAccessError) return featureErrorResponse(error);
  if (error instanceof KnowledgeValidationError) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: error.message } }, { status: 400 });
  }
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Knowledge request failed." } }, { status: 500 });
}

export function createKnowledgeRouteHandlers(database?: AppDatabase) {
  const db = database ?? getDatabase();

  return {
    async GET(request: Request) {
      try {
        const current = await requirePrincipal(db, request);
        requireFeature(current, "knowledge_station");
        const params = new URL(request.url).searchParams;
        return NextResponse.json(await listKnowledgeItems(db, {
          organizationId: current.organizationId,
          intentId: params.get("intentId"),
          bidId: params.get("bidId"),
          q: params.get("q"),
          type: params.get("type"),
          limit: Number(params.get("limit") ?? 25),
        }));
      } catch (error) {
        return errorResponse(error);
      }
    },
    async POST(request: Request) {
      try {
        const current = await requirePrincipal(db, request);
        requireFeature(current, "knowledge_station");
        const input = await request.json();
        const item = await createKnowledgeItem(db, {
          organizationId: current.organizationId,
          userId: current.userId,
          title: input.title,
          body: input.body,
          type: input.type,
          tags: input.tags,
          sourceKind: input.sourceKind,
          sourceIntentId: input.sourceIntentId,
          sourceBidId: input.sourceBidId,
          sourceUrl: input.sourceUrl,
          metadata: input.metadata,
        });
        return NextResponse.json({ item }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export const { GET, POST } = createKnowledgeRouteHandlers();
```

- [ ] **Step 4: Update feature coverage**

In `frontend/src/server/auth/feature-gate-routes.ts`, add:

```ts
{
  sourcePath: "../../app/api/knowledge/route.ts",
  feature: "knowledge_station",
  methods: ["GET", "POST"],
},
```

Remove `"knowledge_station"` from `UNIMPLEMENTED_PAID_FEATURE_API_COVERAGE`.

- [ ] **Step 5: Add browser API client**

Create `frontend/src/lib/api/knowledge.ts` with `fetchKnowledgeItems` and `createKnowledgeItem` using the existing `ApiError` pattern from `frontend/src/lib/api/intents.ts`.

- [ ] **Step 6: Run route and coverage tests**

Run: `cd frontend && npm test -- src/app/api/knowledge/route.test.ts src/server/auth/feature-gate-coverage.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/api/knowledge frontend/src/server/auth/feature-gate-routes.ts frontend/src/lib/api/knowledge.ts
git commit -m "feat: add knowledge station api"
```

## Task 4: Intent Knowledge Station Panel

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/page.test.ts`
- Modify: `frontend/src/lib/i18n/translations.ts`

- [ ] **Step 1: Add failing static render assertions**

In `frontend/src/app/intents/page.test.ts`, add assertions that the detail page source contains:

```ts
expect(detailPage).toContain("Knowledge Station");
expect(detailPage).toContain("workflow coach");
expect(detailPage).toContain("knowledge_station");
expect(detailPage).toContain("createKnowledgeItem");
expect(detailPage).toContain("fetchKnowledgeItems");
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/app/intents/page.test.ts`

Expected: FAIL because the Intent page does not contain Knowledge Station UI/client calls yet.

- [ ] **Step 3: Add translations**

Add English and Chinese translation keys for:

- `knowledge.title`
- `knowledge.library`
- `knowledge.workflowCoach`
- `knowledge.saveFromCoach`
- `knowledge.createNote`
- `knowledge.lockedTitle`
- `knowledge.lockedBody`
- `knowledge.recentItems`
- `knowledge.empty`
- `knowledge.search`
- `knowledge.type`
- `knowledge.tags`
- `knowledge.body`
- `knowledge.saved`
- `knowledge.saveFailed`

- [ ] **Step 4: Add Intent panel state and handlers**

In `frontend/src/app/intents/[id]/page.tsx`, import:

```ts
import { createKnowledgeItem, fetchKnowledgeItems } from "@/lib/api/knowledge";
import type { KnowledgeItem, WorkflowCoachCard } from "@/server/knowledge/types";
```

Add state:

```ts
const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
const [knowledgeNotice, setKnowledgeNotice] = useState<string | null>(null);
const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
const [knowledgeDraft, setKnowledgeDraft] = useState({
  title: "",
  body: "",
  type: "workflow_note",
  tags: "",
});
```

Load items only when `user?.features.includes("knowledge_station")` and `intent` exists:

```ts
useEffect(() => {
  if (!intent || !user?.features.includes("knowledge_station")) return;
  fetchKnowledgeItems({ intentId: intent.id, bidId: intent.bid.id, limit: 10 })
    .then((response) => setKnowledgeItems(response.items))
    .catch(() => setKnowledgeError(t("knowledge.loadFailed")));
}, [intent, user?.features, t]);
```

Use `generateWorkflowCoachCards(intent)` from `frontend/src/lib/knowledge/coach.ts` so the Intent page never imports database-backed server modules.

- [ ] **Step 5: Render panel**

Add the panel after Compliance/Pursuit sections:

- locked state for missing `knowledge_station`;
- coach cards with save button;
- create form;
- recent linked items.

Use existing button/input/select styles from the Intent page. Do not introduce a new visual system in this phase.

- [ ] **Step 6: Run Intent static test**

Run: `cd frontend && npm test -- src/app/intents/page.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/intents/[id]/page.tsx frontend/src/app/intents/page.test.ts frontend/src/lib/i18n/translations.ts
git commit -m "feat: add intent knowledge station panel"
```

## Task 5: Knowledge Library Page And Sidebar

**Files:**
- Create: `frontend/src/app/knowledge/page.tsx`
- Create: `frontend/src/app/knowledge/page.test.ts`
- Modify: `frontend/src/components/layout/app-sidebar.tsx`
- Modify: `frontend/src/lib/i18n/translations.ts`

- [ ] **Step 1: Add failing tests**

Create `frontend/src/app/knowledge/page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("knowledge page", () => {
  it("renders the knowledge library shell", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(page).toContain("Knowledge Station");
    expect(page).toContain("fetchKnowledgeItems");
    expect(page).toContain("knowledge_station");
    expect(page).toContain("type");
    expect(page).toContain("search");
  });
});
```

Create `frontend/src/components/layout/app-sidebar.test.ts` if it does not exist:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("AppSidebar", () => {
  it("registers Knowledge Station navigation behind feature access", () => {
    const source = readFileSync(new URL("./app-sidebar.tsx", import.meta.url), "utf8");

    expect(source).toContain("/knowledge");
    expect(source).toContain("knowledge_station");
    expect(source).toContain("knowledge.library");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/app/knowledge/page.test.ts`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Create client library page**

Create `frontend/src/app/knowledge/page.tsx` as a client component that:

- checks `user?.features.includes("knowledge_station")`;
- shows locked state if unavailable;
- calls `fetchKnowledgeItems({ q, type, limit: 50 })`;
- renders search input, type select, tag chips, source links, and empty/loading/error states.

- [ ] **Step 4: Update sidebar**

In `frontend/src/components/layout/app-sidebar.tsx`, import a suitable lucide icon such as `BookOpen` and insert the nav item only when:

```ts
user?.features.includes("knowledge_station")
```

The nav item should use `/knowledge` and translation key `knowledge.library`.

- [ ] **Step 5: Run page/sidebar tests**

Run: `cd frontend && npm test -- src/app/knowledge/page.test.ts src/components/layout/app-sidebar.test.ts src/app/intents/page.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/knowledge frontend/src/components/layout/app-sidebar.tsx frontend/src/lib/i18n/translations.ts
git commit -m "feat: add knowledge station library"
```

## Task 6: Documentation And Full Verification

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`

- [ ] **Step 1: Update implementation status**

Change the Knowledge Station Lite row from missing to done locally:

```md
| Knowledge Station Lite | Done locally: Enterprise-gated Intent workflow coach, reusable organization-scoped knowledge items, protected list/create APIs, Intent panel, and minimal `/knowledge` library are implemented. | Full retrieval, embeddings, admin publishing workflow, artifact uploads, and credit metering remain future depth. | Continue with Admin risk-check visualization or Response Workspace Lite. |
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
cd frontend && npm test -- \
  src/server/db/schema.test.ts \
  src/server/knowledge/service.test.ts \
  src/app/api/knowledge/route.test.ts \
  src/server/auth/feature-gate-coverage.test.ts \
  src/app/intents/page.test.ts \
  src/app/knowledge/page.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full regression**

Run:

```bash
cd frontend && npm test
cd frontend && npm run lint
cd frontend && npm run build
cd frontend && npm run db:migrate
cd frontend && npm run risk:check
git diff --check
```

Expected:

- all tests pass;
- lint passes;
- production build passes;
- migration command exits successfully;
- risk check reports 50/50 state coverage and no attachment/route regression;
- diff whitespace check passes.

- [ ] **Step 4: Browser verification**

With the app running at `http://localhost:3000`:

- open an Intent detail page as an Enterprise/admin-capable account or an account with `knowledge_station` override;
- confirm Knowledge Station panel shows coach cards, create form, and recent items;
- save one coach card or manual note;
- confirm the saved item appears in the Intent panel;
- open `/knowledge`;
- confirm the saved item appears in the library;
- confirm a lower-tier ordinary account sees locked state and does not see sidebar Knowledge navigation.

- [ ] **Step 5: Commit docs and final implementation state**

```bash
git add docs/product-requirements/winbids-implementation-status.md
git commit -m "docs: mark knowledge station lite complete"
```

## Remaining Work After This Plan

- Admin risk-check visualization: surface `npm run risk:check` coverage and failures in the Admin console.
- Response Workspace Lite: add task/artifact workflow for preparing response packages.
- Quote/Supply Chain Lite: add partner list and quote-request draft workflow.
- Knowledge Station depth: retrieval, embeddings, admin curated content, artifact uploads, usage metrics, and credit metering.
