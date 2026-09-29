import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import { createPlatformReview, validatePlatformReviewInput } from "@/server/admin/platform-reviews-repository";
import { dataSources, sourceApprovalEvents } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminDataSourcesBatchPost } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});

const NOW = "2026-05-19T00:00:00.000Z";
// The route reads the wall clock for the review and precheck freshness checks, so the ledgered
// cases pin it; the fixtures below are relative to this instant.
const CLOCK = new Date("2026-09-29T08:00:00.000Z");
const FRESH_PRECHECK = "2026-09-25T00:00:00.000Z";
const COUNTY_URL = "https://www.bidnetdirect.com/mitn/a/solicitations/open-bids";
const ENDPOINT = "http://localhost/api/admin/data-sources/batch";

function batchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("POST /api/admin/data-sources/batch", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({
      kind: "admin",
      role: "admin",
      userId: "admin_1",
    });
    testDb.db
      .insert(dataSources)
      .values([
        {
          id: "ca_caleprocure",
          label: "California Cal eProcure",
          issuerType: "state",
          stateCode: "CA",
          isEnabled: 1,
          cadence: "daily",
          approvedForIngestion: 0,
          approvalStatus: "needs_review",
          legalReviewStatus: "not_reviewed",
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "tx_esbd",
          label: "Texas ESBD",
          issuerType: "state",
          stateCode: "TX",
          isEnabled: 1,
          cadence: "daily",
          approvedForIngestion: 0,
          approvalStatus: "needs_review",
          legalReviewStatus: "not_reviewed",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ])
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function insertCountySource(overrides: Partial<typeof dataSources.$inferInsert> = {}) {
    testDb.db
      .insert(dataSources)
      .values({
        id: "bidnet_mi_a",
        label: "A County",
        issuerType: "county",
        stateCode: "MI",
        providerFamily: "bidnet",
        jurisdictionLevel: "county",
        baseUrl: COUNTY_URL,
        isEnabled: 1,
        cadence: "daily",
        liveHealthDisposition: "empty",
        liveHealthReviewedAt: FRESH_PRECHECK,
        liveHealthNotes: JSON.stringify({ precheck: { baseUrl: COUNTY_URL, verdict: "empty" } }),
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .run();
  }

  function seedBidnetReview() {
    return createPlatformReview(
      testDb.db,
      validatePlatformReviewInput(
        {
          providerFamily: "bidnet",
          tosUrl: "https://www.bidnetdirect.com/tsandcs",
          tosReviewedAt: "2026-09-29",
          robotsUrl: "https://www.bidnetdirect.com/robots.txt",
          robotsCheckedAt: "2026-09-29T07:00:00.000Z",
          robotsSummary: "list and detail paths allowed",
          reviewer: "apsi.lily@gmail.com",
          legalOpinionReference: "LEGAL-42",
          nextReviewAt: "2027-09-29",
        },
        CLOCK,
      ),
      { now: CLOCK },
    );
  }

  function rawSource(id: string) {
    return testDb.db.select().from(dataSources).all().find((row) => row.id === id);
  }

  it("approves selected data sources and records approval history", async () => {
    const POST = createAdminDataSourcesBatchPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/admin/data-sources/batch", {
        method: "POST",
        body: JSON.stringify({
          sourceIds: ["ca_caleprocure", "tx_esbd"],
          action: "approve",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.any(Request), { roles: ["admin"] });
    expect(body).toEqual({
      updatedCount: 2,
      skippedCount: 0,
      outcomes: [
        { sourceId: "ca_caleprocure", outcome: "approved", reason: null },
        { sourceId: "tx_esbd", outcome: "approved", reason: null },
      ],
      sources: [
        expect.objectContaining({
          id: "ca_caleprocure",
          approvedForIngestion: true,
          approvalStatus: "approved",
          legalReviewStatus: "approved_public",
          approvalHistory: [expect.objectContaining({ actorUserId: "admin_1", action: "approved" })],
        }),
        expect.objectContaining({
          id: "tx_esbd",
          approvedForIngestion: true,
          approvalStatus: "approved",
          legalReviewStatus: "approved_public",
          approvalHistory: [expect.objectContaining({ actorUserId: "admin_1", action: "approved" })],
        }),
      ],
    });
    expect(testDb.db.select().from(sourceApprovalEvents).all()).toHaveLength(2);
  });

  it("rejects malformed batch requests before requiring admin access", async () => {
    const POST = createAdminDataSourcesBatchPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/admin/data-sources/batch", {
        method: "POST",
        body: JSON.stringify({ sourceIds: [], action: "approve" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(adminAuth.requireAdminAccess).not.toHaveBeenCalled();
  });

  it("requires full admin access for batch approval actions", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError("Admin access is required."));
    const POST = createAdminDataSourcesBatchPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/admin/data-sources/batch", {
        method: "POST",
        body: JSON.stringify({ sourceIds: ["ca_caleprocure"], action: "hold" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });
  it("holds the selected sources with the old generic input and answers no outcomes", async () => {
    const POST = createAdminDataSourcesBatchPost(testDb.db);
    await POST(batchRequest({ sourceIds: ["ca_caleprocure", "tx_esbd"], action: "approve" }));

    const response = await POST(batchRequest({ sourceIds: ["ca_caleprocure"], action: "hold" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updatedCount).toBe(1);
    expect(body).not.toHaveProperty("outcomes");
    expect(body).not.toHaveProperty("skippedCount");
    expect(body.sources[0]).toMatchObject({
      id: "ca_caleprocure",
      approvedForIngestion: false,
      approvalStatus: "needs_review",
      legalReviewStatus: "not_reviewed",
      approvalNotes: "Held from Admin batch source approval workflow.",
    });
    expect(rawSource("tx_esbd")?.approvalStatus).toBe("approved");
  });

  describe("ledgered approval of local sources", () => {
    beforeEach(() => {
      vi.setSystemTime(CLOCK);
    });

    it("skips a county source that has no platform review and writes nothing", async () => {
      insertCountySource();

      const response = await createAdminDataSourcesBatchPost(testDb.db)(
        batchRequest({ sourceIds: ["bidnet_mi_a"], action: "approve" }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        updatedCount: 0,
        skippedCount: 1,
        outcomes: [{ sourceId: "bidnet_mi_a", outcome: "skipped", reason: "missing_platform_review" }],
        sources: [],
      });
      expect(rawSource("bidnet_mi_a")).toMatchObject({ approvalStatus: null, approvedForIngestion: null, complianceReviewer: null });
      expect(testDb.db.select().from(sourceApprovalEvents).all()).toHaveLength(0);
    });

    it("approves it with the platform review's ledger once a valid review and a fresh matching precheck exist", async () => {
      insertCountySource();
      const review = seedBidnetReview();

      const response = await createAdminDataSourcesBatchPost(testDb.db)(
        batchRequest({ sourceIds: ["bidnet_mi_a"], action: "approve" }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.updatedCount).toBe(1);
      expect(body.skippedCount).toBe(0);
      expect(body.outcomes).toEqual([{ sourceId: "bidnet_mi_a", outcome: "approved", reason: null }]);
      expect(body.sources).toHaveLength(1);
      expect(body.sources[0]).toMatchObject({
        id: "bidnet_mi_a",
        approvalStatus: "approved",
        approvedForIngestion: true,
        legalReviewStatus: "approved_public",
        complianceReviewer: "apsi.lily@gmail.com",
        tosUrl: "https://www.bidnetdirect.com/tsandcs",
        tosReviewed: true,
        legalOpinionReference: "LEGAL-42",
        complianceReviewDueAt: "2027-09-29",
      });
      expect(rawSource("bidnet_mi_a")).toMatchObject({
        approvalStatus: "approved",
        approvedForIngestion: 1,
        isEnabled: 1,
        legalReviewStatus: "approved_public",
        complianceReviewer: "apsi.lily@gmail.com",
        tosUrl: "https://www.bidnetdirect.com/tsandcs",
        tosReviewed: 1,
        complianceReviewDueAt: "2027-09-29",
        approvalNotes: `依据平台审查 #${review.id}；预检 empty @${FRESH_PRECHECK}`,
      });
      expect(testDb.db.select().from(sourceApprovalEvents).all()).toHaveLength(1);
    });

    it("applies the ledger per source in one call: approves, skips and generic-approves side by side", async () => {
      insertCountySource();
      insertCountySource({ id: "bidnet_mi_b", label: "B County", baseUrl: "https://x/b", liveHealthDisposition: "needs_fix", liveHealthNotes: JSON.stringify({ precheck: { baseUrl: "https://x/b", verdict: "needs_fix" } }) });
      seedBidnetReview();

      const response = await createAdminDataSourcesBatchPost(testDb.db)(
        batchRequest({ sourceIds: ["bidnet_mi_a", "bidnet_mi_b", "ca_caleprocure"], action: "approve" }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.updatedCount).toBe(2);
      expect(body.skippedCount).toBe(1);
      expect(body.outcomes).toEqual([
        { sourceId: "bidnet_mi_a", outcome: "approved", reason: null },
        { sourceId: "bidnet_mi_b", outcome: "skipped", reason: "precheck_needs_fix" },
        { sourceId: "ca_caleprocure", outcome: "approved", reason: null },
      ]);
      expect(body.sources.map((source: { id: string }) => source.id)).toEqual(["bidnet_mi_a", "ca_caleprocure"]);
      expect(rawSource("bidnet_mi_b")?.approvalStatus).toBeNull();
      // The state source keeps the old generic note; the county source carries the ledger note.
      expect(rawSource("ca_caleprocure")?.approvalNotes).toBe("Approved from Admin batch source approval workflow.");
      expect(rawSource("bidnet_mi_a")?.approvalNotes).toMatch(/^依据平台审查 #prv_/);
    });

    it("skips a county source whose base_url moved after the precheck", async () => {
      insertCountySource({ baseUrl: "https://www.bidnetdirect.com/mitn/a2/solicitations/open-bids" });
      seedBidnetReview();

      const response = await createAdminDataSourcesBatchPost(testDb.db)(
        batchRequest({ sourceIds: ["bidnet_mi_a"], action: "approve" }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.outcomes).toEqual([{ sourceId: "bidnet_mi_a", outcome: "skipped", reason: "base_url_changed" }]);
      expect(rawSource("bidnet_mi_a")?.approvalStatus).toBeNull();
    });

    it("answers 404 DATA_SOURCE_NOT_FOUND for the whole request when any id is unknown", async () => {
      const response = await createAdminDataSourcesBatchPost(testDb.db)(
        batchRequest({ sourceIds: ["ca_caleprocure", "ghost"], action: "approve" }),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: "DATA_SOURCE_NOT_FOUND", message: "Data source was not found." } });
    });

    it("answers 400 APPROVAL_REQUIREMENTS_UNMET for a login-gated source approved without a ledger", async () => {
      testDb.db.update(dataSources).set({ requiresLogin: 1 }).where(eq(dataSources.id, "tx_esbd")).run();

      const response = await createAdminDataSourcesBatchPost(testDb.db)(
        batchRequest({ sourceIds: ["tx_esbd"], action: "approve" }),
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error.code).toBe("APPROVAL_REQUIREMENTS_UNMET");
      expect(body.error.message).toContain("complianceReviewer");
      expect(rawSource("tx_esbd")?.approvalStatus).toBe("needs_review");
    });

    it("approves through the MySQL store when one is supplied and leaves SQLite alone", async () => {
      const countyRow = {
        id: "bidnet_oh_x", label: "X County", issuerType: "county", stateCode: "OH", baseUrl: COUNTY_URL, isEnabled: 1, cadence: "daily",
        fetchConfig: null, jurisdictionLevel: "county", jurisdictionName: "X County", providerFamily: "bidnet", accessMode: null, sourceType: null,
        sourceConfidence: null, activationStatus: null, requiresBrowser: null, requiresManual: null, requiresLogin: null, supportsQuery: null,
        supportsPagination: null, supportsAttachmentMetadata: null, supportsDetailPageFetch: null, fallbackNotes: null, approvedForIngestion: null,
        approvalStatus: null, accessPattern: null, legalReviewStatus: null, sourceOwner: null, approvalNotes: null, lastApprovalReviewedAt: null,
        liveHealthOwner: null, liveHealthDisposition: "empty", liveHealthNextReviewAt: null,
        liveHealthNotes: JSON.stringify({ precheck: { baseUrl: COUNTY_URL, verdict: "empty" } }), liveHealthReviewedAt: FRESH_PRECHECK,
        precheckRequestedAt: null, robotsTxtStatus: null, robotsTxtCheckedAt: null, robotsTxtHash: null, robotsTxtDisallowsCrawledPaths: null,
        robotsTxtFlagReason: null, tosReviewed: null, tosReviewedAt: null, tosUrl: null, complianceReviewer: null, legalOpinionReference: null,
        complianceReviewDueAt: null, complianceNotes: null, lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW,
      };
      const reviewRow = {
        id: "prv_mysql_1", provider_family: "bidnet", tos_url: "https://www.bidnetdirect.com/tsandcs", tos_reviewed_at: "2026-09-29",
        robots_url: "https://www.bidnetdirect.com/robots.txt", robots_checked_at: "2026-09-29T07:00:00.000Z", robots_summary: "ok",
        access_boundary: "boundary", reviewer: "apsi.lily@gmail.com", legal_opinion_reference: null, reviewed_at: "2026-09-29T08:00:00.000Z",
        next_review_at: "2027-09-29", notes: null, created_by: null, created_at: "2026-09-29T08:00:00.000Z",
      };
      const executed: Array<{ sql: string; values: unknown[] }> = [];
      const query = vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM data_sources") && sql.includes("WHERE id = ?")) return [values[0] === countyRow.id ? [countyRow] : []];
        if (sql.includes("FROM data_sources")) return [[countyRow]];
        if (sql.includes("FROM platform_reviews")) return [[reviewRow]];
        return [[]];
      });
      const execute = vi.fn(async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1 }] as [unknown];
      });

      const response = await createAdminDataSourcesBatchPost(testDb.db, { query, execute } as never)(
        batchRequest({ sourceIds: ["bidnet_oh_x"], action: "approve" }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.updatedCount).toBe(1);
      expect(body.outcomes).toEqual([{ sourceId: "bidnet_oh_x", outcome: "approved", reason: null }]);
      const update = executed.find((call) => call.sql.startsWith("UPDATE data_sources SET"));
      expect(update?.sql).toContain("compliance_reviewer = ?");
      expect(update?.values).toEqual(expect.arrayContaining(["approved", "apsi.lily@gmail.com", "2027-09-29"]));
      expect(executed.some((call) => call.sql.includes("INSERT INTO source_approval_events"))).toBe(true);
      // Nothing was written to SQLite: the seeded state rows are exactly as inserted.
      expect(rawSource("ca_caleprocure")?.approvalStatus).toBe("needs_review");
      expect(testDb.db.select().from(sourceApprovalEvents).all()).toHaveLength(0);
    });

    it("rejects a cross-origin approve before touching the guard or the ledger (CSRF)", async () => {
      insertCountySource();
      seedBidnetReview();

      const response = await createAdminDataSourcesBatchPost(testDb.db)(
        batchRequest({ sourceIds: ["bidnet_mi_a"], action: "approve" }, { origin: "https://evil.example" }),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("CSRF_VALIDATION_FAILED");
      expect(adminAuth.requireAdminAccess).not.toHaveBeenCalled();
      expect(rawSource("bidnet_mi_a")?.approvalStatus).toBeNull();
    });
  });
});
