import type { AppDatabase } from "@/server/db/client";
import { notificationOutbox } from "@/server/db/schema";
import {
  listDeliverableNotifications,
  markNotificationFailed,
  markNotificationSent,
} from "./outbox-repository";
import { createNotificationProvider } from "./provider";
import type { NotificationProvider } from "./types";

export interface NotificationDeliveryOptions {
  now?: string;
  limit?: number;
  maxAttempts?: number;
}

export interface NotificationDeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function deliverPendingNotifications(
  db: AppDatabase,
  provider: NotificationProvider = createNotificationProvider(),
  options: NotificationDeliveryOptions = {},
): Promise<NotificationDeliveryResult> {
  const now = options.now ?? new Date().toISOString();
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const deliverable = listDeliverableNotifications(db, {
    limit: options.limit,
    maxAttempts,
  });
  const candidateCount = db
    .select()
    .from(notificationOutbox)
    .all()
    .filter((row) => row.status === "pending" || row.status === "failed").length;
  const result: NotificationDeliveryResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  for (const notification of deliverable) {
    result.attempted += 1;

    try {
      const sendResult = await provider.send({
        id: notification.id,
        channel: notification.channel,
        recipient: notification.recipient,
        subject: notification.subject,
        bodyText: notification.bodyText,
        dedupeKey: notification.dedupeKey,
        matchedBidIds: notification.matchedBidIds,
      });

      if (sendResult.ok) {
        markNotificationSent(db, notification.id, now);
        result.sent += 1;
      } else {
        markNotificationFailed(db, notification.id, sendResult.error, now);
        result.failed += 1;
      }
    } catch (error) {
      markNotificationFailed(
        db,
        notification.id,
        error instanceof Error ? error.message : "Notification provider threw an unknown error",
        now,
      );
      result.failed += 1;
    }
  }

  result.skipped = Math.max(0, candidateCount - deliverable.length);

  return result;
}
