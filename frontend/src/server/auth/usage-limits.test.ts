import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bids, intentToBid, savedBids, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  UsageLimitError,
  enforceUsageLimit,
  getUsageLimitStatus,
  usageLimitForTier,
} from "./usage-limits";

describe("usage limits", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(users).values({
      id: "user_free",
      email: "free@example.com",
      role: "user",
      accountTier: "free",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    }).run();
    for (let index = 1; index <= 6; index += 1) {
      testDb.db.insert(bids).values({
        id: `bid_${index}`,
        source: "SAM.gov",
        sourceBidId: `mock:${index}`,
        dedupeKey: `mock:${index}`,
        title: `Bid ${index}`,
        description: "Short description",
        issuerName: "Agency",
        issuerType: "federal",
        stateCode: "US",
        sourceUrl: "https://example.com",
        firstSeenAt: "2026-05-28T00:00:00.000Z",
        lastSeenAt: "2026-05-28T00:00:00.000Z",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      }).run();
    }
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("reports tier limits for countable features", () => {
    expect(usageLimitForTier("free", "saved_bids")).toBe(5);
    expect(usageLimitForTier("free", "intent_workspace")).toBe(2);
    expect(usageLimitForTier("enterprise", "saved_bids")).toBeNull();
  });

  it("allows free users under the saved bid limit and rejects new saves at the limit", () => {
    for (let index = 1; index <= 5; index += 1) {
      testDb.db.insert(savedBids).values({
        userId: "user_free",
        bidId: `bid_${index}`,
        createdAt: `2026-05-28T00:00:0${index}.000Z`,
      }).run();
    }

    expect(
      getUsageLimitStatus(testDb.db, "user_free", "free", "saved_bids"),
    ).toMatchObject({ used: 5, limit: 5, remaining: 0, isLimited: true });
    expect(() =>
      enforceUsageLimit(testDb.db, {
        userId: "user_free",
        tier: "free",
        feature: "saved_bids",
        resourceId: "bid_6",
      }),
    ).toThrow(UsageLimitError);
    expect(() =>
      enforceUsageLimit(testDb.db, {
        userId: "user_free",
        tier: "free",
        feature: "saved_bids",
        resourceId: "bid_1",
      }),
    ).not.toThrow();
  });

  it("rejects new intent workspaces at the free limit", () => {
    for (let index = 1; index <= 2; index += 1) {
      testDb.db.insert(intentToBid).values({
        id: `intent_${index}`,
        userId: "user_free",
        bidId: `bid_${index}`,
        status: "intent_added",
        aiBidBrief: "Brief",
        keyDatesJson: "{}",
        initialChecklistJson: "[]",
        riskFlagsJson: "[]",
        matchScoreSnapshotJson: "{}",
        createdAt: `2026-05-28T00:00:0${index}.000Z`,
        updatedAt: `2026-05-28T00:00:0${index}.000Z`,
      }).run();
    }

    expect(() =>
      enforceUsageLimit(testDb.db, {
        userId: "user_free",
        tier: "free",
        feature: "intent_workspace",
        resourceId: "bid_3",
      }),
    ).toThrow(UsageLimitError);
    expect(() =>
      enforceUsageLimit(testDb.db, {
        userId: "user_free",
        tier: "free",
        feature: "intent_workspace",
        resourceId: "bid_1",
      }),
    ).not.toThrow();
  });
});
