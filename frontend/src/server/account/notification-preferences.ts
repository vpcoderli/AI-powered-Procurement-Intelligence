import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { userNotificationPreferences } from "@/server/db/schema";
import type { NotificationFrequency } from "@/server/notifications/types";

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
