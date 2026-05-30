import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getAccountNotificationPreferences } from "@/server/account/notification-preferences";
import type { AppDatabase } from "@/server/db/client";
import { alerts, users } from "@/server/db/schema";
import type { SearchAlertMatchResult } from "@/server/search-alerts/matcher";
import { recordSearchAlertDigestRun } from "@/server/search-alerts/digest-history";
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

function digestRunId() {
  return `digest_run_${randomUUID()}`;
}

function recordDigestRun(
  db: AppDatabase,
  match: MatchedAlertNotification,
  input: {
    status: "queued" | "sent" | "failed" | "skipped";
    now: string;
    notificationId?: string | null;
    skippedReason?: "unsupported_channel" | "missing_recipient" | "notifications_disabled" | "duplicate_digest";
    failureReason?: string | null;
  },
) {
  recordSearchAlertDigestRun(db, {
    id: digestRunId(),
    alertId: match.alertId,
    userId: match.userId,
    frequency: match.frequency,
    status: input.status,
    matchCount: match.bidIds.length,
    notificationId: input.notificationId ?? null,
    skippedReason: input.skippedReason ?? null,
    failureReason: input.failureReason ?? null,
    matchedBidIds: match.bidIds,
    createdAt: input.now,
  });
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
      recordDigestRun(db, match, {
        status: "skipped",
        now,
        skippedReason: "unsupported_channel",
      });
      result.skipped += 1;
      continue;
    }

    const email = findUserEmail(db, match.userId);
    if (!email) {
      recordDigestRun(db, match, {
        status: "skipped",
        now,
        skippedReason: "missing_recipient",
      });
      result.skipped += 1;
      continue;
    }

    if (!getAccountNotificationPreferences(db, match.userId).savedSearchAlertsEnabled) {
      recordDigestRun(db, match, {
        status: "skipped",
        now,
        skippedReason: "notifications_disabled",
      });
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
      recordDigestRun(db, match, {
        status: "skipped",
        now,
        notificationId: enqueueResult.notification.id,
        skippedReason: "duplicate_digest",
      });
      result.skipped += 1;
      continue;
    }

    result.queued += 1;
    const notification = enqueueResult.notification;
    const sendResult = await provider
      .send({
        id: notification.id,
        channel: notification.channel,
        recipient: notification.recipient,
        subject: notification.subject,
        bodyText: notification.bodyText,
        dedupeKey: notification.dedupeKey,
        matchedBidIds: notification.matchedBidIds,
      })
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : "Notification provider threw an unknown error",
      }));

    if (sendResult.ok) {
      markNotificationSent(db, notification.id, now);
      recordDigestRun(db, match, {
        status: "sent",
        now,
        notificationId: notification.id,
      });
      db.update(alerts)
        .set({ lastNotifiedAt: now, updatedAt: now })
        .where(eq(alerts.id, match.alertId))
        .run();
      result.sent += 1;
    } else {
      markNotificationFailed(db, notification.id, sendResult.error, now);
      recordDigestRun(db, match, {
        status: "failed",
        now,
        notificationId: notification.id,
        failureReason: sendResult.error,
      });
      result.failed += 1;
    }
  }

  return result;
}
