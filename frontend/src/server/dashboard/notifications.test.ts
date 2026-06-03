import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notificationOutbox, searchAlertDigestRuns } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { listDashboardNotificationInsights } from "./notifications";

describe("dashboard notification insights", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("summarizes current user's notification outbox and recent search digest runs", () => {
    testDb.db
      .insert(notificationOutbox)
      .values([
        {
          id: "notification_failed",
          alertId: "alert_1",
          userId: "user_1",
          channel: "email",
          recipient: "buyer@example.com",
          frequency: "daily",
          dedupeKey: "failed",
          subject: "Failed",
          bodyText: "Failed",
          matchedBidIds: JSON.stringify(["bid_1"]),
          status: "failed",
          attemptCount: 1,
          createdAt: "2026-06-02T00:00:00.000Z",
        },
        {
          id: "notification_pending",
          alertId: "alert_1",
          userId: "user_1",
          channel: "email",
          recipient: "buyer@example.com",
          frequency: "daily",
          dedupeKey: "pending",
          subject: "Pending",
          bodyText: "Pending",
          matchedBidIds: JSON.stringify(["bid_2"]),
          status: "pending",
          attemptCount: 0,
          createdAt: "2026-06-02T00:01:00.000Z",
        },
        {
          id: "notification_other",
          alertId: "alert_2",
          userId: "other_user",
          channel: "email",
          recipient: "other@example.com",
          frequency: "daily",
          dedupeKey: "other",
          subject: "Other",
          bodyText: "Other",
          matchedBidIds: JSON.stringify(["bid_3"]),
          status: "failed",
          attemptCount: 1,
          createdAt: "2026-06-02T00:02:00.000Z",
        },
      ])
      .run();
    testDb.db
      .insert(searchAlertDigestRuns)
      .values([
        {
          id: "digest_sent",
          alertId: "alert_1",
          userId: "user_1",
          frequency: "daily",
          status: "sent",
          matchCount: 4,
          matchedBidIdsJson: JSON.stringify(["bid_1", "bid_2", "bid_3", "bid_4"]),
          createdAt: "2026-06-02T00:03:00.000Z",
        },
        {
          id: "digest_failed",
          alertId: "alert_1",
          userId: "user_1",
          frequency: "daily",
          status: "failed",
          matchCount: 0,
          failureReason: "Provider unavailable",
          matchedBidIdsJson: JSON.stringify([]),
          createdAt: "2026-06-02T00:04:00.000Z",
        },
      ])
      .run();

    expect(listDashboardNotificationInsights(testDb.db, "user_1")).toEqual({
      failedNotifications: 1,
      pendingNotifications: 1,
      failedDigestRuns: 1,
      recentDigestMatches: 4,
    });
  });
});
