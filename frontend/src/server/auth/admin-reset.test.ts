import { eq } from "drizzle-orm";
import type { Pool } from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { organizationMemberships, organizations, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { hashPassword, verifyPassword } from "./password";
import {
  LOCAL_ADMIN_EMAIL,
  LOCAL_ADMIN_PASSWORD,
  resetLocalAdminPassword,
  resetLocalAdminPasswordFromMysql,
} from "./admin-reset";

type MysqlUserRecord = {
  id: string;
  email: string | null;
  passwordHash: string | null;
  displayName: string | null;
  role: string;
  accountTier: string;
  isDisabled: number;
  createdAt: string;
  updatedAt: string;
};

type MysqlOrganizationRecord = {
  id: string;
  name: string;
  accountTier: string;
  createdAt: string;
  updatedAt: string;
};

type MysqlMembershipRecord = {
  organizationId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function createMysqlAdminResetHarness(seed?: {
  users?: MysqlUserRecord[];
  organizations?: MysqlOrganizationRecord[];
  memberships?: MysqlMembershipRecord[];
}) {
  const userRows = new Map(seed?.users?.map((row) => [row.id, { ...row }]));
  const organizationRows = new Map(seed?.organizations?.map((row) => [row.id, { ...row }]));
  const membershipRows = new Map(seed?.memberships?.map((row) => [`${row.organizationId}:${row.userId}`, { ...row }]));

  const execute = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO organizations")) {
      const id = values[0] as string;
      const existing = organizationRows.get(id);
      if (existing) {
        existing.name = existing.name || (values[1] as string);
        existing.accountTier = values[2] as string;
        existing.updatedAt = values[4] as string;
      } else {
        organizationRows.set(id, {
          id,
          name: values[1] as string,
          accountTier: values[2] as string,
          createdAt: values[3] as string,
          updatedAt: values[4] as string,
        });
      }
    }

    if (sql.includes("INSERT INTO users")) {
      const id = values[0] as string;
      const existing = userRows.get(id);
      if (existing) {
        existing.email = values[1] as string;
        existing.passwordHash = values[2] as string;
        existing.displayName = existing.displayName ?? (values[3] as string | null);
        existing.role = values[4] as string;
        existing.accountTier = values[5] as string;
        existing.isDisabled = values[6] as number;
        existing.updatedAt = values[8] as string;
      } else {
        userRows.set(id, {
          id,
          email: values[1] as string,
          passwordHash: values[2] as string,
          displayName: values[3] as string | null,
          role: values[4] as string,
          accountTier: values[5] as string,
          isDisabled: values[6] as number,
          createdAt: values[7] as string,
          updatedAt: values[8] as string,
        });
      }
    }

    if (sql.includes("INSERT INTO organization_memberships")) {
      const organizationId = values[0] as string;
      const userId = values[1] as string;
      const key = `${organizationId}:${userId}`;
      const existing = membershipRows.get(key);
      if (existing) {
        existing.role = values[2] as string;
        existing.status = values[3] as string;
        existing.updatedAt = values[5] as string;
      } else {
        membershipRows.set(key, {
          organizationId,
          userId,
          role: values[2] as string,
          status: values[3] as string,
          createdAt: values[4] as string,
          updatedAt: values[5] as string,
        });
      }
    }

    return [{ affectedRows: 1, insertId: 0 }, undefined];
  };

  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM users") && sql.includes("WHERE email = ?")) {
      return [[...userRows.values()].filter((row) => row.email === values[0]), undefined];
    }

    if (sql.includes("FROM organization_memberships") && sql.includes("WHERE user_id = ?")) {
      return [
        [...membershipRows.values()]
          .filter((row) => row.userId === values[0])
          .sort(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.organizationId.localeCompare(right.organizationId),
          ),
        undefined,
      ];
    }

    if (sql.includes("FROM organizations") && sql.includes("WHERE id = ?")) {
      return [[organizationRows.get(values[0] as string)].filter(Boolean), undefined];
    }

    return [[], undefined];
  };

  const mysql = {
    execute,
    query,
    getConnection: async () => ({
      execute,
      query,
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    }),
  } as unknown as Pool;

  return { mysql, userRows, organizationRows, membershipRows };
}

describe("local admin password reset", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("creates the local admin account when it is missing", async () => {
    const result = await resetLocalAdminPassword(testDb.db);

    expect(result).toMatchObject({
      email: LOCAL_ADMIN_EMAIL,
      password: LOCAL_ADMIN_PASSWORD,
    });

    const admin = testDb.db.select().from(users).where(eq(users.email, LOCAL_ADMIN_EMAIL)).get();
    expect(admin).toMatchObject({
      role: "admin",
      accountTier: "enterprise",
      isDisabled: 0,
    });
    expect(await verifyPassword(LOCAL_ADMIN_PASSWORD, admin?.passwordHash ?? "")).toBe(true);

    const membership = testDb.db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, admin?.id ?? ""))
      .get();
    expect(membership).toMatchObject({ role: "owner", status: "active" });
  });

  it("resets an existing disabled non-admin local account into an active enterprise admin", async () => {
    const now = new Date().toISOString();
    testDb.db.insert(organizations).values({
      id: "org_local_admin",
      name: "Old Local Admin Workspace",
      accountTier: "free",
      createdAt: now,
      updatedAt: now,
    }).run();
    testDb.db.insert(users).values({
      id: "user_local_admin",
      email: LOCAL_ADMIN_EMAIL,
      passwordHash: await hashPassword("OldPassword-2026!"),
      displayName: "Old Admin",
      role: "user",
      accountTier: "free",
      isDisabled: 1,
      createdAt: now,
      updatedAt: now,
    }).run();

    const result = await resetLocalAdminPassword(testDb.db);

    const admin = testDb.db.select().from(users).where(eq(users.id, "user_local_admin")).get();
    expect(result.userId).toBe("user_local_admin");
    expect(admin).toMatchObject({
      role: "admin",
      accountTier: "enterprise",
      isDisabled: 0,
    });
    expect(await verifyPassword("OldPassword-2026!", admin?.passwordHash ?? "")).toBe(false);
    expect(await verifyPassword(LOCAL_ADMIN_PASSWORD, admin?.passwordHash ?? "")).toBe(true);

    const organization = testDb.db.select().from(organizations).where(eq(organizations.id, "org_local_admin")).get();
    expect(organization).toMatchObject({ accountTier: "enterprise" });
  });

  it("promotes the existing local admin workspace tier used by login sessions", async () => {
    const now = new Date().toISOString();
    testDb.db.insert(organizations).values({
      id: "org_existing_admin",
      name: "Existing Admin Workspace",
      accountTier: "free",
      createdAt: now,
      updatedAt: now,
    }).run();
    testDb.db.insert(users).values({
      id: "user_existing_admin",
      email: LOCAL_ADMIN_EMAIL,
      passwordHash: await hashPassword("OldPassword-2026!"),
      displayName: "Existing Admin",
      role: "admin",
      accountTier: "free",
      isDisabled: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    testDb.db.insert(organizationMemberships).values({
      organizationId: "org_existing_admin",
      userId: "user_existing_admin",
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run();

    const result = await resetLocalAdminPassword(testDb.db);

    expect(result.organizationId).toBe("org_existing_admin");
    expect(testDb.db.select().from(organizations).where(eq(organizations.id, "org_existing_admin")).get())
      .toMatchObject({ accountTier: "enterprise" });
  });

  it("creates the local admin account through the MySQL runtime", async () => {
    const { mysql, userRows, organizationRows, membershipRows } = createMysqlAdminResetHarness();

    const result = await resetLocalAdminPasswordFromMysql(mysql);

    expect(result).toMatchObject({
      email: LOCAL_ADMIN_EMAIL,
      password: LOCAL_ADMIN_PASSWORD,
      userId: "user_local_admin",
      organizationId: "org_local_admin",
    });
    expect(userRows.get("user_local_admin")).toMatchObject({
      email: LOCAL_ADMIN_EMAIL,
      role: "admin",
      accountTier: "enterprise",
      isDisabled: 0,
    });
    expect(await verifyPassword(LOCAL_ADMIN_PASSWORD, userRows.get("user_local_admin")?.passwordHash ?? "")).toBe(true);
    expect(organizationRows.get("org_local_admin")).toMatchObject({ accountTier: "enterprise" });
    expect(membershipRows.get("org_local_admin:user_local_admin")).toMatchObject({ role: "owner", status: "active" });
  });

  it("resets an existing MySQL local account and preserves its workspace", async () => {
    const now = new Date().toISOString();
    const { mysql, userRows, organizationRows, membershipRows } = createMysqlAdminResetHarness({
      organizations: [{
        id: "org_existing_admin",
        name: "Existing Admin Workspace",
        accountTier: "free",
        createdAt: now,
        updatedAt: now,
      }],
      users: [{
        id: "user_existing_admin",
        email: LOCAL_ADMIN_EMAIL,
        passwordHash: await hashPassword("OldPassword-2026!"),
        displayName: "Existing Admin",
        role: "user",
        accountTier: "free",
        isDisabled: 1,
        createdAt: now,
        updatedAt: now,
      }],
      memberships: [{
        organizationId: "org_existing_admin",
        userId: "user_existing_admin",
        role: "member",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      }],
    });

    const result = await resetLocalAdminPasswordFromMysql(mysql);

    expect(result).toMatchObject({
      userId: "user_existing_admin",
      organizationId: "org_existing_admin",
    });
    expect(userRows.get("user_existing_admin")).toMatchObject({
      displayName: "Existing Admin",
      role: "admin",
      accountTier: "enterprise",
      isDisabled: 0,
    });
    expect(await verifyPassword("OldPassword-2026!", userRows.get("user_existing_admin")?.passwordHash ?? "")).toBe(false);
    expect(await verifyPassword(LOCAL_ADMIN_PASSWORD, userRows.get("user_existing_admin")?.passwordHash ?? "")).toBe(true);
    expect(organizationRows.get("org_existing_admin")).toMatchObject({
      name: "Existing Admin Workspace",
      accountTier: "enterprise",
    });
    expect(membershipRows.get("org_existing_admin:user_existing_admin")).toMatchObject({
      role: "owner",
      status: "active",
    });
  });
});
