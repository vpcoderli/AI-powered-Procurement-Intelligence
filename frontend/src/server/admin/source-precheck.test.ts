import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import type { CrawlTaskResult } from "@/server/crawler/state-runner";
import type { SourceComplianceReport } from "@/server/source-validity/robots-compliance-scan";
import { AdminDataSourceNotFoundError } from "./data-sources-repository";
import { SourcePrecheckFailedError, runSourcePrecheck } from "./source-precheck";

type RunCrawlTask = (typeof import("@/server/crawler/state-runner"))["runCrawlTask"];

const NOW = new Date("2026-09-16T10:00:00.000Z");
const SOURCE_ID = "bidnet_ny_erie";

function complianceReport(overrides: Partial<SourceComplianceReport["results"][number]> = {}): SourceComplianceReport {
  const result = {
    stateCode: "NY",
    sourceId: SOURCE_ID,
    label: "Erie County, NY (BidNet)",
    baseUrl: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
    robotsTxtUrl: "https://www.bidnetdirect.com/robots.txt",
    status: "clear" as const,
    httpStatus: 200,
    robotsTxtHash: "hash-1",
    disallowsCrawledPaths: false,
    flagged: false,
    flagReason: null,
    matchedDisallowRules: [],
    checkedAt: NOW.toISOString(),
    errorMessage: null,
    ...overrides,
  };

  return {
    ok: !result.flagged,
    checkedAt: NOW.toISOString(),
    summary: { total: 1, clear: result.flagged ? 0 : 1, flagged: result.flagged ? 1 : 0, unreachable: 0 },
    results: [result],
  };
}

function taskResult(overrides: Partial<CrawlTaskResult> = {}): CrawlTaskResult {
  return {
    ok: true,
    source: SOURCE_ID,
    status: "success",
    stdout: "",
    stderr: "",
    fetchedCount: 0,
    errorCode: null,
    payload: null,
    ...overrides,
  };
}

function successWithBids(count: number) {
  const bids = Array.from({ length: count }, (_, index) => ({
    title: `Bid ${index}`,
    source_url: `https://example.gov/bid/${index}`,
  }));

  return taskResult({
    fetchedCount: count,
    payload: {
      source: SOURCE_ID,
      runId: "run_1",
      status: "success",
      startedAt: NOW.toISOString(),
      bids,
      metadata: { listExtraction: { method: "scrapling", items: count } },
    },
  });
}

describe("runSourcePrecheck", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: SOURCE_ID,
        label: "Erie County, NY (BidNet)",
        issuerType: "county",
        stateCode: "NY",
        baseUrl: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
        isEnabled: 1,
        cadence: "daily",
        providerFamily: "bidnet",
        jurisdictionLevel: "county",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      })
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.restoreAllMocks();
  });

  function readSource() {
    return testDb.db.select().from(dataSources).where(eq(dataSources.id, SOURCE_ID)).get();
  }

  it("reports a ready verdict and writes robots + live health back (SQLite)", async () => {
    const runCrawlTask = vi.fn<RunCrawlTask>(async () => successWithBids(4));
    const discoverTenant = vi.fn();

    const result = await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask,
      discoverTenant,
      scanCompliance: async () => complianceReport(),
    });

    expect(result).toMatchObject({
      sourceId: SOURCE_ID,
      checkedAt: NOW.toISOString(),
      verdict: "ready",
      robots: { status: "clear", flagged: false, flagReason: null },
      fetch: { status: "ok", items: 4, listMethod: "scrapling", errorCode: null, httpStatus: null, wafChallenge: false },
      suggestedBaseUrl: null,
    });
    expect(result.fetch.sample).toEqual([
      { title: "Bid 0", url: "https://example.gov/bid/0" },
      { title: "Bid 1", url: "https://example.gov/bid/1" },
      { title: "Bid 2", url: "https://example.gov/bid/2" },
    ]);
    expect(discoverTenant).not.toHaveBeenCalled();

    expect(readSource()).toMatchObject({
      robotsTxtStatus: "clear",
      robotsTxtCheckedAt: NOW.toISOString(),
      robotsTxtHash: "hash-1",
      robotsTxtDisallowsCrawledPaths: 0,
      liveHealthDisposition: "ready",
      liveHealthReviewedAt: NOW.toISOString(),
    });
    expect(JSON.parse(readSource()?.liveHealthNotes ?? "{}")).toMatchObject({
      precheck: { verdict: "ready", fetch: { items: 4 } },
    });
  });

  it("dry-runs with the requested limit, no persistence and no governance gate", async () => {
    const runCrawlTask = vi.fn<RunCrawlTask>(async () => successWithBids(1));
    // A blocked, never-approved source must still be dry-runnable: that is what the pre-check
    // exists to inform.
    testDb.db.update(dataSources).set({ approvalStatus: "blocked", approvedForIngestion: 0 }).where(eq(dataSources.id, SOURCE_ID)).run();

    await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      limit: 3,
      now: NOW,
      runCrawlTask,
      scanCompliance: async () => complianceReport(),
    });

    expect(runCrawlTask).toHaveBeenCalledTimes(1);
    expect(runCrawlTask.mock.calls[0][0]).toMatchObject({ id: SOURCE_ID });
    expect(runCrawlTask.mock.calls[0][1]).toMatchObject({ limit: 3 });
    expect(runCrawlTask.mock.calls[0][2]).toBeUndefined();
  });

  it("defaults the dry-run limit to 5", async () => {
    const runCrawlTask = vi.fn<RunCrawlTask>(async () => successWithBids(1));

    await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask,
      scanCompliance: async () => complianceReport(),
    });

    expect(runCrawlTask.mock.calls[0][1]).toMatchObject({ limit: 5 });
  });

  it("verdicts a verified empty state as empty", async () => {
    const result = await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask: async () =>
        taskResult({
          payload: {
            source: SOURCE_ID,
            runId: "run_empty",
            status: "success",
            startedAt: NOW.toISOString(),
            bids: [],
            metadata: {
              emptyState: { verified: true, tenant_confirmed: true, marker: "There are no open bids at this time." },
              listExtraction: { method: "adapter" },
            },
          },
        }),
      scanCompliance: async () => complianceReport(),
    });

    expect(result.verdict).toBe("empty");
    expect(result.fetch).toMatchObject({ status: "empty_verified", items: 0 });
    expect(result.reasons.join(" ")).toContain("no open solicitations");
    expect(readSource()?.liveHealthDisposition).toBe("empty");
  });

  it("verdicts an unexplained zero-row success as needs_fix", async () => {
    const result = await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask: async () =>
        taskResult({
          payload: { source: SOURCE_ID, runId: "r", status: "success", startedAt: NOW.toISOString(), bids: [] },
        }),
      scanCompliance: async () => complianceReport(),
    });

    expect(result.verdict).toBe("needs_fix");
    expect(result.reasons.join(" ")).toContain("parsed no rows");
  });

  it("probes for a tenant path after a 404 and suggests the discovered base URL", async () => {
    const discoverTenant = vi.fn(async () => ({
      candidates: [],
      suggestedBaseUrl: "https://www.bidnetdirect.com/new-york/erie-county-ny/solicitations/open-bids",
      reason: "label_match_with_rows",
    }));

    const result = await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask: async () =>
        taskResult({
          ok: false,
          status: "failure",
          errorCode: "HtmlPageError",
          stderr: "HtmlPageError: unexpected status 404 for https://www.bidnetdirect.com/...",
          payload: {
            source: SOURCE_ID,
            runId: "r",
            status: "failure",
            startedAt: NOW.toISOString(),
            bids: [],
            errorCode: "HtmlPageError",
            errorMessage: "unexpected status 404",
          },
        }),
      discoverTenant,
      scanCompliance: async () => complianceReport(),
    });

    expect(discoverTenant).toHaveBeenCalledWith({
      base_url: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
      label: "Erie County, NY (BidNet)",
      state_code: "NY",
      provider_family: "bidnet",
      max_requests: 6,
      min_interval_seconds: 3,
    });
    expect(result).toMatchObject({
      verdict: "needs_fix",
      suggestedBaseUrl: "https://www.bidnetdirect.com/new-york/erie-county-ny/solicitations/open-bids",
      fetch: { status: "failed", httpStatus: 404, errorCode: "HtmlPageError" },
    });
    expect(readSource()?.liveHealthDisposition).toBe("needs_fix");
  });

  it("does not probe after a non-404 failure and flags a WAF challenge", async () => {
    const discoverTenant = vi.fn();

    const result = await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask: async () =>
        taskResult({
          ok: false,
          status: "failure",
          errorCode: "BidNetChallengeError",
          stderr: "challenge, status 202",
          payload: null,
        }),
      discoverTenant,
      scanCompliance: async () => complianceReport(),
    });

    expect(discoverTenant).not.toHaveBeenCalled();
    expect(result.fetch).toMatchObject({ status: "failed", wafChallenge: true, httpStatus: 202 });
    expect(result.reasons.join(" ")).toContain("bot/WAF challenge");
  });

  it("keeps the verdict when the tenant probe itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask: async () =>
        taskResult({ ok: false, status: "failure", errorCode: "HtmlPageError", stderr: "status 404", payload: null }),
      discoverTenant: async () => {
        throw new Error("python missing");
      },
      scanCompliance: async () => complianceReport(),
    });

    expect(result.verdict).toBe("needs_fix");
    expect(result.suggestedBaseUrl).toBeNull();
  });

  it("surfaces a flagged robots.txt in the reasons", async () => {
    const result = await runSourcePrecheck({
      database: testDb.db,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask: async () => successWithBids(2),
      scanCompliance: async () =>
        complianceReport({ status: "disallow_crawled_paths", flagged: true, flagReason: "disallows /bids", disallowsCrawledPaths: true }),
    });

    expect(result.verdict).toBe("ready");
    expect(result.robots).toEqual({ status: "disallow_crawled_paths", flagged: true, flagReason: "disallows /bids" });
    expect(result.reasons.join(" ")).toContain("legal opinion reference is required");
    expect(readSource()).toMatchObject({ robotsTxtDisallowsCrawledPaths: 1, robotsTxtFlagReason: "disallows /bids" });
  });

  it("rejects an unknown source id", async () => {
    await expect(
      runSourcePrecheck({
        database: testDb.db,
        sourceId: "nope",
        now: NOW,
        runCrawlTask: async () => successWithBids(1),
        scanCompliance: async () => complianceReport(),
      }),
    ).rejects.toBeInstanceOf(AdminDataSourceNotFoundError);
  });

  it("wraps an unusable crawler runtime as SourcePrecheckFailedError", async () => {
    await expect(
      runSourcePrecheck({
        database: testDb.db,
        sourceId: SOURCE_ID,
        now: NOW,
        runCrawlTask: async () => {
          throw new Error("spawn python3 ENOENT");
        },
        scanCompliance: async () => complianceReport(),
      }),
    ).rejects.toBeInstanceOf(SourcePrecheckFailedError);
  });
});

describe("runSourcePrecheck on the MySQL path", () => {
  function createFakeMysql() {
    const row = {
      id: SOURCE_ID,
      label: "Erie County, NY (BidNet)",
      issuerType: "county",
      stateCode: "NY",
      baseUrl: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
      cadence: "daily",
      providerFamily: "bidnet",
      jurisdictionLevel: "county",
      jurisdictionName: "Erie County",
      fipsCode: null,
      fetchConfig: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
    };
    const executed: Array<{ sql: string; values: unknown[] }> = [];

    return {
      executed,
      query: async (sql: string) => {
        if (sql.includes("FROM data_sources") && sql.includes("SELECT id FROM data_sources")) {
          return [[{ id: SOURCE_ID }]];
        }
        if (sql.includes("FROM data_sources")) return [[row]];
        return [[]];
      },
      execute: async (sql: string, values?: unknown[]) => {
        executed.push({ sql, values: (values ?? []) as unknown[] });
        return [{ affectedRows: 1 }];
      },
    };
  }

  it("reads the source and writes robots + live health through the MySQL pool", async () => {
    const mysql = createFakeMysql();

    const result = await runSourcePrecheck({
      database: {} as never,
      mysql: mysql as never,
      sourceId: SOURCE_ID,
      now: NOW,
      runCrawlTask: async () => successWithBids(2),
      scanCompliance: async () => complianceReport(),
    });

    expect(result.verdict).toBe("ready");
    expect(mysql.executed).toHaveLength(1);
    expect(mysql.executed[0].sql).toContain("UPDATE data_sources SET robots_txt_status = ?");
    expect(mysql.executed[0].sql).toContain("live_health_disposition = ?");
    expect(mysql.executed[0].values).toEqual([
      "clear",
      NOW.toISOString(),
      "hash-1",
      0,
      null,
      "ready",
      expect.stringContaining('"verdict":"ready"'),
      NOW.toISOString(),
      expect.any(String),
      SOURCE_ID,
    ]);
  });
});
