import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bids, dataSources, platformReviews } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { AdminDataSourceNotFoundError } from "./data-sources-repository";
import { bidIdPrefixesForSource, getAdminDataSourceDetail, getAdminDataSourceDetailFromMysql } from "./source-detail";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const T = NOW.toISOString();
const DENVER_URL = "https://www.bidnetdirect.com/colorado/denver";
const STATES_SQL_START = "SELECT (CASE WHEN COALESCE(jurisdiction_level, issuer_type)";

function source(id: string, overrides: Partial<typeof dataSources.$inferInsert>): typeof dataSources.$inferInsert {
  return { id, label: id, issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", providerFamily: "bidnet", isEnabled: 1, cadence: "daily", createdAt: T, updatedAt: T, ...overrides };
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
    issuerType: "county",
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
  testDb.db
    .insert(dataSources)
    .values([
      source("ca_state", { label: "California", issuerType: "state", stateCode: "CA", jurisdictionLevel: null, providerFamily: null, approvalStatus: "approved", approvedForIngestion: 1, legalReviewStatus: "approved_public", lastSuccessAt: T }),
      source("bidnet_co_denver", {
        label: "Denver",
        baseUrl: DENVER_URL,
        approvalStatus: null,
        liveHealthDisposition: "ready",
        liveHealthReviewedAt: "2026-09-25T00:00:00.000Z",
        liveHealthNotes: JSON.stringify({ precheck: { baseUrl: DENVER_URL } }),
      }),
      // A local source of a platform nobody has reviewed.
      source("bonfire_co_boulder", { label: "Boulder", providerFamily: "bonfire", baseUrl: "https://boulder.bonfirehub.com" }),
    ])
    .run();

  testDb.db
    .insert(bids)
    .values([
      bid("bidnet_co_denver:1", { lifecycleStatus: "open", createdAt: "2026-09-20T00:00:00.000Z", publishedDate: "2026-09-19", deadlineDate: "2026-10-30" }),
      bid("bidnet_co_denver:2", { lifecycleStatus: "closed", createdAt: "2026-09-28T00:00:00.000Z" }),
      // Another source whose id merely starts with this one's: the ':' after the id keeps it out.
      bid("bidnet_co_denver_x:9", { lifecycleStatus: "open", createdAt: "2026-09-29T00:00:00.000Z" }),
      // An unescaped '_' in the source id would read as a wildcard and match this one too.
      bid("bidnetxco_denver:5", { lifecycleStatus: "open", createdAt: "2026-09-29T01:00:00.000Z" }),
      // The state row's legacy prefix is its crawler id, and its own id counts too.
      bid("ca_caleprocure:7", { lifecycleStatus: "open", stateCode: "CA", issuerType: "state", createdAt: "2026-09-15T00:00:00.000Z" }),
      bid("ca_state:3", { lifecycleStatus: "awarded", stateCode: "CA", issuerType: "state", createdAt: "2026-09-10T00:00:00.000Z" }),
    ])
    .run();

  testDb.db
    .insert(platformReviews)
    .values({
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
    })
    .run();
}

describe("admin source detail (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    seed(testDb);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("describes a local source: states, readiness and only its own bids", async () => {
    const detail = await getAdminDataSourceDetail(testDb.db, "bidnet_co_denver", NOW);

    expect(detail.source).toMatchObject({ id: "bidnet_co_denver", label: "Denver", fipsCode: null, latestLog: null });
    expect(detail.logSourceKeys).toEqual(["Denver", "bidnet_co_denver"]);
    expect(detail.states).toEqual({ level: "county", platform: "bidnet", approval: "awaiting", health: "never_run" });
    expect(detail.readiness).toEqual({
      bucket: "approvable",
      reason: null,
      platformReview: { status: "valid", review: expect.objectContaining({ providerFamily: "bidnet" }) },
    });
    expect(detail.bids.counts).toEqual({ open: 1, closed: 1, awarded: 0, total: 2 });
    expect(detail.bids.latest.map((item) => item.id)).toEqual(["bidnet_co_denver:2", "bidnet_co_denver:1"]);
    expect(detail.bids.latest[1]).toEqual({
      id: "bidnet_co_denver:1",
      title: "Bid bidnet_co_denver:1",
      publishedDate: "2026-09-19",
      deadlineDate: "2026-10-30",
      lifecycleStatus: "open",
    });
    expect(detail.bids.latest[0]).toMatchObject({ publishedDate: null, deadlineDate: null, lifecycleStatus: "closed" });
  });

  it("names why a local source is not ready", async () => {
    const detail = await getAdminDataSourceDetail(testDb.db, "bonfire_co_boulder", NOW);

    expect(detail.readiness).toEqual({
      bucket: "missing_platform_review",
      reason: "missing_platform_review",
      platformReview: { status: "missing", review: null },
    });
    expect(detail.states).toMatchObject({ level: "county", platform: "bonfire", approval: "awaiting" });
    expect(detail.bids).toEqual({ counts: { open: 0, closed: 0, awarded: 0, total: 0 }, latest: [] });
  });

  it("describes a state portal: no readiness, and bids under both its id and its crawler id", async () => {
    const detail = await getAdminDataSourceDetail(testDb.db, "ca_state", NOW);

    expect(detail.readiness).toBeNull();
    expect(detail.logSourceKeys).toEqual(["ca_caleprocure", "California", "ca_state"]);
    expect(detail.states).toEqual({ level: "state", platform: "state_portal", approval: "approved", health: "healthy" });
    expect(detail.bids.counts).toEqual({ open: 1, closed: 0, awarded: 1, total: 2 });
    expect(detail.bids.latest.map((item) => item.id)).toEqual(["ca_caleprocure:7", "ca_state:3"]);
  });

  it("rejects an unknown id", async () => {
    await expect(getAdminDataSourceDetail(testDb.db, "missing", NOW)).rejects.toBeInstanceOf(AdminDataSourceNotFoundError);
  });

  it("selects bids by the id prefixes a source can have", () => {
    expect(bidIdPrefixesForSource({ id: "ca_state", crawlerSourceId: "ca_caleprocure" })).toEqual(["ca_state", "ca_caleprocure"]);
    expect(bidIdPrefixesForSource({ id: "bidnet_co_denver", crawlerSourceId: null })).toEqual(["bidnet_co_denver"]);
    expect(bidIdPrefixesForSource({ id: "same", crawlerSourceId: "same" })).toEqual(["same"]);
  });
});

describe("admin source detail (MySQL)", () => {
  const row = {
    id: "bidnet_co_denver",
    label: "Denver",
    issuerType: "county",
    stateCode: "CO",
    isEnabled: 1,
    cadence: "daily",
    jurisdictionLevel: "county",
    providerFamily: "bidnet",
    consecutiveFailures: 0,
    createdAt: T,
    updatedAt: T,
  };

  function fakeStore(bidRows: { counts: unknown[]; latest: unknown[] } = { counts: [], latest: [] }) {
    const query = vi.fn(async (sql: string) => {
      if (sql.trimStart().startsWith(STATES_SQL_START)) {
        return [[{ coverage_level: "county", platform: "bidnet", approval_state: "awaiting", health_state: "never_run" }]] as [unknown[]];
      }
      if (sql.includes("FROM data_sources")) return [[row]] as [unknown[]];
      if (sql.includes("FROM bids") && sql.includes("GROUP BY lifecycle_status")) return [bidRows.counts] as [unknown[]];
      if (sql.includes("FROM bids")) return [bidRows.latest] as [unknown[]];
      return [[]] as [unknown[]];
    });
    return { query, store: { query, execute: vi.fn() } as never };
  }

  it("runs the shared states and bid SQL through the MySQL runner", async () => {
    const { query, store } = fakeStore();

    const detail = await getAdminDataSourceDetailFromMysql(store, "bidnet_co_denver", NOW);

    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    const statesCall = calls.find(([sql]) => sql.startsWith(STATES_SQL_START));
    expect(statesCall?.[1]).toEqual(["bidnet_co_denver"]);
    const bidCalls = calls.filter(([sql]) => sql.includes("FROM bids"));
    expect(bidCalls).toHaveLength(2);
    for (const [sql, values] of bidCalls) {
      expect(sql).toContain("id LIKE ? ESCAPE '!'");
      expect(values).toEqual(["bidnet!_co!_denver:%"]);
    }
    expect(detail.logSourceKeys).toEqual(["Denver", "bidnet_co_denver"]);
    expect(detail.states).toEqual({ level: "county", platform: "bidnet", approval: "awaiting", health: "never_run" });
    // The fake answers the platform review read with no rows, so the source cannot be approved yet.
    expect(detail.readiness).toMatchObject({ bucket: "missing_platform_review", reason: "missing_platform_review" });
    expect(detail.bids).toEqual({ counts: { open: 0, closed: 0, awarded: 0, total: 0 }, latest: [] });
  });

  it("reads mysql2's decimal-string counts and column values", async () => {
    const { store } = fakeStore({
      counts: [
        { lifecycle_status: "open", total: "3" },
        { lifecycle_status: "awarded", total: "1" },
      ],
      latest: [{ id: "bidnet_co_denver:1", title: "Bid 1", published_date: "2026-09-19", deadline_date: null, lifecycle_status: "open" }],
    });

    const detail = await getAdminDataSourceDetailFromMysql(store, "bidnet_co_denver", NOW);

    expect(detail.bids).toEqual({
      counts: { open: 3, closed: 0, awarded: 1, total: 4 },
      latest: [{ id: "bidnet_co_denver:1", title: "Bid 1", publishedDate: "2026-09-19", deadlineDate: null, lifecycleStatus: "open" }],
    });
  });

  it("rejects an unknown id", async () => {
    const store = { query: vi.fn(async () => [[]] as [unknown[]]), execute: vi.fn() } as never;

    await expect(getAdminDataSourceDetailFromMysql(store, "missing", NOW)).rejects.toBeInstanceOf(AdminDataSourceNotFoundError);
  });
});
