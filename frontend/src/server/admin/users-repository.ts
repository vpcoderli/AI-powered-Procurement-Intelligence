import crypto from "node:crypto";
import { and, asc, desc, eq, isNotNull, like, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { hashPassword } from "@/server/auth/password";
import { ensureUserWorkspace, syncOwnedWorkspaceTier } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
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
export type AdminUserAuditActorKind = "admin" | "local-bypass" | "self-service";
export type AdminUserAuditAction = "user_access_updated" | "user_invited" | "user_self_deleted";

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
  reason: string | null;
  expiresAt: string | null;
  isExpired: boolean;
}

export interface AdminUserFeatureOverridesResponse {
  organizationId: string;
  organizationName: string;
  overrides: AdminUserFeatureOverride[];
}

export interface UpdateAdminUserFeatureOverrideInput {
  featureKey: FeatureKey;
  isEnabled: boolean | null;
  reason?: string | null;
  expiresAt?: string | null;
}

export interface AdminUserAuditActor {
  actorKind: AdminUserAuditActorKind;
  actorUserId: string | null;
}

export type AdminUserAuditChange =
  | { field: "role"; before: UserRole; after: UserRole }
  | { field: "tier"; before: AccountTier; after: AccountTier }
  | { field: "isDisabled"; before: boolean; after: boolean }
  | {
      field: "featureOverride";
      featureKey: FeatureKey;
      before: AdminUserFeatureOverrideAuditState | null;
      after: AdminUserFeatureOverrideAuditState | null;
    }
  | { field: "created"; before: null; after: string }
  | { field: "email"; before: string | null; after: string | null }
  | { field: "workspaceAccess"; before: "active"; after: "removed" };

export interface AdminUserAuditLog {
  id: string;
  actorKind: AdminUserAuditActorKind;
  actorUserId: string | null;
  targetUserId: string;
  targetEmail: string | null;
  action: AdminUserAuditAction;
  changes: AdminUserAuditChange[];
  createdAt: string;
}

export interface AdminUserFeatureOverrideAuditState {
  isEnabled: boolean;
  reason: string | null;
  expiresAt: string | null;
}

export interface AdminUserAuditLogsResponse {
  logs: AdminUserAuditLog[];
}

export interface ListAdminUserAuditLogsOptions {
  limit?: number;
  actorKind?: AdminUserAuditActorKind;
  action?: AdminUserAuditAction;
  target?: string;
  featureKey?: FeatureKey;
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

interface MysqlAdminUsersStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlAdminUserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
  accountTier: string;
  isDisabled: number | string | boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface MysqlAdminWorkspaceRow {
  organizationId: string;
  organizationName: string;
  role: string;
  tier: string;
}

interface MysqlFeatureOverrideRow {
  featureKey: string;
  isEnabled: number | string | boolean;
  reason: string | null;
  expiresAt: string | null;
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

function mysqlBoolean(value: number | string | boolean | null | undefined) {
  return value === true || value === 1 || value === "1";
}

function toAdminUserFromMysql(row: MysqlAdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: normalizeUserRole(row.role),
    tier: normalizeAccountTier(row.accountTier),
    isDisabled: mysqlBoolean(row.isDisabled),
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

function auditLogMatchesFeature(log: AdminUserAuditLog, featureKey: FeatureKey) {
  return log.changes.some((change) => change.field === "featureOverride" && change.featureKey === featureKey);
}

function validateFeatureOverrideKey(featureKey: FeatureKey) {
  if (!isFeatureKey(featureKey) || featureKey === "admin_console") {
    throw new AdminUserFeatureOverrideError();
  }
}

function normalizeFeatureOverrideReason(reason: string | null | undefined) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";

  return trimmed ? trimmed : null;
}

function normalizeFeatureOverrideExpiresAt(expiresAt: string | null | undefined) {
  if (!expiresAt) return null;

  const timestamp = new Date(expiresAt).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new AdminUserFeatureOverrideError("Feature override expiry must be an ISO date.");
  }

  return new Date(timestamp).toISOString();
}

function isExpired(expiresAt: string | null, now = new Date()) {
  return expiresAt ? new Date(expiresAt).getTime() <= now.getTime() : false;
}

function toFeatureOverrideAuditState(row: { isEnabled: number; reason?: string | null; expiresAt?: string | null } | undefined | null) {
  if (!row) return null;

  return {
    isEnabled: row.isEnabled === 1,
    reason: row.reason ?? null,
    expiresAt: row.expiresAt ?? null,
  };
}

function toFeatureOverrideAuditStateFromMysql(row: MysqlFeatureOverrideRow | undefined | null) {
  if (!row) return null;

  return {
    isEnabled: mysqlBoolean(row.isEnabled),
    reason: row.reason ?? null,
    expiresAt: row.expiresAt ?? null,
  };
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
      reason: organizationFeatureOverrides.reason,
      expiresAt: organizationFeatureOverrides.expiresAt,
    })
    .from(organizationFeatureOverrides)
    .where(eq(organizationFeatureOverrides.organizationId, organizationId))
    .orderBy(asc(organizationFeatureOverrides.featureKey))
    .all()
    .filter((row): row is { featureKey: FeatureKey; isEnabled: number; reason: string | null; expiresAt: string | null } =>
      isFeatureKey(row.featureKey) && row.featureKey !== "admin_console",
    )
    .map((row) => ({
      featureKey: row.featureKey,
      isEnabled: row.isEnabled === 1,
      reason: row.reason,
      expiresAt: row.expiresAt,
      isExpired: isExpired(row.expiresAt),
    }));
}

async function featureOverrideWorkspaceFromMysql(mysql: MysqlAdminUsersStore, userId: string) {
  const user = await mysqlSelectOne<{ email: string | null }>(
    mysql,
    "SELECT email FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  if (!user?.email) {
    throw new AdminUserNotFoundError();
  }

  let workspace = await mysqlSelectOne<MysqlAdminWorkspaceRow>(
    mysql,
    `
      SELECT
        organizations.id AS organizationId,
        organizations.name AS organizationName,
        organization_memberships.role AS role,
        organizations.account_tier AS tier
      FROM organization_memberships
      INNER JOIN organizations ON organizations.id = organization_memberships.organization_id
      WHERE organization_memberships.user_id = ? AND organization_memberships.status = 'active'
      ORDER BY organization_memberships.created_at ASC
      LIMIT 1
    `,
    [userId],
  );

  if (!workspace) {
    const timestamp = nowIso();
    const organizationId = `org_${crypto.randomUUID()}`;
    await mysqlExecute(
      mysql,
      "INSERT INTO organizations (id, name, account_tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [organizationId, `${user.email} Workspace`, "free", timestamp, timestamp],
    );
    await mysqlExecute(
      mysql,
      `
        INSERT INTO organization_memberships (
          organization_id,
          user_id,
          role,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [organizationId, userId, "owner", "active", timestamp, timestamp],
    );
    workspace = {
      organizationId,
      organizationName: `${user.email} Workspace`,
      role: "owner",
      tier: "free",
    };
  }

  return workspace;
}

async function listOrganizationFeatureOverridesFromMysql(
  mysql: MysqlAdminUsersStore,
  organizationId: string,
): Promise<AdminUserFeatureOverride[]> {
  const rows = await mysqlSelectMany<MysqlFeatureOverrideRow>(
    mysql,
    `
      SELECT
        feature_key AS featureKey,
        is_enabled AS isEnabled,
        reason,
        expires_at AS expiresAt
      FROM organization_feature_overrides
      WHERE organization_id = ?
      ORDER BY feature_key ASC
    `,
    [organizationId],
  );

  return rows
    .filter((row): row is MysqlFeatureOverrideRow & { featureKey: FeatureKey } =>
      isFeatureKey(row.featureKey) && row.featureKey !== "admin_console",
    )
    .map((row) => ({
      featureKey: row.featureKey,
      isEnabled: mysqlBoolean(row.isEnabled),
      reason: row.reason,
      expiresAt: row.expiresAt,
      isExpired: isExpired(row.expiresAt),
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
    code.includes("ER_DUP_ENTRY") ||
    error.message.includes("UNIQUE constraint failed: users.email")
  );
}

function mysqlAdminUserSelectSql(whereClause: string) {
  return `
    SELECT
      id,
      email,
      display_name AS displayName,
      role,
      account_tier AS accountTier,
      is_disabled AS isDisabled,
      created_at AS createdAt,
      updated_at AS updatedAt,
      last_login_at AS lastLoginAt
    FROM users
    ${whereClause}
  `;
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

export async function listAdminUsersFromMysql(
  mysql: MysqlAdminUsersStore,
  filters: ListAdminUsersFilters = {},
): Promise<AdminUsersResponse> {
  const conditions = ["email IS NOT NULL"];
  const values: unknown[] = [];
  const query = filters.q?.trim();

  if (query) {
    const pattern = `%${query}%`;
    conditions.push("(email LIKE ? OR display_name LIKE ? OR id LIKE ?)");
    values.push(pattern, pattern, pattern);
  }

  if (filters.role) {
    conditions.push("role = ?");
    values.push(filters.role);
  }
  if (filters.tier) {
    conditions.push("account_tier = ?");
    values.push(filters.tier);
  }
  if (filters.status) {
    conditions.push("is_disabled = ?");
    values.push(filters.status === "disabled" ? 1 : 0);
  }

  const rows = await mysqlSelectMany<MysqlAdminUserRow>(
    mysql,
    `${mysqlAdminUserSelectSql(`WHERE ${conditions.join(" AND ")}`)}
     ORDER BY created_at ASC, id ASC`,
    values,
  );

  return { users: rows.map(toAdminUserFromMysql) };
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

export async function createAdminUserInviteFromMysql(
  mysql: MysqlAdminUsersStore,
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
    await mysqlExecute(
      mysql,
      `
        INSERT INTO users (
          id,
          email,
          password_hash,
          display_name,
          role,
          account_tier,
          is_disabled,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        user.id,
        user.email,
        user.passwordHash,
        user.displayName,
        user.role,
        user.accountTier,
        user.isDisabled,
        user.createdAt,
        user.updatedAt,
      ],
    );
  } catch (error) {
    if (isUniqueEmailConflict(error)) {
      throw new AdminUserEmailExistsError();
    }

    throw error;
  }

  await mysqlExecute(
    mysql,
    `
      INSERT INTO admin_user_audit_logs (
        id,
        actor_kind,
        actor_user_id,
        target_user_id,
        action,
        changes_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      `audit_${crypto.randomUUID()}`,
      actor.actorKind,
      actor.actorUserId,
      user.id,
      "user_invited",
      JSON.stringify([{ field: "created", before: null, after: email }]),
      timestamp,
    ],
  );

  return {
    user: toAdminUserFromMysql({
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

export async function updateAdminUserFromMysql(
  mysql: MysqlAdminUsersStore,
  userId: string,
  input: UpdateAdminUserInput,
  actor: AdminUserAuditActor = { actorKind: "local-bypass", actorUserId: null },
): Promise<AdminUser> {
  const before = await mysqlSelectOne<MysqlAdminUserRow>(
    mysql,
    `${mysqlAdminUserSelectSql("WHERE id = ?")} LIMIT 1`,
    [userId],
  );

  if (!before) {
    throw new AdminUserNotFoundError();
  }

  const timestamp = nowIso();
  const assignments = ["updated_at = ?"];
  const values: unknown[] = [timestamp];
  const changes: AdminUserAuditChange[] = [];
  const beforeRole = normalizeUserRole(before.role);
  const beforeTier = normalizeAccountTier(before.accountTier);
  const beforeIsDisabled = mysqlBoolean(before.isDisabled);

  if (input.role !== undefined) {
    assignments.unshift("role = ?");
    values.unshift(input.role);
    if (input.role !== beforeRole) changes.push({ field: "role", before: beforeRole, after: input.role });
  }

  if (input.tier !== undefined) {
    assignments.splice(assignments.length - 1, 0, "account_tier = ?");
    values.splice(values.length - 1, 0, input.tier);
    if (input.tier !== beforeTier) changes.push({ field: "tier", before: beforeTier, after: input.tier });
  }

  if (input.isDisabled !== undefined) {
    assignments.splice(assignments.length - 1, 0, "is_disabled = ?");
    values.splice(values.length - 1, 0, input.isDisabled ? 1 : 0);
    if (input.isDisabled !== beforeIsDisabled) {
      changes.push({ field: "isDisabled", before: beforeIsDisabled, after: input.isDisabled });
    }
  }

  await mysqlExecute(
    mysql,
    `UPDATE users SET ${assignments.join(", ")} WHERE id = ?`,
    [...values, userId],
  );

  if (input.tier !== undefined) {
    await mysqlExecute(
      mysql,
      `
        UPDATE organizations
        INNER JOIN organization_memberships
          ON organization_memberships.organization_id = organizations.id
        SET organizations.account_tier = ?, organizations.updated_at = ?
        WHERE organization_memberships.user_id = ?
          AND organization_memberships.role = 'owner'
          AND organization_memberships.status = 'active'
      `,
      [input.tier, timestamp, userId],
    );
  }

  const row = await mysqlSelectOne<MysqlAdminUserRow>(
    mysql,
    `${mysqlAdminUserSelectSql("WHERE id = ?")} LIMIT 1`,
    [userId],
  );

  if (!row) {
    throw new AdminUserNotFoundError();
  }

  if (changes.length > 0) {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO admin_user_audit_logs (
          id,
          actor_kind,
          actor_user_id,
          target_user_id,
          action,
          changes_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `audit_${crypto.randomUUID()}`,
        actor.actorKind,
        actor.actorUserId,
        userId,
        "user_access_updated",
        JSON.stringify(changes),
        timestamp,
      ],
    );
  }

  return toAdminUserFromMysql(row);
}

export function listAdminUserFeatureOverrides(db: AppDatabase, userId: string): AdminUserFeatureOverridesResponse {
  const workspace = featureOverrideWorkspace(db, userId);

  return {
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    overrides: listOrganizationFeatureOverrides(db, workspace.organizationId),
  };
}

export async function listAdminUserFeatureOverridesFromMysql(
  mysql: MysqlAdminUsersStore,
  userId: string,
): Promise<AdminUserFeatureOverridesResponse> {
  const workspace = await featureOverrideWorkspaceFromMysql(mysql, userId);

  return {
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    overrides: await listOrganizationFeatureOverridesFromMysql(mysql, workspace.organizationId),
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
  const beforeValue = toFeatureOverrideAuditState(before);
  const reason = normalizeFeatureOverrideReason(input.reason);
  const expiresAt = normalizeFeatureOverrideExpiresAt(input.expiresAt);

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
        reason,
        expiresAt,
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
        reason,
        expiresAt,
        createdByUserId: actor.actorUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  const afterValue = input.isEnabled === null ? null : { isEnabled: input.isEnabled, reason, expiresAt };
  if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
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
          after: afterValue,
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

export async function updateAdminUserFeatureOverrideFromMysql(
  mysql: MysqlAdminUsersStore,
  userId: string,
  input: UpdateAdminUserFeatureOverrideInput,
  actor: AdminUserAuditActor = { actorKind: "local-bypass", actorUserId: null },
): Promise<AdminUserFeatureOverridesResponse> {
  validateFeatureOverrideKey(input.featureKey);

  const workspace = await featureOverrideWorkspaceFromMysql(mysql, userId);
  const timestamp = nowIso();
  const before = await mysqlSelectOne<MysqlFeatureOverrideRow>(
    mysql,
    `
      SELECT
        feature_key AS featureKey,
        is_enabled AS isEnabled,
        reason,
        expires_at AS expiresAt
      FROM organization_feature_overrides
      WHERE organization_id = ? AND feature_key = ?
      LIMIT 1
    `,
    [workspace.organizationId, input.featureKey],
  );
  const beforeValue = toFeatureOverrideAuditStateFromMysql(before);
  const reason = normalizeFeatureOverrideReason(input.reason);
  const expiresAt = normalizeFeatureOverrideExpiresAt(input.expiresAt);

  if (input.isEnabled === null) {
    await mysqlExecute(
      mysql,
      "DELETE FROM organization_feature_overrides WHERE organization_id = ? AND feature_key = ?",
      [workspace.organizationId, input.featureKey],
    );
  } else if (before) {
    await mysqlExecute(
      mysql,
      `
        UPDATE organization_feature_overrides
        SET is_enabled = ?,
            reason = ?,
            expires_at = ?,
            created_by_user_id = ?,
            updated_at = ?
        WHERE organization_id = ? AND feature_key = ?
      `,
      [
        input.isEnabled ? 1 : 0,
        reason,
        expiresAt,
        actor.actorUserId,
        timestamp,
        workspace.organizationId,
        input.featureKey,
      ],
    );
  } else {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO organization_feature_overrides (
          organization_id,
          feature_key,
          is_enabled,
          reason,
          expires_at,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        workspace.organizationId,
        input.featureKey,
        input.isEnabled ? 1 : 0,
        reason,
        expiresAt,
        actor.actorUserId,
        timestamp,
        timestamp,
      ],
    );
  }

  const afterValue = input.isEnabled === null ? null : { isEnabled: input.isEnabled, reason, expiresAt };
  if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO admin_user_audit_logs (
          id,
          actor_kind,
          actor_user_id,
          target_user_id,
          action,
          changes_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `audit_${crypto.randomUUID()}`,
        actor.actorKind,
        actor.actorUserId,
        userId,
        "user_access_updated",
        JSON.stringify([{
          field: "featureOverride",
          featureKey: input.featureKey,
          before: beforeValue,
          after: afterValue,
        }]),
        timestamp,
      ],
    );
  }

  return {
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    overrides: await listOrganizationFeatureOverridesFromMysql(mysql, workspace.organizationId),
  };
}

export function listAdminUserAuditLogs(
  db: AppDatabase,
  options: ListAdminUserAuditLogsOptions = {},
): AdminUserAuditLogsResponse {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const target = options.target?.trim();
  const conditions: SQL[] = [];

  if (options.actorKind) {
    conditions.push(eq(adminUserAuditLogs.actorKind, options.actorKind));
  }

  if (options.action) {
    conditions.push(eq(adminUserAuditLogs.action, options.action));
  }

  if (target) {
    const targetPattern = `%${target}%`;
    conditions.push(or(
      like(adminUserAuditLogs.targetUserId, targetPattern),
      like(users.email, targetPattern),
      like(users.displayName, targetPattern),
    ) as SQL);
  }

  const query = db
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
    .leftJoin(users, eq(adminUserAuditLogs.targetUserId, users.id));

  const rows = (conditions.length > 0 ? query.where(and(...conditions)) : query)
    .orderBy(desc(adminUserAuditLogs.createdAt), desc(adminUserAuditLogs.id))
    .all()
    .map(toAuditLog)
    .filter((log) => (options.featureKey ? auditLogMatchesFeature(log, options.featureKey) : true))
    .slice(0, limit);

  return {
    logs: rows,
  };
}

export async function listAdminUserAuditLogsFromMysql(
  mysql: MysqlAdminUsersStore,
  options: ListAdminUserAuditLogsOptions = {},
): Promise<AdminUserAuditLogsResponse> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const rows = await mysqlSelectMany<Parameters<typeof toAuditLog>[0]>(
    mysql,
    `
      SELECT
        admin_user_audit_logs.id AS id,
        admin_user_audit_logs.actor_kind AS actorKind,
        admin_user_audit_logs.actor_user_id AS actorUserId,
        admin_user_audit_logs.target_user_id AS targetUserId,
        users.email AS targetEmail,
        admin_user_audit_logs.action AS action,
        admin_user_audit_logs.changes_json AS changesJson,
        admin_user_audit_logs.created_at AS createdAt
      FROM admin_user_audit_logs
      LEFT JOIN users ON admin_user_audit_logs.target_user_id = users.id
      ORDER BY admin_user_audit_logs.created_at DESC, admin_user_audit_logs.id DESC
      LIMIT 200
    `,
  );
  const target = options.target?.trim().toLowerCase();
  const logs = rows
    .map(toAuditLog)
    .filter((log) => (options.actorKind ? log.actorKind === options.actorKind : true))
    .filter((log) => (options.action ? log.action === options.action : true))
    .filter((log) => {
      if (!target) return true;
      return [
        log.targetUserId,
        log.targetEmail ?? "",
      ].some((value) => value.toLowerCase().includes(target));
    })
    .filter((log) => (options.featureKey ? auditLogMatchesFeature(log, options.featureKey) : true))
    .slice(0, limit);

  return { logs };
}
