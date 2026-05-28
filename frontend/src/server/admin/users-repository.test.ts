import { describe, expect, it } from "vitest";
import { users } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { listAdminUserAuditLogs, listAdminUsers, updateAdminUser } from "./users-repository";

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

      const updated = updateAdminUser(
        testDb.db,
        "user_1",
        {
          role: "admin",
          tier: "business",
          isDisabled: true,
        },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(updated).toEqual(expect.objectContaining({
        id: "user_1",
        role: "admin",
        tier: "business",
        isDisabled: true,
      }));

      const auditLogs = listAdminUserAuditLogs(testDb.db, { limit: 5 });
      expect(auditLogs.logs).toEqual([
        expect.objectContaining({
          actorKind: "admin",
          actorUserId: "admin_1",
          targetUserId: "user_1",
          targetEmail: "buyer@example.com",
          action: "user_access_updated",
          changes: expect.arrayContaining([
            { field: "role", before: "user", after: "admin" },
            { field: "tier", before: "free", after: "business" },
            { field: "isDisabled", before: false, after: true },
          ]),
        }),
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("filters registered users by search, role, tier, and status", async () => {
    const testDb = await createTestDatabase();

    try {
      testDb.db
        .insert(users)
        .values([
          {
            id: "user_admin",
            email: "admin@example.com",
            displayName: "Admin",
            role: "admin",
            accountTier: "enterprise",
            isDisabled: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
          {
            id: "user_buyer",
            email: "buyer@example.com",
            displayName: "Acme Buyer",
            role: "user",
            accountTier: "pro",
            isDisabled: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
          {
            id: "user_disabled",
            email: "disabled@example.com",
            displayName: "Disabled User",
            role: "user",
            accountTier: "free",
            isDisabled: 1,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ])
        .run();

      expect(listAdminUsers(testDb.db, { q: "acme" }).users.map((user) => user.id)).toEqual(["user_buyer"]);
      expect(listAdminUsers(testDb.db, { role: "admin" }).users.map((user) => user.id)).toEqual(["user_admin"]);
      expect(listAdminUsers(testDb.db, { tier: "pro" }).users.map((user) => user.id)).toEqual(["user_buyer"]);
      expect(listAdminUsers(testDb.db, { status: "disabled" }).users.map((user) => user.id)).toEqual([
        "user_disabled",
      ]);
    } finally {
      await testDb.cleanup();
    }
  });
});
