import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne, mysqlTransaction } from "@/server/db/mysql-runtime";
import {
  AccountDeletionRequiresOwnerTransferError,
  AccountLifecycleUserNotFoundError,
} from "./lifecycle";

interface MysqlLifecycleUserRow {
  id: string;
  email: string | null;
  isDisabled: number | string | null;
}

interface MysqlMembershipRow {
  organizationId: string;
  role: string;
}

function nowIso() {
  return new Date().toISOString();
}

async function findMysqlLifecycleUser(pool: Pool, userId: string) {
  return mysqlSelectOne<MysqlLifecycleUserRow>(
    pool,
    "SELECT id, email, is_disabled AS isDisabled FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
}

async function activeMysqlMemberships(pool: Pool, userId: string) {
  return mysqlSelectMany<MysqlMembershipRow>(
    pool,
    `
      SELECT organization_id AS organizationId, role
      FROM organization_memberships
      WHERE user_id = ? AND status = 'active'
    `,
    [userId],
  );
}

async function mysqlCount(pool: Pool, sql: string, values: unknown[]) {
  const row = await mysqlSelectOne<{ countValue: number | string }>(pool, sql, values);
  return Number(row?.countValue ?? 0);
}

async function ensureCanDeleteMysqlMemberships(pool: Pool, userId: string) {
  for (const membership of await activeMysqlMemberships(pool, userId)) {
    const activeOwners = await mysqlCount(
      pool,
      `
        SELECT COUNT(*) AS countValue
        FROM organization_memberships
        WHERE organization_id = ? AND status = 'active' AND role = 'owner'
      `,
      [membership.organizationId],
    );
    const activeOtherMembers = await mysqlCount(
      pool,
      `
        SELECT COUNT(*) AS countValue
        FROM organization_memberships
        WHERE organization_id = ? AND status = 'active' AND user_id <> ?
      `,
      [membership.organizationId, userId],
    );

    if (membership.role === "owner" && activeOwners <= 1 && activeOtherMembers > 0) {
      throw new AccountDeletionRequiresOwnerTransferError();
    }
  }
}

export async function softDeleteMysqlAccount(pool: Pool, userId: string) {
  const user = await findMysqlLifecycleUser(pool, userId);

  if (!user) {
    throw new AccountLifecycleUserNotFoundError();
  }

  await ensureCanDeleteMysqlMemberships(pool, userId);

  const timestamp = nowIso();
  const anonymizedEmail = `deleted-${userId}@deleted.local`;

  await mysqlTransaction(pool, async (connection) => {
    await mysqlExecute(connection, "DELETE FROM sessions WHERE user_id = ?", [userId]);
    await mysqlExecute(connection, "DELETE FROM password_reset_tokens WHERE user_id = ?", [userId]);
    await mysqlExecute(connection, "DELETE FROM organization_memberships WHERE user_id = ?", [userId]);
    await mysqlExecute(
      connection,
      `
        UPDATE users
        SET email = ?, password_hash = NULL, display_name = NULL, is_disabled = 1, updated_at = ?
        WHERE id = ?
      `,
      [anonymizedEmail, timestamp, userId],
    );
    await mysqlExecute(
      connection,
      `
        INSERT INTO admin_user_audit_logs (
          id, actor_kind, actor_user_id, target_user_id, action, changes_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `audit_${crypto.randomUUID()}`,
        "self-service",
        userId,
        userId,
        "user_self_deleted",
        JSON.stringify([
          { field: "email", before: user.email, after: anonymizedEmail },
          { field: "isDisabled", before: user.isDisabled === 1 || user.isDisabled === "1", after: true },
          { field: "workspaceAccess", before: "active", after: "removed" },
        ]),
        timestamp,
      ],
    );
  });

  return { ok: true as const };
}
