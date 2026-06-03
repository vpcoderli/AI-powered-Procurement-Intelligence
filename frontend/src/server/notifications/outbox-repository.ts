import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { notificationOutbox } from "@/server/db/schema";
import type {
  EnqueueNotificationResult,
  NotificationOutboxInput,
  NotificationOutboxRow,
} from "./types";

interface MysqlNotificationOutboxStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

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

function toOutboxRowFromMysql(row: {
  id: string;
  alertId: string;
  userId: string;
  channel: string;
  recipient: string;
  frequency: string;
  dedupeKey: string;
  subject: string;
  bodyText: string;
  matchedBidIds: string;
  status: string;
  attemptCount: number | string;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}): NotificationOutboxRow {
  return {
    id: row.id,
    alertId: row.alertId,
    userId: row.userId,
    channel: "email",
    recipient: row.recipient,
    frequency: row.frequency === "weekly" ? "weekly" : "daily",
    dedupeKey: row.dedupeKey,
    subject: row.subject,
    bodyText: row.bodyText,
    matchedBidIds: JSON.parse(row.matchedBidIds) as string[],
    status: row.status === "sent" || row.status === "failed" ? row.status : "pending",
    attemptCount: Number(row.attemptCount),
    lastError: row.lastError,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

const mysqlOutboxSelect = `
  SELECT
    id,
    alert_id AS alertId,
    user_id AS userId,
    channel,
    recipient,
    frequency,
    dedupe_key AS dedupeKey,
    subject,
    body_text AS bodyText,
    matched_bid_ids AS matchedBidIds,
    status,
    attempt_count AS attemptCount,
    last_error AS lastError,
    created_at AS createdAt,
    sent_at AS sentAt
  FROM notification_outbox
`;

async function findMysqlByDedupeKey(mysql: Pick<MysqlNotificationOutboxStore, "query">, dedupeKey: string) {
  return mysqlSelectOne<Parameters<typeof toOutboxRowFromMysql>[0]>(
    mysql,
    `${mysqlOutboxSelect} WHERE dedupe_key = ? LIMIT 1`,
    [dedupeKey],
  );
}

async function findMysqlById(mysql: Pick<MysqlNotificationOutboxStore, "query">, id: string) {
  return mysqlSelectOne<Parameters<typeof toOutboxRowFromMysql>[0]>(
    mysql,
    `${mysqlOutboxSelect} WHERE id = ? LIMIT 1`,
    [id],
  );
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
  if (isMysqlDatabaseUrlConfigured()) {
    throw new Error("Use enqueueNotificationFromMysql in MySQL runtime.");
  }

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

export async function enqueueNotificationFromMysql(
  mysql: MysqlNotificationOutboxStore,
  input: NotificationOutboxInput,
): Promise<EnqueueNotificationResult> {
  const existing = await findMysqlByDedupeKey(mysql, input.dedupeKey);

  if (existing) {
    return { created: false, notification: toOutboxRowFromMysql(existing) };
  }

  await mysqlExecute(
    mysql,
    `
      INSERT INTO notification_outbox (
        id,
        alert_id,
        user_id,
        channel,
        recipient,
        frequency,
        dedupe_key,
        subject,
        body_text,
        matched_bid_ids,
        status,
        attempt_count,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key
    `,
    [
      input.id,
      input.alertId,
      input.userId,
      input.channel,
      input.recipient,
      input.frequency,
      input.dedupeKey,
      input.subject,
      input.bodyText,
      JSON.stringify(input.matchedBidIds),
      "pending",
      0,
      input.createdAt,
    ],
  );

  const row = await findMysqlByDedupeKey(mysql, input.dedupeKey);
  if (!row) {
    throw new Error("Failed to enqueue notification");
  }

  return { created: row.id === input.id, notification: toOutboxRowFromMysql(row) };
}

export function markNotificationSent(db: AppDatabase, id: string, sentAt: string) {
  if (isMysqlDatabaseUrlConfigured()) {
    throw new Error("Use markNotificationSentFromMysql in MySQL runtime.");
  }

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

export async function markNotificationSentFromMysql(
  mysql: MysqlNotificationOutboxStore,
  id: string,
  sentAt: string,
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE notification_outbox
      SET status = 'sent', sent_at = ?, last_error = NULL, attempt_count = attempt_count + 1
      WHERE id = ?
    `,
    [sentAt, id],
  );

  const row = await findMysqlById(mysql, id);
  if (!row) throw new Error(`Notification not found: ${id}`);
  return toOutboxRowFromMysql(row);
}

export function markNotificationFailed(
  db: AppDatabase,
  id: string,
  error: string,
  attemptedAt: string,
) {
  if (isMysqlDatabaseUrlConfigured()) {
    throw new Error("Use markNotificationFailedFromMysql in MySQL runtime.");
  }

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

export async function markNotificationFailedFromMysql(
  mysql: MysqlNotificationOutboxStore,
  id: string,
  error: string,
  attemptedAt: string,
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE notification_outbox
      SET status = 'failed', sent_at = NULL, last_error = ?, attempt_count = attempt_count + 1
      WHERE id = ?
    `,
    [error, id],
  );

  const row = await findMysqlById(mysql, id);
  if (!row) throw new Error(`Notification not found: ${id} at ${attemptedAt}`);
  return toOutboxRowFromMysql(row);
}

export function listDeliverableNotifications(
  db: AppDatabase,
  options: { limit?: number; maxAttempts?: number } = {},
): NotificationOutboxRow[] {
  if (isMysqlDatabaseUrlConfigured()) {
    throw new Error("Use listDeliverableNotificationsFromMysql in MySQL runtime.");
  }

  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  return db
    .select()
    .from(notificationOutbox)
    .where(inArray(notificationOutbox.status, ["pending", "failed"]))
    .orderBy(asc(notificationOutbox.createdAt), asc(notificationOutbox.id))
    .all()
    .filter((row) => row.attemptCount < maxAttempts)
    .slice(0, limit)
    .map(toOutboxRow);
}

export async function listDeliverableNotificationsFromMysql(
  mysql: Pick<MysqlNotificationOutboxStore, "query">,
  options: { limit?: number; maxAttempts?: number } = {},
): Promise<NotificationOutboxRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const rows = await mysqlSelectMany<Parameters<typeof toOutboxRowFromMysql>[0]>(
    mysql,
    `
      ${mysqlOutboxSelect}
      WHERE status IN ('pending', 'failed') AND attempt_count < ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `,
    [maxAttempts, limit],
  );

  return rows.map(toOutboxRowFromMysql);
}

export function listRecentNotifications(
  db: AppDatabase,
  options: { limit?: number; status?: NotificationOutboxRow["status"] } = {},
): NotificationOutboxRow[] {
  if (isMysqlDatabaseUrlConfigured()) {
    throw new Error("Use listRecentNotificationsFromMysql in MySQL runtime.");
  }

  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const rows = options.status
    ? db
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.status, options.status))
        .orderBy(desc(notificationOutbox.createdAt), desc(notificationOutbox.id))
        .limit(limit)
        .all()
    : db
        .select()
        .from(notificationOutbox)
        .orderBy(desc(notificationOutbox.createdAt), desc(notificationOutbox.id))
        .limit(limit)
        .all();

  return rows.map(toOutboxRow);
}

export async function listRecentNotificationsFromMysql(
  mysql = resolveMysqlPool(),
  options: { limit?: number; status?: NotificationOutboxRow["status"] } = {},
): Promise<NotificationOutboxRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const status = options.status;
  const rows = await mysqlSelectMany<Parameters<typeof toOutboxRowFromMysql>[0]>(
    mysql,
    status
      ? `
        ${mysqlOutboxSelect}
        WHERE status = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
      : `
        ${mysqlOutboxSelect}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
    status ? [status, limit] : [limit],
  );

  return rows.map(toOutboxRowFromMysql);
}

export async function countPendingNotificationsFromMysql(mysql: Pick<MysqlNotificationOutboxStore, "query">) {
  const row = await mysqlSelectOne<{ countValue: number | string }>(
    mysql,
    "SELECT COUNT(*) AS countValue FROM notification_outbox WHERE status IN ('pending', 'failed')",
  );

  return Number(row?.countValue ?? 0);
}
