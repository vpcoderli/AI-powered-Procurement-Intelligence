import { and, asc, eq } from "drizzle-orm";
import type { Pool } from "mysql2/promise";
import { organizationMemberships, organizations, users } from "@/server/db/schema";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectOne, mysqlTransaction } from "@/server/db/mysql-runtime";
import { hashPassword } from "./password";

export const LOCAL_ADMIN_EMAIL = "admin@winbids.local";
export const LOCAL_ADMIN_PASSWORD = "AdminLocal-2026!";

const LOCAL_ADMIN_USER_ID = "user_local_admin";
const LOCAL_ADMIN_ORGANIZATION_ID = "org_local_admin";

interface ResetLocalAdminPasswordInput {
  email?: string;
  password?: string;
  displayName?: string;
}

interface MysqlLocalAdminUserRow {
  id: string;
}

interface MysqlLocalAdminMembershipRow {
  organizationId: string;
}

export async function resetLocalAdminPassword(
  db: AppDatabase,
  input: ResetLocalAdminPasswordInput = {},
) {
  const email = input.email ?? LOCAL_ADMIN_EMAIL;
  const password = input.password ?? LOCAL_ADMIN_PASSWORD;
  const displayName = input.displayName ?? "WinBids Local Admin";
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  const existingUser = db.select().from(users).where(eq(users.email, email)).get();
  const userId = existingUser?.id ?? LOCAL_ADMIN_USER_ID;
  const existingMembership = existingUser
    ? db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, existingUser.id))
        .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.organizationId))
        .get()
    : undefined;
  const organizationId = existingMembership?.organizationId ?? LOCAL_ADMIN_ORGANIZATION_ID;

  const existingOrganization = db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .get();
  if (existingOrganization) {
    db.update(organizations)
      .set({
        name: existingOrganization.name || "WinBids Local Admin Workspace",
        accountTier: "enterprise",
        updatedAt: now,
      })
      .where(eq(organizations.id, organizationId))
      .run();
  } else {
    db.insert(organizations)
      .values({
        id: organizationId,
        name: "WinBids Local Admin Workspace",
        accountTier: "enterprise",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  if (existingUser) {
    db.update(users)
      .set({
        passwordHash,
        displayName: existingUser.displayName ?? displayName,
        role: "admin",
        accountTier: "enterprise",
        isDisabled: 0,
        updatedAt: now,
      })
      .where(eq(users.id, existingUser.id))
      .run();
  } else {
    db.insert(users)
      .values({
        id: userId,
        email,
        passwordHash,
        displayName,
        role: "admin",
        accountTier: "enterprise",
        isDisabled: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  if (existingMembership) {
    db.update(organizationMemberships)
      .set({
        role: "owner",
        status: "active",
        updatedAt: now,
      })
      .where(and(
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.organizationId, organizationId),
      ))
      .run();
  } else {
    db.insert(organizationMemberships)
      .values({
        organizationId,
        userId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  return {
    email,
    password,
    userId,
    organizationId,
  };
}

export async function resetLocalAdminPasswordFromMysql(
  pool: Pool,
  input: ResetLocalAdminPasswordInput = {},
) {
  const email = input.email ?? LOCAL_ADMIN_EMAIL;
  const password = input.password ?? LOCAL_ADMIN_PASSWORD;
  const displayName = input.displayName ?? "WinBids Local Admin";
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  const existingUser = await mysqlSelectOne<MysqlLocalAdminUserRow>(
    pool,
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email],
  );
  const userId = existingUser?.id ?? LOCAL_ADMIN_USER_ID;
  const existingMembership = existingUser
    ? await mysqlSelectOne<MysqlLocalAdminMembershipRow>(
        pool,
        `
          SELECT organization_id AS organizationId
          FROM organization_memberships
          WHERE user_id = ?
          ORDER BY created_at ASC, organization_id ASC
          LIMIT 1
        `,
        [existingUser.id],
      )
    : null;
  const organizationId = existingMembership?.organizationId ?? LOCAL_ADMIN_ORGANIZATION_ID;

  await mysqlTransaction(pool, async (connection) => {
    await mysqlExecute(
      connection,
      `
        INSERT INTO organizations (id, name, account_tier, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = IF(name IS NULL OR name = '', VALUES(name), name),
          account_tier = VALUES(account_tier),
          updated_at = VALUES(updated_at)
      `,
      [organizationId, "WinBids Local Admin Workspace", "enterprise", now, now],
    );

    await mysqlExecute(
      connection,
      `
        INSERT INTO users (
          id, email, password_hash, display_name, role, account_tier, is_disabled, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          email = VALUES(email),
          password_hash = VALUES(password_hash),
          display_name = COALESCE(display_name, VALUES(display_name)),
          role = VALUES(role),
          account_tier = VALUES(account_tier),
          is_disabled = VALUES(is_disabled),
          updated_at = VALUES(updated_at)
      `,
      [userId, email, passwordHash, displayName, "admin", "enterprise", 0, now, now],
    );

    await mysqlExecute(
      connection,
      `
        INSERT INTO organization_memberships (
          organization_id, user_id, role, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          role = VALUES(role),
          status = VALUES(status),
          updated_at = VALUES(updated_at)
      `,
      [organizationId, userId, "owner", "active", now, now],
    );
  });

  return {
    email,
    password,
    userId,
    organizationId,
  };
}
