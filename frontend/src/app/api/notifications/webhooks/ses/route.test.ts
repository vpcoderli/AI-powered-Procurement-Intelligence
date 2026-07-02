import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { enqueueNotification, markNotificationSent } from "@/server/notifications/outbox-repository";
import type { NotificationOutboxInput } from "@/server/notifications/types";
import { createSesWebhookHandler } from "./route";

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

function bounceEnvelope(notificationId: string) {
  return {
    Type: "Notification",
    Message: JSON.stringify({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        timestamp: "2026-05-19T02:00:00.000Z",
        bouncedRecipients: [{ emailAddress: "buyer@example.com" }],
      },
      mail: { tags: { apsi_notification_id: [notificationId] } },
    }),
  };
}

describe("POST /api/notifications/webhooks/ses", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects malformed JSON bodies", async () => {
    vi.stubEnv("NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION", "1");
    const testDb = await createTestDatabase();

    try {
      const POST = createSesWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/ses", {
          method: "POST",
          body: "{not json",
        }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    } finally {
      await testDb.cleanup();
    }
  });

  it("requires a valid signature when verification is not explicitly skipped", async () => {
    const testDb = await createTestDatabase();

    try {
      const POST = createSesWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/ses", {
          method: "POST",
          body: JSON.stringify(bounceEnvelope("notification_1")),
        }),
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_SIGNATURE");
    } finally {
      await testDb.cleanup();
    }
  });

  it("never allows the signature bypass in production even if the env var is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION", "1");
    const testDb = await createTestDatabase();

    try {
      const POST = createSesWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/ses", {
          method: "POST",
          body: JSON.stringify(bounceEnvelope("notification_1")),
        }),
      );

      expect(response.status).toBe(401);
    } finally {
      await testDb.cleanup();
    }
  });

  it("applies a bounce notification to the matching outbox row when verification is skipped", async () => {
    vi.stubEnv("NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION", "1");
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      markNotificationSent(testDb.db, "notification_1", "2026-05-19T01:00:00.000Z");

      const POST = createSesWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/ses", {
          method: "POST",
          body: JSON.stringify(bounceEnvelope("notification_1")),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ applied: 1, skipped: 0, notFound: 0 });
    } finally {
      await testDb.cleanup();
    }
  });

  it("acknowledges unknown notification types without applying anything", async () => {
    vi.stubEnv("NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION", "1");
    const testDb = await createTestDatabase();

    try {
      const POST = createSesWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/ses", {
          method: "POST",
          body: JSON.stringify({
            Type: "Notification",
            Message: JSON.stringify({ notificationType: "SomethingUnexpected" }),
          }),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ applied: 0, skipped: 1, notFound: 0 });
    } finally {
      await testDb.cleanup();
    }
  });

  it("confirms an SNS subscription by fetching SubscribeURL", async () => {
    vi.stubEnv("NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION", "1");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("OK", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const testDb = await createTestDatabase();

    try {
      const POST = createSesWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/ses", {
          method: "POST",
          body: JSON.stringify({
            Type: "SubscriptionConfirmation",
            SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
          }),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ confirmed: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
      );
    } finally {
      vi.unstubAllGlobals();
      await testDb.cleanup();
    }
  });
});
