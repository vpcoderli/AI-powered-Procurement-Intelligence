import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { PublicWorkspace } from "@/server/account/workspace";
import {
  applyFeatureOverrides,
  featuresForUser,
  normalizeAccountTier,
  normalizeUserRole,
  type FeatureKey,
} from "@/server/auth/entitlements";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSessionToken, hashSessionToken, SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne, mysqlTransaction } from "@/server/db/mysql-runtime";
import {
  AccountDisabledError,
  DuplicateEmailError,
  InvalidAuthInputError,
  InvalidCredentialsError,
  type ChangeUserPasswordInput,
  type PublicUser,
  type RegisterUserInput,
  type UpdateUserProfileInput,
  WeakPasswordError,
} from "./service";

interface MysqlUserRow {
  id: string;
  email: string | null;
  passwordHash: string | null;
  displayName: string | null;
  role: string | null;
  accountTier: string | null;
  isDisabled: number | string | null;
}

interface MysqlWorkspaceRow {
  organizationId: string;
  organizationName: string;
  role: string;
  tier: string | null;
}

interface MysqlFeatureOverrideRow {
  featureKey: FeatureKey;
  isEnabled: number | string;
  expiresAt: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string | undefined) {
  const normalized = displayName?.trim();
  return normalized ? normalized : null;
}

function workspaceNameForUser(input: RegisterUserInput, email: string) {
  return normalizeDisplayName(input.displayName) ? `${normalizeDisplayName(input.displayName)}'s Workspace` : `${email}'s Workspace`;
}

function isEnabledOverride(row: MysqlFeatureOverrideRow) {
  return row.isEnabled === 1 || row.isEnabled === "1";
}

async function mysqlOrganizationOverrides(pool: Pool, workspace?: PublicWorkspace) {
  if (!workspace) return [];

  const rows = await mysqlSelectMany<MysqlFeatureOverrideRow>(
    pool,
    `
      SELECT feature_key AS featureKey, is_enabled AS isEnabled, expires_at AS expiresAt
      FROM organization_feature_overrides
      WHERE organization_id = ?
    `,
    [workspace.organizationId],
  );

  return rows.map((row) => ({
    featureKey: row.featureKey,
    isEnabled: isEnabledOverride(row) ? 1 : 0,
    expiresAt: row.expiresAt,
  }));
}

async function mysqlWorkspaceForUser(pool: Pool, userId: string): Promise<PublicWorkspace | undefined> {
  const row = await mysqlSelectOne<MysqlWorkspaceRow>(
    pool,
    `
      SELECT
        organization_memberships.organization_id AS organizationId,
        organizations.name AS organizationName,
        organization_memberships.role AS role,
        organizations.account_tier AS tier
      FROM organization_memberships
      INNER JOIN organizations ON organization_memberships.organization_id = organizations.id
      WHERE organization_memberships.user_id = ? AND organization_memberships.status = 'active'
      ORDER BY organization_memberships.created_at ASC
      LIMIT 1
    `,
    [userId],
  );

  if (!row) return undefined;

  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: row.role as PublicWorkspace["role"],
    tier: normalizeAccountTier(row.tier),
  };
}

async function mysqlPublicUser(pool: Pool, row: MysqlUserRow): Promise<PublicUser> {
  if (!row.email) {
    throw new InvalidAuthInputError("Authenticated users must have an email");
  }

  if (row.isDisabled === 1 || row.isDisabled === "1") {
    throw new AccountDisabledError();
  }

  const workspace = await mysqlWorkspaceForUser(pool, row.id);
  const role = normalizeUserRole(row.role);
  const tier = workspace?.tier ?? normalizeAccountTier(row.accountTier);
  const features = applyFeatureOverrides(
    featuresForUser({ role, tier }),
    await mysqlOrganizationOverrides(pool, workspace),
  );

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role,
    tier,
    features,
    ...(workspace ? { workspace } : {}),
  };
}

async function createMysqlSession(pool: Pool, userId: string) {
  const sessionToken = createSessionToken();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await mysqlExecute(
    pool,
    `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [`session_${randomUUID()}`, userId, hashSessionToken(sessionToken), expiresAt, timestamp, timestamp],
  );

  return sessionToken;
}

async function getMysqlUserRowById(pool: Pool, userId: string) {
  return mysqlSelectOne<MysqlUserRow>(
    pool,
    `
      SELECT
        id,
        email,
        password_hash AS passwordHash,
        display_name AS displayName,
        role,
        account_tier AS accountTier,
        is_disabled AS isDisabled
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [userId],
  );
}

export async function registerMysqlUser(pool: Pool, input: RegisterUserInput) {
  const email = normalizeEmail(input.email);

  if (!email) {
    throw new InvalidAuthInputError("Email is required");
  }

  if (input.password.length < 8) {
    throw new WeakPasswordError();
  }

  const existing = await mysqlSelectOne<MysqlUserRow>(pool, "SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing) {
    throw new DuplicateEmailError();
  }

  const timestamp = nowIso();
  const user: MysqlUserRow = {
    id: `user_${randomUUID()}`,
    email,
    passwordHash: await hashPassword(input.password),
    displayName: normalizeDisplayName(input.displayName),
    role: "user",
    accountTier: "free",
    isDisabled: 0,
  };
  const organizationId = `org_${randomUUID()}`;

  try {
    await mysqlTransaction(pool, async (connection) => {
      await mysqlExecute(
        connection,
        `
          INSERT INTO users (
            id, email, password_hash, display_name, role, account_tier, is_disabled, created_at, updated_at
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
          timestamp,
          timestamp,
        ],
      );
      await mysqlExecute(
        connection,
        "INSERT INTO organizations (id, name, account_tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [organizationId, workspaceNameForUser(input, email), "free", timestamp, timestamp],
      );
      await mysqlExecute(
        connection,
        `
          INSERT INTO organization_memberships (
            organization_id, user_id, role, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [organizationId, user.id, "owner", "active", timestamp, timestamp],
      );
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: unknown }).code) === "ER_DUP_ENTRY"
    ) {
      throw new DuplicateEmailError();
    }

    throw error;
  }

  return {
    user: await mysqlPublicUser(pool, user),
    sessionToken: await createMysqlSession(pool, user.id),
  };
}

export async function loginMysqlUser(pool: Pool, emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const user = await mysqlSelectOne<MysqlUserRow>(
    pool,
    `
      SELECT
        id,
        email,
        password_hash AS passwordHash,
        display_name AS displayName,
        role,
        account_tier AS accountTier,
        is_disabled AS isDisabled
      FROM users
      WHERE email = ?
      LIMIT 1
    `,
    [email],
  );

  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new InvalidCredentialsError();
  }

  if (user.isDisabled === 1 || user.isDisabled === "1") {
    throw new AccountDisabledError();
  }

  await mysqlExecute(pool, "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", [
    nowIso(),
    nowIso(),
    user.id,
  ]);

  return {
    user: await mysqlPublicUser(pool, user),
    sessionToken: await createMysqlSession(pool, user.id),
  };
}

export async function updateMysqlUserProfile(
  pool: Pool,
  userId: string,
  input: UpdateUserProfileInput,
) {
  const user = await getMysqlUserRowById(pool, userId);

  if (!user) {
    throw new InvalidAuthInputError("User not found");
  }

  await mysqlPublicUser(pool, user);

  const timestamp = nowIso();
  await mysqlExecute(
    pool,
    "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
    [normalizeDisplayName(input.displayName), timestamp, userId],
  );

  const updatedUser = await getMysqlUserRowById(pool, userId);
  if (!updatedUser) {
    throw new InvalidAuthInputError("User not found");
  }

  return mysqlPublicUser(pool, updatedUser);
}

export async function changeMysqlUserPassword(
  pool: Pool,
  userId: string,
  input: ChangeUserPasswordInput,
) {
  if (input.newPassword.length < 8) {
    throw new WeakPasswordError();
  }

  const user = await getMysqlUserRowById(pool, userId);

  if (!user?.passwordHash) {
    throw new InvalidCredentialsError();
  }

  await mysqlPublicUser(pool, user);

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new InvalidCredentialsError();
  }

  await mysqlExecute(
    pool,
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
    [await hashPassword(input.newPassword), nowIso(), userId],
  );

  return { ok: true as const };
}

export async function getMysqlSessionUser(pool: Pool, sessionToken: string) {
  const row = await mysqlSelectOne<
    MysqlUserRow & {
      sessionId: string;
      expiresAt: string;
    }
  >(
    pool,
    `
      SELECT
        sessions.id AS sessionId,
        sessions.expires_at AS expiresAt,
        users.id AS id,
        users.email AS email,
        users.password_hash AS passwordHash,
        users.display_name AS displayName,
        users.role AS role,
        users.account_tier AS accountTier,
        users.is_disabled AS isDisabled
      FROM sessions
      INNER JOIN users ON sessions.user_id = users.id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `,
    [hashSessionToken(sessionToken)],
  );

  if (!row) return null;

  if (new Date(row.expiresAt).getTime() <= Date.now() || row.isDisabled === 1 || row.isDisabled === "1" || !row.email) {
    await mysqlExecute(pool, "DELETE FROM sessions WHERE id = ?", [row.sessionId]);
    return null;
  }

  await mysqlExecute(pool, "UPDATE sessions SET last_seen_at = ? WHERE id = ?", [nowIso(), row.sessionId]);
  return mysqlPublicUser(pool, row);
}

export async function logoutMysqlSession(pool: Pool, sessionToken: string) {
  await mysqlExecute(pool, "DELETE FROM sessions WHERE token_hash = ?", [hashSessionToken(sessionToken)]);
}
