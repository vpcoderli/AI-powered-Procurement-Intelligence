import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "@/server/auth/service";
import { userNotificationPreferences } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  getAccountNotificationPreferences,
  getAccountNotificationPreferencesFromMysql,
  updateAccountNotificationPreferences,
  updateAccountNotificationPreferencesFromMysql,
} from "./notification-preferences";

describe("account notification preferences service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("creates default preferences the first time they are read", async () => {
    const registered = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });

    const preferences = getAccountNotificationPreferences(testDb.db, registered.user.id);

    expect(preferences).toMatchObject({
      userId: registered.user.id,
      savedSearchAlertsEnabled: true,
      defaultAlertFrequency: "daily",
      marketingUpdatesEnabled: false,
    });
    expect(
      testDb.db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, registered.user.id))
        .all(),
    ).toHaveLength(1);
  });

  it("updates supported notification preferences without clearing unspecified fields", async () => {
    const registered = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });

    updateAccountNotificationPreferences(testDb.db, registered.user.id, {
      savedSearchAlertsEnabled: false,
      defaultAlertFrequency: "weekly",
    });

    const preferences = updateAccountNotificationPreferences(testDb.db, registered.user.id, {
      marketingUpdatesEnabled: true,
    });

    expect(preferences).toMatchObject({
      savedSearchAlertsEnabled: false,
      defaultAlertFrequency: "weekly",
      marketingUpdatesEnabled: true,
    });
  });

  it("creates and updates MySQL notification preferences", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([
        [
          {
            userId: "user_1",
            savedSearchAlertsEnabled: 1,
            defaultAlertFrequency: "daily",
            marketingUpdatesEnabled: 0,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        undefined,
      ])
      .mockResolvedValueOnce([
        [
          {
            userId: "user_1",
            savedSearchAlertsEnabled: 1,
            defaultAlertFrequency: "daily",
            marketingUpdatesEnabled: 0,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
          },
        ],
        undefined,
      ])
      .mockResolvedValueOnce([
        [
          {
            userId: "user_1",
            savedSearchAlertsEnabled: 0,
            defaultAlertFrequency: "weekly",
            marketingUpdatesEnabled: 1,
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:05:00.000Z",
          },
        ],
        undefined,
      ]);
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, undefined]);
    const mysql = { query, execute };

    await expect(getAccountNotificationPreferencesFromMysql(mysql, "user_1")).resolves.toMatchObject({
      userId: "user_1",
      savedSearchAlertsEnabled: true,
      defaultAlertFrequency: "daily",
      marketingUpdatesEnabled: false,
    });

    await expect(
      updateAccountNotificationPreferencesFromMysql(mysql, "user_1", {
        savedSearchAlertsEnabled: false,
        defaultAlertFrequency: "weekly",
        marketingUpdatesEnabled: true,
      }),
    ).resolves.toMatchObject({
      savedSearchAlertsEnabled: false,
      defaultAlertFrequency: "weekly",
      marketingUpdatesEnabled: true,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_notification_preferences"),
      expect.arrayContaining(["user_1", 1, "daily", 0]),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE user_notification_preferences"),
      expect.arrayContaining([0, "weekly", 1, "user_1"]),
    );
  });
});
