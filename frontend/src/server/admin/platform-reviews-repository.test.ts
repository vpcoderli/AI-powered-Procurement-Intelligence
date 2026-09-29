import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  PLATFORM_ACCESS_BOUNDARY,
  PlatformReviewValidationError,
  createPlatformReview,
  createPlatformReviewFromMysql,
  effectivePlatformReview,
  effectivePlatformReviewsByFamily,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  validatePlatformReviewInput,
  type PlatformReview,
} from "./platform-reviews-repository";

const NOW = new Date("2026-09-29T08:00:00.000Z");

function input(overrides: Record<string, unknown> = {}) {
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

function review(overrides: Partial<PlatformReview> = {}): PlatformReview {
  return {
    id: "prv_1", providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29",
    robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok",
    accessBoundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legalOpinionReference: null,
    reviewedAt: "2026-09-29T08:00:00.000Z", nextReviewAt: "2027-09-29", notes: null, createdBy: null, createdAt: "2026-09-29T08:00:00.000Z",
    ...overrides,
  };
}

describe("validatePlatformReviewInput", () => {
  it("normalises the family, defaults the boundary and reviewedAt", () => {
    const value = validatePlatformReviewInput(input({ providerFamily: " BidNet " }), NOW);
    expect(value.providerFamily).toBe("bidnet");
    expect(value.accessBoundary).toBe(PLATFORM_ACCESS_BOUNDARY);
    expect(value.reviewedAt).toBe(NOW.toISOString());
  });

  it.each([
    ["providerFamily", { providerFamily: "Bid Net!" }],
    ["tosUrl", { tosUrl: "ftp://x" }],
    ["robotsUrl", { robotsUrl: "not a url" }],
    ["reviewer", { reviewer: "  " }],
    ["robotsSummary", { robotsSummary: "" }],
    ["nextReviewAt", { nextReviewAt: "2026-01-01" }],
    ["tosReviewedAt", { tosReviewedAt: "yesterday" }],
  ])("rejects a bad %s", (field, overrides) => {
    expect(() => validatePlatformReviewInput(input(overrides), NOW)).toThrow(PlatformReviewValidationError);
    try {
      validatePlatformReviewInput(input(overrides), NOW);
    } catch (error) {
      expect((error as PlatformReviewValidationError).issues.join(" ")).toContain(field);
    }
  });

  it("rejects a non-object", () => {
    expect(() => validatePlatformReviewInput(null, NOW)).toThrow(PlatformReviewValidationError);
  });
});

describe("effectivePlatformReview", () => {
  it("is missing without a row for the family", () => {
    expect(effectivePlatformReview([review({ providerFamily: "bonfire" })], "bidnet", NOW)).toEqual({ status: "missing", review: null });
  });

  it("picks the latest reviewed_at and calls it valid while next_review_at is in the future", () => {
    const older = review({ id: "prv_old", reviewedAt: "2025-09-01T00:00:00.000Z", nextReviewAt: "2026-09-01" });
    const newer = review({ id: "prv_new", reviewedAt: "2026-09-29T08:00:00.000Z", nextReviewAt: "2027-09-29" });
    expect(effectivePlatformReview([older, newer], "bidnet", NOW)).toEqual({ status: "valid", review: newer });
  });

  it("calls the latest row expired once next_review_at has passed, even if an older row would still be valid", () => {
    const older = review({ id: "prv_old", reviewedAt: "2025-09-01T00:00:00.000Z", nextReviewAt: "2027-01-01" });
    const newer = review({ id: "prv_new", reviewedAt: "2026-06-01T00:00:00.000Z", nextReviewAt: "2026-09-01" });
    expect(effectivePlatformReview([older, newer], "bidnet", NOW)).toEqual({ status: "expired", review: newer });
  });

  it("groups by family", () => {
    const byFamily = effectivePlatformReviewsByFamily([review(), review({ id: "prv_b", providerFamily: "bonfire", nextReviewAt: "2026-01-01" })], NOW);
    expect(byFamily.bidnet.status).toBe("valid");
    expect(byFamily.bonfire.status).toBe("expired");
  });
});

describe("createPlatformReview / listPlatformReviews (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("stores the row, returns it and writes a platform_review.created audit event", () => {
    const created = createPlatformReview(testDb.db, validatePlatformReviewInput(input(), NOW), { actorUserId: "usr_admin", now: NOW });
    expect(created.id).toMatch(/^prv_/);
    expect(created.accessBoundary).toBe(PLATFORM_ACCESS_BOUNDARY);
    expect(created.createdBy).toBe("usr_admin");
    expect(listPlatformReviews(testDb.db)).toEqual([created]);

    const event = testDb.db.$client
      .prepare("SELECT event_name, target_type, target_id, actor_id FROM event_log ORDER BY created_at DESC LIMIT 1")
      .get() as { event_name: string; target_type: string; target_id: string; actor_id: string | null };
    expect(event).toMatchObject({ event_name: "platform_review.created", target_type: "platform_review", target_id: created.id, actor_id: "usr_admin" });
  });

  it("lists newest reviewed_at first", () => {
    createPlatformReview(testDb.db, validatePlatformReviewInput(input({ reviewedAt: "2025-01-01T00:00:00.000Z", nextReviewAt: "2026-01-01" }), NOW), { now: NOW });
    const newer = createPlatformReview(testDb.db, validatePlatformReviewInput(input(), NOW), { now: NOW });
    expect(listPlatformReviews(testDb.db)[0].id).toBe(newer.id);
  });
});

describe("MySQL twins", () => {
  it("inserts with the same column set and lists rows back", async () => {
    const execute = vi.fn<(sql: string, values?: unknown[]) => Promise<[unknown, unknown?]>>(async () => [{ affectedRows: 1 }]);
    const query = vi.fn(async () => [[
      { id: "prv_1", provider_family: "bidnet", tos_url: "https://www.bidnetdirect.com/tsandcs", tos_reviewed_at: "2026-09-29", robots_url: "https://www.bidnetdirect.com/robots.txt", robots_checked_at: "2026-09-29T07:00:00.000Z", robots_summary: "ok", access_boundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legal_opinion_reference: null, reviewed_at: "2026-09-29T08:00:00.000Z", next_review_at: "2027-09-29", notes: null, created_by: null, created_at: "2026-09-29T08:00:00.000Z" },
    ]]);
    const store = { execute, query } as never;

    const created = await createPlatformReviewFromMysql(store, validatePlatformReviewInput(input(), NOW), { now: NOW });
    const insert = execute.mock.calls.find((call) => String(call[0]).includes("INSERT INTO platform_reviews"));
    expect(insert).toBeDefined();
    expect(String(insert?.[0])).toContain("(id, provider_family, tos_url, tos_reviewed_at, robots_url, robots_checked_at, robots_summary, access_boundary, reviewer, legal_opinion_reference, reviewed_at, next_review_at, notes, created_by, created_at)");
    expect(created.providerFamily).toBe("bidnet");
    expect(execute.mock.calls.some((call) => String(call[0]).includes("INSERT INTO event_log"))).toBe(true);

    const rows = await listPlatformReviewsFromMysql(store);
    expect(rows[0]).toMatchObject({ id: "prv_1", providerFamily: "bidnet", nextReviewAt: "2027-09-29" });
  });
});
