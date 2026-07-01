# AI Enterprise Depth Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise WinBids AI/Enterprise depth from the current deterministic 20-30% baseline by adding explicit AI run metadata, lexical Knowledge retrieval traceability, and a dry-run credit ledger without requiring real model credentials.

**Architecture:** Keep this phase deterministic and local-first: add small server-side helpers for AI run metadata, lexical retrieval, and dry-run credit events, then attach those helpers to existing Intent brief, grounded Q&A, and Knowledge Station flows. The design records provider/model/prompt/cost/fallback facts and retrieval traces now, while leaving narrow seams for future LLM, embedding, debit, refund, and monthly-grant enforcement. No vector store, external embedding provider, or real credit deduction is introduced.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Drizzle SQLite with existing MySQL runtime branching where needed, existing `knowledge_items`, `credit_usage_events`, and Enterprise `knowledge_station` feature gate.

---

## Current Baseline

- AI/Enterprise depth is 20-30%.
- Current AI-like features are deterministic rules: `frontend/src/server/intents/brief-generator.ts`, `frontend/src/server/qualification/qa.ts`, citation/freshness helpers, and Knowledge Station Lite.
- Current credit support is metadata-only: `frontend/src/server/billing/credits.ts` defines costs and event types, while `credit_balances` and `credit_usage_events` already exist in `frontend/src/server/db/schema.ts`.
- This plan deliberately does not need real model keys and does not depend on an embedding/vector store.

## Required Metadata Contract

All new deterministic AI metadata must use this shape:

```ts
export type AiProvider = "deterministic";
export type AiConfidence = "low" | "medium" | "high";

export interface AiRunMetadata {
  id: string;
  provider: AiProvider;
  model: "rules://winbids/deterministic-ai-enterprise-depth-lite";
  rulesVersion: "ai-enterprise-depth-lite-rules@2026-06-10";
  promptVersion: string;
  confidence: AiConfidence;
  cost: {
    currency: "USD";
    total: 0;
  };
  fallbackReason: "no_llm_provider_configured" | "deterministic_rules_selected" | "workspace_not_available";
  generatedAt: string;
}
```

Concrete values required in this phase:

- `provider`: `deterministic`
- `model`: `rules://winbids/deterministic-ai-enterprise-depth-lite`
- `rulesVersion`: `ai-enterprise-depth-lite-rules@2026-06-10`
- `promptVersion`: feature-specific strings such as `intent-brief-lite@2026-06-10` and `qualification-qa-lite@2026-06-10`
- `confidence`: normalized to `low`, `medium`, or `high`
- `cost.total`: `0`
- `fallbackReason`: `no_llm_provider_configured` for AI-like outputs that are standing in for future LLM calls

## Knowledge Retrieval Lite Contract

Retrieval stays lexical and transparent:

```ts
export interface KnowledgeRetrievalTrace {
  provider: "lexical";
  query: string;
  queryTokens: string[];
  matchedFields: Array<{
    itemId: string;
    field: "title" | "body" | "tags" | "sourceKind" | "sourceUrl" | "metadata";
    tokenHits: string[];
    score: number;
  }>;
  selectedItemIds: string[];
  futureEmbeddingStatus: {
    status: "not_configured";
    provider: null;
    vectorStore: "none";
    reason: "embedding_provider_out_of_scope_for_lite_phase";
  };
}
```

The retrieval implementation must:

- Use `listKnowledgeItems` and in-memory lexical scoring.
- Match against title, body, tags, source kind, source URL, and selected string metadata values.
- Return the trace alongside selected knowledge items when requested.
- Never call an embedding provider.
- Never require or create a vector store.

## Credit Ledger Dry-Run Contract

Premium action usage can be recorded as `credit_usage_events` rows, but no balance changes happen in this phase:

```ts
export interface CreditLedgerDryRunResult {
  mode: "dry_run";
  eventRecorded: boolean;
  eventId: string | null;
  featureKey: FeatureKey;
  creditCost: number;
  chargedAmount: 0;
  balanceAfter: null;
  fallbackReason: "billing_enforcement_disabled" | "workspace_not_available";
}
```

Dry-run rows must use:

- `event_type`: `premium_action`
- `amount`: `0`
- `balance_after`: `null`
- `metadata_json.dryRun`: `true`
- `metadata_json.billingEnforcement`: `false`
- `metadata_json.reservedInterfaces`: `["debitCredits", "refundCredits", "grantMonthlyCredits"]`

Reserved functions must exist and throw `CreditLedgerEnforcementDisabledError` with a message that states real debits are disabled for this lite phase.

## Env / API Key Boundary

- This phase does not require `OPENAI_API_KEY`.
- Tests must pass with `OPENAI_API_KEY` unset.
- No code path may read `OPENAI_API_KEY`, `OPENAI_PROJECT_ID`, or any model-provider key in this phase.
- Future real AI integration may add model-provider configuration, but that belongs to a separate implementation plan.

## Out Of Scope

- Real LLM calls.
- Embedding provider integration.
- Vector database or vector search.
- Real credit debit, refund, monthly grant enforcement, or paid credit packs.
- Billing webhook changes.
- Production docs changes.
- Broad frontend redesign.
- Complex Product 6 prediction, price-to-win modeling, or award intelligence datasets.

## File Structure

- Create `frontend/src/server/ai/run-metadata.ts`: deterministic AI metadata constants and factory.
- Create `frontend/src/server/ai/run-metadata.test.ts`: metadata normalization and no-key behavior tests.
- Modify `frontend/src/server/intents/types.ts`: add `aiRun` metadata to generated intent content.
- Modify `frontend/src/server/intents/brief-generator.ts`: attach deterministic metadata to generated briefs.
- Modify `frontend/src/server/intents/service.ts`: hydrate metadata for persisted intent rows.
- Modify `frontend/src/server/intents/brief-generator.test.ts`: assert provider/model/prompt/cost/fallback fields.
- Modify `frontend/src/server/intents/service.test.ts`: assert hydrated intent metadata is present.
- Modify `frontend/src/server/qualification/types.ts`: add `aiRun` and optional `creditUsage` to Q&A response.
- Modify `frontend/src/server/qualification/qa.ts`: attach deterministic metadata to grounded answers.
- Modify `frontend/src/server/qualification/qa.test.ts`: assert Q&A metadata and cost zero.
- Create `frontend/src/server/knowledge/retrieval.ts`: lexical retrieval and trace helper.
- Create `frontend/src/server/knowledge/retrieval.test.ts`: matched field trace and future embedding status tests.
- Modify `frontend/src/server/knowledge/types.ts`: add retrieval trace types and optional list response trace.
- Modify `frontend/src/app/api/knowledge/route.ts`: return retrieval trace when `includeRetrievalTrace=1`.
- Modify `frontend/src/app/api/knowledge/route.test.ts`: assert trace is feature-gated and lexical.
- Modify `frontend/src/lib/api/knowledge.ts`: add `includeRetrievalTrace` param.
- Modify `frontend/src/lib/api/knowledge.test.ts`: assert URL encoding.
- Create `frontend/src/server/billing/credit-ledger.ts`: dry-run premium action recorder and reserved enforcement interfaces.
- Create `frontend/src/server/billing/credit-ledger.test.ts`: dry-run insert and enforcement-disabled tests.
- Modify `frontend/src/app/api/intents/[id]/qa/route.ts`: record dry-run premium action usage after successful Q&A when a workspace exists.
- Modify `frontend/src/app/api/intents/[id]/qa/route.test.ts`: assert route returns metadata and dry-run usage status.

## Task 1: Deterministic AI Run Metadata

**Files:**
- Create: `frontend/src/server/ai/run-metadata.ts`
- Create: `frontend/src/server/ai/run-metadata.test.ts`

- [ ] **Step 1: Write failing metadata tests**

Create `frontend/src/server/ai/run-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_AI_MODEL,
  DETERMINISTIC_AI_RULES_VERSION,
  createDeterministicAiRunMetadata,
} from "./run-metadata";

describe("deterministic AI run metadata", () => {
  it("records deterministic provider, model, prompt, confidence, zero cost, and fallback reason", () => {
    const metadata = createDeterministicAiRunMetadata({
      action: "qualification_qa",
      promptVersion: "qualification-qa-lite@2026-06-10",
      confidence: "medium",
      fallbackReason: "no_llm_provider_configured",
      now: () => new Date("2026-06-10T00:00:00.000Z"),
    });

    expect(metadata).toEqual({
      id: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
      provider: "deterministic",
      model: DETERMINISTIC_AI_MODEL,
      rulesVersion: DETERMINISTIC_AI_RULES_VERSION,
      promptVersion: "qualification-qa-lite@2026-06-10",
      confidence: "medium",
      cost: { currency: "USD", total: 0 },
      fallbackReason: "no_llm_provider_configured",
      generatedAt: "2026-06-10T00:00:00.000Z",
    });
  });

  it("normalizes unknown confidence to medium and does not require OPENAI_API_KEY", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const metadata = createDeterministicAiRunMetadata({
        action: "intent_brief",
        promptVersion: "intent-brief-lite@2026-06-10",
        confidence: "unexpected",
        fallbackReason: "no_llm_provider_configured",
        now: () => new Date("2026-06-10T00:00:00.000Z"),
      });

      expect(metadata.confidence).toBe("medium");
      expect(metadata.cost.total).toBe(0);
      expect(metadata.provider).toBe("deterministic");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/server/ai/run-metadata.test.ts`

Expected: FAIL because `frontend/src/server/ai/run-metadata.ts` does not exist.

- [ ] **Step 3: Add the metadata helper**

Create `frontend/src/server/ai/run-metadata.ts`:

```ts
export const DETERMINISTIC_AI_MODEL = "rules://winbids/deterministic-ai-enterprise-depth-lite" as const;
export const DETERMINISTIC_AI_RULES_VERSION = "ai-enterprise-depth-lite-rules@2026-06-10" as const;

export const AI_FALLBACK_REASONS = [
  "no_llm_provider_configured",
  "deterministic_rules_selected",
  "workspace_not_available",
] as const;

export type AiProvider = "deterministic";
export type AiConfidence = "low" | "medium" | "high";
export type AiFallbackReason = (typeof AI_FALLBACK_REASONS)[number];

export interface AiRunMetadata {
  id: string;
  provider: AiProvider;
  model: typeof DETERMINISTIC_AI_MODEL;
  rulesVersion: typeof DETERMINISTIC_AI_RULES_VERSION;
  promptVersion: string;
  confidence: AiConfidence;
  cost: {
    currency: "USD";
    total: 0;
  };
  fallbackReason: AiFallbackReason;
  generatedAt: string;
}

export interface CreateDeterministicAiRunMetadataInput {
  action: string;
  promptVersion: string;
  confidence: unknown;
  fallbackReason: AiFallbackReason;
  now?: () => Date;
}

function normalizeConfidence(value: unknown): AiConfidence {
  return value === "low" || value === "high" ? value : "medium";
}

function normalizeAction(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

export function createDeterministicAiRunMetadata(
  input: CreateDeterministicAiRunMetadataInput,
): AiRunMetadata {
  const generatedAt = (input.now ?? (() => new Date()))().toISOString();

  return {
    id: `ai_run_${normalizeAction(input.action)}_${generatedAt}`,
    provider: "deterministic",
    model: DETERMINISTIC_AI_MODEL,
    rulesVersion: DETERMINISTIC_AI_RULES_VERSION,
    promptVersion: input.promptVersion,
    confidence: normalizeConfidence(input.confidence),
    cost: { currency: "USD", total: 0 },
    fallbackReason: input.fallbackReason,
    generatedAt,
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd frontend && npm test -- src/server/ai/run-metadata.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/server/ai/run-metadata.ts frontend/src/server/ai/run-metadata.test.ts
git commit -m "feat: add deterministic ai run metadata"
```

## Task 2: Attach AI Metadata To Intent Briefs And Grounded Q&A

**Files:**
- Modify: `frontend/src/server/intents/types.ts`
- Modify: `frontend/src/server/intents/brief-generator.ts`
- Modify: `frontend/src/server/intents/service.ts`
- Modify: `frontend/src/server/intents/brief-generator.test.ts`
- Modify: `frontend/src/server/intents/service.test.ts`
- Modify: `frontend/src/server/qualification/types.ts`
- Modify: `frontend/src/server/qualification/qa.ts`
- Modify: `frontend/src/server/qualification/qa.test.ts`
- Modify: `frontend/src/app/api/intents/[id]/qa/route.test.ts`

- [ ] **Step 1: Write failing tests for intent metadata**

Update `frontend/src/server/intents/brief-generator.test.ts`:

```ts
expect(result.aiRun).toMatchObject({
  provider: "deterministic",
  model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
  rulesVersion: "ai-enterprise-depth-lite-rules@2026-06-10",
  promptVersion: "intent-brief-lite@2026-06-10",
  confidence: "medium",
  cost: { currency: "USD", total: 0 },
  fallbackReason: "no_llm_provider_configured",
});
```

Update `frontend/src/server/intents/service.test.ts` in the create/read assertion:

```ts
expect(intent.generated.aiRun).toMatchObject({
  provider: "deterministic",
  promptVersion: "intent-brief-lite@2026-06-10",
  cost: { currency: "USD", total: 0 },
});
```

- [ ] **Step 2: Write failing tests for Q&A metadata**

Update `frontend/src/server/qualification/qa.test.ts` in the successful answer test:

```ts
expect(response.aiRun).toMatchObject({
  provider: "deterministic",
  model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
  rulesVersion: "ai-enterprise-depth-lite-rules@2026-06-10",
  promptVersion: "qualification-qa-lite@2026-06-10",
  confidence: "high",
  cost: { currency: "USD", total: 0 },
  fallbackReason: "no_llm_provider_configured",
});
```

Update `frontend/src/app/api/intents/[id]/qa/route.test.ts` response fixture:

```ts
aiRun: {
  id: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
  provider: "deterministic",
  model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
  rulesVersion: "ai-enterprise-depth-lite-rules@2026-06-10",
  promptVersion: "qualification-qa-lite@2026-06-10",
  confidence: "high",
  cost: { currency: "USD", total: 0 },
  fallbackReason: "no_llm_provider_configured",
  generatedAt: "2026-06-10T00:00:00.000Z",
},
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd frontend && npm test -- src/server/intents/brief-generator.test.ts src/server/intents/service.test.ts src/server/qualification/qa.test.ts 'src/app/api/intents/[id]/qa/route.test.ts'`

Expected: FAIL because `aiRun` fields are missing.

- [ ] **Step 4: Add metadata types**

In `frontend/src/server/intents/types.ts`, import and attach metadata:

```ts
import type { AiRunMetadata } from "@/server/ai/run-metadata";

export interface GeneratedIntentContent {
  aiBidBrief: string;
  keyDates: {
    publishedDate: string;
    deadlineDate: string;
  };
  initialChecklist: string[];
  riskFlags: string[];
  aiRun: AiRunMetadata;
}
```

In `frontend/src/server/qualification/types.ts`, import and attach metadata:

```ts
import type { AiRunMetadata } from "@/server/ai/run-metadata";
import type { CreditLedgerDryRunResult } from "@/server/billing/credit-ledger";

export interface QualificationQuestionResponse {
  intentId: string;
  bidId: string;
  question: string;
  answer: string;
  citations: QualificationCitation[];
  grounded: true;
  aiRun: AiRunMetadata;
  creditUsage?: CreditLedgerDryRunResult;
  generatedAt: string;
}
```

- [ ] **Step 5: Attach metadata in deterministic generators**

In `frontend/src/server/intents/brief-generator.ts`, import the helper and add the field to `generateIntentBrief`:

```ts
import { createDeterministicAiRunMetadata } from "@/server/ai/run-metadata";
```

```ts
aiRun: createDeterministicAiRunMetadata({
  action: "intent_brief",
  promptVersion: "intent-brief-lite@2026-06-10",
  confidence: match.confidence,
  fallbackReason: "no_llm_provider_configured",
}),
```

In `frontend/src/server/intents/service.ts`, add the same metadata to hydrated persisted rows because the current database stores generated brief fields individually, not metadata JSON:

```ts
aiRun: createDeterministicAiRunMetadata({
  action: "intent_brief",
  promptVersion: "intent-brief-lite@2026-06-10",
  confidence: row.matchConfidence,
  fallbackReason: "no_llm_provider_configured",
}),
```

In `frontend/src/server/qualification/qa.ts`, add metadata to the return object:

```ts
aiRun: createDeterministicAiRunMetadata({
  action: "qualification_qa",
  promptVersion: "qualification-qa-lite@2026-06-10",
  confidence: citations[0]?.confidence ?? "medium",
  fallbackReason: "no_llm_provider_configured",
}),
```

- [ ] **Step 6: Run tests to verify pass**

Run: `cd frontend && npm test -- src/server/intents/brief-generator.test.ts src/server/intents/service.test.ts src/server/qualification/qa.test.ts 'src/app/api/intents/[id]/qa/route.test.ts'`

Expected: PASS and all returned AI-like outputs include deterministic provider metadata, cost zero, and fallback reason.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/server/intents/types.ts frontend/src/server/intents/brief-generator.ts frontend/src/server/intents/service.ts frontend/src/server/intents/brief-generator.test.ts frontend/src/server/intents/service.test.ts frontend/src/server/qualification/types.ts frontend/src/server/qualification/qa.ts frontend/src/server/qualification/qa.test.ts 'frontend/src/app/api/intents/[id]/qa/route.test.ts'
git commit -m "feat: expose deterministic ai metadata"
```

## Task 3: Knowledge Retrieval Lite With Lexical Trace

**Files:**
- Create: `frontend/src/server/knowledge/retrieval.ts`
- Create: `frontend/src/server/knowledge/retrieval.test.ts`
- Modify: `frontend/src/server/knowledge/types.ts`
- Modify: `frontend/src/app/api/knowledge/route.ts`
- Modify: `frontend/src/app/api/knowledge/route.test.ts`
- Modify: `frontend/src/lib/api/knowledge.ts`
- Modify: `frontend/src/lib/api/knowledge.test.ts`

- [ ] **Step 1: Write failing retrieval service tests**

Create `frontend/src/server/knowledge/retrieval.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { organizationMemberships, organizations } from "@/server/db/schema";
import { createKnowledgeItem } from "./service";
import { retrieveKnowledgeContext } from "./retrieval";

async function seedKnowledge(testDb: Awaited<ReturnType<typeof createTestDatabase>>) {
  testDb.db.insert(organizations)
    .values({
      id: "org_seed",
      name: "Seed Organization",
      accountTier: "enterprise",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();

  testDb.db.insert(organizationMemberships)
    .values({
      organizationId: "org_seed",
      userId: "anon_seed",
      role: "owner",
      status: "active",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();

  await createKnowledgeItem(testDb.db, {
    organizationId: "org_seed",
    userId: "anon_seed",
    title: "Cloud security past performance",
    body: "Reusable response language for FedRAMP cloud migration work.",
    type: "template_snippet",
    tags: ["cloud", "security", "fedramp"],
    sourceKind: "manual",
    metadata: { owner: "proposal-team", sourceConfidence: "high" },
  });
}

describe("knowledge retrieval lite", () => {
  it("returns lexical trace with matched fields and future embedding status", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      await seedKnowledge(testDb);

      const result = await retrieveKnowledgeContext(testDb.db, {
        organizationId: "org_seed",
        query: "cloud security response",
        limit: 5,
      });

      expect(result.items).toHaveLength(1);
      expect(result.trace.provider).toBe("lexical");
      expect(result.trace.queryTokens).toEqual(["cloud", "security", "response"]);
      expect(result.trace.selectedItemIds).toEqual([result.items[0].id]);
      expect(result.trace.matchedFields).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemId: result.items[0].id, field: "title", tokenHits: ["cloud", "security"] }),
        expect.objectContaining({ itemId: result.items[0].id, field: "body", tokenHits: ["response"] }),
        expect.objectContaining({ itemId: result.items[0].id, field: "tags", tokenHits: ["cloud", "security"] }),
      ]));
      expect(result.trace.futureEmbeddingStatus).toEqual({
        status: "not_configured",
        provider: null,
        vectorStore: "none",
        reason: "embedding_provider_out_of_scope_for_lite_phase",
      });
    } finally {
      await testDb.cleanup();
    }
  });
});
```

- [ ] **Step 2: Write failing API/client tests**

In `frontend/src/app/api/knowledge/route.test.ts`, add:

```ts
it("returns lexical retrieval trace when requested with a query", async () => {
  await route.POST(new Request("http://localhost/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Past performance cloud snippet",
      body: "Reusable cloud response wording.",
      type: "template_snippet",
      tags: ["cloud"],
      sourceKind: "manual",
    }),
  }));

  const response = await route.GET(
    new Request("http://localhost/api/knowledge?q=cloud&includeRetrievalTrace=1"),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.retrievalTrace).toMatchObject({
    provider: "lexical",
    query: "cloud",
    futureEmbeddingStatus: {
      status: "not_configured",
      provider: null,
      vectorStore: "none",
      reason: "embedding_provider_out_of_scope_for_lite_phase",
    },
  });
  expect(body.retrievalTrace.matchedFields[0]).toMatchObject({
    field: expect.stringMatching(/title|body|tags/),
  });
});
```

In `frontend/src/lib/api/knowledge.test.ts`, add:

```ts
await fetchKnowledgeItems({
  q: "cloud security",
  includeRetrievalTrace: true,
});

expect(mockFetch).toHaveBeenCalledWith(
  "/api/knowledge?q=cloud+security&includeRetrievalTrace=1",
);
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd frontend && npm test -- src/server/knowledge/retrieval.test.ts src/app/api/knowledge/route.test.ts src/lib/api/knowledge.test.ts`

Expected: FAIL because retrieval trace types and endpoint support do not exist.

- [ ] **Step 4: Add retrieval types**

In `frontend/src/server/knowledge/types.ts`, add:

```ts
export type KnowledgeRetrievalProvider = "lexical";
export type KnowledgeRetrievalMatchedField = "title" | "body" | "tags" | "sourceKind" | "sourceUrl" | "metadata";

export interface KnowledgeRetrievalTrace {
  provider: KnowledgeRetrievalProvider;
  query: string;
  queryTokens: string[];
  matchedFields: Array<{
    itemId: string;
    field: KnowledgeRetrievalMatchedField;
    tokenHits: string[];
    score: number;
  }>;
  selectedItemIds: string[];
  futureEmbeddingStatus: {
    status: "not_configured";
    provider: null;
    vectorStore: "none";
    reason: "embedding_provider_out_of_scope_for_lite_phase";
  };
}

export interface KnowledgeRetrievalResponse {
  items: KnowledgeItem[];
  trace: KnowledgeRetrievalTrace;
}

export interface KnowledgeListResponse {
  items: KnowledgeItem[];
  retrievalTrace?: KnowledgeRetrievalTrace;
}
```

- [ ] **Step 5: Implement lexical retrieval**

Create `frontend/src/server/knowledge/retrieval.ts`:

```ts
import type { AppDatabase } from "@/server/db/client";
import { listKnowledgeItems } from "./service";
import type {
  KnowledgeItem,
  KnowledgeRetrievalMatchedField,
  KnowledgeRetrievalResponse,
  KnowledgeRetrievalTrace,
} from "./types";

const STOP_WORDS = new Set(["a", "an", "and", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function stringMetadataValues(metadata: Record<string, unknown>) {
  return Object.values(metadata).filter((value): value is string => typeof value === "string");
}

function fieldValues(item: KnowledgeItem): Array<{ field: KnowledgeRetrievalMatchedField; value: string }> {
  return [
    { field: "title", value: item.title },
    { field: "body", value: item.body },
    { field: "tags", value: item.tags.join(" ") },
    { field: "sourceKind", value: item.sourceKind },
    { field: "sourceUrl", value: item.sourceUrl ?? "" },
    { field: "metadata", value: stringMetadataValues(item.metadata).join(" ") },
  ];
}

function scoreField(tokens: string[], value: string) {
  const lower = value.toLowerCase();
  const tokenHits = tokens.filter((token) => lower.includes(token));

  return { tokenHits, score: tokenHits.length };
}

function traceForItems(query: string, tokens: string[], items: KnowledgeItem[]): KnowledgeRetrievalTrace {
  const matchedFields = items.flatMap((item) =>
    fieldValues(item)
      .map(({ field, value }) => ({
        itemId: item.id,
        field,
        ...scoreField(tokens, value),
      }))
      .filter((match) => match.score > 0),
  );

  return {
    provider: "lexical",
    query,
    queryTokens: tokens,
    matchedFields,
    selectedItemIds: items.map((item) => item.id),
    futureEmbeddingStatus: {
      status: "not_configured",
      provider: null,
      vectorStore: "none",
      reason: "embedding_provider_out_of_scope_for_lite_phase",
    },
  };
}

export async function retrieveKnowledgeContext(
  database: AppDatabase,
  input: { organizationId: string; query: string; limit?: number | null },
): Promise<KnowledgeRetrievalResponse> {
  const query = input.query.trim();
  const queryTokens = tokenize(query);
  const listed = await listKnowledgeItems(database, {
    organizationId: input.organizationId,
    q: query,
    limit: input.limit ?? 10,
  });
  const trace = traceForItems(query, queryTokens, listed.items);

  return {
    items: listed.items,
    trace,
  };
}
```

- [ ] **Step 6: Wire API and client**

In `frontend/src/app/api/knowledge/route.ts`, branch inside GET after parsing `searchParams`:

```ts
const includeRetrievalTrace = searchParams.get("includeRetrievalTrace") === "1";
const q = optionalQueryValue(searchParams.get("q"));

if (includeRetrievalTrace && q) {
  const result = await retrieveKnowledgeContext(database, {
    organizationId,
    query: q,
    limit: limitQueryValue(searchParams.get("limit")),
  });

  return jsonWithPrincipalCookie({
    items: result.items,
    retrievalTrace: result.trace,
  }, principal);
}
```

In `frontend/src/lib/api/knowledge.ts`, add the param:

```ts
export interface FetchKnowledgeItemsParams {
  intentId?: string;
  bidId?: string;
  q?: string;
  type?: string;
  limit?: number;
  includeRetrievalTrace?: boolean;
}
```

```ts
if (params.includeRetrievalTrace) searchParams.set("includeRetrievalTrace", "1");
```

- [ ] **Step 7: Run tests to verify pass**

Run: `cd frontend && npm test -- src/server/knowledge/retrieval.test.ts src/server/knowledge/service.test.ts src/app/api/knowledge/route.test.ts src/lib/api/knowledge.test.ts`

Expected: PASS. Retrieval trace shows lexical provider, matched fields, selected item IDs, and `futureEmbeddingStatus.status === "not_configured"`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/server/knowledge/retrieval.ts frontend/src/server/knowledge/retrieval.test.ts frontend/src/server/knowledge/types.ts frontend/src/app/api/knowledge/route.ts frontend/src/app/api/knowledge/route.test.ts frontend/src/lib/api/knowledge.ts frontend/src/lib/api/knowledge.test.ts
git commit -m "feat: add lexical knowledge retrieval trace"
```

## Task 4: Credit Ledger Dry-Run

**Files:**
- Create: `frontend/src/server/billing/credit-ledger.ts`
- Create: `frontend/src/server/billing/credit-ledger.test.ts`
- Modify: `frontend/src/server/billing/credits.test.ts`

- [ ] **Step 1: Write failing dry-run ledger tests**

Create `frontend/src/server/billing/credit-ledger.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "@/server/db/test-utils";
import { creditUsageEvents, organizationMemberships, organizations } from "@/server/db/schema";
import {
  CreditLedgerEnforcementDisabledError,
  debitCredits,
  grantMonthlyCredits,
  recordPremiumActionUsageDryRun,
  refundCredits,
} from "./credit-ledger";

function createLedgerScope(testDb: Awaited<ReturnType<typeof createTestDatabase>>) {
  testDb.db.insert(organizations)
    .values({
      id: "org_seed",
      name: "Seed Organization",
      accountTier: "pro",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();

  testDb.db.insert(organizationMemberships)
    .values({
      organizationId: "org_seed",
      userId: "anon_seed",
      role: "owner",
      status: "active",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();
}

describe("credit ledger dry-run", () => {
  it("records premium action usage without debiting credits", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      createLedgerScope(testDb);

      const result = await recordPremiumActionUsageDryRun(testDb.db, {
        organizationId: "org_seed",
        userId: "anon_seed",
        featureKey: "bid.brief.full.generate",
        actionId: "qa:intent_1",
        aiRunId: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
        metadata: { provider: "deterministic" },
        now: () => new Date("2026-06-10T00:00:00.000Z"),
      });

      expect(result).toMatchObject({
        mode: "dry_run",
        eventRecorded: true,
        featureKey: "bid.brief.full.generate",
        creditCost: 1,
        chargedAmount: 0,
        balanceAfter: null,
        fallbackReason: "billing_enforcement_disabled",
      });

      const row = testDb.db
        .select()
        .from(creditUsageEvents)
        .where(eq(creditUsageEvents.id, result.eventId ?? ""))
        .limit(1)
        .get();

      expect(row).toMatchObject({
        organizationId: "org_seed",
        userId: "anon_seed",
        featureKey: "bid.brief.full.generate",
        eventType: "premium_action",
        amount: 0,
        balanceAfter: null,
      });
      expect(JSON.parse(row?.metadataJson ?? "{}")).toMatchObject({
        dryRun: true,
        billingEnforcement: false,
        actionId: "qa:intent_1",
        aiRunId: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
        reservedInterfaces: ["debitCredits", "refundCredits", "grantMonthlyCredits"],
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("keeps debit, refund, and monthly grant interfaces disabled", async () => {
    await expect(debitCredits()).rejects.toBeInstanceOf(CreditLedgerEnforcementDisabledError);
    await expect(refundCredits()).rejects.toBeInstanceOf(CreditLedgerEnforcementDisabledError);
    await expect(grantMonthlyCredits()).rejects.toBeInstanceOf(CreditLedgerEnforcementDisabledError);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- src/server/billing/credit-ledger.test.ts`

Expected: FAIL because `credit-ledger.ts` does not exist.

- [ ] **Step 3: Implement dry-run ledger**

Create `frontend/src/server/billing/credit-ledger.ts`:

```ts
import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { creditUsageEvents } from "@/server/db/schema";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlExecute } from "@/server/db/mysql-runtime";
import type { FeatureKey } from "@/server/auth/entitlements";
import { creditCostForFeature } from "./credits";

export interface CreditLedgerDryRunResult {
  mode: "dry_run";
  eventRecorded: boolean;
  eventId: string | null;
  featureKey: FeatureKey;
  creditCost: number;
  chargedAmount: 0;
  balanceAfter: null;
  fallbackReason: "billing_enforcement_disabled" | "workspace_not_available";
}

export interface RecordPremiumActionUsageDryRunInput {
  organizationId: string | null;
  userId: string;
  featureKey: FeatureKey;
  actionId: string;
  aiRunId?: string | null;
  metadata?: Record<string, unknown>;
  now?: () => Date;
}

export class CreditLedgerEnforcementDisabledError extends Error {
  constructor() {
    super("Real credit debit, refund, and monthly grant enforcement are disabled for AI Enterprise Depth Lite.");
    this.name = "CreditLedgerEnforcementDisabledError";
  }
}

const RESERVED_INTERFACES = ["debitCredits", "refundCredits", "grantMonthlyCredits"] as const;

type CreditUsageEventValues = typeof creditUsageEvents.$inferInsert;

async function insertCreditUsageEvent(database: AppDatabase, values: CreditUsageEventValues) {
  if (isMysqlDatabaseUrlConfigured()) {
    await mysqlExecute(resolveMysqlPool(), `
      INSERT INTO credit_usage_events (
        id,
        organization_id,
        user_id,
        feature_key,
        event_type,
        amount,
        balance_after,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      values.id,
      values.organizationId,
      values.userId,
      values.featureKey,
      values.eventType,
      values.amount,
      values.balanceAfter,
      values.metadataJson,
      values.createdAt,
    ]);
    return;
  }

  database.insert(creditUsageEvents).values(values).run();
}

export async function recordPremiumActionUsageDryRun(
  database: AppDatabase,
  input: RecordPremiumActionUsageDryRunInput,
): Promise<CreditLedgerDryRunResult> {
  const creditCost = creditCostForFeature(input.featureKey);

  if (!input.organizationId) {
    return {
      mode: "dry_run",
      eventRecorded: false,
      eventId: null,
      featureKey: input.featureKey,
      creditCost,
      chargedAmount: 0,
      balanceAfter: null,
      fallbackReason: "workspace_not_available",
    };
  }

  const eventId = `credit_usage_${crypto.randomUUID()}`;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();

  await insertCreditUsageEvent(database, {
    id: eventId,
    organizationId: input.organizationId,
    userId: input.userId,
    featureKey: input.featureKey,
    eventType: "premium_action",
    amount: 0,
    balanceAfter: null,
    metadataJson: JSON.stringify({
      ...(input.metadata ?? {}),
      dryRun: true,
      billingEnforcement: false,
      actionId: input.actionId,
      aiRunId: input.aiRunId ?? null,
      reservedInterfaces: [...RESERVED_INTERFACES],
    }),
    createdAt,
  });

  return {
    mode: "dry_run",
    eventRecorded: true,
    eventId,
    featureKey: input.featureKey,
    creditCost,
    chargedAmount: 0,
    balanceAfter: null,
    fallbackReason: "billing_enforcement_disabled",
  };
}

export async function debitCredits(): Promise<never> {
  throw new CreditLedgerEnforcementDisabledError();
}

export async function refundCredits(): Promise<never> {
  throw new CreditLedgerEnforcementDisabledError();
}

export async function grantMonthlyCredits(): Promise<never> {
  throw new CreditLedgerEnforcementDisabledError();
}
```

The MySQL branch must preserve the same return shape and insert into `credit_usage_events` using `mysqlExecute`; do not update `credit_balances`.

- [ ] **Step 4: Strengthen credits tests**

In `frontend/src/server/billing/credits.test.ts`, assert dry-run compatibility without changing existing costs:

```ts
expect(CREDIT_EVENT_TYPES).toContain("premium_action");
expect(creditCostForFeature("bid.brief.full.generate")).toBe(1);
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd frontend && npm test -- src/server/billing/credits.test.ts src/server/billing/credit-ledger.test.ts`

Expected: PASS. Dry-run usage events record `amount: 0`, `balanceAfter: null`, and disabled-enforcement metadata.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/server/billing/credit-ledger.ts frontend/src/server/billing/credit-ledger.test.ts frontend/src/server/billing/credits.test.ts
git commit -m "feat: add dry-run credit ledger events"
```

## Task 5: Route Integration For Q&A Premium Action Dry-Run

**Files:**
- Modify: `frontend/src/app/api/intents/[id]/qa/route.ts`
- Modify: `frontend/src/app/api/intents/[id]/qa/route.test.ts`
- Modify: `frontend/src/server/qualification/types.ts`

- [ ] **Step 1: Write failing route tests for dry-run credit usage**

In `frontend/src/app/api/intents/[id]/qa/route.test.ts`, mock the ledger:

```ts
import * as creditLedger from "@/server/billing/credit-ledger";

vi.mock("@/server/billing/credit-ledger", () => ({
  recordPremiumActionUsageDryRun: vi.fn(),
}));

const recordPremiumActionUsageDryRun = vi.mocked(creditLedger.recordPremiumActionUsageDryRun);
```

Add an authenticated principal with a workspace:

```ts
const proWorkspacePrincipal = {
  ...proPrincipal,
  workspace: {
    organizationId: "org_seed",
    organizationName: "Seed Organization",
    role: "owner" as const,
    tier: "pro" as const,
  },
};
```

Add the test:

```ts
it("records dry-run credit usage for successful premium Q&A when workspace exists", async () => {
  resolvePrincipal.mockResolvedValueOnce(proWorkspacePrincipal);
  answerQualificationQuestion.mockResolvedValueOnce(qaResponse);
  recordPremiumActionUsageDryRun.mockResolvedValueOnce({
    mode: "dry_run",
    eventRecorded: true,
    eventId: "credit_usage_1",
    featureKey: "bid.brief.full.generate",
    creditCost: 1,
    chargedAmount: 0,
    balanceAfter: null,
    fallbackReason: "billing_enforcement_disabled",
  });

  const response = await POST(new Request("http://localhost/api/intents/intent_1/qa", {
    method: "POST",
    body: JSON.stringify({ question: "What is the deadline?" }),
  }), {
    params: Promise.resolve({ id: "intent_1" }),
  });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.creditUsage).toMatchObject({
    mode: "dry_run",
    chargedAmount: 0,
    fallbackReason: "billing_enforcement_disabled",
  });
  expect(recordPremiumActionUsageDryRun).toHaveBeenCalledWith(expect.anything(), {
    organizationId: "org_seed",
    userId: "user_1",
    featureKey: "bid.brief.full.generate",
    actionId: "qualification_qa:intent_1",
    aiRunId: qaResponse.aiRun.id,
    metadata: {
      provider: "deterministic",
      promptVersion: "qualification-qa-lite@2026-06-10",
    },
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npm test -- 'src/app/api/intents/[id]/qa/route.test.ts'`

Expected: FAIL because route does not call the dry-run ledger.

- [ ] **Step 3: Record dry-run usage after successful answer**

In `frontend/src/app/api/intents/[id]/qa/route.ts`, import the ledger:

```ts
import { recordPremiumActionUsageDryRun } from "@/server/billing/credit-ledger";
```

After `answerQualificationQuestion` succeeds:

```ts
const creditUsage = await recordPremiumActionUsageDryRun(db, {
  organizationId: principal.workspace?.organizationId ?? null,
  userId: principal.userId,
  featureKey: "bid.brief.full.generate",
  actionId: `qualification_qa:${id}`,
  aiRunId: answer.aiRun.id,
  metadata: {
    provider: answer.aiRun.provider,
    promptVersion: answer.aiRun.promptVersion,
  },
});

return jsonWithPrincipalCookie({ ...answer, creditUsage }, principal);
```

The route must continue returning answers even when no workspace exists; in that case the ledger result has `eventRecorded: false` and `fallbackReason: "workspace_not_available"`.

- [ ] **Step 4: Run test to verify pass**

Run: `cd frontend && npm test -- 'src/app/api/intents/[id]/qa/route.test.ts' src/server/billing/credit-ledger.test.ts src/server/qualification/qa.test.ts`

Expected: PASS. Successful Q&A responses include AI metadata and dry-run credit usage, with no real debit.

- [ ] **Step 5: Commit**

```bash
git add 'frontend/src/app/api/intents/[id]/qa/route.ts' 'frontend/src/app/api/intents/[id]/qa/route.test.ts' frontend/src/server/qualification/types.ts
git commit -m "feat: dry-run premium qa credit usage"
```

## Task 6: Verification Gate

**Files:**
- Modify: none beyond Tasks 1-5.

- [ ] **Step 1: Run focused AI/Knowledge/Billing tests**

Run:

```bash
cd frontend
npm test -- src/server/ai/run-metadata.test.ts src/server/intents/brief-generator.test.ts src/server/intents/service.test.ts src/server/qualification/qa.test.ts 'src/app/api/intents/[id]/qa/route.test.ts' src/server/knowledge/retrieval.test.ts src/server/knowledge/service.test.ts src/app/api/knowledge/route.test.ts src/lib/api/knowledge.test.ts src/server/billing/credits.test.ts src/server/billing/credit-ledger.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader regression checks**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 3: Verify no model key dependency**

Run:

```bash
cd frontend
env -u OPENAI_API_KEY npm test -- src/server/ai/run-metadata.test.ts src/server/qualification/qa.test.ts src/server/knowledge/retrieval.test.ts src/server/billing/credit-ledger.test.ts
```

Expected: PASS with `OPENAI_API_KEY` unset.

- [ ] **Step 4: Verify no forbidden implementation appeared**

Run:

```bash
rg -n "OPENAI_API_KEY|embeddings|vectorStore|vector store|chat.completions|responses.create|debitCredits\\(|refundCredits\\(|grantMonthlyCredits\\(" frontend/src/server frontend/src/app/api frontend/src/lib --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
```

Expected:
- No `OPENAI_API_KEY` reads.
- No real LLM call sites.
- No embedding provider calls.
- No vector store implementation.
- `debitCredits(`, `refundCredits(`, and `grantMonthlyCredits(` appear only as disabled reserved interfaces and tests that assert disabled behavior.

- [ ] **Step 5: Check formatting and diff scope**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Changed files are limited to the files listed in Tasks 1-5.

## Acceptance Criteria

- AI-like outputs expose deterministic AI run metadata with provider, model/rules version, prompt version, confidence, zero cost, and fallback reason.
- Knowledge Station can return a lexical retrieval trace with matched fields and future embedding status.
- Retrieval does not call embeddings and does not need a vector store.
- Premium Q&A can record a `premium_action` dry-run usage event with `amount = 0` and `balance_after = null`.
- Debit/refund/monthly grant functions exist only as disabled reserved interfaces.
- `OPENAI_API_KEY` is not required.
- Existing deterministic Q&A, citation, Knowledge Station, and billing credit tests still pass.
- No billing webhook, production docs, product requirements docs, or broad UI code are changed for this lite phase.

## Self-Review Checklist

- Spec coverage: AI run metadata is covered in Tasks 1-2; Knowledge retrieval lite is covered in Task 3; credit ledger dry-run is covered in Tasks 4-5; env/API key boundary and explicit non-goals are documented above.
- Placeholder scan: no task relies on an unspecified provider, vector store, real debit, or model key.
- Type consistency: `AiRunMetadata`, `KnowledgeRetrievalTrace`, and `CreditLedgerDryRunResult` are introduced before downstream use.
- Scope check: plan remains an implementation handoff only; it does not ask the planning worker to edit product code.
