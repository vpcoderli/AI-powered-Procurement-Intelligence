import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, crawlerLogs, dataSources, platformReviews } from "@/server/db/schema";
import { COVERAGE_SQL, computeAdminOverview, getAdminOverview, getAdminOverviewFromMysql } from "./overview";
import { sqliteSqlRunner, type AdminSqlRunner, type SqlValue } from "./sql-runner";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const T = NOW.toISOString();

function source(id: string, overrides: Partial<typeof dataSources.$inferInsert>): typeof dataSources.$inferInsert {
  return { id, label: id, issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", providerFamily: "bidnet", isEnabled: 1, cadence: "daily", createdAt: T, updatedAt: T, ...overrides };
}

function log(id: string, overrides: Partial<typeof crawlerLogs.$inferInsert>): typeof crawlerLogs.$inferInsert {
  return { id, source: "bidnet_co_denver", runId: id, status: "success", startedAt: T, ...overrides };
}

function bid(id: string, overrides: Partial<typeof bids.$inferInsert>): typeof bids.$inferInsert {
  return {
    id,
    source: "Denver",
    sourceBidId: id,
    dedupeKey: id,
    title: `Bid ${id}`,
    description: "Description",
    issuerName: "Agency",
    issuerType: "state",
    stateCode: "CO",
    sourceUrl: `https://example.gov/${id}`,
    firstSeenAt: T,
    lastSeenAt: T,
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

function seed(testDb: TestDatabase) {
  testDb.db.insert(dataSources).values([
    source("ca_state", { label: "California", issuerType: "state", stateCode: "CA", jurisdictionLevel: null, providerFamily: null, approvalStatus: "approved", approvedForIngestion: 1, legalReviewStatus: "approved_public", lastSuccessAt: T }),
    source("tx_state", { label: "Texas", issuerType: "state", stateCode: "TX", jurisdictionLevel: null, providerFamily: null }),
    source("sam_gov", { label: "SAM.gov", issuerType: "federal", stateCode: "US", jurisdictionLevel: null, providerFamily: null, consecutiveFailures: 1, lastFailureAt: T }),
    source("bidnet_co_denver", { label: "Denver", approvalStatus: "approved", approvedForIngestion: 1, legalReviewStatus: "approved_public", lastSuccessAt: T }),
    source("bidnet_co_aurora", { label: "Aurora", issuerType: "city", jurisdictionLevel: "city", precheckRequestedAt: "2026-09-29T01:00:00.000Z" }),
    source("bidnet_mi_twp", { label: "Canton Township", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", approvalStatus: "needs_review", consecutiveFailures: 3, lastFailureAt: T }),
    source("bidnet_oh_block", { label: "Blocked", stateCode: "OH", approvalStatus: "blocked", isEnabled: 0 }),
    source("odd", { label: "Odd", issuerType: "municipal", stateCode: "TX", jurisdictionLevel: null, providerFamily: null }),
    source("own_site_city", { label: "Own Site City", issuerType: "city", stateCode: "TX", jurisdictionLevel: "city", providerFamily: null }),
  ]).run();

  testDb.db.insert(crawlerLogs).values([
    log("l1", { source: "bidnet_co_denver", status: "success", startedAt: "2026-09-29T10:00:00.000000+00:00" }),
    log("l2", { source: "SAM.gov", status: "failure", startedAt: "2026-09-29T09:00:00.000Z", errorCode: "HtmlPageError", errorMessage: "HTML request failed with status 429: Too Many Requests" }),
    log("l3", { source: "bidnet_mi_twp", status: "failure", startedAt: "2026-09-27T09:00:00.000Z", errorCode: "BidNetChallengeError", errorMessage: "challenge" }),
    log("l4", { source: "attachment_repair", status: "failure", startedAt: "2026-09-29T11:00:00.000Z" }),
    log("l5", { source: "ca_caleprocure", status: "success", startedAt: "2026-09-10T00:00:00.000Z" }),
    log("l6", { source: "bidnet_co_denver", status: "partial", startedAt: "2026-09-29T08:00:00.000Z" }),
    log("l7", { source: "bidnet_mi_twp", status: "failure", startedAt: "2026-09-29T07:00:00.000Z", errorCode: "HtmlPageError", errorMessage: "HTML request failed with status 404: page mentions code 403" }),
  ]).run();

  testDb.db.insert(bids).values([
    bid("bidnet_co_denver:1", { lifecycleStatus: "open", jurisdictionLevel: "county", createdAt: "2026-09-29T06:00:00.000Z" }),
    bid("bidnet_co_denver:2", { lifecycleStatus: "open", jurisdictionLevel: "county", createdAt: "2026-09-25T00:00:00.000Z" }),
    bid("ca_state:1", { lifecycleStatus: "open", stateCode: "CA", createdAt: "2026-09-01T00:00:00.000Z" }),
    bid("ca_state:2", { lifecycleStatus: "closed", stateCode: "CA", createdAt: "2026-09-28T13:00:00.000Z" }),
    bid("sam_gov:1", { lifecycleStatus: "awarded", issuerType: "federal", stateCode: "US", adminReviewStatus: "needs_review", createdAt: "2026-08-01T00:00:00.000Z" }),
  ]).run();

  testDb.db.insert(platformReviews).values({
    id: "review_1",
    providerFamily: "bidnet",
    tosUrl: "https://www.bidnetdirect.com/tsandcs",
    tosReviewedAt: "2026-09-20T00:00:00.000Z",
    robotsUrl: "https://www.bidnetdirect.com/robots.txt",
    robotsCheckedAt: "2026-09-20T00:00:00.000Z",
    robotsSummary: "allows public lists",
    accessBoundary: "只读公开列表与详情页；不登录、不取会员内容、不绕 WAF",
    reviewer: "ops@example.com",
    reviewedAt: "2026-09-20T00:00:00.000Z",
    nextReviewAt: "2027-09-20T00:00:00.000Z",
    createdAt: "2026-09-20T00:00:00.000Z",
  }).run();
}

describe("admin overview (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    seed(testDb);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("counts coverage by level and state with the gate's definitions", async () => {
    const { coverage, errors } = await getAdminOverview(testDb.db, NOW);
    expect(errors).toEqual({});
    expect(coverage?.totals).toEqual({ sources: 9, scheduled: 4, awaitingApproval: 4, neverRun: 5 });
    expect(coverage?.byLevel).toEqual([
      { level: "federal", total: 1, enabled: 1, approved: 0, awaitingApproval: 0, blocked: 0, neverRun: 0 },
      { level: "state", total: 2, enabled: 2, approved: 1, awaitingApproval: 0, blocked: 0, neverRun: 1 },
      { level: "county", total: 2, enabled: 1, approved: 1, awaitingApproval: 0, blocked: 1, neverRun: 1 },
      { level: "city", total: 2, enabled: 2, approved: 0, awaitingApproval: 2, blocked: 0, neverRun: 2 },
      { level: "township", total: 1, enabled: 1, approved: 0, awaitingApproval: 1, blocked: 0, neverRun: 0 },
      { level: "unknown", total: 1, enabled: 1, approved: 0, awaitingApproval: 1, blocked: 0, neverRun: 1 },
    ]);
    expect(coverage?.byState.map((state) => [state.stateCode, state.total])).toEqual([
      ["TX", 3],
      ["CO", 2],
      ["CA", 1],
      ["MI", 1],
      ["OH", 1],
      ["US", 1],
    ]);
    expect(coverage?.byState[0].byLevel).toEqual({ state: 1, unknown: 1, city: 1 });
  });

  it("summarises the onboarding pipeline per real platform", async () => {
    const { pipeline } = await getAdminOverview(testDb.db, NOW);
    expect(pipeline).toEqual([
      {
        providerFamily: "bidnet",
        platformReview: { status: "valid", review: expect.objectContaining({ id: "review_1" }) },
        counts: { approvable: 0, awaiting_precheck: 2, needs_fix: 0, missing_platform_review: 0, approved: 1, blocked: 1 },
        queued: 1,
        oldestQueuedAt: "2026-09-29T01:00:00.000Z",
      },
    ]);
  });

  it("summarises crawl health without attachment repair runs", async () => {
    const { crawlHealth } = await getAdminOverview(testDb.db, NOW);
    expect(crawlHealth).toEqual({
      runs24h: { success: 1, failure: 2, other: 1 },
      runs7d: { success: 1, failure: 3, other: 1 },
      lastRunAt: "2026-09-29T10:00:00.000000+00:00",
      failingSources: 2,
      worstFailing: [
        { id: "bidnet_mi_twp", label: "Canton Township", consecutiveFailures: 3, lastFailureAt: T },
        { id: "sam_gov", label: "SAM.gov", consecutiveFailures: 1, lastFailureAt: T },
      ],
      throttleEvents24h: 1,
    });
  });

  it("summarises bids by lifecycle, recency and source level", async () => {
    const { bids: bidSummary } = await getAdminOverview(testDb.db, NOW);
    expect(bidSummary).toEqual({ open: 3, closed: 1, awarded: 1, new24h: 2, new7d: 3, openByLevel: { county: 2, state: 1 }, pendingQa: 1 });
  });

  it("keeps the other sections when one fails", async () => {
    const sqlite = sqliteSqlRunner(testDb.db);
    const failingOnBids: AdminSqlRunner = {
      all<T>(sql: string, values?: readonly SqlValue[]) {
        return sql.includes("FROM bids") ? Promise.reject(new Error("boom")) : sqlite.all<T>(sql, values);
      },
    };
    const onSectionError = vi.fn();
    const overview = await computeAdminOverview({
      sql: failingOnBids,
      listLedgerSources: async () => [],
      listPlatformReviews: async () => [],
      bidQaNeedsReview: async () => 0,
      now: NOW,
      onSectionError,
    });
    expect(overview.bids).toBeNull();
    expect(overview.errors).toEqual({ bids: { code: "SECTION_FAILED", message: "This section could not be computed." } });
    expect(overview.coverage?.totals.sources).toBe(9);
    expect(onSectionError).toHaveBeenCalledWith("bids", expect.any(Error));
  });
});

describe("admin overview (MySQL)", () => {
  it("runs the shared SQL and reads mysql2's string numbers", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === COVERAGE_SQL) {
        return [[{ coverage_level: "county", state_code: "CO", total: "3", enabled: "2", approved: "1", blocked: "0", awaiting_approval: "2", never_run: "1", scheduled: "1" }]];
      }
      return [[]];
    });
    const overview = await getAdminOverviewFromMysql({ query, execute: vi.fn() } as never, NOW);
    expect(overview.coverage?.totals).toEqual({ sources: 3, scheduled: 1, awaitingApproval: 2, neverRun: 1 });
    expect(overview.pipeline).toEqual([]);
    expect(overview.bids).toMatchObject({ open: 0, pendingQa: 0 });
    expect(query.mock.calls.map((call) => call[0])).toContain(COVERAGE_SQL);
  });
});
