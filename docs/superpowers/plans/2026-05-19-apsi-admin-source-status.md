# APSi Admin Source Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Admin source rows show accurate latest crawler status and concise error reasons for mapped state crawler sources.

**Architecture:** Fix the server-side `listAdminDataSources` log matching so seeded source rows resolve their crawler runner source ids by state code before falling back to existing label/id matching. Then add a small inline error summary in the Admin table using the existing `latestLog.errorMessage`.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM, SQLite, Next.js React client component, existing i18n dictionaries.

---

## File Structure

- Modify `frontend/src/server/admin/data-sources-repository.ts`: add state-code-to-crawler-source mapping and use it when attaching `latestLog`.
- Modify `frontend/src/server/admin/data-sources-repository.test.ts`: add mapped crawler log status tests and keep direct SAM.gov matching covered.
- Modify `frontend/src/app/admin/page.tsx`: show short inline error reason under failed status badge.
- Modify `frontend/src/lib/i18n/dictionaries/en.ts`: add error label if needed.
- Modify `frontend/src/lib/i18n/dictionaries/zh.ts`: add error label if needed.

---

### Task 1: Add Repository Mapping Tests

**Files:**
- Modify: `frontend/src/server/admin/data-sources-repository.test.ts`

- [ ] **Step 1: Write failing tests**

Add imports:

```ts
import { crawlerLogs, dataSources } from "@/server/db/schema";
import { listAdminDataSources } from "./data-sources-repository";
```

Add this helper in the test file:

```ts
function insertCrawlerLog(
  testDb: TestDatabase,
  input: {
    id: string;
    source: string;
    status: string;
    startedAt: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  testDb.db
    .insert(crawlerLogs)
    .values({
      id: input.id,
      source: input.source,
      runId: `${input.id}_run`,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.startedAt,
      durationMs: 10,
      fetchedCount: input.status === "success" ? 1 : 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: input.status === "failure" ? 1 : 0,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      errorStack: null,
      metadata: null,
    })
    .run();
}
```

Add tests:

```ts
it("maps state data source rows to crawler log source ids", async () => {
  testDb.db
    .insert(dataSources)
    .values({
      id: "texas_smartbuy",
      label: "Texas SmartBuy",
      issuerType: "state",
      stateCode: "TX",
      isEnabled: 1,
      cadence: "daily",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  insertCrawlerLog(testDb, {
    id: "log_tx_failure",
    source: "tx_esbd",
    status: "failure",
    startedAt: "2026-05-19T01:00:00.000Z",
    errorCode: "TxEsbdError",
    errorMessage: "Texas ESBD response was not valid JSON",
  });

  const result = await listAdminDataSources(testDb.db);
  const source = result.sources.find((item) => item.id === "texas_smartbuy");

  expect(source?.latestLog).toMatchObject({
    source: "tx_esbd",
    status: "failure",
    errorMessage: "Texas ESBD response was not valid JSON",
  });
  expect(result.summary.failingSources).toBe(1);
});

it("keeps direct SAM.gov log matching", async () => {
  testDb.db
    .insert(dataSources)
    .values({
      id: "sam_gov",
      label: "SAM.gov",
      issuerType: "federal",
      stateCode: "US",
      isEnabled: 1,
      cadence: "daily",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  insertCrawlerLog(testDb, {
    id: "log_sam_success",
    source: "SAM.gov",
    status: "success",
    startedAt: "2026-05-19T01:00:00.000Z",
  });

  const result = await listAdminDataSources(testDb.db);
  const source = result.sources.find((item) => item.id === "sam_gov");

  expect(source?.latestLog).toMatchObject({
    source: "SAM.gov",
    status: "success",
  });
  expect(result.summary.healthySources).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npm test -- src/server/admin/data-sources-repository.test.ts
```

Expected: the TX mapping test fails because `tx_esbd` is not attached to `texas_smartbuy` yet.

---

### Task 2: Implement Server-Side Log Mapping

**Files:**
- Modify: `frontend/src/server/admin/data-sources-repository.ts`
- Test: `frontend/src/server/admin/data-sources-repository.test.ts`

- [ ] **Step 1: Add source mapping helpers**

Add near the top of `data-sources-repository.ts`:

```ts
const CRAWLER_LOG_SOURCE_BY_STATE: Record<string, string> = {
  CA: "ca_caleprocure",
  TX: "tx_esbd",
  NY: "ny_contract_reporter",
  FL: "fl_mfmp",
  IL: "il_bidbuy",
};

function crawlerLogKeysForSource(source: typeof dataSources.$inferSelect) {
  return [
    CRAWLER_LOG_SOURCE_BY_STATE[source.stateCode],
    source.label,
    source.id,
  ].filter((value): value is string => Boolean(value));
}

function latestLogForSource(
  source: typeof dataSources.$inferSelect,
  latestLogsBySource: Map<string, AdminCrawlerLog>,
) {
  for (const key of crawlerLogKeysForSource(source)) {
    const log = latestLogsBySource.get(key);
    if (log) return log;
  }

  return null;
}
```

Replace source mapping in `listAdminDataSources` with:

```ts
const sources = sourceRows.map((source) => toAdminSource(source, latestLogForSource(source, latestLogsBySource)));
```

- [ ] **Step 2: Run repository tests**

```bash
cd frontend && npm test -- src/server/admin/data-sources-repository.test.ts
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/server/admin/data-sources-repository.ts frontend/src/server/admin/data-sources-repository.test.ts
git commit -m "fix: map admin sources to crawler logs"
```

---

### Task 3: Show Inline Error Reasons

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Add helper for compact error text**

Add above `SummaryCard`:

```ts
function compactErrorMessage(message: string) {
  return message.length > 96 ? `${message.slice(0, 93)}...` : message;
}
```

- [ ] **Step 2: Add dictionary labels**

Add under `admin` in English:

```ts
errorReason: "Error",
```

Add under `admin` in Chinese:

```ts
errorReason: "错误",
```

- [ ] **Step 3: Render inline error under status badge**

Replace the status table cell with:

```tsx
<TableCell>
  <div className="max-w-56">
    <Badge variant="outline" className={statusTone(source.latestLog?.status)}>
      {source.latestLog?.status ?? t("admin.notRun")}
    </Badge>
    {source.latestLog?.errorMessage && (
      <div className="mt-1 text-xs leading-5 text-rose-700">
        <span className="font-medium">{t("admin.errorReason")}:</span>{" "}
        {compactErrorMessage(source.latestLog.errorMessage)}
      </div>
    )}
  </div>
</TableCell>
```

- [ ] **Step 4: Run build**

```bash
cd frontend && npm run build
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/admin/page.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: show admin source error reasons"
```

---

### Task 4: Full Verification and Browser Check

**Files:**
- No code edits unless verification finds a defect.

- [ ] **Step 1: Run targeted tests**

```bash
cd frontend && npm test -- src/server/admin/data-sources-repository.test.ts src/lib/state-crawler-sources.test.ts
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

- Texas row shows latest `tx_esbd` failure status if that log exists.
- New York row shows latest `ny_contract_reporter` failure status if that log exists.
- Florida/Illinois rows show success if their latest logs exist.
- Failed rows show a concise inline error reason under the badge.
- Summary cards reflect mapped healthy/failing counts.

---

## Self-Review

- Spec coverage: mapped log lookup, accurate summary counts, inline error reason, and verification are covered.
- Placeholder scan: no placeholder instructions remain.
- Type consistency: `AdminCrawlerLog`, `AdminDataSource`, `latestLog`, and dictionary keys match existing code patterns.
