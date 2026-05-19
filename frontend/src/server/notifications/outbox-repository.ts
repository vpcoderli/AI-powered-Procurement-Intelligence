import { eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { notificationOutbox } from "@/server/db/schema";
import type {
  EnqueueNotificationResult,
  NotificationOutboxInput,
  NotificationOutboxRow,
} from "./types";

function toOutboxRow(row: typeof notificationOutbox.$inferSelect): NotificationOutboxRow {
  return {
    id: row.id,
    alertId: row.alertId,
    userId: row.userId,
    channel: row.channel,
    recipient: row.recipient,
    frequency: row.frequency,
    dedupeKey: row.dedupeKey,
    subject: row.subject,
    bodyText: row.bodyText,
    matchedBidIds: JSON.parse(row.matchedBidIds) as string[],
    status: row.status,
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

function findByDedupeKey(db: AppDatabase, dedupeKey: string) {
  return db
    .select()
    .from(notificationOutbox)
    .where(eq(notificationOutbox.dedupeKey, dedupeKey))
    .limit(1)
    .get();
}

function findById(db: AppDatabase, id: string) {
  return db
    .select()
    .from(notificationOutbox)
    .where(eq(notificationOutbox.id, id))
    .limit(1)
    .get();
}

export function enqueueNotification(
  db: AppDatabase,
  input: NotificationOutboxInput,
): EnqueueNotificationResult {
  const existing = findByDedupeKey(db, input.dedupeKey);

  if (existing) {
    return { created: false, notification: toOutboxRow(existing) };
  }

  db.insert(notificationOutbox)
    .values({
      ...input,
      matchedBidIds: JSON.stringify(input.matchedBidIds),
      status: "pending",
      attemptCount: 0,
    })
    .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
    .run();

  const row = findByDedupeKey(db, input.dedupeKey);

  if (!row) {
    throw new Error("Failed to enqueue notification");
  }

  return { created: row.id === input.id, notification: toOutboxRow(row) };
}

export function markNotificationSent(db: AppDatabase, id: string, sentAt: string) {
  db.update(notificationOutbox)
    .set({
      status: "sent",
      sentAt,
      lastError: null,
      attemptCount: sql`${notificationOutbox.attemptCount} + 1`,
    })
    .where(eq(notificationOutbox.id, id))
    .run();

  const row = findById(db, id);
  if (!row) throw new Error(`Notification not found: ${id}`);
  return toOutboxRow(row);
}

export function markNotificationFailed(
  db: AppDatabase,
  id: string,
  error: string,
  attemptedAt: string,
) {
  db.update(notificationOutbox)
    .set({
      status: "failed",
      sentAt: null,
      lastError: error,
      attemptCount: sql`${notificationOutbox.attemptCount} + 1`,
    })
    .where(eq(notificationOutbox.id, id))
    .run();

  const row = findById(db, id);
  if (!row) throw new Error(`Notification not found: ${id} at ${attemptedAt}`);
  return toOutboxRow(row);
}
