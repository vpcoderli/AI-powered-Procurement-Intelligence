import { describe, expect, it } from "vitest";
import {
  applyNotificationDeliveryEvents,
  isSnsSubscriptionConfirmation,
  parseSendgridEvents,
  parseSesSnsNotification,
} from "./delivery-events";
import { enqueueNotification, markNotificationSent } from "./outbox-repository";
import { createTestDatabase } from "@/server/db/test-utils";
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

describe("parseSesSnsNotification", () => {
  it("parses a bounce notification and correlates it via the message tag", () => {
    const envelope = {
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Bounce",
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          timestamp: "2026-05-19T02:00:00.000Z",
          bouncedRecipients: [{ emailAddress: "buyer@example.com", diagnosticCode: "smtp; 550 5.1.1" }],
        },
        mail: { tags: { apsi_notification_id: ["notification_1"] } },
      }),
    };

    expect(parseSesSnsNotification(envelope)).toEqual({
      notificationId: "notification_1",
      kind: "bounce",
      detail: "Permanent/General: smtp; 550 5.1.1",
      observedAt: "2026-05-19T02:00:00.000Z",
    });
  });

  it("parses a complaint notification", () => {
    const envelope = {
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Complaint",
        complaint: {
          complaintFeedbackType: "abuse",
          timestamp: "2026-05-19T02:00:00.000Z",
          complainedRecipients: [{ emailAddress: "buyer@example.com" }],
        },
        mail: { tags: { apsi_notification_id: ["notification_1"] } },
      }),
    };

    expect(parseSesSnsNotification(envelope)).toEqual({
      notificationId: "notification_1",
      kind: "complaint",
      detail: "abuse",
      observedAt: "2026-05-19T02:00:00.000Z",
    });
  });

  it("parses a delivery notification", () => {
    const envelope = {
      Type: "Notification",
      Message: JSON.stringify({
        notificationType: "Delivery",
        delivery: { timestamp: "2026-05-19T01:30:00.000Z" },
        mail: { tags: { apsi_notification_id: ["notification_1"] } },
      }),
    };

    expect(parseSesSnsNotification(envelope)).toEqual({
      notificationId: "notification_1",
      kind: "delivered",
      detail: "delivered",
      observedAt: "2026-05-19T01:30:00.000Z",
    });
  });

  it("returns null for non-Notification envelope types", () => {
    expect(parseSesSnsNotification({ Type: "SubscriptionConfirmation" })).toBeNull();
  });

  it("returns null for malformed inner Message JSON", () => {
    expect(parseSesSnsNotification({ Type: "Notification", Message: "{not json" })).toBeNull();
  });

  it("returns null for unknown notificationType values", () => {
    expect(
      parseSesSnsNotification({
        Type: "Notification",
        Message: JSON.stringify({ notificationType: "SomethingNew" }),
      }),
    ).toBeNull();
  });

  it("identifies SubscriptionConfirmation envelopes", () => {
    expect(isSnsSubscriptionConfirmation({ Type: "SubscriptionConfirmation" })).toBe(true);
    expect(isSnsSubscriptionConfirmation({ Type: "Notification" })).toBe(false);
  });
});

describe("parseSendgridEvents", () => {
  it("maps bounce/blocked/dropped to bounce and spamreport to complaint", () => {
    const events = parseSendgridEvents([
      { event: "bounce", reason: "mailbox full", timestamp: 1747620000, apsi_notification_id: "notification_1" },
      { event: "blocked", reason: "blocked by isp", timestamp: 1747620001, apsi_notification_id: "notification_2" },
      { event: "dropped", reason: "invalid", timestamp: 1747620002, apsi_notification_id: "notification_3" },
      { event: "spamreport", timestamp: 1747620003, apsi_notification_id: "notification_4" },
      { event: "delivered", timestamp: 1747620004, apsi_notification_id: "notification_5" },
    ]);

    expect(events).toEqual([
      {
        notificationId: "notification_1",
        kind: "bounce",
        detail: "mailbox full",
        observedAt: new Date(1747620000 * 1000).toISOString(),
      },
      {
        notificationId: "notification_2",
        kind: "bounce",
        detail: "blocked by isp",
        observedAt: new Date(1747620001 * 1000).toISOString(),
      },
      {
        notificationId: "notification_3",
        kind: "bounce",
        detail: "invalid",
        observedAt: new Date(1747620002 * 1000).toISOString(),
      },
      {
        notificationId: "notification_4",
        kind: "complaint",
        detail: "spamreport",
        observedAt: new Date(1747620003 * 1000).toISOString(),
      },
      {
        notificationId: "notification_5",
        kind: "delivered",
        detail: "delivered",
        observedAt: new Date(1747620004 * 1000).toISOString(),
      },
    ]);
  });

  it("ignores event types this app does not act on (e.g. open, click, processed)", () => {
    expect(parseSendgridEvents([{ event: "open" }, { event: "click" }, { event: "processed" }])).toEqual([]);
  });

  it("returns an empty array for a non-array body", () => {
    expect(parseSendgridEvents({ event: "bounce" })).toEqual([]);
    expect(parseSendgridEvents(null)).toEqual([]);
  });
});

describe("applyNotificationDeliveryEvents", () => {
  it("applies bounce events to matching rows and reports notFound for unmatched ids", async () => {
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      markNotificationSent(testDb.db, "notification_1", "2026-05-19T01:00:00.000Z");

      const result = await applyNotificationDeliveryEvents(testDb.db, [
        { notificationId: "notification_1", kind: "bounce", detail: "Permanent", observedAt: "2026-05-19T02:00:00.000Z" },
        { notificationId: "notification_missing", kind: "bounce", detail: "Permanent", observedAt: "2026-05-19T02:00:00.000Z" },
        { notificationId: "", kind: "bounce", detail: "Permanent", observedAt: "2026-05-19T02:00:00.000Z" },
      ]);

      expect(result).toEqual({ applied: 1, skipped: 1, notFound: 1 });
    } finally {
      await testDb.cleanup();
    }
  });
});
