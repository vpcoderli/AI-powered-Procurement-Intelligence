import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { notificationOutbox } from "@/server/db/schema";
import { recordSearchAlertDigestRun } from "@/server/search-alerts/digest-history";
import {
  listDeliverableNotifications,
  markNotificationFailed,
  markNotificationSent,
} from "./outbox-repository";
import { createNotificationProvider } from "./provider";
import type { NotificationOutboxRow, NotificationProvider } from "./types";

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

function recordDigestRunFromNotification(
  db: AppDatabase,
  notification: NotificationOutboxRow,
  input: { status: "sent" | "failed"; now: string; failureReason?: string | null },
) {
  if (notification.matchedBidIds.length === 0) return;

  recordSearchAlertDigestRun(db, {
    id: `digest_run_${randomUUID()}`,
    alertId: notification.alertId,
    userId: notification.userId,
    frequency: notification.frequency,
    status: input.status,
    matchCount: notification.matchedBidIds.length,
    notificationId: notification.id,
    failureReason: input.failureReason ?? null,
    matchedBidIds: notification.matchedBidIds,
    createdAt: input.now,
  });
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
        recordDigestRunFromNotification(db, notification, { status: "sent", now });
        result.sent += 1;
      } else {
        markNotificationFailed(db, notification.id, sendResult.error, now);
        recordDigestRunFromNotification(db, notification, {
          status: "failed",
          now,
          failureReason: sendResult.error,
        });
        result.failed += 1;
      }
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "Notification provider threw an unknown error";
      markNotificationFailed(
        db,
        notification.id,
        failureReason,
        now,
      );
      recordDigestRunFromNotification(db, notification, {
        status: "failed",
        now,
        failureReason,
      });
      result.failed += 1;
    }
  }

  result.skipped = Math.max(0, candidateCount - deliverable.length);

  return result;
}
