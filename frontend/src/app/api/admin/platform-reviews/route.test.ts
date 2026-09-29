import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import {
  PLATFORM_ACCESS_BOUNDARY,
  createPlatformReview,
  listPlatformReviews,
  validatePlatformReviewInput,
} from "@/server/admin/platform-reviews-repository";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminPlatformReviewsGet, createAdminPlatformReviewsPost } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});

// The routes read the wall clock (`new Date()`), so the clock is pinned: otherwise the "valid"
// assertions below would flip to "expired" once the real date passes the fixture's next_review_at.
const NOW = new Date("2026-09-29T08:00:00.000Z");
const ENDPOINT = "http://localhost/api/admin/platform-reviews";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    providerFamily: "bidnet",
    tosUrl: "https://www.bidnetdirect.com/tsandcs",
    tosReviewedAt: "2026-09-29",
    robotsUrl: "https://www.bidnetdirect.com/robots.txt",
    robotsCheckedAt: "2026-09-29T07:00:00.000Z",
    robotsSummary: "Disallow: /private/, /favorites; list and detail paths allowed",
    reviewer: "apsi.lily@gmail.com",
    nextReviewAt: "2027-09-29",
    ...overrides,
  };
}

function jsonRequest(method: "POST", body: unknown, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function seedReview(testDb: TestDatabase, overrides: Record<string, unknown> = {}) {
  return createPlatformReview(testDb.db, validatePlatformReviewInput(validInput(overrides), NOW), { now: NOW });
}

/** The row shape `listPlatformReviewsFromMysql` reads (snake_case columns). */
const MYSQL_ROW = {
  id: "prv_mysql_1",
  provider_family: "bidnet",
  tos_url: "https://www.bidnetdirect.com/tsandcs",
  tos_reviewed_at: "2026-09-29",
  robots_url: "https://www.bidnetdirect.com/robots.txt",
  robots_checked_at: "2026-09-29T07:00:00.000Z",
  robots_summary: "ok",
  access_boundary: PLATFORM_ACCESS_BOUNDARY,
  reviewer: "apsi.lily@gmail.com",
  legal_opinion_reference: null,
  reviewed_at: "2026-09-29T08:00:00.000Z",
  next_review_at: "2027-09-29",
  notes: null,
  created_by: null,
  created_at: "2026-09-29T08:00:00.000Z",
};

describe("/api/admin/platform-reviews", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    vi.setSystemTime(NOW);
    testDb = await createTestDatabase({ seed: false });
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({ kind: "admin", role: "admin", userId: "admin_1" });
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe("GET", () => {
    it("lists reviews with the effective map", async () => {
      seedReview(testDb);

      const response = await createAdminPlatformReviewsGet(testDb.db)(new Request(ENDPOINT));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.reviews).toHaveLength(1);
      expect(body.effective.bidnet.status).toBe("valid");
      expect(body.effective.bidnet.review.id).toBe(body.reviews[0].id);
      expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.any(Request), {
        roles: ["admin", "operator", "support"],
      });
    });

    it("answers an empty ledger with no reviews and no effective entries", async () => {
      const response = await createAdminPlatformReviewsGet(testDb.db)(new Request(ENDPOINT));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ reviews: [], effective: {} });
    });

    it("calls a platform expired once its latest review is past next_review_at", async () => {
      seedReview(testDb, { reviewedAt: "2025-09-01T00:00:00.000Z", nextReviewAt: "2026-09-01" });

      const response = await createAdminPlatformReviewsGet(testDb.db)(new Request(ENDPOINT));

      expect((await response.json()).effective.bidnet.status).toBe("expired");
    });

    it("rejects a caller the admin guard refuses", async () => {
      vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError());

      const response = await createAdminPlatformReviewsGet(testDb.db)(new Request(ENDPOINT));

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
    });

    it("reads through the MySQL store when one is supplied and leaves SQLite alone", async () => {
      seedReview(testDb, { providerFamily: "bonfire" });
      const query = vi.fn(async () => [[MYSQL_ROW]]);
      const execute = vi.fn();

      const response = await createAdminPlatformReviewsGet(testDb.db, { query, execute } as never)(new Request(ENDPOINT));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.reviews.map((review: { id: string }) => review.id)).toEqual(["prv_mysql_1"]);
      expect(body.effective.bidnet.status).toBe("valid");
      expect(body.effective.bonfire).toBeUndefined();
      expect(String((query.mock.calls[0] as unknown[])[0])).toContain("FROM platform_reviews");
    });
  });

  describe("POST", () => {
    it("creates a review for an admin and returns 201", async () => {
      const response = await createAdminPlatformReviewsPost(testDb.db)(jsonRequest("POST", validInput()));

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.review.providerFamily).toBe("bidnet");
      expect(body.review.accessBoundary).toBe(PLATFORM_ACCESS_BOUNDARY);
      expect(body.review.reviewedAt).toBe(NOW.toISOString());
      expect(body.review.createdBy).toBe("admin_1");
      expect(listPlatformReviews(testDb.db)).toEqual([body.review]);
      expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.any(Request), { roles: ["admin"] });
    });

    it("records no actor when the admin console runs behind the local bypass", async () => {
      vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({ kind: "local-bypass" });

      const response = await createAdminPlatformReviewsPost(testDb.db)(jsonRequest("POST", validInput()));

      expect(response.status).toBe(201);
      expect((await response.json()).review.createdBy).toBeNull();
    });

    it("answers 400 INVALID_REQUEST with every validation issue", async () => {
      const response = await createAdminPlatformReviewsPost(testDb.db)(
        jsonRequest("POST", { ...validInput(), tosUrl: "nope", reviewer: "" }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.message).toContain("tosUrl");
      expect(body.error.message).toContain("reviewer");
      expect(body.error.message).toContain("; ");
      expect(listPlatformReviews(testDb.db)).toHaveLength(0);
    });

    it("answers 400 INVALID_REQUEST for a body that is not JSON", async () => {
      const response = await createAdminPlatformReviewsPost(testDb.db)(
        new Request(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.message).toContain("body must be an object");
      expect(listPlatformReviews(testDb.db)).toHaveLength(0);
    });

    it("rejects a non-admin POST with the auth guard's 403", async () => {
      vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(
        new adminAuth.AdminAuthError("Admin access is required."),
      );

      const response = await createAdminPlatformReviewsPost(testDb.db)(jsonRequest("POST", validInput()));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
      expect(listPlatformReviews(testDb.db)).toHaveLength(0);
    });

    it("answers the guard's 403 before validating, so a non-admin learns nothing about the schema", async () => {
      vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError());

      const response = await createAdminPlatformReviewsPost(testDb.db)(jsonRequest("POST", { tosUrl: "nope" }));

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
    });

    it("rejects a cross-origin POST before touching the guard or the ledger (CSRF)", async () => {
      const response = await createAdminPlatformReviewsPost(testDb.db)(
        jsonRequest("POST", validInput(), { origin: "https://evil.example" }),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("CSRF_VALIDATION_FAILED");
      expect(adminAuth.requireAdminAccess).not.toHaveBeenCalled();
      expect(listPlatformReviews(testDb.db)).toHaveLength(0);
    });

    it("accepts the app's own Origin header (positive control for the CSRF case above)", async () => {
      vi.stubEnv("APP_ORIGIN", "http://localhost");
      vi.stubEnv("CSRF_ALLOWED_ORIGINS", "");

      const response = await createAdminPlatformReviewsPost(testDb.db)(
        jsonRequest("POST", validInput(), { origin: "http://localhost" }),
      );

      expect(response.status).toBe(201);
    });

    it("writes through the MySQL store when one is supplied and leaves SQLite alone", async () => {
      const execute = vi.fn<(sql: string, values?: unknown[]) => Promise<[unknown, unknown?]>>(async () => [{ affectedRows: 1 }]);
      // The audit writer reads its event_log row back after inserting it, so the fake must answer that.
      const query = vi.fn(async () => [[{ id: "event_stub", event_name: "platform_review.created" }]]);

      const response = await createAdminPlatformReviewsPost(testDb.db, { execute, query } as never)(
        jsonRequest("POST", validInput()),
      );

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.review.createdBy).toBe("admin_1");
      const insert = execute.mock.calls.find((call) => String(call[0]).includes("INSERT INTO platform_reviews"));
      expect(insert).toBeDefined();
      expect(insert?.[1]).toContain(body.review.id);
      expect(execute.mock.calls.some((call) => String(call[0]).includes("INSERT INTO event_log"))).toBe(true);
      expect(listPlatformReviews(testDb.db)).toHaveLength(0);
    });
  });
});
