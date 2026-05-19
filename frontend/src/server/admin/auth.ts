import { and, eq } from "drizzle-orm";
import { readSessionToken, hashSessionToken } from "@/server/auth/session";
import type { AppDatabase } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";

export type AdminPrincipal =
  | {
      kind: "admin";
      userId: string;
    }
  | {
      kind: "local-bypass";
    };

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
  if (allowsLocalBypass()) {
    return { kind: "local-bypass" };
  }

  const sessionToken = readSessionToken(request);
  if (!sessionToken) {
    throw new AdminAuthError();
  }

  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashSessionToken(sessionToken)), eq(users.role, "admin")))
    .limit(1)
    .get();

  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new AdminAuthError();
  }

  db.update(sessions)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(sessions.id, row.sessionId))
    .run();

  return {
    kind: "admin",
    userId: row.userId,
  };
}
