import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { userNotificationPreferences } from "@/server/db/schema";
import type { NotificationFrequency } from "@/server/notifications/types";

interface MysqlNotificationPreferencesStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export interface AccountNotificationPreferences {
  userId: string;
  savedSearchAlertsEnabled: boolean;
  defaultAlertFrequency: NotificationFrequency;
  marketingUpdatesEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateAccountNotificationPreferencesInput {
  savedSearchAlertsEnabled?: boolean;
  defaultAlertFrequency?: NotificationFrequency;
  marketingUpdatesEnabled?: boolean;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeFrequency(value: unknown): NotificationFrequency {
  return value === "weekly" ? "weekly" : "daily";
}

function toPreferences(
  row: typeof userNotificationPreferences.$inferSelect,
): AccountNotificationPreferences {
  return {
    userId: row.userId,
    savedSearchAlertsEnabled: row.savedSearchAlertsEnabled === 1,
    defaultAlertFrequency: normalizeFrequency(row.defaultAlertFrequency),
    marketingUpdatesEnabled: row.marketingUpdatesEnabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMysqlPreferences(row: {
  userId: string;
  savedSearchAlertsEnabled: number | string | boolean;
  defaultAlertFrequency: string | null;
  marketingUpdatesEnabled: number | string | boolean;
  createdAt: string;
  updatedAt: string;
}): AccountNotificationPreferences {
  return {
    userId: row.userId,
    savedSearchAlertsEnabled:
      row.savedSearchAlertsEnabled === true ||
      row.savedSearchAlertsEnabled === 1 ||
      row.savedSearchAlertsEnabled === "1",
    defaultAlertFrequency: normalizeFrequency(row.defaultAlertFrequency),
    marketingUpdatesEnabled:
      row.marketingUpdatesEnabled === true ||
      row.marketingUpdatesEnabled === 1 ||
      row.marketingUpdatesEnabled === "1",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findPreferences(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId))
    .limit(1)
    .get();
}

export function getAccountNotificationPreferences(
  db: AppDatabase,
  userId: string,
): AccountNotificationPreferences {
  const existing = findPreferences(db, userId);

  if (existing) {
    return toPreferences(existing);
  }

  const timestamp = nowIso();
  db.insert(userNotificationPreferences)
    .values({
      userId,
      savedSearchAlertsEnabled: 1,
      defaultAlertFrequency: "daily",
      marketingUpdatesEnabled: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing({ target: userNotificationPreferences.userId })
    .run();

  const created = findPreferences(db, userId);
  if (!created) throw new Error("Failed to create notification preferences");

  return toPreferences(created);
}

export function updateAccountNotificationPreferences(
  db: AppDatabase,
  userId: string,
  input: UpdateAccountNotificationPreferencesInput,
): AccountNotificationPreferences {
  const current = getAccountNotificationPreferences(db, userId);
  const timestamp = nowIso();

  db.update(userNotificationPreferences)
    .set({
      savedSearchAlertsEnabled:
        typeof input.savedSearchAlertsEnabled === "boolean"
          ? input.savedSearchAlertsEnabled ? 1 : 0
          : current.savedSearchAlertsEnabled ? 1 : 0,
      defaultAlertFrequency: input.defaultAlertFrequency
        ? normalizeFrequency(input.defaultAlertFrequency)
        : current.defaultAlertFrequency,
      marketingUpdatesEnabled:
        typeof input.marketingUpdatesEnabled === "boolean"
          ? input.marketingUpdatesEnabled ? 1 : 0
          : current.marketingUpdatesEnabled ? 1 : 0,
      updatedAt: timestamp,
    })
    .where(eq(userNotificationPreferences.userId, userId))
    .run();

  return getAccountNotificationPreferences(db, userId);
}

async function findMysqlPreferences(mysql: Pick<MysqlNotificationPreferencesStore, "query">, userId: string) {
  return mysqlSelectOne<{
    userId: string;
    savedSearchAlertsEnabled: number | string | boolean;
    defaultAlertFrequency: string | null;
    marketingUpdatesEnabled: number | string | boolean;
    createdAt: string;
    updatedAt: string;
  }>(
    mysql,
    `
      SELECT
        user_id AS userId,
        saved_search_alerts_enabled AS savedSearchAlertsEnabled,
        default_alert_frequency AS defaultAlertFrequency,
        marketing_updates_enabled AS marketingUpdatesEnabled,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM user_notification_preferences
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );
}

export async function getAccountNotificationPreferencesFromMysql(
  mysql: MysqlNotificationPreferencesStore,
  userId: string,
): Promise<AccountNotificationPreferences> {
  const existing = await findMysqlPreferences(mysql, userId);

  if (existing) {
    return toMysqlPreferences(existing);
  }

  const timestamp = nowIso();
  await mysqlExecute(
    mysql,
    `
      INSERT INTO user_notification_preferences (
        user_id,
        saved_search_alerts_enabled,
        default_alert_frequency,
        marketing_updates_enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE user_id = user_id
    `,
    [userId, 1, "daily", 0, timestamp, timestamp],
  );

  const created = await findMysqlPreferences(mysql, userId);
  if (!created) throw new Error("Failed to create notification preferences");

  return toMysqlPreferences(created);
}

export async function updateAccountNotificationPreferencesFromMysql(
  mysql: MysqlNotificationPreferencesStore,
  userId: string,
  input: UpdateAccountNotificationPreferencesInput,
): Promise<AccountNotificationPreferences> {
  const current = await getAccountNotificationPreferencesFromMysql(mysql, userId);
  const timestamp = nowIso();

  await mysqlExecute(
    mysql,
    `
      UPDATE user_notification_preferences
      SET
        saved_search_alerts_enabled = ?,
        default_alert_frequency = ?,
        marketing_updates_enabled = ?,
        updated_at = ?
      WHERE user_id = ?
    `,
    [
      typeof input.savedSearchAlertsEnabled === "boolean"
        ? input.savedSearchAlertsEnabled ? 1 : 0
        : current.savedSearchAlertsEnabled ? 1 : 0,
      input.defaultAlertFrequency ? normalizeFrequency(input.defaultAlertFrequency) : current.defaultAlertFrequency,
      typeof input.marketingUpdatesEnabled === "boolean"
        ? input.marketingUpdatesEnabled ? 1 : 0
        : current.marketingUpdatesEnabled ? 1 : 0,
      timestamp,
      userId,
    ],
  );

  return getAccountNotificationPreferencesFromMysql(mysql, userId);
}
