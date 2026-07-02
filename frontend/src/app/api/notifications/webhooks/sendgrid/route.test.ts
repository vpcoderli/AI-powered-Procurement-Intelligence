import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { enqueueNotification, markNotificationSent } from "@/server/notifications/outbox-repository";
import type { NotificationOutboxInput } from "@/server/notifications/types";
import { createSendgridWebhookHandler } from "./route";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

function sign(timestamp: string, rawBody: string) {
  const signer = createSign("SHA256");
  signer.update(timestamp + rawBody, "utf8");
  return signer.sign(privateKey, "base64");
}

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

function signedRequest(rawBody: string) {
  const timestamp = "1747620000";
  const signature = sign(timestamp, rawBody);

  return new Request("http://localhost/api/notifications/webhooks/sendgrid", {
    method: "POST",
    headers: {
      "x-twilio-email-event-webhook-signature": signature,
      "x-twilio-email-event-webhook-timestamp": timestamp,
    },
    body: rawBody,
  });
}

describe("POST /api/notifications/webhooks/sendgrid", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unsigned requests when a verification key is configured", async () => {
    vi.stubEnv("NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY", publicKeyBase64);
    const testDb = await createTestDatabase();

    try {
      const POST = createSendgridWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/sendgrid", {
          method: "POST",
          body: JSON.stringify([{ event: "bounce" }]),
        }),
      );

      expect(response.status).toBe(401);
    } finally {
      await testDb.cleanup();
    }
  });

  it("requires a verification key in production even if none is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const testDb = await createTestDatabase();

    try {
      const POST = createSendgridWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/sendgrid", {
          method: "POST",
          body: JSON.stringify([{ event: "bounce" }]),
        }),
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_SIGNATURE");
    } finally {
      await testDb.cleanup();
    }
  });

  it("accepts a signed request and applies bounce/complaint events", async () => {
    vi.stubEnv("NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY", publicKeyBase64);
    const testDb = await createTestDatabase();

    try {
      enqueueNotification(testDb.db, input);
      markNotificationSent(testDb.db, "notification_1", "2026-05-19T01:00:00.000Z");

      const rawBody = JSON.stringify([
        { event: "bounce", reason: "mailbox full", apsi_notification_id: "notification_1" },
        { event: "open", apsi_notification_id: "notification_1" },
      ]);

      const POST = createSendgridWebhookHandler(testDb.db);
      const response = await POST(signedRequest(rawBody));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ applied: 1, skipped: 0, notFound: 0 });
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects a tampered signed body", async () => {
    vi.stubEnv("NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY", publicKeyBase64);
    const testDb = await createTestDatabase();

    try {
      const rawBody = JSON.stringify([{ event: "bounce", apsi_notification_id: "notification_1" }]);
      const timestamp = "1747620000";
      const signature = sign(timestamp, rawBody);
      const tamperedBody = JSON.stringify([{ event: "delivered", apsi_notification_id: "notification_1" }]);

      const POST = createSendgridWebhookHandler(testDb.db);
      const response = await POST(
        new Request("http://localhost/api/notifications/webhooks/sendgrid", {
          method: "POST",
          headers: {
            "x-twilio-email-event-webhook-signature": signature,
            "x-twilio-email-event-webhook-timestamp": timestamp,
          },
          body: tamperedBody,
        }),
      );

      expect(response.status).toBe(401);
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects a non-array request body", async () => {
    vi.stubEnv("NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY", publicKeyBase64);
    const testDb = await createTestDatabase();

    try {
      const rawBody = JSON.stringify({ event: "bounce" });
      const POST = createSendgridWebhookHandler(testDb.db);
      const response = await POST(signedRequest(rawBody));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    } finally {
      await testDb.cleanup();
    }
  });
});
