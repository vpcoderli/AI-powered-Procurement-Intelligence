import { describe, expect, it, vi } from "vitest";
import { notificationOutbox } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { enqueueNotification, markNotificationFailed } from "./outbox-repository";
import { deliverPendingNotifications } from "./delivery";
import type { NotificationOutboxInput } from "./types";

const input: NotificationOutboxInput = {
  id: "notification_1",
  alertId: "workspace_invite:invite_1",
  userId: "user_1",
  channel: "email",
  recipient: "buyer@example.com",
  frequency: "daily",
  dedupeKey: "workspace_invite:invite_1:token",
  subject: "Invite",
  bodyText: "Accept invite",
  matchedBidIds: [],
  createdAt: "2026-05-28T00:00:00.000Z",
};

describe("notification delivery service", () => {
  it("delivers pending notifications and marks them sent", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      const provider = { send: vi.fn().mockResolvedValue({ ok: true, providerMessageId: "mail_1" }) };

      const result = await deliverPendingNotifications(testDb.db, provider, {
        now: "2026-05-28T01:00:00.000Z",
      });

      expect(result).toEqual({ attempted: 1, sent: 1, failed: 0, skipped: 0 });
      expect(provider.send).toHaveBeenCalledWith({
        id: "notification_1",
        channel: "email",
        recipient: "buyer@example.com",
        subject: "Invite",
        bodyText: "Accept invite",
        dedupeKey: "workspace_invite:invite_1:token",
        matchedBidIds: [],
      });
      expect(testDb.db.select().from(notificationOutbox).get()).toMatchObject({
        status: "sent",
        sentAt: "2026-05-28T01:00:00.000Z",
        attemptCount: 1,
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("retries failed notifications below the attempt limit and skips exhausted rows", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      markNotificationFailed(testDb.db, "notification_1", "Provider unavailable", "2026-05-28T00:10:00.000Z");
      enqueueNotification(testDb.db, {
        ...input,
        id: "notification_exhausted",
        dedupeKey: "workspace_invite:invite_2:token",
      });
      markNotificationFailed(testDb.db, "notification_exhausted", "Provider unavailable", "2026-05-28T00:11:00.000Z");
      markNotificationFailed(testDb.db, "notification_exhausted", "Provider unavailable", "2026-05-28T00:12:00.000Z");
      markNotificationFailed(testDb.db, "notification_exhausted", "Provider unavailable", "2026-05-28T00:13:00.000Z");

      const provider = { send: vi.fn().mockResolvedValue({ ok: false, error: "Still down" }) };

      const result = await deliverPendingNotifications(testDb.db, provider, {
        now: "2026-05-28T01:00:00.000Z",
        maxAttempts: 3,
      });

      expect(result).toEqual({ attempted: 1, sent: 0, failed: 1, skipped: 1 });
      expect(provider.send).toHaveBeenCalledTimes(1);
      expect(
        testDb.db.select().from(notificationOutbox).all().map((row) => ({
          id: row.id,
          status: row.status,
          attemptCount: row.attemptCount,
          lastError: row.lastError,
        })),
      ).toEqual([
        {
          id: "notification_1",
          status: "failed",
          attemptCount: 2,
          lastError: "Still down",
        },
        {
          id: "notification_exhausted",
          status: "failed",
          attemptCount: 3,
          lastError: "Provider unavailable",
        },
      ]);
    } finally {
      await testDb.cleanup();
    }
  });
});
