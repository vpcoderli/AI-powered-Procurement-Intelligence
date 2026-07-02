import { NextResponse } from "next/server";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured } from "@/server/db/mysql";
import { applyNotificationDeliveryEvents, isSnsSubscriptionConfirmation, parseSesSnsNotification, type SnsEnvelope } from "@/server/notifications/delivery-events";
import { SnsSignatureVerificationError, verifySnsSignature } from "@/server/notifications/ses-sns-verification";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

function skipSignatureVerification() {
  // Local/integration testing only against unsigned SNS fixture payloads.
  // The route refuses this bypass whenever NODE_ENV=production, regardless
  // of the env var, so a misconfigured deploy cannot silently disable
  // verification.
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NOTIFICATION_SES_SNS_SKIP_SIGNATURE_VERIFICATION === "1"
  );
}

/**
 * Handles the SES bounce/complaint/delivery notification pipeline delivered
 * via SNS: SES -> SNS topic -> HTTPS subscription -> this route.
 *
 * SNS subscription lifecycle:
 *   - `SubscriptionConfirmation`: SNS sends this once when the HTTPS
 *     subscription is created. AWS requires the endpoint to fetch
 *     `SubscribeURL` to complete the handshake; we do that here rather than
 *     requiring a human to click the link. Signature verification still
 *     applies to this message type.
 *   - `Notification`: the actual bounce/complaint/delivery event, parsed by
 *     `parseSesSnsNotification` and applied to the matching
 *     `notification_outbox` row via `applyNotificationDeliveryEvents`.
 *
 * SNS message bodies are `Content-Type: text/plain; charset=UTF-8` even
 * though the body is JSON, so this route parses the raw body itself instead
 * of relying on `request.json()`'s content-type check.
 */
export function createSesWebhookHandler(database?: AppDatabase) {
  return async function POST(request: Request) {
    const rawBody = await request.text();

    let envelope: (SnsEnvelope & Record<string, unknown>) | null;
    try {
      envelope = JSON.parse(rawBody) as SnsEnvelope & Record<string, unknown>;
    } catch {
      envelope = null;
    }

    if (!envelope || typeof envelope !== "object") {
      return errorResponse("INVALID_REQUEST", "Request body must be a JSON SNS envelope", 400);
    }

    if (!skipSignatureVerification()) {
      try {
        await verifySnsSignature(envelope);
      } catch (error) {
        if (error instanceof SnsSignatureVerificationError) {
          return errorResponse("INVALID_SIGNATURE", error.message, 401);
        }
        return errorResponse("INVALID_SIGNATURE", "SNS signature verification failed", 401);
      }
    }

    if (isSnsSubscriptionConfirmation(envelope)) {
      const subscribeUrl = envelope.SubscribeURL as string | undefined;
      if (subscribeUrl) {
        try {
          await fetch(subscribeUrl);
        } catch {
          // Confirmation fetch failures are surfaced to SNS via CloudWatch
          // on their side; retry by re-delivering the confirmation message.
          return errorResponse("SUBSCRIPTION_CONFIRMATION_FAILED", "Failed to confirm SNS subscription", 502);
        }
      }

      return NextResponse.json({ confirmed: true });
    }

    const event = parseSesSnsNotification(envelope);
    if (!event) {
      // Unknown/unsupported notification type (or a malformed inner
      // Message). Acknowledge with 200 so SNS does not retry indefinitely;
      // there is nothing actionable to apply.
      return NextResponse.json({ applied: 0, skipped: 1, notFound: 0 });
    }

    const resolvedDb = await resolveDatabase(database);
    const result = await applyNotificationDeliveryEvents(resolvedDb, [event]);

    return NextResponse.json(result);
  };
}

export const POST = createSesWebhookHandler();
