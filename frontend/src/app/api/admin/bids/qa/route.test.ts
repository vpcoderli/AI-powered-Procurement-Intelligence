import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminBidQaGet } from "./route";

const NOW = "2026-05-30T00:00:00.000Z";

describe("GET /api/admin/bids/qa", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
  });

  afterEach(async () => {
    await testDb.cleanup();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("denies requests without admin auth or local bypass", async () => {
    const GET = createAdminBidQaGet(testDb.db);

    const response = await GET(new Request("http://localhost/api/admin/bids/qa"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });

  it("returns filtered QA items with local bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    testDb.db.insert(bids).values({
      id: "qa_bid_1",
      source: "California Cal eProcure",
      sourceBidId: "CA-1",
      dedupeKey: "CA-1",
      title: "California records system",
      description: "Records system procurement",
      issuerName: "California Agency",
      issuerType: "state",
      stateCode: "CA",
      sourceUrl: "https://caleprocure.ca.gov/event/CA-1",
      sourceConfidence: "low",
      qualityFlagsJson: JSON.stringify(["missing_deadline"]),
      adminReviewStatus: "needs_review",
      detailArchiveStatus: "failed",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();

    const GET = createAdminBidQaGet(testDb.db);
    const response = await GET(
      new Request("http://localhost/api/admin/bids/qa?stateCode=CA&reviewStatus=needs_review&archiveStatus=failed"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ total: 1, archiveIssues: 1 }),
        items: [expect.objectContaining({ id: "qa_bid_1", qualityScore: expect.any(Number) })],
      }),
    );
  });
});
