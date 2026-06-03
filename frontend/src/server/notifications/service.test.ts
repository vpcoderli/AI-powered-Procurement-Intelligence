import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { updateAccountNotificationPreferences } from "@/server/account/notification-preferences";
import { alerts, notificationOutbox, searchAlertDigestRuns, users } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { sendMatchedAlertNotifications, sendMatchedAlertNotificationsFromMysql } from "./service";

describe("notification service", () => {
  it("skips anonymous and no-email users", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db
        .insert(alerts)
        .values({
          id: "alert_no_email",
          userId: "anon_seed",
          name: "Cloud alerts",
          query: JSON.stringify({ q: "cloud" }),
          frequency: "daily",
          isEnabled: 1,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();

      const provider = { send: vi.fn() };
      const result = await sendMatchedAlertNotifications(
        testDb.db,
        {
          evaluatedAlerts: 1,
          matchedAlerts: 1,
          updatedAlerts: 1,
          matches: [
            {
              alertId: "alert_no_email",
              userId: "anon_seed",
              alertName: "Cloud alerts",
              frequency: "daily",
              notificationChannel: "email",
              bidIds: ["bid_1"],
              bids: [
                {
                  id: "bid_1",
                  title: "Cloud modernization",
                  issuerName: "GSA",
                  sourceUrl: "https://sam.gov/opp/bid_1",
                  deadlineDate: "2026-06-01",
                },
              ],
              query: { q: "cloud" },
            },
          ],
        },
        provider,
        { now: "2026-05-19T12:00:00.000Z" },
      );

      expect(result).toEqual({ queued: 0, sent: 0, skipped: 1, failed: 0 });
      expect(provider.send).not.toHaveBeenCalled();
      expect(testDb.db.select().from(notificationOutbox).all()).toHaveLength(0);
    } finally {
      await testDb.cleanup();
    }
  });

  it("enqueues deduped notifications, sends created rows, and updates alert notification time", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db
        .insert(users)
        .values({
          id: "user_email",
          email: "buyer@example.com",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();
      testDb.db
        .insert(alerts)
        .values({
          id: "alert_email",
          userId: "user_email",
          name: "Cloud alerts",
          query: JSON.stringify({ q: "cloud" }),
          frequency: "daily",
          notificationChannel: "email",
          isEnabled: 1,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();

      const matchResult = {
        evaluatedAlerts: 1,
        matchedAlerts: 1,
        updatedAlerts: 1,
        matches: [
          {
            alertId: "alert_email",
            userId: "user_email",
            alertName: "Cloud alerts",
            frequency: "daily" as const,
            notificationChannel: "email" as const,
            bidIds: ["bid_1"],
            bids: [
              {
                id: "bid_1",
                title: "Cloud modernization",
                issuerName: "GSA",
                sourceUrl: "https://sam.gov/opp/bid_1",
                deadlineDate: "2026-06-01",
              },
            ],
            query: { q: "cloud" },
          },
        ],
      };
      const provider = { send: vi.fn().mockResolvedValue({ ok: true, providerMessageId: "file:1" }) };

      const first = await sendMatchedAlertNotifications(testDb.db, matchResult, provider, {
        now: "2026-05-19T12:00:00.000Z",
      });
      const second = await sendMatchedAlertNotifications(testDb.db, matchResult, provider, {
        now: "2026-05-19T12:30:00.000Z",
      });

      expect(first).toEqual({ queued: 1, sent: 1, skipped: 0, failed: 0 });
      expect(second).toEqual({ queued: 0, sent: 0, skipped: 1, failed: 0 });
      expect(provider.send).toHaveBeenCalledTimes(1);

      const notification = testDb.db.select().from(notificationOutbox).get();
      expect(notification?.status).toBe("sent");
      expect(notification?.recipient).toBe("buyer@example.com");
      expect(notification?.matchedBidIds).toBe(JSON.stringify(["bid_1"]));
      const digestRuns = testDb.db.select().from(searchAlertDigestRuns).all();
      expect(digestRuns).toEqual([
        expect.objectContaining({
          alertId: "alert_email",
          userId: "user_email",
          status: "sent",
          matchCount: 1,
          notificationId: notification?.id,
          matchedBidIdsJson: JSON.stringify(["bid_1"]),
        }),
        expect.objectContaining({
          alertId: "alert_email",
          userId: "user_email",
          status: "skipped",
          matchCount: 1,
          skippedReason: "duplicate_digest",
          matchedBidIdsJson: JSON.stringify(["bid_1"]),
        }),
      ]);

      const alert = testDb.db.select().from(alerts).where(eq(alerts.id, "alert_email")).get();
      expect(alert?.lastNotifiedAt).toBe("2026-05-19T12:00:00.000Z");
    } finally {
      await testDb.cleanup();
    }
  });

  it("marks outbox rows failed when the provider fails", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db
        .insert(users)
        .values({
          id: "user_email",
          email: "buyer@example.com",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();
      testDb.db
        .insert(alerts)
        .values({
          id: "alert_email",
          userId: "user_email",
          name: "Cloud alerts",
          query: JSON.stringify({ q: "cloud" }),
          frequency: "daily",
          notificationChannel: "email",
          isEnabled: 1,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();

      const provider = {
        send: vi.fn().mockResolvedValue({ ok: false, error: "Provider unavailable" }),
      };
      const result = await sendMatchedAlertNotifications(
        testDb.db,
        {
          evaluatedAlerts: 1,
          matchedAlerts: 1,
          updatedAlerts: 1,
          matches: [
            {
              alertId: "alert_email",
              userId: "user_email",
              alertName: "Cloud alerts",
              frequency: "daily",
              notificationChannel: "email",
              bidIds: ["bid_1"],
              bids: [
                {
                  id: "bid_1",
                  title: "Cloud modernization",
                  issuerName: "GSA",
                  sourceUrl: "https://sam.gov/opp/bid_1",
                  deadlineDate: "2026-06-01",
                },
              ],
              query: { q: "cloud" },
            },
          ],
        },
        provider,
        { now: "2026-05-19T12:00:00.000Z" },
      );

      expect(result).toEqual({ queued: 1, sent: 0, skipped: 0, failed: 1 });
      const notification = testDb.db.select().from(notificationOutbox).get();
      expect(notification?.status).toBe("failed");
      expect(notification?.lastError).toBe("Provider unavailable");
      expect(testDb.db.select().from(searchAlertDigestRuns).all()).toEqual([
        expect.objectContaining({
          alertId: "alert_email",
          status: "failed",
          failureReason: "Provider unavailable",
          notificationId: notification?.id,
        }),
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("marks outbox rows failed when the provider throws", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db
        .insert(users)
        .values({
          id: "user_email",
          email: "buyer@example.com",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();
      testDb.db
        .insert(alerts)
        .values({
          id: "alert_email",
          userId: "user_email",
          name: "Cloud alerts",
          query: JSON.stringify({ q: "cloud" }),
          frequency: "daily",
          notificationChannel: "email",
          isEnabled: 1,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();

      const provider = {
        send: vi.fn().mockRejectedValue(new Error("Provider crashed")),
      };
      const result = await sendMatchedAlertNotifications(
        testDb.db,
        {
          evaluatedAlerts: 1,
          matchedAlerts: 1,
          updatedAlerts: 1,
          matches: [
            {
              alertId: "alert_email",
              userId: "user_email",
              alertName: "Cloud alerts",
              frequency: "daily",
              notificationChannel: "email",
              bidIds: ["bid_1"],
              bids: [],
              query: { q: "cloud" },
            },
          ],
        },
        provider,
        { now: "2026-05-19T12:00:00.000Z" },
      );

      expect(result).toEqual({ queued: 1, sent: 0, skipped: 0, failed: 1 });
      const notification = testDb.db.select().from(notificationOutbox).get();
      expect(notification?.status).toBe("failed");
      expect(notification?.lastError).toBe("Provider crashed");
      expect(testDb.db.select().from(searchAlertDigestRuns).all()).toEqual([
        expect.objectContaining({
          alertId: "alert_email",
          status: "failed",
          failureReason: "Provider crashed",
          notificationId: notification?.id,
        }),
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("skips matched alert email when the user disables saved search notifications", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db
        .insert(users)
        .values({
          id: "user_email",
          email: "buyer@example.com",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();
      testDb.db
        .insert(alerts)
        .values({
          id: "alert_email",
          userId: "user_email",
          name: "Cloud alerts",
          query: JSON.stringify({ q: "cloud" }),
          frequency: "daily",
          notificationChannel: "email",
          isEnabled: 1,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();
      updateAccountNotificationPreferences(testDb.db, "user_email", {
        savedSearchAlertsEnabled: false,
      });

      const provider = {
        send: vi.fn().mockResolvedValue({ ok: true }),
      };
      const result = await sendMatchedAlertNotifications(
        testDb.db,
        {
          evaluatedAlerts: 1,
          matchedAlerts: 1,
          updatedAlerts: 1,
          matches: [
            {
              alertId: "alert_email",
              userId: "user_email",
              alertName: "Cloud alerts",
              frequency: "daily",
              notificationChannel: "email",
              bidIds: ["bid_1"],
              bids: [],
              query: { q: "cloud" },
            },
          ],
        },
        provider,
        { now: "2026-05-19T12:00:00.000Z" },
      );

      expect(result).toEqual({ queued: 0, sent: 0, skipped: 1, failed: 0 });
      expect(provider.send).not.toHaveBeenCalled();
      expect(testDb.db.select().from(notificationOutbox).all()).toHaveLength(0);
      expect(testDb.db.select().from(searchAlertDigestRuns).all()).toEqual([
        expect.objectContaining({
          alertId: "alert_email",
          status: "skipped",
          skippedReason: "notifications_disabled",
          matchCount: 1,
        }),
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("records skipped digest history when a matched alert cannot resolve a recipient", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db
        .insert(alerts)
        .values({
          id: "alert_no_email",
          userId: "anon_seed",
          name: "Cloud alerts",
          query: JSON.stringify({ q: "cloud" }),
          frequency: "daily",
          isEnabled: 1,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        })
        .run();

      const provider = { send: vi.fn() };
      await sendMatchedAlertNotifications(
        testDb.db,
        {
          evaluatedAlerts: 1,
          matchedAlerts: 1,
          updatedAlerts: 1,
          matches: [
            {
              alertId: "alert_no_email",
              userId: "anon_seed",
              alertName: "Cloud alerts",
              frequency: "daily",
              notificationChannel: "email",
              bidIds: ["bid_1"],
              bids: [],
              query: { q: "cloud" },
            },
          ],
        },
        provider,
        { now: "2026-05-19T12:00:00.000Z" },
      );

      expect(testDb.db.select().from(searchAlertDigestRuns).all()).toEqual([
        expect.objectContaining({
          alertId: "alert_no_email",
          status: "skipped",
          skippedReason: "missing_recipient",
          matchCount: 1,
          matchedBidIdsJson: JSON.stringify(["bid_1"]),
        }),
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("enqueues, sends, records digest history, and updates alert notification time through MySQL", async () => {
    const mysql = createFakeMysqlNotificationStore();
    const provider = { send: vi.fn().mockResolvedValue({ ok: true, providerMessageId: "mysql:1" }) };

    const result = await sendMatchedAlertNotificationsFromMysql(
      mysql,
      {
        evaluatedAlerts: 1,
        matchedAlerts: 1,
        updatedAlerts: 1,
        matches: [
          {
            alertId: "alert_mysql",
            userId: "user_mysql",
            alertName: "MySQL Cloud alerts",
            frequency: "daily",
            notificationChannel: "email",
            bidIds: ["mysql_bid_1"],
            bids: [
              {
                id: "mysql_bid_1",
                title: "Cloud modernization",
                issuerName: "California Agency",
                sourceUrl: "https://example.com/mysql-bid-1",
                deadlineDate: "2026-06-30",
              },
            ],
            query: { q: "cloud" },
          },
        ],
      },
      provider,
      { now: "2026-06-01T12:00:00.000Z" },
    );

    expect(result).toEqual({ queued: 1, sent: 1, skipped: 0, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(mysql.outbox[0]).toMatchObject({
      alertId: "alert_mysql",
      userId: "user_mysql",
      recipient: "buyer@example.com",
      status: "sent",
      attemptCount: 1,
    });
    expect(mysql.digestRuns).toEqual([
      expect.objectContaining({
        alertId: "alert_mysql",
        userId: "user_mysql",
        status: "sent",
        matchCount: 1,
        matchedBidIdsJson: JSON.stringify(["mysql_bid_1"]),
      }),
    ]);
    expect(mysql.alerts.get("alert_mysql")?.lastNotifiedAt).toBe("2026-06-01T12:00:00.000Z");
  });
});

function createFakeMysqlNotificationStore() {
  const users = new Map([
    ["user_mysql", { id: "user_mysql", email: "buyer@example.com" }],
  ]);
  const preferences = new Map([
    [
      "user_mysql",
      {
        userId: "user_mysql",
        savedSearchAlertsEnabled: 1,
        defaultAlertFrequency: "daily",
        marketingUpdatesEnabled: 0,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
  ]);
  const alerts = new Map([
    ["alert_mysql", { id: "alert_mysql", lastNotifiedAt: null as string | null, updatedAt: null as string | null }],
  ]);
  const outbox: Record<string, unknown>[] = [];
  const digestRuns: Record<string, unknown>[] = [];

  return {
    users,
    preferences,
    alerts,
    outbox,
    digestRuns,
    execute: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("INSERT INTO notification_outbox")) {
        const existing = outbox.find((row) => row.dedupeKey === values[6]);
        if (!existing) {
          outbox.push({
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
            status: values[10],
            attemptCount: values[11],
            lastError: null,
            createdAt: values[12],
            sentAt: null,
          });
        }
      }

      if (sql.includes("SET status = 'sent'")) {
        const row = outbox.find((item) => item.id === values[1]);
        if (row) {
          row.status = "sent";
          row.sentAt = values[0];
          row.lastError = null;
          row.attemptCount = Number(row.attemptCount) + 1;
        }
      }

      if (sql.includes("SET status = 'failed'")) {
        const row = outbox.find((item) => item.id === values[1]);
        if (row) {
          row.status = "failed";
          row.lastError = values[0];
          row.attemptCount = Number(row.attemptCount) + 1;
        }
      }

      if (sql.includes("INSERT INTO search_alert_digest_runs")) {
        digestRuns.push({
          id: values[0],
          alertId: values[1],
          userId: values[2],
          frequency: values[3],
          status: values[4],
          matchCount: values[5],
          notificationId: values[6],
          skippedReason: values[7],
          failureReason: values[8],
          matchedBidIdsJson: values[9],
          createdAt: values[10],
        });
      }

      if (sql.includes("UPDATE alerts SET last_notified_at")) {
        const alert = alerts.get(String(values[2]));
        if (alert) {
          alert.lastNotifiedAt = String(values[0]);
          alert.updatedAt = String(values[1]);
        }
      }

      return [{ affectedRows: 1 }, undefined];
    }),
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM users")) {
        const user = users.get(String(values[0]));
        return [user ? [{ email: user.email }] : [], undefined];
      }

      if (sql.includes("FROM user_notification_preferences")) {
        const row = preferences.get(String(values[0]));
        return [row ? [row] : [], undefined];
      }

      if (sql.includes("FROM notification_outbox") && sql.includes("WHERE dedupe_key = ?")) {
        return [[outbox.find((row) => row.dedupeKey === values[0])].filter(Boolean), undefined];
      }

      if (sql.includes("FROM notification_outbox") && sql.includes("WHERE id = ?")) {
        return [[outbox.find((row) => row.id === values[0])].filter(Boolean), undefined];
      }

      if (sql.includes("FROM search_alert_digest_runs") && sql.includes("WHERE id = ?")) {
        return [[digestRuns.find((row) => row.id === values[0])].filter(Boolean), undefined];
      }

      return [[], undefined];
    }),
  };
}
