import { asc, eq, isNotNull } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  normalizeAccountTier,
  normalizeUserRole,
  type AccountTier,
  type UserRole,
} from "@/server/auth/entitlements";

export interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  tier: AccountTier;
  isDisabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface UpdateAdminUserInput {
  role?: UserRole;
  tier?: AccountTier;
  isDisabled?: boolean;
}

export class AdminUserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "AdminUserNotFoundError";
  }
}

function toAdminUser(row: typeof users.$inferSelect): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: normalizeUserRole(row.role),
    tier: normalizeAccountTier(row.accountTier),
    isDisabled: row.isDisabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

function nowIso() {
  return new Date().toISOString();
}

export function listAdminUsers(db: AppDatabase): AdminUsersResponse {
  return {
    users: db
      .select()
      .from(users)
      .where(isNotNull(users.email))
      .orderBy(asc(users.createdAt), asc(users.id))
      .all()
      .map(toAdminUser),
  };
}

export function updateAdminUser(
  db: AppDatabase,
  userId: string,
  input: UpdateAdminUserInput,
): AdminUser {
  const values: Partial<typeof users.$inferInsert> = { updatedAt: nowIso() };

  if (input.role !== undefined) values.role = input.role;
  if (input.tier !== undefined) values.accountTier = input.tier;
  if (input.isDisabled !== undefined) values.isDisabled = input.isDisabled ? 1 : 0;

  db.update(users).set(values).where(eq(users.id, userId)).run();

  const row = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!row) {
    throw new AdminUserNotFoundError();
  }

  return toAdminUser(row);
}
