import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { organizationFeatureOverrides, organizationMemberships, organizations, users } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { verifyPassword } from "@/server/auth/password";
import {
  AdminUserEmailExistsError,
  createAdminUserInvite,
  listAdminUserFeatureOverrides,
  listAdminUserAuditLogs,
  listAdminUsers,
  updateAdminUser,
  updateAdminUserFeatureOverride,
} from "./users-repository";

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
      testDb.db.insert(users).values({
        id: "admin_1",
        email: "admin@example.com",
        role: "admin",
        accountTier: "free",
        isDisabled: 0,
        createdAt: NOW,
        updatedAt: NOW,
      }).run();
      testDb.db.insert(organizations).values({
        id: "org_1",
        name: "Buyer Workspace",
        accountTier: "free",
        createdAt: NOW,
        updatedAt: NOW,
      }).run();
      testDb.db.insert(organizationMemberships).values({
        organizationId: "org_1",
        userId: "user_1",
        role: "owner",
        status: "active",
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
      expect(testDb.db.select().from(organizations).where(eq(organizations.id, "org_1")).get())
        .toMatchObject({ accountTier: "business" });

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

  it("manages organization feature overrides for a user's workspace", async () => {
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
      testDb.db.insert(users).values({
        id: "admin_1",
        email: "admin@example.com",
        role: "admin",
        accountTier: "free",
        isDisabled: 0,
        createdAt: NOW,
        updatedAt: NOW,
      }).run();
      testDb.db.insert(organizations).values({
        id: "org_1",
        name: "Buyer Workspace",
        accountTier: "free",
        createdAt: NOW,
        updatedAt: NOW,
      }).run();
      testDb.db.insert(organizationMemberships).values({
        organizationId: "org_1",
        userId: "user_1",
        role: "owner",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      }).run();

      const enabled = updateAdminUserFeatureOverride(
        testDb.db,
        "user_1",
        { featureKey: "compliance_manifest", isEnabled: true },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(enabled).toEqual({
        organizationId: "org_1",
        organizationName: "Buyer Workspace",
        overrides: [{ featureKey: "compliance_manifest", isEnabled: true }],
      });
      expect(testDb.db.select().from(organizationFeatureOverrides).all()).toEqual([
        expect.objectContaining({
          organizationId: "org_1",
          featureKey: "compliance_manifest",
          isEnabled: 1,
          createdByUserId: "admin_1",
        }),
      ]);

      const disabled = updateAdminUserFeatureOverride(
        testDb.db,
        "user_1",
        { featureKey: "compliance_manifest", isEnabled: false },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(disabled.overrides).toEqual([{ featureKey: "compliance_manifest", isEnabled: false }]);

      const cleared = updateAdminUserFeatureOverride(
        testDb.db,
        "user_1",
        { featureKey: "compliance_manifest", isEnabled: null },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(cleared.overrides).toEqual([]);
      expect(listAdminUserFeatureOverrides(testDb.db, "user_1").overrides).toEqual([]);
      expect(listAdminUserAuditLogs(testDb.db, { limit: 5 }).logs[0].changes[0]).toEqual({
        field: "featureOverride",
        featureKey: "compliance_manifest",
        before: false,
        after: null,
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates an invited user with role, tier, temporary password, and audit log", async () => {
    const testDb = await createTestDatabase();

    try {
      const result = await createAdminUserInvite(
        testDb.db,
        {
          email: " NewBuyer@Example.com ",
          displayName: "New Buyer",
          role: "user",
          tier: "pro",
        },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);
      expect(result.user).toEqual(expect.objectContaining({
        email: "newbuyer@example.com",
        displayName: "New Buyer",
        role: "user",
        tier: "pro",
        isDisabled: false,
      }));

      const row = testDb.db.select().from(users).where(eq(users.id, result.user.id)).limit(1).get();
      expect(row?.passwordHash).toBeTruthy();
      expect(await verifyPassword(result.temporaryPassword, row?.passwordHash ?? "")).toBe(true);

      const auditLogs = listAdminUserAuditLogs(testDb.db, { limit: 5 });
      expect(auditLogs.logs[0]).toEqual(expect.objectContaining({
        action: "user_invited",
        actorKind: "admin",
        actorUserId: "admin_1",
        targetUserId: result.user.id,
        targetEmail: "newbuyer@example.com",
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects duplicate invited user emails", async () => {
    const testDb = await createTestDatabase();

    try {
      await createAdminUserInvite(testDb.db, {
        email: "buyer@example.com",
        role: "user",
        tier: "free",
      });

      await expect(
        createAdminUserInvite(testDb.db, {
          email: " Buyer@Example.com ",
          role: "user",
          tier: "pro",
        }),
      ).rejects.toBeInstanceOf(AdminUserEmailExistsError);
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
