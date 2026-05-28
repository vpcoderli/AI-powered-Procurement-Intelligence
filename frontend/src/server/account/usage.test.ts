import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bids, intentToBid, organizationMemberships, organizations, savedBids, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { getAccountUsage } from "./usage";

describe("account usage service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(users).values([
      {
        id: "user_owner",
        email: "owner@example.com",
        role: "user",
        accountTier: "free",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      {
        id: "user_member",
        email: "member@example.com",
        role: "user",
        accountTier: "free",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    ]).run();
    testDb.db.insert(organizations).values({
      id: "org_1",
      name: "Acme Federal Team",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    }).run();
    for (const userId of ["user_owner", "user_member"]) {
      testDb.db.insert(organizationMemberships).values({
        organizationId: "org_1",
        userId,
        role: userId === "user_owner" ? "owner" : "member",
        status: "active",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      }).run();
    }
    for (let index = 1; index <= 4; index += 1) {
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

  it("reports workspace-scoped usage against the current tier limits", () => {
    testDb.db.insert(savedBids).values([
      { userId: "user_owner", bidId: "bid_1", createdAt: "2026-05-28T00:00:00.000Z" },
      { userId: "user_member", bidId: "bid_2", createdAt: "2026-05-28T00:00:01.000Z" },
    ]).run();
    testDb.db.insert(intentToBid).values({
      id: "intent_1",
      userId: "user_member",
      bidId: "bid_3",
      status: "intent_added",
      aiBidBrief: "Brief",
      keyDatesJson: "{}",
      initialChecklistJson: "[]",
      riskFlagsJson: "[]",
      matchScoreSnapshotJson: "{}",
      createdAt: "2026-05-28T00:00:02.000Z",
      updatedAt: "2026-05-28T00:00:02.000Z",
    }).run();

    expect(getAccountUsage(testDb.db, "user_owner")).toEqual({
      tier: "free",
      workspaceUserIds: ["user_owner", "user_member"],
      items: [
        {
          feature: "saved_bids",
          used: 2,
          limit: 5,
          remaining: 3,
          isLimited: false,
          requiredTier: "pro",
        },
        {
          feature: "intent_workspace",
          used: 1,
          limit: 2,
          remaining: 1,
          isLimited: false,
          requiredTier: "pro",
        },
      ],
    });
  });
});
