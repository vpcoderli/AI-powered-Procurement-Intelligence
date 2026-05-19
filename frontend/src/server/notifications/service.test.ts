import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { alerts, notificationOutbox, users } from "@/server/db/schema";
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
    } finally {
      await testDb.cleanup();
    }
  });
});
