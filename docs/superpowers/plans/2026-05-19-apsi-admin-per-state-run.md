# APSi Admin Per-State Crawler Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add row-level Admin controls so operators can run one supported state crawler at a time.

**Architecture:** Reuse the existing `POST /api/crawler/state/run` endpoint, which already accepts a `sources` array. Extend the Admin API client to send selected source ids, then wire a new `Run` column in the Admin data source table with per-row loading state and localized messages.

**Tech Stack:** Next.js app router, React client component, TypeScript, Vitest, existing i18n dictionaries, lucide-react icons.

---

## File Structure

- Modify `frontend/src/lib/api/admin.ts`: allow `runStateCrawlersNow` to accept optional source ids.
- Modify `frontend/src/lib/api/admin.test.ts`: add selected-source request test.
- Modify `frontend/src/app/admin/page.tsx`: add supported state source set, row-level run handler, loading state, and table button column.
- Modify `frontend/src/lib/i18n/dictionaries/en.ts`: add row-run labels and messages.
- Modify `frontend/src/lib/i18n/dictionaries/zh.ts`: add row-run labels and messages.

---

### Task 1: Extend Admin API Client Test

**Files:**
- Modify: `frontend/src/lib/api/admin.test.ts`

- [ ] **Step 1: Add a failing test**

Add this test after the existing `runs state crawlers now` test:

```ts
it("runs a selected state crawler now", async () => {
  const body = { status: "completed", results: [{ source: "il_bidbuy" }] };
  mockFetch.mockResolvedValueOnce(jsonResponse(body));

  await expect(runStateCrawlersNow(["il_bidbuy"])).resolves.toEqual(body);
  expect(mockFetch).toHaveBeenCalledWith("/api/crawler/state/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources: ["il_bidbuy"] }),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && npm test -- src/lib/api/admin.test.ts
```

Expected: fail because `runStateCrawlersNow` does not accept source ids or send a body.

---

### Task 2: Implement Admin API Client Support

**Files:**
- Modify: `frontend/src/lib/api/admin.ts`
- Test: `frontend/src/lib/api/admin.test.ts`

- [ ] **Step 1: Update `runStateCrawlersNow`**

Replace the current function with:

```ts
export async function runStateCrawlersNow(sourceIds?: string[]) {
  const hasSelectedSources = sourceIds && sourceIds.length > 0;
  const response = await fetch(
    "/api/crawler/state/run",
    hasSelectedSources
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: sourceIds }),
        }
      : { method: "POST" },
  );

  return parseResponse<unknown>(response);
}
```

- [ ] **Step 2: Run API client tests**

Run:

```bash
cd frontend && npm test -- src/lib/api/admin.test.ts
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api/admin.ts frontend/src/lib/api/admin.test.ts
git commit -m "feat: support selected state crawler runs"
```

---

### Task 3: Wire Admin Row Buttons

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Add supported source ids**

Add near the top of `frontend/src/app/admin/page.tsx`:

```ts
const RUNNABLE_STATE_SOURCE_IDS = new Set([
  "ca_caleprocure",
  "tx_esbd",
  "ny_contract_reporter",
  "fl_mfmp",
  "il_bidbuy",
]);

function isRunnableStateSource(source: AdminDataSource) {
  return RUNNABLE_STATE_SOURCE_IDS.has(source.id);
}
```

- [ ] **Step 2: Add row running state**

Add state next to `isRunning`:

```ts
const [runningSourceId, setRunningSourceId] = useState<string | null>(null);
```

- [ ] **Step 3: Update bulk button disable logic**

Change the bulk run button disable prop to:

```tsx
disabled={isRunning || runningSourceId !== null}
```

- [ ] **Step 4: Add a row run handler**

Add below `runNow`:

```ts
const runSourceNow = (source: AdminDataSource) => {
  setRunningSourceId(source.id);
  setRunMessage(null);
  runStateCrawlersNow([source.id])
    .then(() => {
      setRunMessage(t("admin.runSourceQueued").replace("{source}", source.label));
      load();
    })
    .catch(() => {
      setRunMessage(t("admin.runSourceFailed").replace("{source}", source.label));
    })
    .finally(() => {
      setRunningSourceId(null);
    });
};
```

- [ ] **Step 5: Add table column header**

Insert before the enabled column header:

```tsx
<TableHead className="text-right">{t("admin.run")}</TableHead>
```

- [ ] **Step 6: Add row action cell**

Insert before the enabled cell:

```tsx
<TableCell className="text-right">
  {isRunnableStateSource(source) ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => runSourceNow(source)}
      disabled={isRunning || runningSourceId !== null}
      aria-label={t("admin.runSource").replace("{source}", source.label)}
      className="h-8 rounded-lg border-slate-200 px-2"
    >
      <Play size={14} />
      <span className="sr-only">{t("admin.runSource").replace("{source}", source.label)}</span>
    </Button>
  ) : (
    <span className="text-slate-400">-</span>
  )}
</TableCell>
```

- [ ] **Step 7: Add localized strings**

In both dictionaries under `admin`, add:

English:

```ts
run: "Run",
runSource: "Run {source}",
runSourceQueued: "State crawler run completed for {source}.",
runSourceFailed: "Unable to run state crawler for {source}.",
```

Chinese:

```ts
run: "运行",
runSource: "运行 {source}",
runSourceQueued: "{source} 州级爬虫运行完成。",
runSourceFailed: "无法运行 {source} 州级爬虫。",
```

- [ ] **Step 8: Run build**

Run:

```bash
cd frontend && npm run build
```

Expected: pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/app/admin/page.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: add admin per-state crawler run buttons"
```

---

### Task 4: Verify Browser and Full Suite

**Files:**
- No code edits unless verification finds a defect.

- [ ] **Step 1: Run targeted tests**

```bash
cd frontend && npm test -- src/lib/api/admin.test.ts src/app/api/crawler/state/run/route.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full frontend tests**

```bash
cd frontend && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

```bash
cd frontend && npm run lint
```

Expected: exit code 0.

- [ ] **Step 4: Run production build**

```bash
cd frontend && npm run build
```

Expected: exit code 0.

- [ ] **Step 5: Run crawler tests**

```bash
cd crawler && python3 -m pytest
```

Expected: all tests pass. The existing local urllib3 LibreSSL warning is acceptable.

- [ ] **Step 6: Browser verification**

Open `http://localhost:3000/admin` and verify:

- The data source table has a `Run` column.
- Supported state rows show Play buttons.
- Unsupported rows show `-`.
- Clicking the IL row button sends a single-source state run and refreshes logs.

---

## Self-Review

- Spec coverage: row-level state run controls, API client payload, loading behavior, localization, and verification are covered.
- Placeholder scan: no placeholder instructions remain.
- Type consistency: `runStateCrawlersNow(sourceIds?: string[])`, `AdminDataSource`, and dictionary keys match planned usage.
