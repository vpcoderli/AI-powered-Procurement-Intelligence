import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, crawlerLocks, crawlerLogs, dataSources } from "@/server/db/schema";
import type { SourcePrecheckResult } from "@/server/admin/source-precheck";
import { sweepExpiredBids } from "@/server/bids/lifecycle-sweep";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { runCrawlTask } from "./state-runner";
import { createCrawlerWorkerTick } from "./worker-tick";

vi.mock("./state-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./state-runner")>()),
  runCrawlTask: vi.fn(),
}));

const NOW = Date.parse("2026-10-08T08:00:00.000Z");
const matching = { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] };
const notification = { queued: 0, sent: 0, skipped: 0, failed: 0 };
type TickOptions = Parameters<typeof createCrawlerWorkerTick>[0];
type TickAdapters = NonNullable<Parameters<typeof createCrawlerWorkerTick>[1]>;

function success(source: string, cost: number | null = 1): RunCrawlerSourceOnceResult {
  return { ok: true, source, status: "success", runner: { ok: true, source, status: "success", stdout: "", stderr: "", payload: { metadata: cost === null ? {} : { pagination: { requests_made: cost } } } }, alertMatching: matching, notification };
}
function failure(source: string, cost: number | null = 1, status = 503): RunCrawlerSourceOnceResult {
  return { ok: false, source, status: "failure", runner: { ok: false, source, status: "failure", stdout: "", stderr: "", errorCode: "HtmlPageError", payload: { errorMessage: `HTML request failed with status ${status}: unavailable`, metadata: cost === null ? {} : { pagination: { requests_made: cost } } } } };
}
function precheck(sourceId: string, challenge = false): SourcePrecheckResult {
  return { sourceId, checkedAt: new Date(NOW).toISOString(), verdict: challenge ? "needs_fix" : "ready", reasons: [], robots: { status: "clear", flagged: false, flagReason: null }, fetch: { status: challenge ? "failed" : "ok", items: challenge ? 0 : 1, sample: [], listMethod: "adapter", errorCode: challenge ? "BidNetChallengeError" : null, errorMessage: null, httpStatus: challenge ? 202 : 200, wafChallenge: challenge }, suggestedBaseUrl: null };
}

describe("complete crawler worker tick", () => {
  let testDb: TestDatabase;
  let time: number;
  let sleeps: number[];
  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    time = NOW;
    sleeps = [];
    vi.stubEnv("CRAWLER_DETAIL_BACKFILL_ENABLED", "false");
    vi.stubEnv("CRAWLER_PLATFORM_MIN_INTERVAL_MS", "0");
    vi.stubEnv("CRAWLER_WORKER_RETRY_BASE_DELAY_MS", "1");
    vi.stubEnv("CRAWLER_WORKER_RETRY_MAX_DELAY_MS", "1");
    vi.mocked(runCrawlTask).mockReset();
  });
  afterEach(async () => { await testDb.cleanup(); vi.unstubAllEnvs(); });

  function insertSource(id: string, overrides: Partial<typeof dataSources.$inferInsert> = {}) {
    testDb.db.insert(dataSources).values({ id, label: id, issuerType: "state", stateCode: "CA", jurisdictionLevel: "state", providerFamily: "bidnet", baseUrl: `https://public.example/${id}`, isEnabled: 1, cadence: "daily", approvalStatus: "approved", approvedForIngestion: 1, legalReviewStatus: "approved_public", fetchConfig: JSON.stringify({ list_pages: 1 }), createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(), ...overrides }).run();
  }
  function queueSource() { insertSource("queued", { cadence: "manual", precheckRequestedAt: new Date(NOW - 1000).toISOString() }); }
  function insertBacklog() {
    testDb.db.insert(bids).values({ id: "daily:old", source: "daily", sourceBidId: "old", dedupeKey: "daily:old", title: "Road repair", description: "Road repair", issuerName: "County", issuerType: "state", stateCode: "CA", sourceUrl: "https://public.example/bid/old", firstSeenAt: new Date(NOW).toISOString(), lastSeenAt: new Date(NOW).toISOString(), createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() }).run();
  }
  function insertBid(id: string, deadlineDate: string | null) {
    const at = new Date(NOW).toISOString();
    testDb.db.insert(bids).values({ id: `daily:${id}`, source: "daily", sourceBidId: id, dedupeKey: `daily:${id}`, title: "Road repair", description: "Road repair", deadlineDate, issuerName: "County", issuerType: "state", stateCode: "CA", sourceUrl: `https://public.example/bid/${id}`, firstSeenAt: at, lastSeenAt: at, createdAt: at, updatedAt: at }).run();
  }
  function tick(adapters: TickAdapters, allowance = 3, options: Partial<TickOptions> = {}) {
    return createCrawlerWorkerTick({ database: testDb.db, owner: "test-worker", tickMs: 3600000, matcher: async () => matching, notifier: async () => notification, ...options }, { clock: () => time, sleep: async (ms) => { sleeps.push(ms); time += ms; }, platformBudgets: new Map([["bidnet", allowance]]), ...adapters });
  }

  it("charges each real retry attempt before admitting the following cost-two precheck", async () => {
    insertSource("daily"); queueSource();
    let attempts = 0;
    const checked: string[] = [];
    const result = await tick({ runCrawlerSourceOnce: async (_db, run) => ++attempts === 1 ? failure(run.source) : success(run.source), runSourcePrecheck: async ({ sourceId }) => { checked.push(sourceId); return precheck(sourceId); } })();
    expect(attempts).toBe(2);
    expect(result.lists[0].status).toBe("success");
    expect(checked).toEqual([]);
    expect(result.prechecks?.skipped.budget).toBe(1);
  });

  it("shares the configured-list contact timeline with the queued precheck", async () => {
    vi.stubEnv("CRAWLER_PLATFORM_MIN_INTERVAL_MS", "5000");
    insertSource("daily"); queueSource();
    const starts: number[] = [];
    await tick({ runCrawlerSourceOnce: async (_db, run) => { starts.push(time); return success(run.source); }, runSourcePrecheck: async ({ sourceId }) => { starts.push(time); return precheck(sourceId); } }, 10)();
    expect(starts).toEqual([NOW, NOW + 5000]);
    expect(sleeps).toEqual([5000]);
  });

  it("returns the last real failure when its attempt exhausts the budget", async () => {
    insertSource("daily");
    let attempts = 0;
    const last = failure("daily");
    const result = await tick({ runCrawlerSourceOnce: async () => { attempts += 1; return last; } }, 1)();
    expect(attempts).toBe(1);
    expect(result.lists).toEqual([last]);
    expect(sleeps).toEqual([]);
  });

  it("keeps an unreported attempt charged conservatively", async () => {
    insertSource("daily", { fetchConfig: JSON.stringify({ list_pages: 2 }) }); queueSource();
    let attempts = 0;
    const checked: string[] = [];
    await tick({ runCrawlerSourceOnce: async (_db, run) => { attempts += 1; return failure(run.source, null); }, runSourcePrecheck: async ({ sourceId }) => { checked.push(sourceId); return precheck(sourceId); } }, 2)();
    expect(attempts).toBe(1);
    expect(checked).toEqual([]);
  });

  it.each(["locked", "disabled", "blocked", "deferred"] as const)("leaves an uncontacted %s outcome free for the next stage", async (status) => {
    insertSource("daily", { fetchConfig: JSON.stringify({ list_pages: 2 }) }); queueSource();
    const skipped: RunCrawlerSourceOnceResult = status === "blocked" || status === "deferred" ? { ok: false, source: "daily", status, reason: "uncontacted" } : { ok: false, source: "daily", status };
    const checked: string[] = [];
    await tick({ runCrawlerSourceOnce: async () => skipped, runSourcePrecheck: async ({ sourceId }) => { checked.push(sourceId); return precheck(sourceId); } }, 2)();
    expect(checked).toEqual(["queued"]);
    expect(testDb.db.select().from(dataSources).where(eq(dataSources.id, "daily")).get()?.lastSuccessAt).toBeNull();
  });

  it("runs daily lists, prechecks, then historical bodies without historical notifications or list health", async () => {
    vi.stubEnv("CRAWLER_DETAIL_BACKFILL_ENABLED", "true");
    insertSource("daily", { fetchConfig: JSON.stringify({ list_pages: 1, enrichment: { enabled: true } }) }); queueSource(); insertBacklog();
    const stages: string[] = [];
    vi.mocked(runCrawlTask).mockImplementation(async (source, task) => {
      stages.push(task.detailBackfillOnly ? "backfill" : "list");
      return { ok: true, source: source.id, status: "success", stdout: "", stderr: "", fetchedCount: 1, errorCode: null, payload: null };
    });
    const notifier = vi.fn(async () => notification);
    const result = await tick({ runSourcePrecheck: async ({ sourceId }) => { stages.push("precheck"); return precheck(sourceId); } }, 10, { notifier })();
    expect(stages).toEqual(["list", "precheck", "backfill"]);
    expect(notifier).toHaveBeenCalledTimes(1);
    expect(result.backfill).toHaveLength(1);
    expect(testDb.db.select().from(dataSources).where(eq(dataSources.id, "daily")).get()?.lastSuccessAt).toBe(new Date(NOW).toISOString());
    expect(testDb.db.select().from(bids).get()?.isActive).toBe(1);
  });

  it("carries a list throttle through prechecks, historical work, and a later tick", async () => {
    vi.stubEnv("CRAWLER_DETAIL_BACKFILL_ENABLED", "true");
    insertSource("daily", { fetchConfig: JSON.stringify({ list_pages: 1, enrichment: { enabled: true } }) }); queueSource(); insertBacklog();
    let attempts = 0;
    const checked: string[] = [];
    const run = tick({ runCrawlerSourceOnce: async (_db, source) => { attempts += 1; return failure(source.source, 1, 429); }, runSourcePrecheck: async ({ sourceId }) => { checked.push(sourceId); return precheck(sourceId); } }, 10);
    const first = await run();
    time += 1000;
    await run();
    expect(attempts).toBe(1);
    expect(checked).toEqual([]);
    expect(first.prechecks?.skipped.paused).toBe(1);
    expect(first.backfill).toHaveLength(1);
    expect(first.backfill[0].status).toBe("deferred");
  });

  it("does not let a precheck throttle expire inside the tick and admit historical work", async () => {
    vi.stubEnv("CRAWLER_DETAIL_BACKFILL_ENABLED", "true");
    vi.stubEnv("CRAWLER_PLATFORM_PAUSE_MS", "0");
    insertSource("daily", { fetchConfig: JSON.stringify({ list_pages: 1, enrichment: { enabled: true } }) }); queueSource(); insertBacklog();
    const stages: string[] = [];
    const result = await tick({ runCrawlerSourceOnce: async (_db, run) => { stages.push("list-or-backfill"); return success(run.source); }, runSourcePrecheck: async ({ sourceId }) => { stages.push("precheck"); return precheck(sourceId, true); } }, 10)();
    expect(stages).toEqual(["list-or-backfill", "precheck"]);
    expect(result.backfill[0].status).toBe("deferred");
  });

  it("keeps historical work disabled by default even when a ready backlog exists", async () => {
    insertSource("daily", { fetchConfig: JSON.stringify({ list_pages: 1, enrichment: { enabled: true } }) }); insertBacklog();
    const started: string[] = [];
    const result = await tick({ runCrawlerSourceOnce: async (_db, run) => { started.push(run.source); return success(run.source); } }, 10)();
    expect(started).toEqual(["daily"]);
    expect(result.backfill).toEqual([]);
  });

  it("completes committed ingestion once when its notification fails and releases the real source lease", async () => {
    insertSource("daily");
    vi.mocked(runCrawlTask).mockResolvedValue({
      ok: true, source: "daily", status: "success", stdout: "", stderr: "", fetchedCount: 1, errorCode: null,
      payload: { source: "daily", runId: "tick-ingestion", status: "success", startedAt: new Date(NOW).toISOString(),
        metadata: { pagination: { requests_made: 1, complete: false } },
        bids: [{ id: "daily:one", source: "daily", source_bid_id: "one", dedupe_key: "daily:one", title: "Road resurfacing services", issuer_name: "California Department of Transportation", issuer_type: "state", state_code: "CA", source_url: "https://public.example/bid/one", description: "Provide pavement milling and resurfacing for the designated public roads, including traffic control and materials." }],
      },
    });
    const result = await tick({}, 10, { notifier: async () => { throw new Error("notification transport failed"); } })();
    expect(result.lists[0]).toMatchObject({ status: "success", postProcessingErrors: [{ stage: "notifier", message: "notification transport failed" }] });
    expect(vi.mocked(runCrawlTask)).toHaveBeenCalledOnce();
    expect(testDb.db.select().from(bids).all().map((row) => row.id)).toEqual(["daily:one"]);
    expect(testDb.db.select().from(crawlerLogs).all()).toHaveLength(1);
    expect(testDb.db.select().from(crawlerLocks).all()).toEqual([]);
  });

  it("stops admitting retries and later stages after shutdown during a list attempt", async () => {
    vi.stubEnv("CRAWLER_DETAIL_BACKFILL_ENABLED", "true");
    insertSource("daily", { fetchConfig: JSON.stringify({ list_pages: 1, enrichment: { enabled: true } }) }); queueSource(); insertBacklog();
    let stopping = false;
    let started = 0;
    const result = await tick({ runCrawlerSourceOnce: async (_db, run) => { started += 1; stopping = true; return failure(run.source); } }, 10, { isStopping: () => stopping })();
    expect(started).toBe(1);
    expect(result.lists[0].status).toBe("failure");
    expect(result.prechecks).toBeNull();
    expect(result.backfill).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(testDb.db.select().from(dataSources).where(eq(dataSources.id, "queued")).get()?.precheckRequestedAt).not.toBeNull();
  });

  it("does not start a reserved retry after shutdown during its platform-spacing wait", async () => {
    vi.stubEnv("CRAWLER_PLATFORM_MIN_INTERVAL_MS", "5000");
    insertSource("daily");
    let stopping = false;
    let started = 0;
    const last = failure("daily");
    const result = await tick({
      runCrawlerSourceOnce: async () => { started += 1; return last; },
      sleep: async (ms) => { if (ms === 5000) stopping = true; time += ms; },
    }, 10, { isStopping: () => stopping })();
    expect(started).toBe(1);
    expect(result.lists).toEqual([last]);
    expect(result.prechecks).toBeNull();
  });

  it("does not start a queued precheck after shutdown during its platform-spacing wait", async () => {
    vi.stubEnv("CRAWLER_PLATFORM_MIN_INTERVAL_MS", "5000");
    insertSource("daily"); queueSource();
    let stopping = false;
    const checked: string[] = [];
    const result = await tick({
      runCrawlerSourceOnce: async (_db, run) => success(run.source),
      runSourcePrecheck: async ({ sourceId }) => { checked.push(sourceId); return precheck(sourceId); },
      sleep: async (ms) => { stopping = true; time += ms; },
    }, 10, { isStopping: () => stopping })();
    expect(checked).toEqual([]);
    expect(result.prechecks?.processed).toEqual([]);
    expect(testDb.db.select().from(dataSources).where(eq(dataSources.id, "queued")).get()?.precheckRequestedAt).not.toBeNull();
  });

  it("keeps errored precheck retry state across ticks without pausing its platform", async () => {
    vi.stubEnv("CRAWLER_PLATFORM_PAUSE_MS", "1000");
    queueSource();
    const checked: string[] = [];
    const run = tick({ runSourcePrecheck: async ({ sourceId }) => { checked.push(sourceId); throw new Error("temporary subprocess error"); } }, 10);
    await run();
    time += 500;
    const second = await run();
    expect(checked).toEqual(["queued"]);
    expect(second.prechecks?.skipped.retry).toBe(1);
    time += 500;
    await run();
    expect(checked).toEqual(["queued", "queued"]);
  });
  describe("deadline sweep", () => {
    it("closes bids past their deadline after the lists and the prechecks, and reports it", async () => {
      insertSource("daily"); queueSource();
      insertBid("late", "10/01/2026"); insertBid("ahead", "10/20/2026"); insertBid("undated", null);
      const stages: string[] = [];
      const result = await tick({
        runCrawlerSourceOnce: async (_db, run) => { stages.push("list"); return success(run.source); },
        runSourcePrecheck: async ({ sourceId }) => { stages.push("precheck"); return precheck(sourceId); },
      }, 10)();

      expect(result.lifecycleSweep).toEqual({ scanned: 3, closed: 1, unparseable: 0, closedByIssuerType: { state: 1 }, dryRun: false });
      expect(result).not.toHaveProperty("lifecycleSweepError");
      expect(testDb.db.select().from(bids).where(eq(bids.id, "daily:late")).get()).toMatchObject({ lifecycleStatus: "closed", isActive: 0, updatedAt: new Date(NOW).toISOString() });
      expect(testDb.db.select().from(bids).where(eq(bids.id, "daily:ahead")).get()).toMatchObject({ lifecycleStatus: "open", isActive: 1 });
      expect(testDb.db.select().from(bids).where(eq(bids.id, "daily:undated")).get()).toMatchObject({ lifecycleStatus: "open", isActive: 1 });
      expect(stages).toEqual(["list", "precheck"]);
    });

    it("runs after the precheck stage and judges by the tick clock at that moment", async () => {
      insertSource("daily"); queueSource();
      const stages: string[] = [];
      let swept: { target: unknown; now: number } | undefined;
      const result = await tick({
        runCrawlerSourceOnce: async (_db, run) => { stages.push("list"); return success(run.source); },
        runSourcePrecheck: async ({ sourceId }) => { stages.push("precheck"); time += 2_000; return precheck(sourceId); },
        sweepExpiredBids: async (target, options) => {
          stages.push("sweep");
          swept = { target, now: options.now.getTime() };
          return { scanned: 0, closed: 0, unparseable: 0, closedByIssuerType: {}, dryRun: false };
        },
      }, 10)();

      expect(stages).toEqual(["list", "precheck", "sweep"]);
      expect(swept?.now).toBe(NOW + 2_000);
      expect(swept?.target).toEqual({ database: testDb.db });
      expect(result.lifecycleSweep).toEqual({ scanned: 0, closed: 0, unparseable: 0, closedByIssuerType: {}, dryRun: false });
    });

    it("sweeps the MySQL store when the worker has one", async () => {
      const mysql = {
        query: async () => [[], undefined] as [unknown[], unknown],
        execute: async () => [{ affectedRows: 0 }, undefined] as [unknown, unknown],
        getConnection: async (): Promise<never> => { throw new Error("nothing is closed here, so no transaction is opened"); },
      };
      let target: unknown;
      await tick({ sweepExpiredBids: async (received) => { target = received; return { scanned: 0, closed: 0, unparseable: 0, closedByIssuerType: {}, dryRun: false }; } }, 10, { mysql })();

      expect(target).toEqual({ mysql });
    });

    it("does not accept a MySQL store that cannot hold a transaction: that is a type error, not a failure on every tick", () => {
      const narrow = { query: async () => [[], undefined] as [unknown[], unknown], execute: async () => [{ affectedRows: 0 }, undefined] as [unknown, unknown] };
      // @ts-expect-error the sweep opens a transaction per page of closures, so the worker's mysql must have getConnection
      createCrawlerWorkerTick({ database: testDb.db, mysql: narrow, owner: "test-worker", matcher: async () => matching, notifier: async () => notification });
    });

    it("turns a sweep failure into lifecycleSweepError without failing the tick or the other stages", async () => {
      insertSource("daily"); queueSource();
      const result = await tick({
        runCrawlerSourceOnce: async (_db, run) => success(run.source),
        runSourcePrecheck: async ({ sourceId }) => precheck(sourceId),
        sweepExpiredBids: async () => { throw new Error("bids table is locked"); },
      }, 10)();

      expect(result.lifecycleSweepError).toBe("bids table is locked");
      expect(result).not.toHaveProperty("lifecycleSweep");
      expect(result.lists[0].status).toBe("success");
      expect(result.prechecks?.processed).toHaveLength(1);
      expect(result.precheckError).toBeNull();
    });

    it("reports a failure that is not an Error as text", async () => {
      const result = await tick({ sweepExpiredBids: async () => { throw "connection refused"; } }, 10)();

      expect(result.lifecycleSweepError).toBe("connection refused");
    });

    it("still sweeps when the precheck stage fails", async () => {
      insertSource("daily"); queueSource(); insertBid("late", "10/01/2026");
      const result = await tick({ runSourcePrecheck: async () => { throw new Error("precheck exploded"); } }, 10)();

      expect(result.lifecycleSweep).toMatchObject({ closed: 1 });
    });

    it("does not start a sweep once shutdown has begun", async () => {
      insertSource("daily"); insertBid("late", "10/01/2026");
      let stopping = false;
      const sweep = vi.fn(sweepExpiredBids);
      const result = await tick({ runCrawlerSourceOnce: async (_db, run) => { stopping = true; return success(run.source); }, sweepExpiredBids: sweep }, 10, { isStopping: () => stopping })();

      expect(sweep).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("lifecycleSweep");
      expect(testDb.db.select().from(bids).where(eq(bids.id, "daily:late")).get()).toMatchObject({ lifecycleStatus: "open" });
    });

    it("leaves an open bid with no deadline active", async () => {
      insertSource("daily"); insertBacklog();
      const result = await tick({ runCrawlerSourceOnce: async (_db, run) => success(run.source) }, 10)();

      expect(result.lifecycleSweep).toMatchObject({ scanned: 1, closed: 0 });
      expect(testDb.db.select().from(bids).get()?.isActive).toBe(1);
    });
  });
});
