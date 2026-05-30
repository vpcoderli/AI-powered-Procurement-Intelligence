import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { updateAccountNotificationPreferences } from "@/server/account/notification-preferences";
import { alerts, notificationOutbox, searchAlertDigestRuns, users } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { sendMatchedAlertNotifications } from "./service";

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
});
