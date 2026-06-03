import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { featuresForUser, normalizeAccountTier, normalizeUserRole } from "@/server/auth/entitlements";
import { hashPassword } from "@/server/auth/password";
import { createSessionToken, hashSessionToken, SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { UsageLimitError, usageLimitForTier } from "@/server/auth/usage-limits";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import {
  InvalidWorkspaceInvitationTokenError,
  InvalidWorkspaceInputError,
  WorkspaceEmailExistsError,
  WorkspaceInvitationNotFoundError,
  WorkspaceLastOwnerError,
  WorkspaceMemberNotFoundError,
  WorkspaceNotFoundError,
  WorkspacePermissionError,
  type AcceptWorkspaceInvitationInput,
  type AccountWorkspaceMember,
  type AccountWorkspaceResponse,
  type InviteWorkspaceMemberInput,
  type InviteWorkspaceMemberResponse,
  type PublicWorkspace,
  type UpdateWorkspaceMemberRoleInput,
  type WorkspaceMemberStatus,
  type WorkspaceRole,
} from "./workspace";

interface MysqlWorkspaceRow {
  organizationId: string;
  organizationName: string;
  role: string;
  accountTier: string | null;
}

interface MysqlWorkspaceOrganizationRow {
  id: string;
  name: string;
  accountTier: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MysqlWorkspaceMemberRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
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

function normalizeWorkspaceRole(role: unknown): WorkspaceRole {
  return role === "owner" ? "owner" : "member";
}

function createInviteToken() {
  return `invite_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function inviteUrl(token: string) {
  return `/accept-invite?token=${encodeURIComponent(token)}`;
}

function normalizeWorkspaceMemberStatus(status: unknown): WorkspaceMemberStatus {
  if (status === "invited" || status === "disabled") return status;
  return "active";
}

function toPublicWorkspace(row: MysqlWorkspaceRow): PublicWorkspace {
  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: normalizeWorkspaceRole(row.role),
    tier: normalizeAccountTier(row.accountTier),
  };
}

function toWorkspaceMember(row: MysqlWorkspaceMemberRow): AccountWorkspaceMember {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    workspaceRole: normalizeWorkspaceRole(row.role),
    status: normalizeWorkspaceMemberStatus(row.status),
    invitationDelivery: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function currentMysqlWorkspace(pool: Pool, userId: string) {
  return mysqlSelectOne<MysqlWorkspaceRow>(
    pool,
    `
      SELECT
        organizations.id AS organizationId,
        organizations.name AS organizationName,
        organization_memberships.role AS role,
        organizations.account_tier AS accountTier
      FROM organization_memberships
      INNER JOIN organizations ON organization_memberships.organization_id = organizations.id
      WHERE organization_memberships.user_id = ? AND organization_memberships.status = 'active'
      ORDER BY organization_memberships.created_at ASC, organization_memberships.organization_id ASC
      LIMIT 1
    `,
    [userId],
  );
}

export async function ensureMysqlUserWorkspace(pool: Pool, userId: string): Promise<PublicWorkspace> {
  const existing = await currentMysqlWorkspace(pool, userId);
  if (existing) return toPublicWorkspace(existing);

  const user = await mysqlSelectOne<{
    email: string | null;
    displayName: string | null;
    accountTier: string | null;
  }>(
    pool,
    "SELECT email, display_name AS displayName, account_tier AS accountTier FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  if (!user) {
    throw new WorkspaceNotFoundError();
  }

  if (!user.email) {
    return {
      organizationId: "",
      organizationName: "Personal Workspace",
      role: "owner",
      tier: normalizeAccountTier(user.accountTier),
    };
  }

  const timestamp = nowIso();
  const tier = normalizeAccountTier(user.accountTier);
  const organizationId = `org_${crypto.randomUUID()}`;
  const organizationName = user.displayName?.trim()
    ? `${user.displayName.trim()}'s Workspace`
    : `${user.email.split("@")[0]}'s Workspace`;

  await mysqlExecute(
    pool,
    "INSERT INTO organizations (id, name, account_tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [organizationId, organizationName, tier, timestamp, timestamp],
  );
  await mysqlExecute(
    pool,
    `
      INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [organizationId, userId, "owner", "active", timestamp, timestamp],
  );

  return {
    organizationId,
    organizationName,
    role: "owner",
    tier,
  };
}

export async function listMysqlWorkspaceMemberUserIds(pool: Pool, userId: string): Promise<string[]> {
  const workspace = await ensureMysqlUserWorkspace(pool, userId);
  if (!workspace.organizationId) return [userId];

  const rows = await mysqlSelectMany<{ userId: string }>(
    pool,
    `
      SELECT user_id AS userId
      FROM organization_memberships
      WHERE organization_id = ? AND status = 'active'
      ORDER BY created_at ASC, user_id ASC
    `,
    [workspace.organizationId],
  );

  return rows.map((row) => row.userId);
}

export async function getMysqlAccountWorkspace(pool: Pool, userId: string): Promise<AccountWorkspaceResponse> {
  const workspace = await ensureMysqlUserWorkspace(pool, userId);
  const organization = await mysqlSelectOne<MysqlWorkspaceOrganizationRow>(
    pool,
    `
      SELECT id, name, account_tier AS accountTier, created_at AS createdAt, updated_at AS updatedAt
      FROM organizations
      WHERE id = ?
      LIMIT 1
    `,
    [workspace.organizationId],
  );

  if (!organization) {
    throw new WorkspaceNotFoundError();
  }

  const members = await mysqlSelectMany<MysqlWorkspaceMemberRow>(
    pool,
    `
      SELECT
        users.id AS userId,
        users.email AS email,
        users.display_name AS displayName,
        organization_memberships.role AS role,
        organization_memberships.status AS status,
        organization_memberships.created_at AS createdAt,
        organization_memberships.updated_at AS updatedAt
      FROM organization_memberships
      INNER JOIN users ON organization_memberships.user_id = users.id
      WHERE organization_memberships.organization_id = ?
      ORDER BY organization_memberships.role DESC, organization_memberships.created_at ASC, users.email ASC
    `,
    [organization.id],
  );

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      tier: normalizeAccountTier(organization.accountTier),
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    },
    currentUserRole: workspace.role,
    members: members.map(toWorkspaceMember),
  };
}

export async function updateMysqlOrganizationName(
  pool: Pool,
  userId: string,
  input: { name: string },
): Promise<AccountWorkspaceResponse> {
  const workspace = await ensureMysqlUserWorkspace(pool, userId);

  if (workspace.role !== "owner") {
    throw new WorkspacePermissionError();
  }

  const name = input.name.trim();
  if (!name) {
    throw new InvalidWorkspaceInputError("Organization name is required");
  }

  await mysqlExecute(pool, "UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?", [
    name,
    nowIso(),
    workspace.organizationId,
  ]);

  return getMysqlAccountWorkspace(pool, userId);
}

export async function syncOwnedMysqlWorkspaceTier(
  pool: Pool,
  userId: string,
  tier: string,
  timestamp = nowIso(),
) {
  await mysqlExecute(
    pool,
    `
      UPDATE organizations
      SET account_tier = ?, updated_at = ?
      WHERE id IN (
        SELECT organization_id
        FROM organization_memberships
        WHERE user_id = ? AND role = 'owner' AND status = 'active'
      )
    `,
    [tier, timestamp, userId],
  );
}

async function requireMysqlOwner(pool: Pool, userId: string) {
  const user = await mysqlSelectOne<{ isDisabled: number | string | boolean }>(
    pool,
    "SELECT is_disabled AS isDisabled FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  if (user?.isDisabled === true || user?.isDisabled === 1 || user?.isDisabled === "1") {
    throw new WorkspacePermissionError();
  }

  const workspace = await ensureMysqlUserWorkspace(pool, userId);

  if (workspace.role !== "owner") {
    throw new WorkspacePermissionError();
  }

  return workspace;
}

async function mysqlWorkspaceMembership(pool: Pool, organizationId: string, userId: string) {
  return mysqlSelectOne<{
    organizationId: string;
    userId: string;
    role: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>(
    pool,
    `
      SELECT
        organization_id AS organizationId,
        user_id AS userId,
        role,
        status,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM organization_memberships
      WHERE organization_id = ? AND user_id = ?
      LIMIT 1
    `,
    [organizationId, userId],
  );
}

async function requireMysqlManageableMember(pool: Pool, organizationId: string, targetUserId: string) {
  const membership = await mysqlWorkspaceMembership(pool, organizationId, targetUserId);

  if (!membership) {
    throw new WorkspaceMemberNotFoundError();
  }

  return membership;
}

async function countMysqlActiveOwners(pool: Pool, organizationId: string) {
  const row = await mysqlSelectOne<{ countValue: number | string }>(
    pool,
    `
      SELECT COUNT(*) AS countValue
      FROM organization_memberships
      WHERE organization_id = ? AND role = 'owner' AND status = 'active'
    `,
    [organizationId],
  );

  return Number(row?.countValue ?? 0);
}

async function enforceMysqlWorkspaceSeatLimit(
  pool: Pool,
  organizationId: string,
  mode: "create" | "activateReserved" = "create",
) {
  const organization = await mysqlSelectOne<{ accountTier: string | null }>(
    pool,
    "SELECT account_tier AS accountTier FROM organizations WHERE id = ? LIMIT 1",
    [organizationId],
  );
  const tier = normalizeAccountTier(organization?.accountTier);
  const limit = usageLimitForTier(tier, "team_members");

  if (limit === null) return;

  const row = await mysqlSelectOne<{ used: number | string }>(
    pool,
    `
      SELECT COUNT(user_id) AS used
      FROM organization_memberships
      WHERE organization_id = ? AND status IN ('active', 'invited')
    `,
    [organizationId],
  );
  const used = Number(row?.used ?? 0);

  if (mode === "create" ? used >= limit : used > limit) {
    throw new UsageLimitError({
      feature: "team_members",
      tier,
      used,
      limit,
    });
  }
}

async function enqueueMysqlWorkspaceInvitationNotification(
  pool: Pool,
  input: {
    invitationId: string;
    invitedUserId: string;
    email: string;
    organizationName: string;
    token: string;
    createdAt: string;
  },
) {
  const url = inviteUrl(input.token);

  await mysqlExecute(
    pool,
    `
      INSERT INTO notification_outbox (
        id,
        alert_id,
        user_id,
        channel,
        recipient,
        frequency,
        dedupe_key,
        subject,
        body_text,
        matched_bid_ids,
        status,
        attempt_count,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key
    `,
    [
      `notification_${crypto.randomUUID()}`,
      `workspace_invite:${input.invitationId}`,
      input.invitedUserId,
      "email",
      input.email,
      "daily",
      `workspace_invite:${input.invitationId}:${hashInviteToken(input.token)}`,
      `You're invited to ${input.organizationName} on WinBids`,
      [
        `You have been invited to join ${input.organizationName} on WinBids.`,
        `Accept the invitation here: ${url}`,
        "This invitation expires in 7 days.",
      ].join("\n\n"),
      "[]",
      "pending",
      0,
      input.createdAt,
    ],
  );
}

function isMysqlDuplicateEmail(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return code === "ER_DUP_ENTRY" || error.message.includes("Duplicate entry");
}

export async function inviteMysqlWorkspaceMember(
  pool: Pool,
  inviterUserId: string,
  input: InviteWorkspaceMemberInput,
): Promise<InviteWorkspaceMemberResponse> {
  const workspace = await requireMysqlOwner(pool, inviterUserId);
  const email = normalizeEmail(input.email);
  const role = normalizeWorkspaceRole(input.role);

  if (!email) {
    throw new InvalidWorkspaceInputError("Email is required");
  }

  const existing = await mysqlSelectOne<{ id: string }>(pool, "SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing) {
    throw new WorkspaceEmailExistsError();
  }

  await enforceMysqlWorkspaceSeatLimit(pool, workspace.organizationId);

  const timestamp = nowIso();
  const token = createInviteToken();
  const invitationId = `workspace_invite_${crypto.randomUUID()}`;
  const user = {
    id: `user_${crypto.randomUUID()}`,
    email,
    displayName: normalizeDisplayName(input.displayName),
  };
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  try {
    await mysqlExecute(
      pool,
      `
        INSERT INTO users (
          id, email, password_hash, display_name, role, account_tier, is_disabled, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [user.id, user.email, null, user.displayName, "user", "free", 1, timestamp, timestamp],
    );
  } catch (error) {
    if (isMysqlDuplicateEmail(error)) {
      throw new WorkspaceEmailExistsError();
    }

    throw error;
  }

  await mysqlExecute(
    pool,
    `
      INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [workspace.organizationId, user.id, role, "invited", timestamp, timestamp],
  );
  await mysqlExecute(
    pool,
    `
      INSERT INTO workspace_invitations (
        id,
        organization_id,
        invited_user_id,
        invited_by_user_id,
        email,
        token_hash,
        expires_at,
        accepted_at,
        revoked_at,
        last_sent_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      invitationId,
      workspace.organizationId,
      user.id,
      inviterUserId,
      email,
      hashInviteToken(token),
      expiresAt,
      null,
      null,
      timestamp,
      timestamp,
      timestamp,
    ],
  );
  await enqueueMysqlWorkspaceInvitationNotification(pool, {
    invitationId,
    invitedUserId: user.id,
    email,
    organizationName: workspace.organizationName,
    token,
    createdAt: timestamp,
  });

  return {
    member: {
      userId: user.id,
      email,
      displayName: user.displayName,
      workspaceRole: role,
      status: "invited",
      invitationDelivery: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    inviteToken: token,
    inviteUrl: inviteUrl(token),
  };
}

async function createMysqlWorkspaceSession(pool: Pool, userId: string) {
  const sessionToken = createSessionToken();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await mysqlExecute(
    pool,
    `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [`session_${crypto.randomUUID()}`, userId, hashSessionToken(sessionToken), expiresAt, timestamp, timestamp],
  );

  return sessionToken;
}

export async function acceptMysqlWorkspaceInvitation(pool: Pool, input: AcceptWorkspaceInvitationInput) {
  if (input.password.length < 8) {
    throw new InvalidWorkspaceInputError("Password must be at least 8 characters");
  }

  const invitation = await mysqlSelectOne<{
    id: string;
    organizationId: string;
    invitedUserId: string;
    invitedByUserId: string;
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
  }>(
    pool,
    `
      SELECT
        id,
        organization_id AS organizationId,
        invited_user_id AS invitedUserId,
        invited_by_user_id AS invitedByUserId,
        expires_at AS expiresAt,
        accepted_at AS acceptedAt,
        revoked_at AS revokedAt
      FROM workspace_invitations
      WHERE token_hash = ?
      LIMIT 1
    `,
    [hashInviteToken(input.token)],
  );

  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    new Date(invitation.expiresAt).getTime() <= Date.now()
  ) {
    throw new WorkspaceInvitationNotFoundError();
  }

  const membership = await mysqlWorkspaceMembership(pool, invitation.organizationId, invitation.invitedUserId);
  if (!membership || membership.status !== "invited") {
    throw new WorkspaceInvitationNotFoundError();
  }

  await enforceMysqlWorkspaceSeatLimit(pool, invitation.organizationId, "activateReserved");

  const timestamp = nowIso();
  await mysqlExecute(
    pool,
    `
      UPDATE users
      SET password_hash = ?, display_name = COALESCE(?, display_name), is_disabled = 0, updated_at = ?
      WHERE id = ?
    `,
    [await hashPassword(input.password), normalizeDisplayName(input.displayName), timestamp, invitation.invitedUserId],
  );
  await mysqlExecute(
    pool,
    `
      UPDATE organization_memberships
      SET status = 'active', updated_at = ?
      WHERE organization_id = ? AND user_id = ?
    `,
    [timestamp, invitation.organizationId, invitation.invitedUserId],
  );
  await mysqlExecute(
    pool,
    "UPDATE workspace_invitations SET accepted_at = ?, updated_at = ? WHERE id = ?",
    [timestamp, timestamp, invitation.id],
  );

  const user = await mysqlSelectOne<{
    id: string;
    email: string | null;
    displayName: string | null;
    role: string | null;
    accountTier: string | null;
  }>(
    pool,
    "SELECT id, email, display_name AS displayName, role, account_tier AS accountTier FROM users WHERE id = ? LIMIT 1",
    [invitation.invitedUserId],
  );

  if (!user?.email) {
    throw new InvalidWorkspaceInvitationTokenError();
  }

  const role = normalizeUserRole(user.role);
  const tier = normalizeAccountTier(user.accountTier);

  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role,
      tier,
      features: featuresForUser({ role, tier }),
      workspace: await ensureMysqlUserWorkspace(pool, user.id),
    },
    sessionToken: await createMysqlWorkspaceSession(pool, user.id),
  };
}

async function requireMysqlPendingInvitation(pool: Pool, organizationId: string, targetUserId: string) {
  const membership = await mysqlWorkspaceMembership(pool, organizationId, targetUserId);
  if (!membership || membership.status !== "invited") {
    throw new WorkspaceInvitationNotFoundError();
  }

  const invitation = await mysqlSelectOne<{
    id: string;
    email: string;
    createdAt: string;
  }>(
    pool,
    `
      SELECT id, email, created_at AS createdAt
      FROM workspace_invitations
      WHERE organization_id = ? AND invited_user_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [organizationId, targetUserId],
  );

  if (!invitation) {
    throw new WorkspaceInvitationNotFoundError();
  }

  return { membership, invitation };
}

export async function resendMysqlWorkspaceInvitation(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
): Promise<InviteWorkspaceMemberResponse> {
  const workspace = await requireMysqlOwner(pool, actorUserId);
  const { membership, invitation } = await requireMysqlPendingInvitation(pool, workspace.organizationId, targetUserId);
  const user = await mysqlSelectOne<{ email: string | null; displayName: string | null }>(
    pool,
    "SELECT email, display_name AS displayName FROM users WHERE id = ? LIMIT 1",
    [targetUserId],
  );

  if (!user?.email) {
    throw new WorkspaceInvitationNotFoundError();
  }

  const timestamp = nowIso();
  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  await mysqlExecute(
    pool,
    "UPDATE workspace_invitations SET token_hash = ?, expires_at = ?, last_sent_at = ?, updated_at = ? WHERE id = ?",
    [hashInviteToken(token), expiresAt, timestamp, timestamp, invitation.id],
  );
  await mysqlExecute(
    pool,
    "UPDATE organization_memberships SET updated_at = ? WHERE organization_id = ? AND user_id = ?",
    [timestamp, workspace.organizationId, targetUserId],
  );
  await enqueueMysqlWorkspaceInvitationNotification(pool, {
    invitationId: invitation.id,
    invitedUserId: targetUserId,
    email: user.email,
    organizationName: workspace.organizationName,
    token,
    createdAt: timestamp,
  });

  return {
    member: toWorkspaceMember({
      userId: targetUserId,
      email: user.email,
      displayName: user.displayName,
      role: membership.role,
      status: "invited",
      createdAt: membership.createdAt,
      updatedAt: timestamp,
    }),
    inviteToken: token,
    inviteUrl: inviteUrl(token),
  };
}

export async function revokeMysqlWorkspaceInvitation(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
): Promise<AccountWorkspaceResponse> {
  const workspace = await requireMysqlOwner(pool, actorUserId);
  const { invitation } = await requireMysqlPendingInvitation(pool, workspace.organizationId, targetUserId);
  const timestamp = nowIso();

  await mysqlExecute(pool, "UPDATE workspace_invitations SET revoked_at = ?, updated_at = ? WHERE id = ?", [
    timestamp,
    timestamp,
    invitation.id,
  ]);
  await mysqlExecute(
    pool,
    "DELETE FROM organization_memberships WHERE organization_id = ? AND user_id = ?",
    [workspace.organizationId, targetUserId],
  );
  await mysqlExecute(
    pool,
    "UPDATE users SET email = NULL, password_hash = NULL, display_name = NULL, is_disabled = 1, updated_at = ? WHERE id = ?",
    [timestamp, targetUserId],
  );
  await mysqlExecute(pool, "DELETE FROM sessions WHERE user_id = ?", [targetUserId]);

  return getMysqlAccountWorkspace(pool, actorUserId);
}

export async function updateMysqlWorkspaceMemberRole(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
  input: UpdateWorkspaceMemberRoleInput,
): Promise<AccountWorkspaceResponse> {
  const workspace = await requireMysqlOwner(pool, actorUserId);
  const membership = await requireMysqlManageableMember(pool, workspace.organizationId, targetUserId);
  const role = normalizeWorkspaceRole(input.role);

  if (
    membership.role === "owner" &&
    role !== "owner" &&
    (await countMysqlActiveOwners(pool, workspace.organizationId)) <= 1
  ) {
    throw new WorkspaceLastOwnerError();
  }

  await mysqlExecute(
    pool,
    "UPDATE organization_memberships SET role = ?, updated_at = ? WHERE organization_id = ? AND user_id = ?",
    [role, nowIso(), workspace.organizationId, targetUserId],
  );

  return getMysqlAccountWorkspace(pool, actorUserId);
}

export async function disableMysqlWorkspaceMember(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
): Promise<AccountWorkspaceResponse> {
  const workspace = await requireMysqlOwner(pool, actorUserId);
  const membership = await requireMysqlManageableMember(pool, workspace.organizationId, targetUserId);

  if (membership.role === "owner" && (await countMysqlActiveOwners(pool, workspace.organizationId)) <= 1) {
    throw new WorkspaceLastOwnerError();
  }

  const timestamp = nowIso();
  await mysqlExecute(
    pool,
    "UPDATE organization_memberships SET status = 'disabled', updated_at = ? WHERE organization_id = ? AND user_id = ?",
    [timestamp, workspace.organizationId, targetUserId],
  );
  await mysqlExecute(pool, "UPDATE users SET is_disabled = 1, updated_at = ? WHERE id = ?", [timestamp, targetUserId]);
  await mysqlExecute(pool, "DELETE FROM sessions WHERE user_id = ?", [targetUserId]);

  return getMysqlAccountWorkspace(pool, actorUserId);
}

export async function restoreMysqlWorkspaceMember(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
): Promise<AccountWorkspaceResponse> {
  const workspace = await requireMysqlOwner(pool, actorUserId);
  const membership = await requireMysqlManageableMember(pool, workspace.organizationId, targetUserId);

  if (membership.status !== "disabled") {
    throw new InvalidWorkspaceInputError("Only disabled members can be restored");
  }

  const timestamp = nowIso();
  await mysqlExecute(
    pool,
    "UPDATE organization_memberships SET status = 'active', updated_at = ? WHERE organization_id = ? AND user_id = ?",
    [timestamp, workspace.organizationId, targetUserId],
  );
  await mysqlExecute(pool, "UPDATE users SET is_disabled = 0, updated_at = ? WHERE id = ?", [timestamp, targetUserId]);

  return getMysqlAccountWorkspace(pool, actorUserId);
}

export async function removeMysqlWorkspaceMember(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
): Promise<AccountWorkspaceResponse> {
  const workspace = await requireMysqlOwner(pool, actorUserId);
  const membership = await requireMysqlManageableMember(pool, workspace.organizationId, targetUserId);

  if (membership.role === "owner" && (await countMysqlActiveOwners(pool, workspace.organizationId)) <= 1) {
    throw new WorkspaceLastOwnerError();
  }

  await mysqlExecute(
    pool,
    "DELETE FROM organization_memberships WHERE organization_id = ? AND user_id = ?",
    [workspace.organizationId, targetUserId],
  );

  return getMysqlAccountWorkspace(pool, actorUserId);
}

export async function transferMysqlWorkspaceOwnership(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
): Promise<AccountWorkspaceResponse> {
  const workspace = await requireMysqlOwner(pool, actorUserId);
  const targetMembership = await requireMysqlManageableMember(pool, workspace.organizationId, targetUserId);

  if (targetMembership.status !== "active") {
    throw new WorkspaceMemberNotFoundError();
  }

  const timestamp = nowIso();
  await mysqlExecute(
    pool,
    "UPDATE organization_memberships SET role = 'member', updated_at = ? WHERE organization_id = ? AND user_id = ?",
    [timestamp, workspace.organizationId, actorUserId],
  );
  await mysqlExecute(
    pool,
    "UPDATE organization_memberships SET role = 'owner', updated_at = ? WHERE organization_id = ? AND user_id = ?",
    [timestamp, workspace.organizationId, targetUserId],
  );
  await mysqlExecute(pool, "UPDATE users SET account_tier = 'free', updated_at = ? WHERE id = ?", [
    timestamp,
    actorUserId,
  ]);
  await mysqlExecute(pool, "UPDATE users SET account_tier = ?, updated_at = ? WHERE id = ?", [
    workspace.tier,
    timestamp,
    targetUserId,
  ]);

  return getMysqlAccountWorkspace(pool, actorUserId);
}
