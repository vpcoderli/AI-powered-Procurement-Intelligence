import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import {
  listSearchAlertDigestRunsForUser,
  recordSearchAlertDigestRun,
} from "./digest-history";

describe("search alert digest history", () => {
  it("records digest outcomes and lists recent runs by user-owned alerts", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      recordSearchAlertDigestRun(testDb.db, {
        id: "digest_run_1",
        alertId: "alert_1",
        userId: "user_1",
        frequency: "daily",
        status: "sent",
        matchCount: 2,
        notificationId: "notification_1",
        matchedBidIds: ["bid_1", "bid_2"],
        createdAt: "2026-05-30T00:00:00.000Z",
      });
      recordSearchAlertDigestRun(testDb.db, {
        id: "digest_run_2",
        alertId: "alert_1",
        userId: "user_1",
        frequency: "daily",
        status: "skipped",
        matchCount: 2,
        skippedReason: "duplicate_digest",
        matchedBidIds: ["bid_1", "bid_2"],
        createdAt: "2026-05-30T01:00:00.000Z",
      });
      recordSearchAlertDigestRun(testDb.db, {
        id: "digest_run_other",
        alertId: "alert_2",
        userId: "user_2",
        frequency: "daily",
        status: "failed",
        matchCount: 1,
        failureReason: "Provider unavailable",
        matchedBidIds: ["bid_3"],
        createdAt: "2026-05-30T02:00:00.000Z",
      });

      const history = listSearchAlertDigestRunsForUser(testDb.db, "user_1", ["alert_1", "alert_2"], 3);

      expect(history).toEqual({
        alert_1: [
          expect.objectContaining({
            id: "digest_run_2",
            status: "skipped",
            skippedReason: "duplicate_digest",
            matchedBidIds: ["bid_1", "bid_2"],
          }),
          expect.objectContaining({
            id: "digest_run_1",
            status: "sent",
            notificationId: "notification_1",
          }),
        ],
      });
    } finally {
      await testDb.cleanup();
    }
  });
});
