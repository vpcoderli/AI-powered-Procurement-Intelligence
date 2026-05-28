import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { listAdminUsers, updateAdminUser } from "./users-repository";

const NOW = "2026-05-28T00:00:00.000Z";

describe("admin users repository", () => {
  it("lists users with role, tier, and disabled state", async () => {
    const testDb = await createTestDatabase();

    try {
      testDb.db
        .insert(users)
        .values([
          {
            id: "anon_1",
            email: null,
            role: "user",
            accountTier: "free",
            isDisabled: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
          {
            id: "user_1",
            email: "buyer@example.com",
            displayName: "Buyer",
            role: "user",
            accountTier: "pro",
            isDisabled: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ])
        .run();

      const result = listAdminUsers(testDb.db);

      expect(result.users).toEqual([
        expect.objectContaining({
          id: "user_1",
          email: "buyer@example.com",
          role: "user",
          tier: "pro",
          isDisabled: false,
        }),
      ]);
      expect(result.users.map((user) => user.id)).not.toContain("anon_1");
    } finally {
      await testDb.cleanup();
    }
  });

  it("updates a user's role, tier, and disabled state", async () => {
    const testDb = await createTestDatabase();

    try {
      testDb.db.insert(users).values({
        id: "user_1",
        email: "buyer@example.com",
        role: "user",
        accountTier: "free",
        isDisabled: 0,
        createdAt: NOW,
        updatedAt: NOW,
      }).run();

      const updated = updateAdminUser(testDb.db, "user_1", {
        role: "admin",
        tier: "business",
        isDisabled: true,
      });

      expect(updated).toEqual(expect.objectContaining({
        id: "user_1",
        role: "admin",
        tier: "business",
        isDisabled: true,
      }));
    } finally {
      await testDb.cleanup();
    }
  });
});
