import crypto from "node:crypto";
import { and, asc, desc, eq, isNotNull, like, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { hashPassword } from "@/server/auth/password";
import { ensureUserWorkspace, syncOwnedWorkspaceTier } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { adminUserAuditLogs, organizationFeatureOverrides, users } from "@/server/db/schema";
import {
  isFeatureKey,
  normalizeAccountTier,
  normalizeUserRole,
  type AccountTier,
  type FeatureKey,
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

export interface CreateAdminUserInviteInput {
  email: string;
  displayName?: string;
  role: UserRole;
  tier: AccountTier;
}

export interface CreateAdminUserInviteResponse {
  user: AdminUser;
  temporaryPassword: string;
}

export interface AdminUserFeatureOverride {
  featureKey: FeatureKey;
  isEnabled: boolean;
}

export interface AdminUserFeatureOverridesResponse {
  organizationId: string;
  organizationName: string;
  overrides: AdminUserFeatureOverride[];
}

export interface UpdateAdminUserFeatureOverrideInput {
  featureKey: FeatureKey;
  isEnabled: boolean | null;
}

export interface AdminUserAuditActor {
  actorKind: "admin" | "local-bypass" | "self-service";
  actorUserId: string | null;
}

export type AdminUserAuditChange =
  | { field: "role"; before: UserRole; after: UserRole }
  | { field: "tier"; before: AccountTier; after: AccountTier }
  | { field: "isDisabled"; before: boolean; after: boolean }
  | { field: "featureOverride"; featureKey: FeatureKey; before: boolean | null; after: boolean | null }
  | { field: "created"; before: null; after: string }
  | { field: "email"; before: string | null; after: string | null }
  | { field: "workspaceAccess"; before: "active"; after: "removed" };

export interface AdminUserAuditLog {
  id: string;
  actorKind: "admin" | "local-bypass" | "self-service";
  actorUserId: string | null;
  targetUserId: string;
  targetEmail: string | null;
  action: "user_access_updated" | "user_invited" | "user_self_deleted";
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

export class AdminUserEmailExistsError extends Error {
  constructor() {
    super("Email is already registered");
    this.name = "AdminUserEmailExistsError";
  }
}

export class AdminUserFeatureOverrideError extends Error {
  constructor(message = "Unsupported feature override") {
    super(message);
    this.name = "AdminUserFeatureOverrideError";
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

function normalizeAuditActorKind(value: string): AdminUserAuditLog["actorKind"] {
  if (value === "admin") return "admin";
  if (value === "self-service") return "self-service";
  return "local-bypass";
}

function normalizeAuditAction(value: string): AdminUserAuditLog["action"] {
  if (value === "user_invited") return "user_invited";
  if (value === "user_self_deleted") return "user_self_deleted";
  return "user_access_updated";
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
    actorKind: normalizeAuditActorKind(row.actorKind),
    actorUserId: row.actorUserId,
    targetUserId: row.targetUserId,
    targetEmail: row.targetEmail,
    action: normalizeAuditAction(row.action),
    changes: parseAuditChanges(row.changesJson),
    createdAt: row.createdAt,
  };
}

function validateFeatureOverrideKey(featureKey: FeatureKey) {
  if (!isFeatureKey(featureKey) || featureKey === "admin_console") {
    throw new AdminUserFeatureOverrideError();
  }
}

function featureOverrideWorkspace(db: AppDatabase, userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!user?.email) {
    throw new AdminUserNotFoundError();
  }

  return ensureUserWorkspace(db, userId);
}

function listOrganizationFeatureOverrides(db: AppDatabase, organizationId: string): AdminUserFeatureOverride[] {
  return db
    .select({
      featureKey: organizationFeatureOverrides.featureKey,
      isEnabled: organizationFeatureOverrides.isEnabled,
    })
    .from(organizationFeatureOverrides)
    .where(eq(organizationFeatureOverrides.organizationId, organizationId))
    .orderBy(asc(organizationFeatureOverrides.featureKey))
    .all()
    .filter((row): row is { featureKey: FeatureKey; isEnabled: number } =>
      isFeatureKey(row.featureKey) && row.featureKey !== "admin_console",
    )
    .map((row) => ({
      featureKey: row.featureKey,
      isEnabled: row.isEnabled === 1,
    }));
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string | undefined) {
  const normalized = displayName?.trim();

  return normalized ? normalized : null;
}

function temporaryPassword() {
  return `Temp-${crypto.randomBytes(12).toString("base64url")}`;
}

function isUniqueEmailConflict(error: unknown) {
  if (!(error instanceof Error)) return false;

  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    code.includes("SQLITE_CONSTRAINT") ||
    error.message.includes("UNIQUE constraint failed: users.email")
  );
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

export async function createAdminUserInvite(
  db: AppDatabase,
  input: CreateAdminUserInviteInput,
  actor: AdminUserAuditActor = { actorKind: "local-bypass", actorUserId: null },
): Promise<CreateAdminUserInviteResponse> {
  const email = normalizeEmail(input.email);

  if (!email) {
    throw new AdminUserEmailExistsError();
  }

  const timestamp = nowIso();
  const password = temporaryPassword();
  const user = {
    id: `user_${crypto.randomUUID()}`,
    email,
    passwordHash: await hashPassword(password),
    displayName: normalizeDisplayName(input.displayName),
    role: input.role,
    accountTier: input.tier,
    isDisabled: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    db.insert(users).values(user).run();
  } catch (error) {
    if (isUniqueEmailConflict(error)) {
      throw new AdminUserEmailExistsError();
    }

    throw error;
  }

  db.insert(adminUserAuditLogs)
    .values({
      id: `audit_${crypto.randomUUID()}`,
      actorKind: actor.actorKind,
      actorUserId: actor.actorUserId,
      targetUserId: user.id,
      action: "user_invited",
      changesJson: JSON.stringify([{ field: "created", before: null, after: email }]),
      createdAt: timestamp,
    })
    .run();

  return {
    user: toAdminUser({
      ...user,
      lastLoginAt: null,
    }),
    temporaryPassword: password,
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
  if (input.tier !== undefined) {
    syncOwnedWorkspaceTier(db, userId, input.tier, values.updatedAt);
  }

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

export function listAdminUserFeatureOverrides(db: AppDatabase, userId: string): AdminUserFeatureOverridesResponse {
  const workspace = featureOverrideWorkspace(db, userId);

  return {
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    overrides: listOrganizationFeatureOverrides(db, workspace.organizationId),
  };
}

export function updateAdminUserFeatureOverride(
  db: AppDatabase,
  userId: string,
  input: UpdateAdminUserFeatureOverrideInput,
  actor: AdminUserAuditActor = { actorKind: "local-bypass", actorUserId: null },
): AdminUserFeatureOverridesResponse {
  validateFeatureOverrideKey(input.featureKey);

  const workspace = featureOverrideWorkspace(db, userId);
  const timestamp = nowIso();
  const before = db
    .select()
    .from(organizationFeatureOverrides)
    .where(and(
      eq(organizationFeatureOverrides.organizationId, workspace.organizationId),
      eq(organizationFeatureOverrides.featureKey, input.featureKey),
    ))
    .limit(1)
    .get();
  const beforeValue = before ? before.isEnabled === 1 : null;

  if (input.isEnabled === null) {
    db.delete(organizationFeatureOverrides)
      .where(and(
        eq(organizationFeatureOverrides.organizationId, workspace.organizationId),
        eq(organizationFeatureOverrides.featureKey, input.featureKey),
      ))
      .run();
  } else if (before) {
    db.update(organizationFeatureOverrides)
      .set({
        isEnabled: input.isEnabled ? 1 : 0,
        createdByUserId: actor.actorUserId,
        updatedAt: timestamp,
      })
      .where(and(
        eq(organizationFeatureOverrides.organizationId, workspace.organizationId),
        eq(organizationFeatureOverrides.featureKey, input.featureKey),
      ))
      .run();
  } else {
    db.insert(organizationFeatureOverrides)
      .values({
        organizationId: workspace.organizationId,
        featureKey: input.featureKey,
        isEnabled: input.isEnabled ? 1 : 0,
        createdByUserId: actor.actorUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  if (beforeValue !== input.isEnabled) {
    db.insert(adminUserAuditLogs)
      .values({
        id: `audit_${crypto.randomUUID()}`,
        actorKind: actor.actorKind,
        actorUserId: actor.actorUserId,
        targetUserId: userId,
        action: "user_access_updated",
        changesJson: JSON.stringify([{
          field: "featureOverride",
          featureKey: input.featureKey,
          before: beforeValue,
          after: input.isEnabled,
        }]),
        createdAt: timestamp,
      })
      .run();
  }

  return {
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    overrides: listOrganizationFeatureOverrides(db, workspace.organizationId),
  };
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
