# Product 2 Evidence Artifact Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link Product 2 pursue/no-bid recommendation reasons to existing citations, bid details, source URLs, attachment download routes, supplier profile, match snapshot, and generated output.

**Architecture:** Add an additive `PursuitEvidenceRef` type to the existing pursuit recommendation model. Generate references deterministically in `frontend/src/server/pursuit/generator.ts`, render them as safe evidence chips in `frontend/src/app/intents/[id]/page.tsx`, and keep the current `evidenceLabel` fallback for compatibility.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, existing WinBids API/client types, existing i18n dictionaries.

---

### Task 1: Add Evidence Ref Types And Generator Tests

**Files:**
- Modify: `frontend/src/server/pursuit/types.ts`
- Modify: `frontend/src/server/pursuit/generator.ts`
- Modify: `frontend/src/server/pursuit/service.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions to `frontend/src/server/pursuit/service.test.ts`:

```ts
expect(board.recommendation.reasonDetails[0]).toEqual(expect.objectContaining({
  evidenceRefs: expect.arrayContaining([
    expect.objectContaining({ kind: "match_snapshot", label: "Match snapshot" }),
  ]),
}));
expect(board.recommendation.reasonDetails.some((detail) =>
  detail.evidenceRefs.some((ref) => ref.kind === "source_url" || ref.kind === "attachment"),
)).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- src/server/pursuit/service.test.ts
```

Expected: FAIL because `evidenceRefs` does not exist on generated reason details.

- [ ] **Step 3: Implement additive types and generator refs**

Add `PursuitEvidenceRefKind` and `PursuitEvidenceRef` in `frontend/src/server/pursuit/types.ts`; extend `PursuitReasonDetail` with `evidenceRefs: PursuitEvidenceRef[]`.

Update the local `detail()` helper in `frontend/src/server/pursuit/generator.ts` to accept refs, then add refs by category:

```ts
evidenceRefs: [{ kind: "match_snapshot", label: "Match snapshot" }]
```

Use bid source URL, bid detail path, attachment route URLs, generated output refs, and supplier profile refs where applicable.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd frontend
npm test -- src/server/pursuit/service.test.ts
```

Expected: PASS.

### Task 2: Preserve API Client Compatibility

**Files:**
- Modify: `frontend/src/lib/api/intents.test.ts`

- [ ] **Step 1: Write the failing compatibility test**

Update the mocked pursuit decision board body in `frontend/src/lib/api/intents.test.ts` so `reasonDetails[0]` includes:

```ts
evidenceRefs: [{ kind: "citation", label: "Match snapshot", citationId: "citation_generated_brief" }]
```

Assert:

```ts
expect(result.decisionBoard.recommendation.reasonDetails[0].evidenceRefs[0]).toMatchObject({
  kind: "citation",
  citationId: "citation_generated_brief",
});
```

- [ ] **Step 2: Run test**

Run:

```bash
cd frontend
npm test -- src/lib/api/intents.test.ts
```

Expected: PASS after Task 1 types exist.

### Task 3: Render Evidence Refs In Intent UI

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Write the failing static page test**

Add checks to `frontend/src/app/intents/[id]/page.test.ts`:

```ts
expect(page).toContain("evidenceRefs");
expect(page).toContain("evidenceRefUrl");
expect(page).toContain('t("intentsPage.linkedEvidence")');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- 'src/app/intents/[id]/page.test.ts'
```

Expected: FAIL because the page does not render evidence refs yet.

- [ ] **Step 3: Implement UI**

Add helper:

```ts
function evidenceRefUrl(ref: { url?: string }) {
  return ref.url ? safeEvidenceUrl(ref.url) : "";
}
```

In each reason detail card, render `detail.evidenceRefs` as compact chips. Use `Link` for refs with safe URLs and a non-link badge for refs without URLs. Keep current `evidenceLabel` fallback when refs are empty.

Add dictionary keys:

```ts
linkedEvidence: "Linked evidence"
```

Chinese:

```ts
linkedEvidence: "关联证据"
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd frontend
npm test -- 'src/app/intents/[id]/page.test.ts'
```

Expected: PASS.

### Task 4: Update Product Status And Verify

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`

- [ ] **Step 1: Update status**

Move Product 2 Richer Evidence / Artifact Links v1 into completed/current status and set the next recommended slice to compliance evidence mapping or Knowledge Station Lite.

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/server/pursuit/service.test.ts src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
cd ..
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add docs/product-requirements/winbids-implementation-status.md frontend/src/server/pursuit/types.ts frontend/src/server/pursuit/generator.ts frontend/src/server/pursuit/service.test.ts frontend/src/lib/api/intents.test.ts 'frontend/src/app/intents/[id]/page.tsx' 'frontend/src/app/intents/[id]/page.test.ts' frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: link pursuit reasons to evidence"
```
