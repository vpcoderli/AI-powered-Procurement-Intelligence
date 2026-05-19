# APSi Scheduled State Crawlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend local crawler scheduling so one worker pass runs SAM.gov plus CA, TX, NY, FL, and IL state crawlers.

**Architecture:** Add a shared configured-runner module that defines the scheduled crawler source list and runs each source through `runCrawlerSourceOnce`. Keep scripts thin: `run-crawler-once.ts` executes one full pass, and `crawler-worker.ts` loops full passes with the existing interval.

**Tech Stack:** TypeScript, Vitest, Next.js server modules, SQLite app database, existing Python crawler CLI.

---

## File Structure

- Create `frontend/src/server/crawler/configured-runner.ts`: source registry, state limit parsing, and `runConfiguredCrawlerSourcesOnce`.
- Create `frontend/src/server/crawler/configured-runner.test.ts`: tests for source order, failure continuation, state options, and environment parsing.
- Modify `frontend/scripts/run-crawler-once.ts`: use the configured runner for a full pass.
- Modify `frontend/scripts/crawler-worker.ts`: use the configured runner in each loop iteration.
- Keep `frontend/src/app/api/crawler/state/run/route.ts` unchanged unless type reuse becomes necessary.

---

### Task 1: Add Configured Runner Tests

**Files:**
- Create: `frontend/src/server/crawler/configured-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import type { CrawlerRunner, RunCrawlerSourceOnceOptions } from "./orchestrator";
import {
  CONFIGURED_CRAWLER_SOURCES,
  parseStateCrawlerLimit,
  runConfiguredCrawlerSourcesOnce,
} from "./configured-runner";

describe("configured crawler runner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs SAM.gov first, then configured state sources", async () => {
    const calls: RunCrawlerSourceOnceOptions<unknown>[] = [];
    const runCrawlerSourceOnce = vi.fn(async (_db, options) => {
      calls.push(options);
      return { ok: true, source: options.source, status: "success", runner: successRunner(options.source), alertMatching: emptyMatches(), notification: emptyNotification() };
    });

    const results = await runConfiguredCrawlerSourcesOnce({ database: {} as AppDatabase, owner: "test-owner", runCrawlerSourceOnce });

    expect(results.map((result) => result.source)).toEqual(["SAM.gov", "ca_caleprocure", "tx_esbd", "ny_contract_reporter", "fl_mfmp", "il_bidbuy"]);
    expect(calls.map((call) => call.source)).toEqual(CONFIGURED_CRAWLER_SOURCES.map((source) => source.source));
  });

  it("continues after one source fails", async () => {
    const runCrawlerSourceOnce = vi.fn(async (_db, options) => {
      if (options.source === "tx_esbd") {
        return { ok: false, source: options.source, status: "failure", runner: failedRunner(options.source) };
      }
      return { ok: true, source: options.source, status: "success", runner: successRunner(options.source), alertMatching: emptyMatches(), notification: emptyNotification() };
    });

    const results = await runConfiguredCrawlerSourcesOnce({ database: {} as AppDatabase, owner: "test-owner", runCrawlerSourceOnce });

    expect(runCrawlerSourceOnce).toHaveBeenCalledTimes(6);
    expect(results.find((result) => result.source === "tx_esbd")?.status).toBe("failure");
    expect(results.at(-1)?.source).toBe("il_bidbuy");
  });

  it("passes configured state limit to state runners only", async () => {
    const calls: RunCrawlerSourceOnceOptions<unknown>[] = [];
    const runCrawlerSourceOnce = vi.fn(async (_db, options) => {
      calls.push(options);
      return { ok: true, source: options.source, status: "success", runner: successRunner(options.source), alertMatching: emptyMatches(), notification: emptyNotification() };
    });

    await runConfiguredCrawlerSourcesOnce({ database: {} as AppDatabase, owner: "test-owner", stateRunnerOptions: { limit: 7 }, runCrawlerSourceOnce });

    expect(calls[0].runnerOptions).toBeUndefined();
    expect(calls.slice(1).every((call) => call.runnerOptions && "limit" in call.runnerOptions)).toBe(true);
    expect(calls.slice(1).map((call) => call.runnerOptions)).toEqual([{ limit: 7 }, { limit: 7 }, { limit: 7 }, { limit: 7 }, { limit: 7 }]);
  });

  it("parses positive state crawler limits from the environment", () => {
    vi.stubEnv("STATE_CRAWLER_LIMIT", "12");

    expect(parseStateCrawlerLimit()).toBe(12);
  });

  it("ignores empty, non-numeric, and non-positive state crawler limits", () => {
    vi.stubEnv("STATE_CRAWLER_LIMIT", "");
    expect(parseStateCrawlerLimit()).toBeUndefined();

    vi.stubEnv("STATE_CRAWLER_LIMIT", "abc");
    expect(parseStateCrawlerLimit()).toBeUndefined();

    vi.stubEnv("STATE_CRAWLER_LIMIT", "0");
    expect(parseStateCrawlerLimit()).toBeUndefined();
  });
});

function successRunner(source: string) {
  return { ok: true, source, status: "success" as const, stdout: "", stderr: "" };
}

function failedRunner(source: string) {
  return { ok: false, source, status: "failure" as const, stdout: "", stderr: "failed" };
}

function emptyMatches() {
  return { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] };
}

function emptyNotification() {
  return { queued: 0, sent: 0, skipped: 0, failed: 0 };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd frontend && npm test -- src/server/crawler/configured-runner.test.ts
```

Expected: fail because `configured-runner.ts` does not exist.

---

### Task 2: Implement Configured Runner

**Files:**
- Create: `frontend/src/server/crawler/configured-runner.ts`
- Test: `frontend/src/server/crawler/configured-runner.test.ts`

- [ ] **Step 1: Add the minimal module**

```ts
import type { AppDatabase } from "@/server/db/client";
import { matchEnabledSearchAlerts } from "@/server/search-alerts/matcher";
import { sendMatchedAlertNotifications } from "@/server/notifications/service";
import {
  runCrawlerSourceOnce as defaultRunCrawlerSourceOnce,
  type CrawlerMatcher,
  type CrawlerNotifier,
  type CrawlerRunner,
  type RunCrawlerSourceOnceOptions,
  type RunCrawlerSourceOnceResult,
} from "./orchestrator";
import { runSamGovCrawler } from "./sam-gov-runner";
import {
  STATE_CRAWLER_SOURCES,
  createStateCrawlerRunner,
  type StateCrawlerOrchestratorOptions,
} from "./state-runner";

export const CONFIGURED_CRAWLER_SOURCES = [
  { source: "SAM.gov", kind: "sam" },
  ...STATE_CRAWLER_SOURCES.map((source) => ({ source: source.id, kind: "state" as const })),
] as const;

type ConfiguredCrawlerSource = (typeof CONFIGURED_CRAWLER_SOURCES)[number];

type ConfiguredRunner = <TOptions>(
  db: AppDatabase,
  options: RunCrawlerSourceOnceOptions<TOptions>,
) => Promise<RunCrawlerSourceOnceResult>;

export interface RunConfiguredCrawlerSourcesOnceOptions {
  database: AppDatabase;
  owner: string;
  matcher?: CrawlerMatcher;
  notifier?: CrawlerNotifier;
  stateRunnerOptions?: StateCrawlerOrchestratorOptions;
  runCrawlerSourceOnce?: ConfiguredRunner;
}

export function parseStateCrawlerLimit() {
  const value = Number(process.env.STATE_CRAWLER_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function runnerFor(source: ConfiguredCrawlerSource): CrawlerRunner<StateCrawlerOrchestratorOptions> | CrawlerRunner<undefined> {
  if (source.kind === "sam") {
    return runSamGovCrawler;
  }
  return createStateCrawlerRunner(source.source);
}

export async function runConfiguredCrawlerSourcesOnce(options: RunConfiguredCrawlerSourcesOnceOptions) {
  const matcher = options.matcher ?? (() => matchEnabledSearchAlerts(options.database));
  const notifier = options.notifier ?? (({ alertMatching }) => sendMatchedAlertNotifications(options.database, alertMatching));
  const runCrawlerSourceOnce = options.runCrawlerSourceOnce ?? defaultRunCrawlerSourceOnce;
  const results: RunCrawlerSourceOnceResult[] = [];

  for (const source of CONFIGURED_CRAWLER_SOURCES) {
    const result =
      source.kind === "sam"
        ? await runCrawlerSourceOnce(options.database, {
            source: source.source,
            owner: options.owner,
            runner: runnerFor(source),
            matcher,
            notifier,
          })
        : await runCrawlerSourceOnce(options.database, {
            source: source.source,
            owner: options.owner,
            runner: runnerFor(source),
            runnerOptions: options.stateRunnerOptions,
            matcher,
            notifier,
          });
    results.push(result);
  }

  return results;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
cd frontend && npm test -- src/server/crawler/configured-runner.test.ts
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/server/crawler/configured-runner.ts frontend/src/server/crawler/configured-runner.test.ts
git commit -m "feat: add configured crawler source runner"
```

---

### Task 3: Wire One-Shot Script

**Files:**
- Modify: `frontend/scripts/run-crawler-once.ts`
- Test: `frontend/src/server/crawler/configured-runner.test.ts`

- [ ] **Step 1: Update the one-shot script**

Replace direct SAM.gov orchestration with:

```ts
import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";

function owner() {
  return process.env.CRAWLER_OWNER ?? `crawler-once:${process.pid}`;
}

export async function runCrawlerOnce() {
  const db = createDatabase();
  runMigrations(db);

  try {
    return await runConfiguredCrawlerSourcesOnce({
      database: db,
      owner: owner(),
      stateRunnerOptions: { limit: parseStateCrawlerLimit() },
    });
  } finally {
    db.$client.close();
  }
}

async function main() {
  const results = await runCrawlerOnce();
  console.log(JSON.stringify(results, null, 2));

  if (results.some((result) => result.status === "failure")) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run TypeScript/build verification**

Run:

```bash
cd frontend && npm run build
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/scripts/run-crawler-once.ts
git commit -m "feat: run configured crawlers once"
```

---

### Task 4: Wire Loop Worker

**Files:**
- Modify: `frontend/scripts/crawler-worker.ts`

- [ ] **Step 1: Update the worker loop**

Replace the per-loop direct SAM.gov run with:

```ts
import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

function intervalMs() {
  const value = Number(process.env.CRAWLER_WORKER_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_INTERVAL_MS;
}

function owner() {
  return process.env.CRAWLER_OWNER ?? `crawler-worker:${process.pid}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const db = createDatabase();
  runMigrations(db);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!stopping) {
      const results = await runConfiguredCrawlerSourcesOnce({
        database: db,
        owner: owner(),
        stateRunnerOptions: { limit: parseStateCrawlerLimit() },
      });
      console.log(JSON.stringify(results, null, 2));

      if (!stopping) {
        await sleep(intervalMs());
      }
    }
  } finally {
    db.$client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run targeted tests and build**

Run:

```bash
cd frontend && npm test -- src/server/crawler/configured-runner.test.ts src/server/crawler/orchestrator.test.ts
cd frontend && npm run build
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/scripts/crawler-worker.ts
git commit -m "feat: schedule configured crawler sources"
```

---

### Task 5: Final Verification

**Files:**
- No production edits unless verification exposes a defect.

- [ ] **Step 1: Run full frontend tests**

```bash
cd frontend && npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

```bash
cd frontend && npm run lint
```

Expected: exit code 0.

- [ ] **Step 3: Run production build**

```bash
cd frontend && npm run build
```

Expected: exit code 0.

- [ ] **Step 4: Run crawler tests**

```bash
cd crawler && python3 -m pytest
```

Expected: all tests pass. The existing local urllib3 LibreSSL warning is acceptable.

- [ ] **Step 5: Optional one-shot smoke**

Run with a small state limit:

```bash
cd frontend && STATE_CRAWLER_LIMIT=1 npm run crawler:once
```

Expected: JSON array with six source results. If a live portal fails, record the failed source and do not treat that as a TypeScript regression if unit tests/build pass.

---

## Self-Review

- Spec coverage: worker scheduling, source order, failure continuation, `STATE_CRAWLER_LIMIT`, one-shot script, and verification are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `RunCrawlerSourceOnceOptions<TOptions>`, `StateCrawlerOrchestratorOptions`, and `RunCrawlerSourceOnceResult` names match existing code.
