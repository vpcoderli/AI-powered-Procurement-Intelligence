import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import {
  listSearchAlertDigestRunsForUser,
  listSearchAlertDigestRunsForUserFromMysql,
  recordSearchAlertDigestRun,
  recordSearchAlertDigestRunFromMysql,
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

  it("records and lists MySQL digest outcomes by user-owned alerts", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, undefined]);
    const query = vi.fn()
      .mockResolvedValueOnce([
        [
          {
            id: "digest_run_1",
            alertId: "alert_1",
            userId: "user_1",
            frequency: "daily",
            status: "sent",
            matchCount: 2,
            notificationId: "notification_1",
            skippedReason: null,
            failureReason: null,
            matchedBidIdsJson: JSON.stringify(["bid_1", "bid_2"]),
            createdAt: "2026-05-30T00:00:00.000Z",
          },
        ],
        undefined,
      ])
      .mockResolvedValueOnce([
        [
          {
            id: "digest_run_2",
            alertId: "alert_1",
            userId: "user_1",
            frequency: "daily",
            status: "skipped",
            matchCount: 2,
            notificationId: null,
            skippedReason: "duplicate_digest",
            failureReason: null,
            matchedBidIdsJson: JSON.stringify(["bid_1", "bid_2"]),
            createdAt: "2026-05-30T01:00:00.000Z",
          },
          {
            id: "digest_run_1",
            alertId: "alert_1",
            userId: "user_1",
            frequency: "daily",
            status: "sent",
            matchCount: 2,
            notificationId: "notification_1",
            skippedReason: null,
            failureReason: null,
            matchedBidIdsJson: JSON.stringify(["bid_1", "bid_2"]),
            createdAt: "2026-05-30T00:00:00.000Z",
          },
        ],
        undefined,
      ]);
    const mysql = { execute, query };

    await expect(recordSearchAlertDigestRunFromMysql(mysql, {
      id: "digest_run_1",
      alertId: "alert_1",
      userId: "user_1",
      frequency: "daily",
      status: "sent",
      matchCount: 2,
      notificationId: "notification_1",
      matchedBidIds: ["bid_1", "bid_2"],
      createdAt: "2026-05-30T00:00:00.000Z",
    })).resolves.toMatchObject({
      id: "digest_run_1",
      status: "sent",
      matchedBidIds: ["bid_1", "bid_2"],
    });

    await expect(
      listSearchAlertDigestRunsForUserFromMysql(mysql, "user_1", ["alert_1", "alert_2"], 3),
    ).resolves.toEqual({
      alert_1: [
        expect.objectContaining({ id: "digest_run_2", skippedReason: "duplicate_digest" }),
        expect.objectContaining({ id: "digest_run_1", notificationId: "notification_1" }),
      ],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO search_alert_digest_runs"),
      expect.arrayContaining(["digest_run_1", "alert_1", "user_1", "daily", "sent", 2]),
    );
  });
});
