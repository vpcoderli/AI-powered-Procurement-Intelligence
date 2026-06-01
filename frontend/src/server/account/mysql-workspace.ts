import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { normalizeAccountTier } from "@/server/auth/entitlements";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import {
  InvalidWorkspaceInputError,
  WorkspaceNotFoundError,
  WorkspacePermissionError,
  type AccountWorkspaceMember,
  type AccountWorkspaceResponse,
  type PublicWorkspace,
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

function normalizeWorkspaceRole(role: unknown): WorkspaceRole {
  return role === "owner" ? "owner" : "member";
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
