import { describe, expect, it, vi } from "vitest";
import { notificationOutbox, searchAlertDigestRuns } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { enqueueNotification, markNotificationFailed } from "./outbox-repository";
import { deliverPendingNotifications, deliverPendingNotificationsFromMysql } from "./delivery";
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

  it("records search alert digest history when a retry succeeds", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, {
        ...input,
        id: "notification_alert_1",
        alertId: "alert_1",
        dedupeKey: "alert_1:2026-05-28:email",
        subject: "Cloud bids",
        bodyText: "Matched bids",
        matchedBidIds: ["bid_1", "bid_2"],
      });
      markNotificationFailed(
        testDb.db,
        "notification_alert_1",
        "Provider unavailable",
        "2026-05-28T00:10:00.000Z",
      );
      const provider = { send: vi.fn().mockResolvedValue({ ok: true, providerMessageId: "mail_1" }) };

      const result = await deliverPendingNotifications(testDb.db, provider, {
        now: "2026-05-28T01:00:00.000Z",
      });

      expect(result).toEqual({ attempted: 1, sent: 1, failed: 0, skipped: 0 });
      expect(testDb.db.select().from(searchAlertDigestRuns).get()).toMatchObject({
        alertId: "alert_1",
        userId: "user_1",
        status: "sent",
        matchCount: 2,
        notificationId: "notification_alert_1",
        matchedBidIdsJson: JSON.stringify(["bid_1", "bid_2"]),
        createdAt: "2026-05-28T01:00:00.000Z",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("delivers MySQL pending notifications and records digest history", async () => {
    const rows = new Map<string, Record<string, unknown>>([
      [
        "notification_alert_1",
        {
          id: "notification_alert_1",
          alertId: "alert_1",
          userId: "user_1",
          channel: "email",
          recipient: "buyer@example.com",
          frequency: "daily",
          dedupeKey: "alert_1:2026-05-28:email",
          subject: "Cloud bids",
          bodyText: "Matched bids",
          matchedBidIds: JSON.stringify(["bid_1", "bid_2"]),
          status: "failed",
          attemptCount: 1,
          lastError: "Provider unavailable",
          createdAt: "2026-05-28T00:00:00.000Z",
          sentAt: null,
        },
      ],
    ]);
    const digestRuns: unknown[] = [];
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("SET status = 'sent'")) {
          const row = rows.get(values[1] as string);
          if (row) {
            row.status = "sent";
            row.sentAt = values[0];
            row.lastError = null;
            row.attemptCount = Number(row.attemptCount) + 1;
          }
        }

        if (sql.includes("INSERT INTO search_alert_digest_runs")) {
          digestRuns.push(values);
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("COUNT(*) AS countValue")) {
          return [[{ countValue: rows.size }], undefined];
        }

        if (sql.includes("WHERE status IN")) {
          return [
            [...rows.values()].filter((row) => Number(row.attemptCount) < Number(values[0])),
            undefined,
          ];
        }

        if (sql.includes("FROM search_alert_digest_runs")) {
          return [[{
            id: digestRuns[0]?.[0],
            alertId: digestRuns[0]?.[1],
            userId: digestRuns[0]?.[2],
            frequency: digestRuns[0]?.[3],
            status: digestRuns[0]?.[4],
            matchCount: digestRuns[0]?.[5],
            notificationId: digestRuns[0]?.[6],
            skippedReason: digestRuns[0]?.[7],
            failureReason: digestRuns[0]?.[8],
            matchedBidIdsJson: digestRuns[0]?.[9],
            createdAt: digestRuns[0]?.[10],
          }], undefined];
        }

        if (sql.includes("WHERE id = ?")) {
          return [[[...rows.values()].find((row) => row.id === values[0])].filter(Boolean), undefined];
        }

        return [[], undefined];
      }),
    };
    const provider = { send: vi.fn().mockResolvedValue({ ok: true, providerMessageId: "mail_1" }) };

    await expect(deliverPendingNotificationsFromMysql(mysql, provider, {
      now: "2026-05-28T01:00:00.000Z",
    })).resolves.toEqual({ attempted: 1, sent: 1, failed: 0, skipped: 0 });

    expect(rows.get("notification_alert_1")).toMatchObject({
      status: "sent",
      sentAt: "2026-05-28T01:00:00.000Z",
      attemptCount: 2,
    });
    expect(digestRuns[0]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^digest_run_/),
      "alert_1",
      "user_1",
      "daily",
      "sent",
      2,
      "notification_alert_1",
    ]));
  });
});
