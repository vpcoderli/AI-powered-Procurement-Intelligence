# APSi State Crawler Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect CA/TX/NY/FL/IL Python state crawlers to the frontend admin "run crawler" flow.

**Architecture:** Add a frontend `state-runner` that shells out to the existing Python `fetch-state` CLI. Add a batch API route that runs selected state sources through the existing orchestrator, then update the Admin API client and Admin page button to call the state batch route.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Node `child_process.execFile`, existing APSi Python crawler CLI, SQLite.

---

## File Structure

- Create `frontend/src/server/crawler/state-runner.ts`
  - Builds and runs `python3 -m apsi_crawler.cli fetch-state`.
  - Exposes supported state sources and a source-specific runner factory.
- Create `frontend/src/server/crawler/state-runner.test.ts`
  - Verifies CLI args and failure metadata.
- Create `frontend/src/app/api/crawler/state/run/route.ts`
  - Batch state-crawler API route.
- Create `frontend/src/app/api/crawler/state/run/route.test.ts`
  - Verifies auth, defaults, options, partial failure, locked/disabled handling.
- Modify `frontend/src/lib/api/admin.ts`
  - Add `runStateCrawlersNow`.
- Modify `frontend/src/lib/api/admin.test.ts`
  - Verify `/api/crawler/state/run` call.
- Modify `frontend/src/app/admin/page.tsx`
  - Change run button from SAM.gov-only to state crawler batch.
- Modify `frontend/src/lib/i18n/dictionaries/en.ts`
  - Add state crawler button/message strings.
- Modify `frontend/src/lib/i18n/dictionaries/zh.ts`
  - Add Chinese state crawler button/message strings.

---

### Task 1: State Crawler Runner

**Files:**
- Create: `frontend/src/server/crawler/state-runner.ts`
- Create: `frontend/src/server/crawler/state-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `frontend/src/server/crawler/state-runner.test.ts`:

```ts
import { execFile } from "node:child_process";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STATE_CRAWLER_SOURCES,
  createStateCrawlerRunner,
  runStateCrawler,
} from "./state-runner";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

describe("state crawler runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the supported state crawler sources in run order", () => {
    expect(STATE_CRAWLER_SOURCES.map((source) => source.id)).toEqual([
      "ca_caleprocure",
      "tx_esbd",
      "ny_contract_reporter",
      "fl_mfmp",
      "il_bidbuy",
    ]);
  });

  it("starts the Python fetch-state crawler with source, query, limit, and database path", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runStateCrawler({
      source: "il_bidbuy",
      query: "data",
      limit: 25,
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(result).toEqual({
      ok: true,
      source: "il_bidbuy",
      status: "success",
      stdout: "done",
      stderr: "",
    });
    expect(mockedExecFile).toHaveBeenCalledWith(
      "python3",
      [
        "-m",
        "apsi_crawler.cli",
        "fetch-state",
        "--database",
        "/tmp/apsi.sqlite",
        "--source",
        "il_bidbuy",
        "--limit",
        "25",
        "--query",
        "data",
      ],
      expect.objectContaining({
        cwd: path.resolve(process.cwd(), "..", "crawler"),
      }),
      expect.any(Function),
    );
  });

  it("omits query when it is empty", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    await runStateCrawler({
      source: "ca_caleprocure",
      limit: 10,
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(mockedExecFile.mock.calls[0][1]).toEqual([
      "-m",
      "apsi_crawler.cli",
      "fetch-state",
      "--database",
      "/tmp/apsi.sqlite",
      "--source",
      "ca_caleprocure",
      "--limit",
      "10",
    ]);
  });

  it("returns failure metadata when the Python crawler exits with an error", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(new Error("crawler failed"), "", "trace");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const result = await runStateCrawler({
      source: "tx_esbd",
      databasePath: "/tmp/apsi.sqlite",
    });

    expect(result).toEqual({
      ok: false,
      source: "tx_esbd",
      status: "failure",
      stdout: "",
      stderr: "trace",
    });
  });

  it("creates a source-specific runner for the orchestrator", async () => {
    mockedExecFile.mockImplementationOnce(((_command, _args, _options, callback) => {
      callback(null, "done", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);

    const runner = createStateCrawlerRunner("fl_mfmp");
    const result = await runner({ limit: 5, databasePath: "/tmp/apsi.sqlite" });

    expect(result.source).toBe("fl_mfmp");
    expect(mockedExecFile.mock.calls[0][1]).toContain("fl_mfmp");
  });
});
```

- [ ] **Step 2: Run runner tests to verify RED**

Run:

```bash
cd frontend
npm test -- src/server/crawler/state-runner.test.ts
```

Expected: fail because `state-runner.ts` does not exist.

- [ ] **Step 3: Implement state runner**

Create `frontend/src/server/crawler/state-runner.ts`:

```ts
import { execFile } from "node:child_process";
import path from "node:path";

export const STATE_CRAWLER_SOURCES = [
  { id: "ca_caleprocure", label: "California Cal eProcure" },
  { id: "tx_esbd", label: "Texas ESBD" },
  { id: "ny_contract_reporter", label: "New York State Contract Reporter" },
  { id: "fl_mfmp", label: "MyFloridaMarketPlace" },
  { id: "il_bidbuy", label: "Illinois BidBuy" },
] as const;

export type StateCrawlerSourceId = (typeof STATE_CRAWLER_SOURCES)[number]["id"];

export interface StateCrawlerRunOptions {
  source: StateCrawlerSourceId;
  query?: string;
  limit?: number;
  databasePath?: string;
}

export interface StateCrawlerOrchestratorOptions {
  query?: string;
  limit?: number;
  databasePath?: string;
}

export interface StateCrawlerRunResult {
  ok: boolean;
  source: StateCrawlerSourceId;
  status: "success" | "failure";
  stdout: string;
  stderr: string;
}

function crawlerDirectory() {
  return path.resolve(process.cwd(), "..", "crawler");
}

function defaultDatabasePath() {
  return path.resolve(process.cwd(), "data", "apsi.sqlite");
}

function buildArgs(options: StateCrawlerRunOptions) {
  const args = [
    "-m",
    "apsi_crawler.cli",
    "fetch-state",
    "--database",
    options.databasePath ?? defaultDatabasePath(),
    "--source",
    options.source,
    "--limit",
    String(options.limit ?? 25),
  ];

  if (options.query) {
    args.push("--query", options.query);
  }

  return args;
}

export async function runStateCrawler(
  options: StateCrawlerRunOptions,
): Promise<StateCrawlerRunResult> {
  return new Promise((resolve) => {
    execFile(
      "python3",
      buildArgs(options),
      {
        cwd: crawlerDirectory(),
        env: process.env,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          source: options.source,
          status: error ? "failure" : "success",
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

export function createStateCrawlerRunner(source: StateCrawlerSourceId) {
  return (options: StateCrawlerOrchestratorOptions = {}) =>
    runStateCrawler({
      source,
      query: options.query,
      limit: options.limit,
      databasePath: options.databasePath,
    });
}
```

- [ ] **Step 4: Run runner tests to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/crawler/state-runner.test.ts
```

Expected: all state runner tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add frontend/src/server/crawler/state-runner.ts frontend/src/server/crawler/state-runner.test.ts
git commit -m "feat: add state crawler runner"
```

---

### Task 2: State Batch Run API

**Files:**
- Create: `frontend/src/app/api/crawler/state/run/route.ts`
- Create: `frontend/src/app/api/crawler/state/run/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `frontend/src/app/api/crawler/state/run/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as notificationService from "@/server/notifications/service";
import { createStateCrawlerRunPost } from "./route";

vi.mock("@/server/notifications/service", () => ({
  sendMatchedAlertNotifications: vi.fn(),
}));

describe("POST /api/crawler/state/run", () => {
  const runCrawlerSourceOnce = vi.fn();
  const sendMatchedAlertNotifications = vi.mocked(notificationService.sendMatchedAlertNotifications);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    runCrawlerSourceOnce.mockImplementation(async (_database, options) => ({
      ok: true,
      source: options.source,
      status: "success",
      runner: {
        ok: true,
        source: options.source,
        status: "success",
        stdout: "done",
        stderr: "",
      },
      alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 },
      notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
    }));
    sendMatchedAlertNotifications.mockResolvedValue({
      queued: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it("requires crawler token when configured", async () => {
    vi.stubEnv("CRAWLER_RUN_TOKEN", "local-token");
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce });

    const response = await POST(new Request("http://localhost/api/crawler/state/run"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Crawler run token is required.",
    });
    expect(runCrawlerSourceOnce).not.toHaveBeenCalled();
  });

  it("runs all supported state sources by default", async () => {
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce, owner: "state_route_test" });

    const response = await POST(new Request("http://localhost/api/crawler/state/run", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed");
    expect(body.results.map((result: { source: string }) => result.source)).toEqual([
      "ca_caleprocure",
      "tx_esbd",
      "ny_contract_reporter",
      "fl_mfmp",
      "il_bidbuy",
    ]);
    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(5);
    expect(runCrawlerSourceOnce.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        source: "ca_caleprocure",
        owner: "state_route_test",
        runnerOptions: {},
      }),
    );
  });

  it("passes selected sources, query, and limit into each source run", async () => {
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: ["il_bidbuy", "fl_mfmp"],
          query: "data",
          limit: 12,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results.map((result: { source: string }) => result.source)).toEqual(["il_bidbuy", "fl_mfmp"]);
    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(2);
    expect(runCrawlerSourceOnce.mock.calls[0][1].runnerOptions).toEqual({
      query: "data",
      limit: 12,
    });
    expect(runCrawlerSourceOnce.mock.calls[1][1].runnerOptions).toEqual({
      query: "data",
      limit: 12,
    });
  });

  it("continues after a source failure and returns per-source results", async () => {
    runCrawlerSourceOnce
      .mockResolvedValueOnce({
        ok: false,
        source: "il_bidbuy",
        status: "failure",
        runner: { ok: false, source: "il_bidbuy", status: "failure", stdout: "", stderr: "failed" },
      })
      .mockResolvedValueOnce({
        ok: true,
        source: "fl_mfmp",
        status: "success",
        runner: { ok: true, source: "fl_mfmp", status: "success", stdout: "done", stderr: "" },
        alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 },
        notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
      });
    const POST = createStateCrawlerRunPost({ runCrawlerSourceOnce });

    const response = await POST(
      new Request("http://localhost/api/crawler/state/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["il_bidbuy", "fl_mfmp"] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed_with_failures");
    expect(body.results).toHaveLength(2);
    expect(body.results[0].status).toBe("failure");
    expect(body.results[1].status).toBe("success");
  });
});
```

- [ ] **Step 2: Run route tests to verify RED**

Run:

```bash
cd frontend
npm test -- src/app/api/crawler/state/run/route.test.ts
```

Expected: fail because the route does not exist.

- [ ] **Step 3: Implement state batch route**

Create `frontend/src/app/api/crawler/state/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import { db, type AppDatabase } from "@/server/db/client";
import {
  runCrawlerSourceOnce,
  type CrawlerNotifier,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "@/server/crawler/orchestrator";
import {
  STATE_CRAWLER_SOURCES,
  createStateCrawlerRunner,
  type StateCrawlerOrchestratorOptions,
  type StateCrawlerSourceId,
} from "@/server/crawler/state-runner";
import { sendMatchedAlertNotifications } from "@/server/notifications/service";
import { matchEnabledSearchAlerts, type SearchAlertMatchResult } from "@/server/search-alerts/matcher";

type Matcher = () => Promise<SearchAlertMatchResult>;
type Orchestrator = (db: AppDatabase, options: RunCrawlerSourceOnceOptions) => Promise<RunCrawlerSourceOnceResult>;

interface StateCrawlerRunRouteDependencies {
  database: AppDatabase;
  owner: string;
  matcher: Matcher;
  notifier: CrawlerNotifier;
  runCrawlerSourceOnce: Orchestrator;
}

const SUPPORTED_SOURCE_IDS = new Set(STATE_CRAWLER_SOURCES.map((source) => source.id));

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  return request.headers.get("x-crawler-token");
}

async function isAuthorized(database: AppDatabase, request: Request) {
  const requiredToken = process.env.CRAWLER_RUN_TOKEN;
  if (!requiredToken) return true;
  if (tokenFromRequest(request) === requiredToken) return true;

  try {
    await requireAdmin(database, request);
    return true;
  } catch (error) {
    if (error instanceof AdminAuthError) return false;
    throw error;
  }
}

async function parseOptions(request: Request): Promise<{
  sources: StateCrawlerSourceId[];
  runnerOptions: StateCrawlerOrchestratorOptions;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { sources: STATE_CRAWLER_SOURCES.map((source) => source.id), runnerOptions: {} };
  }

  const body = (await request.json().catch(() => ({}))) as {
    sources?: unknown;
    query?: unknown;
    limit?: unknown;
  };
  const requestedSources = Array.isArray(body.sources)
    ? body.sources.filter((source): source is StateCrawlerSourceId =>
        typeof source === "string" && SUPPORTED_SOURCE_IDS.has(source as StateCrawlerSourceId),
      )
    : STATE_CRAWLER_SOURCES.map((source) => source.id);

  return {
    sources: requestedSources.length > 0 ? requestedSources : STATE_CRAWLER_SOURCES.map((source) => source.id),
    runnerOptions: {
      ...(typeof body.query === "string" && body.query ? { query: body.query } : {}),
      ...(typeof body.limit === "number" ? { limit: body.limit } : {}),
    },
  };
}

function defaultOwner() {
  return `state-route:${process.pid}`;
}

function batchStatus(results: RunCrawlerSourceOnceResult[]) {
  return results.every((result) => result.ok) ? "completed" : "completed_with_failures";
}

export function createStateCrawlerRunPost(overrides: Partial<StateCrawlerRunRouteDependencies> = {}) {
  const database = overrides.database ?? db;
  const dependencies: StateCrawlerRunRouteDependencies = {
    database,
    owner: defaultOwner(),
    matcher: () => matchEnabledSearchAlerts(database),
    notifier: ({ alertMatching }) => sendMatchedAlertNotifications(database, alertMatching),
    runCrawlerSourceOnce,
    ...overrides,
  };

  return async function POST(request: Request) {
    if (!(await isAuthorized(dependencies.database, request))) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Crawler run token is required.",
          },
        },
        { status: 401 },
      );
    }

    const { sources, runnerOptions } = await parseOptions(request);
    const results: RunCrawlerSourceOnceResult[] = [];

    for (const source of sources) {
      const result = await dependencies.runCrawlerSourceOnce(dependencies.database, {
        source,
        owner: dependencies.owner,
        runner: createStateCrawlerRunner(source),
        runnerOptions,
        matcher: dependencies.matcher,
        notifier: dependencies.notifier,
      });
      results.push(result);
    }

    return NextResponse.json(
      {
        ok: results.every((result) => result.ok),
        status: batchStatus(results),
        results,
      },
      { status: 200 },
    );
  };
}

export const POST = createStateCrawlerRunPost();
```

- [ ] **Step 4: Run route tests to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/app/api/crawler/state/run/route.test.ts
```

Expected: all state route tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add frontend/src/app/api/crawler/state/run/route.ts frontend/src/app/api/crawler/state/run/route.test.ts
git commit -m "feat: add state crawler batch route"
```

---

### Task 3: Admin API Client and Page Wiring

**Files:**
- Modify: `frontend/src/lib/api/admin.ts`
- Modify: `frontend/src/lib/api/admin.test.ts`
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [ ] **Step 1: Write failing API client test**

Modify `frontend/src/lib/api/admin.test.ts` import:

```ts
import {
  AdminApiError,
  listAdminCrawlerLogs,
  listAdminDataSources,
  runSamGovCrawlerNow,
  runStateCrawlersNow,
  updateAdminDataSource,
} from "./admin";
```

Add:

```ts
  it("runs state crawlers now", async () => {
    const body = { status: "completed", results: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(runStateCrawlersNow()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/crawler/state/run", { method: "POST" });
  });
```

- [ ] **Step 2: Run API client test to verify RED**

Run:

```bash
cd frontend
npm test -- src/lib/api/admin.test.ts
```

Expected: fail because `runStateCrawlersNow` does not exist.

- [ ] **Step 3: Implement API client**

Add to `frontend/src/lib/api/admin.ts`:

```ts
export async function runStateCrawlersNow() {
  const response = await fetch("/api/crawler/state/run", { method: "POST" });

  return parseResponse<unknown>(response);
}
```

- [ ] **Step 4: Update i18n strings**

In `frontend/src/lib/i18n/dictionaries/en.ts`, change admin run strings:

```ts
runStateCrawlers: "Run state crawlers",
runQueued: "State crawler run completed.",
runFailed: "Unable to run state crawlers.",
```

Keep `runSamGov` if existing tests or route still use it. If no longer referenced, it can remain harmlessly.

In `frontend/src/lib/i18n/dictionaries/zh.ts`, add:

```ts
runStateCrawlers: "运行州级爬虫",
runQueued: "州级爬虫运行完成。",
runFailed: "无法运行州级爬虫。",
```

- [ ] **Step 5: Update Admin page wiring**

Modify imports in `frontend/src/app/admin/page.tsx`:

```ts
  runStateCrawlersNow,
```

Replace `runSamGovCrawlerNow()` with:

```ts
    runStateCrawlersNow()
```

Replace the disabled condition:

```tsx
disabled={isRunning}
```

Replace the button label:

```tsx
{isRunning ? t("admin.running") : t("admin.runStateCrawlers")}
```

Remove the now-unused `samSource` constant.

- [ ] **Step 6: Run admin API client test to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/lib/api/admin.test.ts
```

Expected: all admin API client tests pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add frontend/src/lib/api/admin.ts frontend/src/lib/api/admin.test.ts frontend/src/app/admin/page.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat: wire admin state crawler run"
```

---

### Task 4: Verification

**Files:**
- Modify only files needed to fix verification failures.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
cd frontend
npm test
```

Expected: all frontend tests pass.

- [ ] **Step 2: Run frontend lint**

Run:

```bash
cd frontend
npm run lint
```

Expected: lint passes.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: build passes.

- [ ] **Step 4: Run crawler tests**

Run:

```bash
cd crawler
python3 -m pytest
```

Expected: crawler tests pass.

- [ ] **Step 5: Commit verification fixes if needed**

If any verification command required code changes, stage the touched implementation/test files and commit:

```bash
git add frontend/src/server/crawler/state-runner.ts frontend/src/server/crawler/state-runner.test.ts frontend/src/app/api/crawler/state/run/route.ts frontend/src/app/api/crawler/state/run/route.test.ts frontend/src/lib/api/admin.ts frontend/src/lib/api/admin.test.ts frontend/src/app/admin/page.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "test: verify state crawler runner integration"
```

If the worktree is clean after verification, do not create an empty commit.

---

## Remaining Functional Work After This Plan

After this plan is implemented and verified, remaining work will be:

1. Add scheduled state crawler execution to the recurring worker.
2. Add per-source run buttons if operators need fine-grained manual control.
3. Add Playwright/browser-backed fetching for sources where HTTP/HTML is insufficient.
4. Add PDF/DOCX download and text extraction.
5. Add AI summaries and compliance/risk extraction from documents.
6. Add real SMTP/email delivery.
7. Add production retry policy and crawler health alerting.
