import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "@/server/auth/service";
import { userNotificationPreferences } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  getAccountNotificationPreferences,
  updateAccountNotificationPreferences,
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
});
