import { describe, expect, it, vi } from "vitest";
import { notificationOutbox } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import {
  enqueueNotification,
  enqueueNotificationFromMysql,
  listDeliverableNotifications,
  listDeliverableNotificationsFromMysql,
  listRecentNotifications,
  listRecentNotificationsFromMysql,
  markNotificationFailed,
  markNotificationFailedFromMysql,
  markNotificationSent,
  markNotificationSentFromMysql,
  recordNotificationDeliveryEvent,
  recordNotificationDeliveryEventFromMysql,
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

  it("lists recent notifications for admin delivery inspection", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, {
        ...input,
        id: "notification_sent",
        dedupeKey: "alert_1:2026-05-20:email",
        createdAt: "2026-05-19T00:00:00.000Z",
      });
      markNotificationSent(testDb.db, "notification_sent", "2026-05-19T00:01:00.000Z");
      enqueueNotification(testDb.db, {
        ...input,
        id: "notification_failed",
        dedupeKey: "alert_1:2026-05-21:email",
        createdAt: "2026-05-19T00:02:00.000Z",
      });
      markNotificationFailed(
        testDb.db,
        "notification_failed",
        "Provider unavailable",
        "2026-05-19T00:03:00.000Z",
      );

      expect(listRecentNotifications(testDb.db, { limit: 10 }).map((row) => row.id)).toEqual([
        "notification_failed",
        "notification_sent",
      ]);
      expect(listRecentNotifications(testDb.db, { status: "failed" }).map((row) => row.id)).toEqual([
        "notification_failed",
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("runs the MySQL notification outbox lifecycle", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO notification_outbox")) {
          if (!rows.has(values[6] as string)) {
            rows.set(values[6] as string, {
              id: values[0],
              alertId: values[1],
              userId: values[2],
              channel: values[3],
              recipient: values[4],
              frequency: values[5],
              dedupeKey: values[6],
              subject: values[7],
              bodyText: values[8],
              matchedBidIds: values[9],
              status: "pending",
              attemptCount: 0,
              lastError: null,
              createdAt: values[10],
              sentAt: null,
            });
          }
        }

        if (sql.includes("SET status = 'sent'")) {
          for (const row of rows.values()) {
            if (row.id === values[1]) {
              row.status = "sent";
              row.sentAt = values[0];
              row.lastError = null;
              row.attemptCount = Number(row.attemptCount) + 1;
            }
          }
        }

        if (sql.includes("SET status = 'failed'")) {
          for (const row of rows.values()) {
            if (row.id === values[1]) {
              row.status = "failed";
              row.sentAt = null;
              row.lastError = values[0];
              row.attemptCount = Number(row.attemptCount) + 1;
            }
          }
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("WHERE dedupe_key = ?")) {
          return [[[...rows.values()].find((row) => row.dedupeKey === values[0])].filter(Boolean), undefined];
        }

        if (sql.includes("WHERE id = ?")) {
          return [[[...rows.values()].find((row) => row.id === values[0])].filter(Boolean), undefined];
        }

        if (sql.includes("WHERE status IN")) {
          return [
            [...rows.values()]
              .filter((row) => (row.status === "pending" || row.status === "failed") && Number(row.attemptCount) < Number(values[0]))
              .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
            undefined,
          ];
        }

        if (sql.includes("WHERE status = ?")) {
          return [
            [...rows.values()]
              .filter((row) => row.status === values[0])
              .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
            undefined,
          ];
        }

        return [[...rows.values()].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))), undefined];
      }),
    };

    const first = await enqueueNotificationFromMysql(mysql, input);
    const second = await enqueueNotificationFromMysql(mysql, input);
    const sent = await markNotificationSentFromMysql(mysql, "notification_1", "2026-05-19T01:00:00.000Z");
    await enqueueNotificationFromMysql(mysql, {
      ...input,
      id: "notification_failed",
      dedupeKey: "alert_1:2026-05-20:email",
      createdAt: "2026-05-19T00:01:00.000Z",
    });
    const failed = await markNotificationFailedFromMysql(
      mysql,
      "notification_failed",
      "Provider unavailable",
      "2026-05-19T02:00:00.000Z",
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(sent).toMatchObject({ status: "sent", attemptCount: 1 });
    expect(failed).toMatchObject({ status: "failed", lastError: "Provider unavailable", attemptCount: 1 });
    await expect(listDeliverableNotificationsFromMysql(mysql, { maxAttempts: 3 })).resolves.toEqual([
      expect.objectContaining({ id: "notification_failed" }),
    ]);
    await expect(listRecentNotificationsFromMysql(mysql, { status: "failed" })).resolves.toEqual([
      expect.objectContaining({ id: "notification_failed" }),
    ]);
  });

  it("records a bounce event against a sent notification without touching attemptCount", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      const sent = markNotificationSent(testDb.db, "notification_1", "2026-05-19T01:00:00.000Z");
      expect(sent.attemptCount).toBe(1);

      const bounced = recordNotificationDeliveryEvent(
        testDb.db,
        "notification_1",
        "bounce",
        "Permanent/General: mailbox does not exist",
        "2026-05-19T02:00:00.000Z",
      );

      expect(bounced).toMatchObject({
        status: "failed",
        attemptCount: 1,
        lastError: "provider_event:bounce: Permanent/General: mailbox does not exist",
      });
      // sentAt is preserved: the send genuinely succeeded, the bounce is a
      // later async signal, not a retryable delivery failure.
      expect(bounced?.sentAt).toBe("2026-05-19T01:00:00.000Z");
    } finally {
      await testDb.cleanup();
    }
  });

  it("records a complaint event against a sent notification", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      markNotificationSent(testDb.db, "notification_1", "2026-05-19T01:00:00.000Z");

      const complained = recordNotificationDeliveryEvent(
        testDb.db,
        "notification_1",
        "complaint",
        "abuse",
        "2026-05-19T02:00:00.000Z",
      );

      expect(complained).toMatchObject({
        status: "failed",
        lastError: "provider_event:complaint: abuse",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("ignores delivered confirmations and does not downgrade an already-failed row", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      markNotificationSent(testDb.db, "notification_1", "2026-05-19T01:00:00.000Z");
      recordNotificationDeliveryEvent(
        testDb.db,
        "notification_1",
        "bounce",
        "Permanent",
        "2026-05-19T02:00:00.000Z",
      );

      const afterDelivered = recordNotificationDeliveryEvent(
        testDb.db,
        "notification_1",
        "delivered",
        "delivered",
        "2026-05-19T03:00:00.000Z",
      );

      expect(afterDelivered?.status).toBe("failed");
      expect(afterDelivered?.lastError).toContain("provider_event:bounce");
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns null when recording a delivery event for an unknown notification id", async () => {
    const testDb = await createTestDatabase();

    try {
      const result = recordNotificationDeliveryEvent(
        testDb.db,
        "notification_does_not_exist",
        "bounce",
        "Permanent",
        "2026-05-19T02:00:00.000Z",
      );

      expect(result).toBeNull();
    } finally {
      await testDb.cleanup();
    }
  });

  it("records MySQL bounce/complaint/delivered events against the outbox row", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    rows.set("alert_1:2026-05-19:email", {
      id: "notification_1",
      alertId: "alert_1",
      userId: "user_1",
      channel: "email",
      recipient: "buyer@example.com",
      frequency: "daily",
      dedupeKey: "alert_1:2026-05-19:email",
      subject: "APSi daily bid matches",
      bodyText: "1 matching bid",
      matchedBidIds: JSON.stringify(["bid_1"]),
      status: "sent",
      attemptCount: 1,
      lastError: null,
      createdAt: "2026-05-19T00:00:00.000Z",
      sentAt: "2026-05-19T01:00:00.000Z",
    });

    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("SET status = 'failed', last_error = ?")) {
          for (const row of rows.values()) {
            if (row.id === values[1]) {
              row.status = "failed";
              row.lastError = values[0];
            }
          }
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("WHERE id = ?")) {
          return [[[...rows.values()].find((row) => row.id === values[0])].filter(Boolean), undefined];
        }

        return [[...rows.values()], undefined];
      }),
    };

    const bounced = await recordNotificationDeliveryEventFromMysql(
      mysql,
      "notification_1",
      "bounce",
      "Permanent/General",
      "2026-05-19T02:00:00.000Z",
    );

    expect(bounced).toMatchObject({
      status: "failed",
      lastError: "provider_event:bounce: Permanent/General",
      attemptCount: 1,
      sentAt: "2026-05-19T01:00:00.000Z",
    });

    const notFound = await recordNotificationDeliveryEventFromMysql(
      mysql,
      "notification_missing",
      "complaint",
      "abuse",
      "2026-05-19T02:00:00.000Z",
    );

    expect(notFound).toBeNull();
  });
});
