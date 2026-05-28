import { describe, expect, it } from "vitest";
import { notificationOutbox } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import {
  enqueueNotification,
  listDeliverableNotifications,
  markNotificationFailed,
  markNotificationSent,
} from "./outbox-repository";
import type { NotificationOutboxInput } from "./types";

const input: NotificationOutboxInput = {
  id: "notification_1",
  alertId: "alert_1",
  userId: "user_1",
  channel: "email",
  recipient: "buyer@example.com",
  frequency: "daily",
  dedupeKey: "alert_1:2026-05-19:email",
  subject: "APSi daily bid matches",
  bodyText: "1 matching bid",
  matchedBidIds: ["bid_1"],
  createdAt: "2026-05-19T00:00:00.000Z",
};

describe("notification outbox repository", () => {
  it("deduplicates notification enqueue by dedupe key", async () => {
    const testDb = await createTestDatabase();

    try {
      const first = enqueueNotification(testDb.db, input);
      const second = enqueueNotification(testDb.db, input);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.notification.id).toBe("notification_1");
      expect(testDb.db.select().from(notificationOutbox).all()).toHaveLength(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("marks notifications as sent or failed", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);

      const sent = markNotificationSent(testDb.db, "notification_1", "2026-05-19T01:00:00.000Z");
      expect(sent.status).toBe("sent");
      expect(sent.sentAt).toBe("2026-05-19T01:00:00.000Z");
      expect(sent.attemptCount).toBe(1);

      const failedInput = {
        ...input,
        id: "notification_2",
        dedupeKey: "alert_1:2026-05-20:email",
      };
      enqueueNotification(testDb.db, failedInput);

      const failed = markNotificationFailed(
        testDb.db,
        "notification_2",
        "Provider unavailable",
        "2026-05-19T02:00:00.000Z",
      );
      expect(failed.status).toBe("failed");
      expect(failed.lastError).toBe("Provider unavailable");
      expect(failed.attemptCount).toBe(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("lists pending and retryable failed notifications up to the attempt limit", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      enqueueNotification(testDb.db, {
        ...input,
        id: "notification_retry",
        dedupeKey: "alert_1:2026-05-20:email",
        createdAt: "2026-05-19T00:01:00.000Z",
      });
      markNotificationFailed(
        testDb.db,
        "notification_retry",
        "Provider unavailable",
        "2026-05-19T00:02:00.000Z",
      );
      enqueueNotification(testDb.db, {
        ...input,
        id: "notification_exhausted",
        dedupeKey: "alert_1:2026-05-21:email",
        createdAt: "2026-05-19T00:03:00.000Z",
      });
      markNotificationFailed(testDb.db, "notification_exhausted", "Provider unavailable", "2026-05-19T00:04:00.000Z");
      markNotificationFailed(testDb.db, "notification_exhausted", "Provider unavailable", "2026-05-19T00:05:00.000Z");
      markNotificationFailed(testDb.db, "notification_exhausted", "Provider unavailable", "2026-05-19T00:06:00.000Z");
      enqueueNotification(testDb.db, {
        ...input,
        id: "notification_sent",
        dedupeKey: "alert_1:2026-05-22:email",
        createdAt: "2026-05-19T00:07:00.000Z",
      });
      markNotificationSent(testDb.db, "notification_sent", "2026-05-19T00:08:00.000Z");

      expect(listDeliverableNotifications(testDb.db, { maxAttempts: 3 }).map((row) => row.id)).toEqual([
        "notification_1",
        "notification_retry",
      ]);
    } finally {
      await testDb.cleanup();
    }
  });
});
