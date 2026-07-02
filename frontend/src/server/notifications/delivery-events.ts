/**
 * Shared parsing/application logic for provider bounce/complaint/delivery
 * webhooks (SES via SNS, SendGrid Event Webhook).
 *
 * Both webhook routes under `frontend/src/app/api/notifications/webhooks/`
 * delegate here so the SQLite/MySQL dual-path handling and the
 * `notification_outbox` update semantics live in one place, matching the
 * existing convention of keeping DB access out of `app/api/**` route files
 * (see `@/server/notifications/outbox-repository.ts`,
 * `@/server/billing/subscriptions.ts`).
 */
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import {
  recordNotificationDeliveryEvent,
  recordNotificationDeliveryEventFromMysql,
  type NotificationDeliveryEventKind,
} from "./outbox-repository";

export interface NormalizedDeliveryEvent {
  /** `notification_outbox.id`, correlated via the provider's message tag/custom arg. */
  notificationId: string;
  kind: NotificationDeliveryEventKind;
  detail: string;
  observedAt: string;
}

export interface ApplyDeliveryEventsResult {
  applied: number;
  skipped: number;
  notFound: number;
}

export async function applyNotificationDeliveryEvents(
  db: AppDatabase,
  events: NormalizedDeliveryEvent[],
): Promise<ApplyDeliveryEventsResult> {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const result: ApplyDeliveryEventsResult = { applied: 0, skipped: 0, notFound: 0 };

  for (const event of events) {
    if (!event.notificationId) {
      result.skipped += 1;
      continue;
    }

    const row = mysql
      ? await recordNotificationDeliveryEventFromMysql(
          mysql,
          event.notificationId,
          event.kind,
          event.detail,
          event.observedAt,
        )
      : recordNotificationDeliveryEvent(db, event.notificationId, event.kind, event.detail, event.observedAt);

    if (!row) {
      result.notFound += 1;
      continue;
    }

    result.applied += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// SES / SNS parsing
// ---------------------------------------------------------------------------

interface SesMailTag {
  apsi_notification_id?: string[];
}

interface SesBounceMessage {
  notificationType: "Bounce";
  bounce: {
    bounceType: string;
    bounceSubType: string;
    timestamp: string;
    bouncedRecipients: Array<{ emailAddress: string; diagnosticCode?: string }>;
  };
  mail: { tags?: SesMailTag };
}

interface SesComplaintMessage {
  notificationType: "Complaint";
  complaint: {
    complaintFeedbackType?: string;
    timestamp?: string;
    complainedRecipients: Array<{ emailAddress: string }>;
  };
  mail: { tags?: SesMailTag };
}

interface SesDeliveryMessage {
  notificationType: "Delivery";
  delivery: { timestamp: string };
  mail: { tags?: SesMailTag };
}

type SesEventMessage = SesBounceMessage | SesComplaintMessage | SesDeliveryMessage;

export interface SnsEnvelope {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string;
  SubscribeURL?: string;
  Timestamp?: string;
}

export function isSnsSubscriptionConfirmation(envelope: SnsEnvelope) {
  return envelope.Type === "SubscriptionConfirmation";
}

function notificationIdFromTags(tags: SesMailTag | undefined) {
  return tags?.apsi_notification_id?.[0] ?? "";
}

/**
 * Parses an SES event delivered inside an SNS `Notification` envelope into
 * zero or one normalized delivery events. Unknown/unsupported
 * `notificationType` values are ignored (returns `null`) rather than
 * throwing, since SES/SNS may add new notification types over time.
 */
export function parseSesSnsNotification(envelope: SnsEnvelope): NormalizedDeliveryEvent | null {
  if (envelope.Type !== "Notification" || !envelope.Message) return null;

  let message: SesEventMessage;
  try {
    message = JSON.parse(envelope.Message) as SesEventMessage;
  } catch {
    return null;
  }

  if (message.notificationType === "Bounce") {
    const notificationId = notificationIdFromTags(message.mail?.tags);
    const recipient = message.bounce.bouncedRecipients[0];
    return {
      notificationId,
      kind: "bounce",
      detail: `${message.bounce.bounceType}/${message.bounce.bounceSubType}${
        recipient?.diagnosticCode ? `: ${recipient.diagnosticCode}` : ""
      }`,
      observedAt: message.bounce.timestamp ?? new Date().toISOString(),
    };
  }

  if (message.notificationType === "Complaint") {
    const notificationId = notificationIdFromTags(message.mail?.tags);
    return {
      notificationId,
      kind: "complaint",
      detail: message.complaint.complaintFeedbackType ?? "unspecified",
      observedAt: message.complaint.timestamp ?? new Date().toISOString(),
    };
  }

  if (message.notificationType === "Delivery") {
    const notificationId = notificationIdFromTags(message.mail?.tags);
    return {
      notificationId,
      kind: "delivered",
      detail: "delivered",
      observedAt: message.delivery.timestamp ?? new Date().toISOString(),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// SendGrid Event Webhook parsing
// ---------------------------------------------------------------------------

interface SendgridEvent {
  event: string;
  timestamp?: number;
  reason?: string;
  type?: string;
  apsi_notification_id?: string;
}

const SENDGRID_KIND_MAP: Record<string, NotificationDeliveryEventKind | undefined> = {
  bounce: "bounce",
  blocked: "bounce",
  dropped: "bounce",
  spamreport: "complaint",
  delivered: "delivered",
};

export function parseSendgridEvents(body: unknown): NormalizedDeliveryEvent[] {
  if (!Array.isArray(body)) return [];

  const events: NormalizedDeliveryEvent[] = [];

  for (const entry of body) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as SendgridEvent;
    const kind = SENDGRID_KIND_MAP[raw.event];
    if (!kind) continue;

    events.push({
      notificationId: raw.apsi_notification_id ?? "",
      kind,
      detail: raw.reason ?? raw.type ?? raw.event,
      observedAt: raw.timestamp ? new Date(raw.timestamp * 1000).toISOString() : new Date().toISOString(),
    });
  }

  return events;
}
