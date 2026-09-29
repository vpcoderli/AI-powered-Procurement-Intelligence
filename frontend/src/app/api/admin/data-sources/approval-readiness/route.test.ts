import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import { PLATFORM_ACCESS_BOUNDARY, createPlatformReview, validatePlatformReviewInput } from "@/server/admin/platform-reviews-repository";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminApprovalReadinessGet } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});

// The route reads the wall clock (review validity, 14-day precheck freshness), so it is pinned.
const CLOCK = new Date("2026-09-29T08:00:00.000Z");
const FRESH = "2026-09-25T00:00:00.000Z";
const ROW_TIME = "2026-05-19T00:00:00.000Z";
const URL_A = "https://www.bidnetdirect.com/mitn/a/solicitations/open-bids";
const ENDPOINT = "http://localhost/api/admin/data-sources/approval-readiness";

function precheckNotes(baseUrl: string, verdict: string) {
  return JSON.stringify({ precheck: { baseUrl, verdict } });
}

function localRow(overrides: Partial<typeof dataSources.$inferInsert> = {}): typeof dataSources.$inferInsert {
  return {
    id: "bidnet_mi_a",
    label: "A County",
    issuerType: "county",
    stateCode: "MI",
    providerFamily: "bidnet",
    jurisdictionLevel: "county",
    baseUrl: URL_A,
    isEnabled: 1,
    cadence: "daily",
    liveHealthDisposition: "empty",
    liveHealthReviewedAt: FRESH,
    liveHealthNotes: precheckNotes(URL_A, "empty"),
    createdAt: ROW_TIME,
    updatedAt: ROW_TIME,
    ...overrides,
  };
}

describe("GET /api/admin/data-sources/approval-readiness", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    vi.setSystemTime(CLOCK);
    testDb = await createTestDatabase({ seed: false });
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({ kind: "admin", role: "admin", userId: "admin_1" });
    testDb.db
      .insert(dataSources)
      .values([
        localRow(),
        localRow({
          id: "bidnet_mi_b",
          label: "B County",
          baseUrl: "https://x/b",
          liveHealthDisposition: "needs_fix",
          liveHealthNotes: precheckNotes("https://x/b", "needs_fix"),
        }),
        localRow({
          id: "bonfire_mi_c",
          label: "C City",
          issuerType: "city",
          jurisdictionLevel: "city",
          providerFamily: "bonfire",
          baseUrl: "https://c.bonfirehub.com",
          liveHealthDisposition: null,
          liveHealthReviewedAt: null,
          liveHealthNotes: null,
        }),
        {
          id: "state_mi",
          label: "Michigan",
          issuerType: "state",
          stateCode: "MI",
          jurisdictionLevel: "state",
          isEnabled: 1,
          cadence: "daily",
          createdAt: ROW_TIME,
          updatedAt: ROW_TIME,
        },
      ])
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function seedBidnetReview(overrides: Record<string, unknown> = {}) {
    return createPlatformReview(
      testDb.db,
      validatePlatformReviewInput(
        {
          providerFamily: "bidnet",
          tosUrl: "https://www.bidnetdirect.com/tsandcs",
          tosReviewedAt: "2026-09-29",
          robotsUrl: "https://www.bidnetdirect.com/robots.txt",
          robotsCheckedAt: "2026-09-29T07:00:00.000Z",
          robotsSummary: "ok",
          reviewer: "apsi.lily@gmail.com",
          nextReviewAt: "2027-09-29",
          ...overrides,
        },
        CLOCK,
      ),
      { now: CLOCK },
    );
  }

  it("groups one platform's local sources and reports its effective review", async () => {
    seedBidnetReview();

    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=bidnet`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.providerFamily).toBe("bidnet");
    expect(body.platformReview.status).toBe("valid");
    expect(body.counts).toEqual({ approvable: 1, awaiting_precheck: 0, needs_fix: 1, missing_platform_review: 0, approved: 0, blocked: 0 });
    expect(body.sources.map((entry: { id: string; bucket: string; reason: string | null }) => [entry.id, entry.bucket, entry.reason])).toEqual([
      ["bidnet_mi_a", "approvable", null],
      ["bidnet_mi_b", "needs_fix", "precheck_needs_fix"],
    ]);
    expect(body.sources[0]).toMatchObject({
      label: "A County",
      providerFamily: "bidnet",
      jurisdictionLevel: "county",
      precheckRequestedAt: null,
      liveHealthDisposition: "empty",
      liveHealthReviewedAt: FRESH,
    });
  });

  it("lists every local source of every platform when no family is given, and never a state source", async () => {
    seedBidnetReview();

    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(ENDPOINT));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.providerFamily).toBeNull();
    expect(body.platformReview).toBeNull();
    expect(body.sources.map((entry: { id: string }) => entry.id)).toEqual(["bidnet_mi_a", "bidnet_mi_b", "bonfire_mi_c"]);
    // bonfire has no review at all, so its source cannot be approved yet.
    expect(body.counts).toEqual({ approvable: 1, awaiting_precheck: 0, needs_fix: 1, missing_platform_review: 1, approved: 0, blocked: 0 });
  });

  it("normalises the family (trim, lower-case) and treats a blank one as no filter", async () => {
    seedBidnetReview();

    const padded = await (await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=%20BidNet%20`))).json();
    const blank = await (await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=%20`))).json();

    expect(padded.providerFamily).toBe("bidnet");
    expect(padded.sources).toHaveLength(2);
    expect(blank.providerFamily).toBeNull();
    expect(blank.sources).toHaveLength(3);
  });

  it("reports a platform without any review as missing; the review check comes before the precheck checks", async () => {
    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=bidnet`));

    const body = await response.json();
    expect(body.platformReview).toEqual({ status: "missing", review: null });
    // Both bidnet rows (one fresh empty precheck, one needs_fix) are held on the review alone.
    expect(body.counts).toEqual({ approvable: 0, awaiting_precheck: 0, needs_fix: 0, missing_platform_review: 2, approved: 0, blocked: 0 });
    expect(body.sources.map((entry: { reason: string | null }) => entry.reason)).toEqual(["missing_platform_review", "missing_platform_review"]);
  });

  it("calls a platform's review expired once its next_review_at is past", async () => {
    seedBidnetReview({ reviewedAt: "2025-09-01T00:00:00.000Z", nextReviewAt: "2026-09-01" });

    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=bidnet`));

    const body = await response.json();
    expect(body.platformReview.status).toBe("expired");
    expect(body.counts.approvable).toBe(0);
    expect(body.counts.missing_platform_review).toBe(2);
    expect(body.sources.map((entry: { reason: string | null }) => entry.reason)).toEqual(["platform_review_expired", "platform_review_expired"]);
  });

  it("puts a stale precheck and a moved base_url into awaiting_precheck", async () => {
    seedBidnetReview();
    testDb.db
      .insert(dataSources)
      .values([
        localRow({ id: "bidnet_mi_stale", label: "Stale County", liveHealthReviewedAt: "2026-09-01T00:00:00.000Z" }),
        localRow({ id: "bidnet_mi_moved", label: "Moved County", baseUrl: "https://www.bidnetdirect.com/mitn/moved/solicitations/open-bids" }),
      ])
      .run();

    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=bidnet`));

    const body = await response.json();
    expect(body.counts.awaiting_precheck).toBe(2);
    const reasons = Object.fromEntries(body.sources.map((entry: { id: string; reason: string | null }) => [entry.id, entry.reason]));
    expect(reasons.bidnet_mi_stale).toBe("precheck_stale");
    expect(reasons.bidnet_mi_moved).toBe("base_url_changed");
  });

  it("carries the precheck queue flag so the console can show what is already queued", async () => {
    seedBidnetReview();
    testDb.db
      .insert(dataSources)
      .values(localRow({ id: "bidnet_mi_queued", label: "Queued County", liveHealthDisposition: null, liveHealthReviewedAt: null, liveHealthNotes: null, precheckRequestedAt: "2026-09-29T07:30:00.000Z" }))
      .run();

    const body = await (await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=bidnet`))).json();

    const queued = body.sources.find((entry: { id: string }) => entry.id === "bidnet_mi_queued");
    expect(queued).toMatchObject({ bucket: "awaiting_precheck", reason: "precheck_missing", precheckRequestedAt: "2026-09-29T07:30:00.000Z" });
  });

  it("lists the tenant probe's suggested address next to the current base_url for a needs_fix source, and nothing for legacy or garbage notes", async () => {
    seedBidnetReview();
    const oldUrl = "https://www.bidnetdirect.com/wyoming/laramie-county/solicitations/open-bids";
    const suggestion = "https://www.bidnetdirect.com/colorado/laramiecountywyominggovernment";
    testDb.db
      .insert(dataSources)
      .values([
        localRow({
          id: "bidnet_wy_laramie",
          label: "Laramie County",
          baseUrl: oldUrl,
          liveHealthDisposition: "needs_fix",
          liveHealthNotes: JSON.stringify({ precheck: { baseUrl: oldUrl, verdict: "needs_fix", suggestedBaseUrl: suggestion } }),
        }),
        localRow({
          id: "bidnet_mi_legacy",
          label: "Legacy notes",
          liveHealthDisposition: "needs_fix",
          liveHealthNotes: JSON.stringify({ precheck: { verdict: "needs_fix" } }),
        }),
        localRow({ id: "bidnet_mi_garbage", label: "Garbage notes", liveHealthDisposition: "needs_fix", liveHealthNotes: "triaged by hand, not json" }),
      ])
      .run();

    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=bidnet`));

    expect(response.status).toBe(200);
    const body = await response.json();
    const byId = Object.fromEntries(body.sources.map((entry: { id: string }) => [entry.id, entry]));
    expect(byId.bidnet_wy_laramie).toMatchObject({
      bucket: "needs_fix",
      reason: "precheck_needs_fix",
      baseUrl: oldUrl,
      suggestedBaseUrl: suggestion,
    });
    // The seeded approvable row (empty precheck, no suggestion key), the needs_fix row seeded without one, legacy and garbage notes.
    for (const id of ["bidnet_mi_a", "bidnet_mi_b", "bidnet_mi_legacy", "bidnet_mi_garbage"]) {
      expect(byId[id].suggestedBaseUrl, id).toBeNull();
    }
    expect(byId.bidnet_mi_a.baseUrl).toBe(URL_A);
    // Read-only: the suggestion is only listed, the row is never repointed.
    expect(testDb.db.select().from(dataSources).all().find((row) => row.id === "bidnet_wy_laramie")?.baseUrl).toBe(oldUrl);
  });

  it("is a console read: admin, operator and support may call it", async () => {
    await createAdminApprovalReadinessGet(testDb.db)(new Request(ENDPOINT));

    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.any(Request), {
      roles: ["admin", "operator", "support"],
    });
  });

  it("serves a support principal the same summary", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({ kind: "admin", role: "support", userId: "support_1" });
    seedBidnetReview();

    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(`${ENDPOINT}?providerFamily=bidnet`));

    expect(response.status).toBe(200);
    expect((await response.json()).counts.approvable).toBe(1);
  });

  it("rejects a caller the admin guard refuses", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError());

    const response = await createAdminApprovalReadinessGet(testDb.db)(new Request(ENDPOINT));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  });

  it("answers 500 INTERNAL_ERROR with the envelope when the read fails", async () => {
    const query = vi.fn(async () => {
      throw new Error("mysql down");
    });

    const response = await createAdminApprovalReadinessGet(testDb.db, { query, execute: vi.fn() } as never)(new Request(ENDPOINT));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  it("reads both the sources and the reviews through the MySQL store and leaves SQLite alone", async () => {
    seedBidnetReview({ providerFamily: "bonfire" });
    const mysqlSource = {
      id: "bidnet_oh_x", label: "X County", issuerType: "county", stateCode: "OH", baseUrl: URL_A, isEnabled: 1, cadence: "daily",
      fetchConfig: null, jurisdictionLevel: "county", jurisdictionName: "X County", providerFamily: "bidnet", accessMode: null, sourceType: null,
      sourceConfidence: null, activationStatus: null, requiresBrowser: null, requiresManual: null, requiresLogin: null, supportsQuery: null,
      supportsPagination: null, supportsAttachmentMetadata: null, supportsDetailPageFetch: null, fallbackNotes: null, approvedForIngestion: null,
      approvalStatus: null, accessPattern: null, legalReviewStatus: null, sourceOwner: null, approvalNotes: null, lastApprovalReviewedAt: null,
      liveHealthOwner: null, liveHealthDisposition: "empty", liveHealthNextReviewAt: null, liveHealthNotes: precheckNotes(URL_A, "empty"),
      liveHealthReviewedAt: FRESH, precheckRequestedAt: null, robotsTxtStatus: null, robotsTxtCheckedAt: null, robotsTxtHash: null,
      robotsTxtDisallowsCrawledPaths: null, robotsTxtFlagReason: null, tosReviewed: null, tosReviewedAt: null, tosUrl: null,
      complianceReviewer: null, legalOpinionReference: null, complianceReviewDueAt: null, complianceNotes: null, lastSuccessAt: null,
      lastFailureAt: null, consecutiveFailures: 0, createdAt: ROW_TIME, updatedAt: ROW_TIME,
    };
    const reviewRow = {
      id: "prv_mysql_1", provider_family: "bidnet", tos_url: "https://www.bidnetdirect.com/tsandcs", tos_reviewed_at: "2026-09-29",
      robots_url: "https://www.bidnetdirect.com/robots.txt", robots_checked_at: "2026-09-29T07:00:00.000Z", robots_summary: "ok",
      access_boundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legal_opinion_reference: null,
      reviewed_at: "2026-09-29T08:00:00.000Z", next_review_at: "2027-09-29", notes: null, created_by: null, created_at: "2026-09-29T08:00:00.000Z",
    };
    const fixUrl = "https://www.bidnetdirect.com/ohio/y-county/solicitations/open-bids";
    const suggestion = "https://www.bidnetdirect.com/ohio/ycountyohio/solicitations/open-bids";
    const mysqlFixSource = {
      ...mysqlSource,
      id: "bidnet_oh_y", label: "Y County", baseUrl: fixUrl, liveHealthDisposition: "needs_fix",
      liveHealthNotes: JSON.stringify({ precheck: { baseUrl: fixUrl, verdict: "needs_fix", suggestedBaseUrl: suggestion } }),
    };
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes("FROM data_sources")) return [[mysqlSource, mysqlFixSource]];
      if (sql.includes("FROM platform_reviews")) return [[reviewRow]];
      return [[]];
    });

    const response = await createAdminApprovalReadinessGet(testDb.db, { query, execute: vi.fn() } as never)(
      new Request(`${ENDPOINT}?providerFamily=bidnet`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.platformReview.status).toBe("valid");
    expect(body.platformReview.review.id).toBe("prv_mysql_1");
    expect(body.sources.map((entry: { id: string }) => entry.id)).toEqual(["bidnet_oh_x", "bidnet_oh_y"]);
    expect(body.counts.approvable).toBe(1);
    expect(body.counts.needs_fix).toBe(1);
    expect(body.sources[0]).toMatchObject({ baseUrl: URL_A, suggestedBaseUrl: null });
    expect(body.sources[1]).toMatchObject({ bucket: "needs_fix", baseUrl: fixUrl, suggestedBaseUrl: suggestion });
    expect(queries.some((sql) => sql.includes("FROM platform_reviews"))).toBe(true);
    // The SQLite fixtures (bidnet_mi_*) never appear: the MySQL store answered everything.
    expect(JSON.stringify(body)).not.toContain("bidnet_mi_a");
  });
});
