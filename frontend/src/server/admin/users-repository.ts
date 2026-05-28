import crypto from "node:crypto";
import { and, asc, desc, eq, isNotNull, like, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { adminUserAuditLogs, users } from "@/server/db/schema";
import {
  normalizeAccountTier,
  normalizeUserRole,
  type AccountTier,
  type UserRole,
} from "@/server/auth/entitlements";

export type AdminUserFilterStatus = "enabled" | "disabled";

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

export interface ListAdminUsersFilters {
  q?: string;
  role?: UserRole;
  tier?: AccountTier;
  status?: AdminUserFilterStatus;
}

export interface UpdateAdminUserInput {
  role?: UserRole;
  tier?: AccountTier;
  isDisabled?: boolean;
}

export interface AdminUserAuditActor {
  actorKind: "admin" | "local-bypass";
  actorUserId: string | null;
}

export type AdminUserAuditChange =
  | { field: "role"; before: UserRole; after: UserRole }
  | { field: "tier"; before: AccountTier; after: AccountTier }
  | { field: "isDisabled"; before: boolean; after: boolean };

export interface AdminUserAuditLog {
  id: string;
  actorKind: "admin" | "local-bypass";
  actorUserId: string | null;
  targetUserId: string;
  targetEmail: string | null;
  action: "user_access_updated";
  changes: AdminUserAuditChange[];
  createdAt: string;
}

export interface AdminUserAuditLogsResponse {
  logs: AdminUserAuditLog[];
}

export interface ListAdminUserAuditLogsOptions {
  limit?: number;
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

function parseAuditChanges(value: string): AdminUserAuditChange[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as AdminUserAuditChange[] : [];
  } catch {
    return [];
  }
}

function toAuditLog(row: {
  id: string;
  actorKind: string;
  actorUserId: string | null;
  targetUserId: string;
  targetEmail: string | null;
  action: string;
  changesJson: string;
  createdAt: string;
}): AdminUserAuditLog {
  return {
    id: row.id,
    actorKind: row.actorKind === "admin" ? "admin" : "local-bypass",
    actorUserId: row.actorUserId,
    targetUserId: row.targetUserId,
    targetEmail: row.targetEmail,
    action: "user_access_updated",
    changes: parseAuditChanges(row.changesJson),
    createdAt: row.createdAt,
  };
}

export function listAdminUsers(db: AppDatabase, filters: ListAdminUsersFilters = {}): AdminUsersResponse {
  const conditions: SQL[] = [isNotNull(users.email)];
  const query = filters.q?.trim();

  if (query) {
    const pattern = `%${query}%`;
    const searchCondition = or(
      like(users.email, pattern),
      like(users.displayName, pattern),
      like(users.id, pattern),
    );

    if (searchCondition) conditions.push(searchCondition);
  }

  if (filters.role) conditions.push(eq(users.role, filters.role));
  if (filters.tier) conditions.push(eq(users.accountTier, filters.tier));
  if (filters.status) conditions.push(eq(users.isDisabled, filters.status === "disabled" ? 1 : 0));

  return {
    users: db
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.createdAt), asc(users.id))
      .all()
      .map(toAdminUser),
  };
}

export function updateAdminUser(
  db: AppDatabase,
  userId: string,
  input: UpdateAdminUserInput,
  actor: AdminUserAuditActor = { actorKind: "local-bypass", actorUserId: null },
): AdminUser {
  const before = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!before) {
    throw new AdminUserNotFoundError();
  }

  const values: Partial<typeof users.$inferInsert> = { updatedAt: nowIso() };
  const changes: AdminUserAuditChange[] = [];
  const beforeRole = normalizeUserRole(before.role);
  const beforeTier = normalizeAccountTier(before.accountTier);
  const beforeIsDisabled = before.isDisabled === 1;

  if (input.role !== undefined) {
    values.role = input.role;
    if (input.role !== beforeRole) changes.push({ field: "role", before: beforeRole, after: input.role });
  }

  if (input.tier !== undefined) {
    values.accountTier = input.tier;
    if (input.tier !== beforeTier) changes.push({ field: "tier", before: beforeTier, after: input.tier });
  }

  if (input.isDisabled !== undefined) {
    values.isDisabled = input.isDisabled ? 1 : 0;
    if (input.isDisabled !== beforeIsDisabled) {
      changes.push({ field: "isDisabled", before: beforeIsDisabled, after: input.isDisabled });
    }
  }

  db.update(users).set(values).where(eq(users.id, userId)).run();

  const row = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!row) {
    throw new AdminUserNotFoundError();
  }

  if (changes.length > 0) {
    db.insert(adminUserAuditLogs)
      .values({
        id: `audit_${crypto.randomUUID()}`,
        actorKind: actor.actorKind,
        actorUserId: actor.actorUserId,
        targetUserId: userId,
        action: "user_access_updated",
        changesJson: JSON.stringify(changes),
        createdAt: nowIso(),
      })
      .run();
  }

  return toAdminUser(row);
}

export function listAdminUserAuditLogs(
  db: AppDatabase,
  options: ListAdminUserAuditLogsOptions = {},
): AdminUserAuditLogsResponse {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  return {
    logs: db
      .select({
        id: adminUserAuditLogs.id,
        actorKind: adminUserAuditLogs.actorKind,
        actorUserId: adminUserAuditLogs.actorUserId,
        targetUserId: adminUserAuditLogs.targetUserId,
        targetEmail: users.email,
        action: adminUserAuditLogs.action,
        changesJson: adminUserAuditLogs.changesJson,
        createdAt: adminUserAuditLogs.createdAt,
      })
      .from(adminUserAuditLogs)
      .leftJoin(users, eq(adminUserAuditLogs.targetUserId, users.id))
      .orderBy(desc(adminUserAuditLogs.createdAt), desc(adminUserAuditLogs.id))
      .limit(limit)
      .all()
      .map(toAuditLog),
  };
}
