import { and, eq } from "drizzle-orm";
import { ADMIN_CONSOLE_ROLES, normalizeUserRole, type AdminConsoleRole } from "@/server/auth/entitlements";
import { readSessionToken, hashSessionToken } from "@/server/auth/session";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlExecute, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { sessions, users } from "@/server/db/schema";

export type AdminAccessRole = AdminConsoleRole;

export type AdminPrincipal =
  | {
      kind: "admin";
      userId: string;
    }
  | {
      kind: "local-bypass";
    };

export type AdminAccessPrincipal =
  | {
      kind: "admin";
      role: AdminAccessRole;
      userId: string;
    }
  | {
      kind: "local-bypass";
    };

interface RequireAdminAccessOptions {
  roles?: AdminAccessRole[];
}

export class AdminAuthError extends Error {
  code = "FORBIDDEN" as const;
  status = 403;

  constructor(message = "Admin access is required.") {
    super(message);
    this.name = "AdminAuthError";
  }
}

function allowsLocalBypass() {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_UI_LOCAL_BYPASS === "true";
}

export async function requireAdmin(db: AppDatabase, request: Request): Promise<AdminPrincipal> {
  const principal = await requireAdminAccess(db, request, { roles: ["admin"] });

  if (principal.kind === "local-bypass") {
    return principal;
  }

  return {
    kind: "admin",
    userId: principal.userId,
  };
}

export async function requireAdminAccess(
  db: AppDatabase,
  request: Request,
  options: RequireAdminAccessOptions = {},
): Promise<AdminAccessPrincipal> {
  if (allowsLocalBypass()) {
    return { kind: "local-bypass" };
  }

  const allowedRoles = options.roles ?? ADMIN_CONSOLE_ROLES;
  const sessionToken = readSessionToken(request);
  if (!sessionToken) {
    throw new AdminAuthError();
  }

  if (isMysqlDatabaseUrlConfigured()) {
    const mysql = resolveMysqlPool();
    const row = await mysqlSelectOne<{
      sessionId: string;
      expiresAt: string;
      userId: string;
      role: string | null;
      isDisabled: number | string | null;
    }>(
      mysql,
      `
        SELECT
          sessions.id AS sessionId,
          sessions.expires_at AS expiresAt,
          users.id AS userId,
          users.role AS role,
          users.is_disabled AS isDisabled
        FROM sessions
        INNER JOIN users ON sessions.user_id = users.id
        WHERE sessions.token_hash = ? AND users.is_disabled = 0
        LIMIT 1
      `,
      [hashSessionToken(sessionToken)],
    );
    const role = normalizeUserRole(row?.role);

    if (!row || new Date(row.expiresAt).getTime() <= Date.now() || !allowedRoles.includes(role as AdminAccessRole)) {
      throw new AdminAuthError();
    }

    await mysqlExecute(mysql, "UPDATE sessions SET last_seen_at = ? WHERE id = ?", [
      new Date().toISOString(),
      row.sessionId,
    ]);

    return {
      kind: "admin",
      role: role as AdminAccessRole,
      userId: row.userId,
    };
  }

  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      role: users.role,
      isDisabled: users.isDisabled,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(sessionToken)),
        eq(users.isDisabled, 0),
      ),
    )
    .limit(1)
    .get();

  const role = normalizeUserRole(row?.role);
  if (!row || new Date(row.expiresAt).getTime() <= Date.now() || !allowedRoles.includes(role as AdminAccessRole)) {
    throw new AdminAuthError();
  }

  db.update(sessions)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(sessions.id, row.sessionId))
    .run();

  return {
    kind: "admin",
    role: role as AdminAccessRole,
    userId: row.userId,
  };
}
