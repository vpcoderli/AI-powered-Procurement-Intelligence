import { NextResponse } from "next/server";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured } from "@/server/db/mysql";
import { applyNotificationDeliveryEvents, parseSendgridEvents } from "@/server/notifications/delivery-events";
import { SendgridSignatureVerificationError, verifySendgridSignature } from "@/server/notifications/sendgrid-webhook-verification";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

function webhookPublicKey() {
  return process.env.NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY?.trim();
}

function shouldRequireSignature() {
  // Mirrors the billing webhook posture: require a valid signature whenever
  // a verification key is configured, and hard-require one in production
  // regardless of configuration so a missing key fails closed instead of
  // silently accepting unsigned events.
  return Boolean(webhookPublicKey()) || process.env.NODE_ENV === "production";
}

/**
 * Handles the SendGrid Event Webhook for bounce/complaint/delivery events.
 * SendGrid POSTs a JSON array of event objects per delivery (batched);
 * `parseSendgridEvents` filters this down to the event types this app acts
 * on (`bounce`, `blocked`, `dropped` -> bounce; `spamreport` -> complaint;
 * `delivered` -> delivered) and correlates each one back to a
 * `notification_outbox` row via the `apsi_notification_id` custom arg set
 * by `@/server/notifications/providers/sendgrid.ts` at send time.
 */
export function createSendgridWebhookHandler(database?: AppDatabase) {
  return async function POST(request: Request) {
    const rawBody = await request.text();

    if (shouldRequireSignature()) {
      const publicKey = webhookPublicKey();
      if (!publicKey) {
        return errorResponse(
          "INVALID_SIGNATURE",
          "NOTIFICATION_SENDGRID_WEBHOOK_PUBLIC_KEY is required to verify SendGrid webhook signatures",
          401,
        );
      }

      try {
        verifySendgridSignature({
          rawBody,
          signature: request.headers.get("x-twilio-email-event-webhook-signature"),
          timestamp: request.headers.get("x-twilio-email-event-webhook-timestamp"),
          publicKey,
        });
      } catch (error) {
        if (error instanceof SendgridSignatureVerificationError) {
          return errorResponse("INVALID_SIGNATURE", error.message, 401);
        }
        return errorResponse("INVALID_SIGNATURE", "SendGrid signature verification failed", 401);
      }
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }

    if (!Array.isArray(body)) {
      return errorResponse("INVALID_REQUEST", "Request body must be a JSON array of SendGrid events", 400);
    }

    const events = parseSendgridEvents(body);
    const resolvedDb = await resolveDatabase(database);
    const result = await applyNotificationDeliveryEvents(resolvedDb, events);

    return NextResponse.json(result);
  };
}

export const POST = createSendgridWebhookHandler();
