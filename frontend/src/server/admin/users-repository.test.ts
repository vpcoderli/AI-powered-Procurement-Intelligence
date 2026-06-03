import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminUserAuditLogs,
  organizationFeatureOverrides,
  organizationMemberships,
  organizations,
  users,
} from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { verifyPassword } from "@/server/auth/password";
import {
  AdminUserEmailExistsError,
  createAdminUserInvite,
  createAdminUserInviteFromMysql,
  listAdminUserFeatureOverrides,
  listAdminUserFeatureOverridesFromMysql,
  listAdminUserAuditLogs,
  listAdminUserAuditLogsFromMysql,
  listAdminUsers,
  listAdminUsersFromMysql,
  updateAdminUser,
  updateAdminUserFeatureOverrideFromMysql,
  updateAdminUserFromMysql,
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
        {
          featureKey: "compliance_manifest",
          isEnabled: true,
          reason: "Pilot customer",
          expiresAt: "2026-06-28T00:00:00.000Z",
        },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(enabled).toEqual({
        organizationId: "org_1",
        organizationName: "Buyer Workspace",
        overrides: [{
          featureKey: "compliance_manifest",
          isEnabled: true,
          reason: "Pilot customer",
          expiresAt: "2026-06-28T00:00:00.000Z",
          isExpired: false,
        }],
      });
      expect(testDb.db.select().from(organizationFeatureOverrides).all()).toEqual([
        expect.objectContaining({
          organizationId: "org_1",
          featureKey: "compliance_manifest",
          isEnabled: 1,
          reason: "Pilot customer",
          expiresAt: "2026-06-28T00:00:00.000Z",
          createdByUserId: "admin_1",
        }),
      ]);

      const disabled = updateAdminUserFeatureOverride(
        testDb.db,
        "user_1",
        { featureKey: "compliance_manifest", isEnabled: false },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(disabled.overrides).toEqual([{
        featureKey: "compliance_manifest",
        isEnabled: false,
        reason: null,
        expiresAt: null,
        isExpired: false,
      }]);

      const cleared = updateAdminUserFeatureOverride(
        testDb.db,
        "user_1",
        { featureKey: "compliance_manifest", isEnabled: null },
        { actorKind: "admin", actorUserId: "admin_1" },
      );

      expect(cleared.overrides).toEqual([]);
      expect(listAdminUserFeatureOverrides(testDb.db, "user_1").overrides).toEqual([]);
      const clearOverrideChange = listAdminUserAuditLogs(testDb.db, { limit: 5 }).logs
        .flatMap((log) => log.changes)
        .find((change) => change.field === "featureOverride" && change.after === null);
      expect(clearOverrideChange).toEqual({
        field: "featureOverride",
        featureKey: "compliance_manifest",
        before: { isEnabled: false, reason: null, expiresAt: null },
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

  it("filters user audit logs by actor, action, target, and feature", async () => {
    const testDb = await createTestDatabase();

    try {
      testDb.db.insert(users).values([
        {
          id: "admin_1",
          email: "admin@example.com",
          role: "admin",
          accountTier: "free",
          isDisabled: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "buyer_1",
          email: "buyer@example.com",
          displayName: "Buyer One",
          role: "user",
          accountTier: "free",
          isDisabled: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "seller_1",
          email: "seller@example.com",
          displayName: "Seller One",
          role: "user",
          accountTier: "free",
          isDisabled: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]).run();
      testDb.db.insert(adminUserAuditLogs).values([
        {
          id: "audit_match",
          actorKind: "admin",
          actorUserId: "admin_1",
          targetUserId: "buyer_1",
          action: "user_access_updated",
          changesJson: JSON.stringify([
            {
              field: "featureOverride",
              featureKey: "compliance_manifest",
              before: null,
              after: { isEnabled: true, reason: "Pilot", expiresAt: null },
            },
          ]),
          createdAt: "2026-05-28T03:00:00.000Z",
        },
        {
          id: "audit_other_feature",
          actorKind: "admin",
          actorUserId: "admin_1",
          targetUserId: "buyer_1",
          action: "user_access_updated",
          changesJson: JSON.stringify([
            {
              field: "featureOverride",
              featureKey: "knowledge_station",
              before: null,
              after: { isEnabled: true, reason: null, expiresAt: null },
            },
          ]),
          createdAt: "2026-05-28T02:00:00.000Z",
        },
        {
          id: "audit_other_target",
          actorKind: "admin",
          actorUserId: "admin_1",
          targetUserId: "seller_1",
          action: "user_access_updated",
          changesJson: JSON.stringify([{ field: "tier", before: "free", after: "pro" }]),
          createdAt: "2026-05-28T01:00:00.000Z",
        },
      ]).run();

      const filtered = listAdminUserAuditLogs(testDb.db, {
        limit: 10,
        actorKind: "admin",
        action: "user_access_updated",
        target: "buyer",
        featureKey: "compliance_manifest",
      });

      expect(filtered.logs.map((log) => log.id)).toEqual(["audit_match"]);
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

  it("runs the MySQL admin user access lifecycle", async () => {
    const userRows = new Map<string, Record<string, unknown>>([
      ["admin_1", {
        id: "admin_1",
        email: "admin@example.com",
        displayName: "Admin",
        role: "admin",
        accountTier: "enterprise",
        isDisabled: 0,
        createdAt: NOW,
        updatedAt: NOW,
        lastLoginAt: null,
      }],
      ["user_1", {
        id: "user_1",
        email: "buyer@example.com",
        displayName: "Buyer",
        role: "user",
        accountTier: "free",
        isDisabled: 0,
        createdAt: NOW,
        updatedAt: NOW,
        lastLoginAt: null,
      }],
    ]);
    const organizationsRows = new Map<string, Record<string, unknown>>([
      ["org_1", {
        id: "org_1",
        name: "Buyer Workspace",
        accountTier: "free",
        createdAt: NOW,
        updatedAt: NOW,
      }],
    ]);
    const memberships = new Map<string, Record<string, unknown>>([
      ["org_1:user_1", {
        organizationId: "org_1",
        userId: "user_1",
        role: "owner",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      }],
    ]);
    const overrides = new Map<string, Record<string, unknown>>();
    const auditRows: Record<string, unknown>[] = [];
    const mysql = {
      execute: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO users")) {
          if ([...userRows.values()].some((row) => row.email === values[1])) {
            const error = new Error("Duplicate email") as Error & { code: string };
            error.code = "ER_DUP_ENTRY";
            throw error;
          }
          userRows.set(values[0] as string, {
            id: values[0],
            email: values[1],
            passwordHash: values[2],
            displayName: values[3],
            role: values[4],
            accountTier: values[5],
            isDisabled: values[6],
            createdAt: values[7],
            updatedAt: values[8],
            lastLoginAt: null,
          });
        }

        if (sql.includes("UPDATE users SET")) {
          const user = userRows.get(values.at(-1) as string);
          if (user) {
            if (sql.includes("role = ?")) user.role = values[0];
            if (sql.includes("account_tier = ?")) user.accountTier = values[1];
            if (sql.includes("is_disabled = ?")) user.isDisabled = values[2];
            user.updatedAt = values[3];
          }
        }

        if (sql.includes("UPDATE organizations")) {
          for (const membership of memberships.values()) {
            if (membership.userId === values[2] && membership.role === "owner") {
              const organization = organizationsRows.get(membership.organizationId as string);
              if (organization) {
                organization.accountTier = values[0];
                organization.updatedAt = values[1];
              }
            }
          }
        }

        if (sql.includes("INSERT INTO admin_user_audit_logs")) {
          auditRows.push({
            id: values[0],
            actorKind: values[1],
            actorUserId: values[2],
            targetUserId: values[3],
            action: values[4],
            changesJson: values[5],
            createdAt: values[6],
            targetEmail: userRows.get(values[3] as string)?.email ?? null,
          });
        }

        if (sql.includes("INSERT INTO organization_feature_overrides")) {
          overrides.set(`${values[0]}:${values[1]}`, {
            organizationId: values[0],
            featureKey: values[1],
            isEnabled: values[2],
            reason: values[3],
            expiresAt: values[4],
            createdByUserId: values[5],
            createdAt: values[6],
            updatedAt: values[7],
          });
        }

        if (sql.includes("UPDATE organization_feature_overrides")) {
          const row = overrides.get(`${values[4]}:${values[5]}`);
          if (row) {
            row.isEnabled = values[0];
            row.reason = values[1];
            row.expiresAt = values[2];
            row.createdByUserId = values[3];
          }
        }

        if (sql.includes("DELETE FROM organization_feature_overrides")) {
          overrides.delete(`${values[0]}:${values[1]}`);
        }

        return [{ affectedRows: 1 }, undefined];
      },
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM users") && sql.includes("WHERE id = ?")) {
          return [[[userRows.get(values[0] as string)].filter(Boolean)[0]].filter(Boolean), undefined];
        }

        if (sql.includes("FROM users") && sql.includes("WHERE email IS NOT NULL")) {
          return [[...userRows.values()].filter((row) => row.email !== null), undefined];
        }

        if (sql.includes("FROM organization_memberships") && sql.includes("INNER JOIN organizations")) {
          const membership = [...memberships.values()].find((row) => row.userId === values[0]);
          const organization = membership ? organizationsRows.get(membership.organizationId as string) : null;
          return [[organization ? {
            organizationId: organization.id,
            organizationName: organization.name,
            role: membership?.role,
            tier: organization.accountTier,
          } : null].filter(Boolean), undefined];
        }

        if (sql.includes("FROM organization_feature_overrides")) {
          return [[...overrides.values()].filter((row) => row.organizationId === values[0]), undefined];
        }

        if (sql.includes("FROM admin_user_audit_logs")) {
          return [auditRows.slice().reverse(), undefined];
        }

        return [[], undefined];
      },
    };

    await expect(listAdminUsersFromMysql(mysql)).resolves.toEqual({
      users: expect.arrayContaining([
        expect.objectContaining({ id: "user_1", email: "buyer@example.com", tier: "free" }),
      ]),
    });

    const invited = await createAdminUserInviteFromMysql(mysql, {
      email: "NewBuyer@Example.com",
      displayName: "New Buyer",
      role: "user",
      tier: "pro",
    }, { actorKind: "admin", actorUserId: "admin_1" });
    expect(invited.user.email).toBe("newbuyer@example.com");

    const updated = await updateAdminUserFromMysql(mysql, "user_1", {
      role: "admin",
      tier: "business",
      isDisabled: true,
    }, { actorKind: "admin", actorUserId: "admin_1" });
    expect(updated).toMatchObject({ role: "admin", tier: "business", isDisabled: true });
    expect(organizationsRows.get("org_1")).toMatchObject({ accountTier: "business" });

    const enabled = await updateAdminUserFeatureOverrideFromMysql(mysql, "user_1", {
      featureKey: "compliance_manifest",
      isEnabled: true,
      reason: "Pilot",
      expiresAt: "2026-06-28T00:00:00.000Z",
    }, { actorKind: "admin", actorUserId: "admin_1" });
    expect(enabled.overrides).toEqual([
      expect.objectContaining({ featureKey: "compliance_manifest", isEnabled: true, reason: "Pilot" }),
    ]);
    await expect(listAdminUserFeatureOverridesFromMysql(mysql, "user_1")).resolves.toEqual(enabled);

    await updateAdminUserFeatureOverrideFromMysql(mysql, "user_1", {
      featureKey: "compliance_manifest",
      isEnabled: null,
    }, { actorKind: "admin", actorUserId: "admin_1" });
    await expect(listAdminUserAuditLogsFromMysql(mysql, { featureKey: "compliance_manifest" })).resolves.toEqual({
      logs: expect.arrayContaining([
        expect.objectContaining({ targetUserId: "user_1", action: "user_access_updated" }),
      ]),
    });
  });
});
