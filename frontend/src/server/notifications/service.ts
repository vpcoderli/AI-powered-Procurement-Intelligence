import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getAccountNotificationPreferences } from "@/server/account/notification-preferences";
import type { AppDatabase } from "@/server/db/client";
import { alerts, users } from "@/server/db/schema";
import type { SearchAlertMatchResult } from "@/server/search-alerts/matcher";
import { enqueueNotification, markNotificationFailed, markNotificationSent } from "./outbox-repository";
import { createNotificationProvider } from "./provider";
import { renderAlertDigestNotification } from "./renderer";
import type {
  MatchedAlertNotification,
  NotificationProvider,
  SendMatchedAlertNotificationResult,
} from "./types";

export interface SendMatchedAlertNotificationOptions {
  now?: string;
}

function notificationDateKey(match: MatchedAlertNotification, now: string) {
  const date = now.slice(0, 10);

  if (match.frequency === "weekly") {
    const year = new Date(now).getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const day = Date.UTC(year, new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    const week = Math.ceil(((day - start) / 86_400_000 + new Date(start).getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }

  return date;
}

function dedupeKey(match: MatchedAlertNotification, now: string) {
  return [match.alertId, notificationDateKey(match, now), match.notificationChannel].join(":");
}

function findUserEmail(db: AppDatabase, userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();
  return user?.email?.trim() || null;
}

export async function sendMatchedAlertNotifications(
  db: AppDatabase,
  matchResult: SearchAlertMatchResult,
  provider: NotificationProvider = createNotificationProvider(),
  options: SendMatchedAlertNotificationOptions = {},
): Promise<SendMatchedAlertNotificationResult> {
  const now = options.now ?? new Date().toISOString();
  const result = { queued: 0, sent: 0, skipped: 0, failed: 0 };

  for (const match of matchResult.matches) {
    if (match.notificationChannel !== "email") {
      result.skipped += 1;
      continue;
    }

    const email = findUserEmail(db, match.userId);
    if (!email) {
      result.skipped += 1;
      continue;
    }

    if (!getAccountNotificationPreferences(db, match.userId).savedSearchAlertsEnabled) {
      result.skipped += 1;
      continue;
    }

    const rendered = renderAlertDigestNotification({
      alertName: match.alertName,
      frequency: match.frequency,
      bids: match.bids,
    });
    const enqueueResult = enqueueNotification(db, {
      id: `notification_${randomUUID()}`,
      alertId: match.alertId,
      userId: match.userId,
      channel: match.notificationChannel,
      recipient: email,
      frequency: match.frequency,
      dedupeKey: dedupeKey(match, now),
      subject: rendered.subject,
      bodyText: rendered.bodyText,
      matchedBidIds: match.bidIds,
      createdAt: now,
    });

    if (!enqueueResult.created) {
      result.skipped += 1;
      continue;
    }

    result.queued += 1;
    const notification = enqueueResult.notification;
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
      db.update(alerts)
        .set({ lastNotifiedAt: now, updatedAt: now })
        .where(eq(alerts.id, match.alertId))
        .run();
      result.sent += 1;
    } else {
      markNotificationFailed(db, notification.id, sendResult.error, now);
      result.failed += 1;
    }
  }

  return result;
}
