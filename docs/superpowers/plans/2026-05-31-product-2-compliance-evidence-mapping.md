# Product 2 Compliance Evidence Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link each Compliance Manifest item to existing evidence references so users can trace requirement status back to bid fields, attachments, source records, generated output, and match/profile context.

**Architecture:** Reuse the existing `PursuitEvidenceRef` shape as an additive field on compliance item DTOs. Generate refs deterministically from the current intent at creation and hydration time, without changing the database schema.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle/better-sqlite3, Vitest, existing WinBids i18n dictionaries.

---

### Task 1: Add Compliance Evidence Refs In Backend

**Files:**
- Modify: `frontend/src/server/compliance/types.ts`
- Modify: `frontend/src/server/compliance/generator.ts`
- Modify: `frontend/src/server/compliance/service.ts`
- Test: `frontend/src/server/compliance/service.test.ts`

- [ ] **Step 1: Write the failing test**

Add assertions to `frontend/src/server/compliance/service.test.ts`:

```ts
expect(first.items[0].evidenceRefs.length).toBeGreaterThan(0);
expect(first.items.some((item) =>
  item.evidenceRefs.some((ref) => ref.kind === "source_url" || ref.kind === "attachment"),
)).toBe(true);
expect(second.items[0].evidenceRefs.length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- src/server/compliance/service.test.ts
```

Expected: FAIL because compliance items do not expose `evidenceRefs`.

- [ ] **Step 3: Implement minimal backend mapping**

Add `evidenceRefs` to `GeneratedComplianceItem` and `ComplianceManifestItem`. In `frontend/src/server/compliance/generator.ts`, create `buildComplianceEvidenceRefs(intent, item)` that maps:

- `eligibility` -> supplier profile, source URL, generated checklist.
- `documents` -> attachments, bid detail, source URL.
- `pricing` -> match snapshot, bid detail, source URL.
- `submission` -> deadline citation, source URL, generated checklist.
- `risk` -> generated output, match snapshot, bid detail.

In `frontend/src/server/compliance/service.ts`, pass the current intent into hydration so existing rows derive refs at read time.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd frontend
npm test -- src/server/compliance/service.test.ts
```

Expected: PASS.

### Task 2: Preserve API Client Compatibility

**Files:**
- Modify: `frontend/src/lib/api/intents.test.ts`

- [ ] **Step 1: Write compatibility test**

Update the compliance manifest mock item to include:

```ts
evidenceRefs: [{ kind: "source_url", label: "Original source", url: "https://example.gov/bid" }]
```

Assert:

```ts
expect(result.manifest.items[0].evidenceRefs[0]).toMatchObject({ kind: "source_url" });
```

- [ ] **Step 2: Run test**

Run:

```bash
cd frontend
npm test -- src/lib/api/intents.test.ts
```

Expected: PASS.

### Task 3: Render Compliance Evidence Chips

**Files:**
- Modify: `frontend/src/app/intents/[id]/page.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`

- [ ] **Step 1: Write failing static UI test**

Add checks to `frontend/src/app/intents/[id]/page.test.ts`:

```ts
expect(page).toContain("item.evidenceRefs");
expect(page).toContain('t("intentsPage.linkedEvidence")');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
npm test -- 'src/app/intents/[id]/page.test.ts'
```

Expected: FAIL because compliance items do not render evidence refs.

- [ ] **Step 3: Implement UI**

Reuse `evidenceRefUrl(ref)` from the pursuit reason section. Under each compliance item title, render a “Linked evidence” row only when `item.evidenceRefs.length > 0`. URL refs render as `Link`; citation-only refs render as a non-link chip.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd frontend
npm test -- 'src/app/intents/[id]/page.test.ts'
```

Expected: PASS.

### Task 4: Update Status And Verify

**Files:**
- Modify: `docs/product-requirements/winbids-implementation-status.md`

- [ ] **Step 1: Update status**

Add Product 2 Compliance Evidence Mapping v1 to completed/current status and move the recommended next phase to Knowledge Station Lite or Admin risk-check visualization.

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd frontend
npm test -- src/server/compliance/service.test.ts src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts'
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
git add docs/superpowers/plans/2026-05-31-product-2-compliance-evidence-mapping.md docs/product-requirements/winbids-implementation-status.md frontend/src/server/compliance/types.ts frontend/src/server/compliance/generator.ts frontend/src/server/compliance/service.ts frontend/src/server/compliance/service.test.ts frontend/src/lib/api/intents.test.ts 'frontend/src/app/intents/[id]/page.tsx' 'frontend/src/app/intents/[id]/page.test.ts'
git commit -m "feat: map compliance items to evidence"
```
