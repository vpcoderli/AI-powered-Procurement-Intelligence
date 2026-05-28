import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { hashPassword } from "@/server/auth/password";
import {
  normalizeAccountTier,
  normalizeUserRole,
  type AccountTier,
  type UserRole,
} from "@/server/auth/entitlements";
import type { AppDatabase } from "@/server/db/client";
import { organizationMemberships, organizations, users } from "@/server/db/schema";

export const WORKSPACE_ROLES = ["owner", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type WorkspaceMemberStatus = "active";

export interface PublicWorkspace {
  organizationId: string;
  organizationName: string;
  role: WorkspaceRole;
}

export interface AccountWorkspaceOrganization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountWorkspaceMember {
  userId: string;
  email: string | null;
  displayName: string | null;
  workspaceRole: WorkspaceRole;
  status: WorkspaceMemberStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AccountWorkspaceResponse {
  organization: AccountWorkspaceOrganization;
  currentUserRole: WorkspaceRole;
  members: AccountWorkspaceMember[];
}

export interface UpdateOrganizationNameInput {
  name: string;
}

export interface InviteWorkspaceMemberInput {
  email: string;
  displayName?: string;
  role?: WorkspaceRole;
}

export interface InviteWorkspaceMemberResponse {
  member: AccountWorkspaceMember;
  temporaryPassword: string;
}

export class WorkspacePermissionError extends Error {
  constructor() {
    super("Only workspace owners can manage this workspace");
    this.name = "WorkspacePermissionError";
  }
}

export class WorkspaceEmailExistsError extends Error {
  constructor() {
    super("Email is already registered");
    this.name = "WorkspaceEmailExistsError";
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super("Workspace not found");
    this.name = "WorkspaceNotFoundError";
  }
}

export class InvalidWorkspaceInputError extends Error {
  constructor(message = "Invalid workspace input") {
    super(message);
    this.name = "InvalidWorkspaceInputError";
  }
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

function defaultWorkspaceName(user: { email: string | null; displayName: string | null }) {
  if (user.displayName?.trim()) {
    return `${user.displayName.trim()}'s Workspace`;
  }

  if (user.email?.trim()) {
    return `${user.email.trim().split("@")[0]}'s Workspace`;
  }

  return "Personal Workspace";
}

function toPublicWorkspace(row: {
  organizationId: string;
  organizationName: string;
  role: string;
}): PublicWorkspace {
  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: normalizeWorkspaceRole(row.role),
  };
}

function toWorkspaceMember(row: {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}): AccountWorkspaceMember {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    workspaceRole: normalizeWorkspaceRole(row.role),
    status: "active",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function getCurrentWorkspace(db: AppDatabase, userId: string) {
  return db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: organizationMemberships.role,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizationMemberships.organizationId, organizations.id))
    .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")))
    .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.organizationId))
    .limit(1)
    .get();
}

export function ensureUserWorkspace(db: AppDatabase, userId: string): PublicWorkspace {
  const existing = getCurrentWorkspace(db, userId);
  if (existing) {
    return toPublicWorkspace(existing);
  }

  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();
  if (!user) {
    throw new WorkspaceNotFoundError();
  }

  const timestamp = nowIso();
  const organization = {
    id: `org_${crypto.randomUUID()}`,
    name: defaultWorkspaceName(user),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.insert(organizations).values(organization).run();
  db.insert(organizationMemberships)
    .values({
      organizationId: organization.id,
      userId,
      role: "owner",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    role: "owner",
  };
}

export function getAccountWorkspace(db: AppDatabase, userId: string): AccountWorkspaceResponse {
  const workspace = ensureUserWorkspace(db, userId);
  const organization = db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1)
    .get();

  if (!organization) {
    throw new WorkspaceNotFoundError();
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    },
    currentUserRole: workspace.role,
    members: db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: organizationMemberships.role,
        status: organizationMemberships.status,
        createdAt: organizationMemberships.createdAt,
        updatedAt: organizationMemberships.updatedAt,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(organizationMemberships.userId, users.id))
      .where(eq(organizationMemberships.organizationId, organization.id))
      .orderBy(desc(organizationMemberships.role), asc(organizationMemberships.createdAt), asc(users.email))
      .all()
      .map(toWorkspaceMember),
  };
}

function requireOwner(db: AppDatabase, userId: string) {
  const workspace = ensureUserWorkspace(db, userId);
  if (workspace.role !== "owner") {
    throw new WorkspacePermissionError();
  }

  return workspace;
}

export function updateOrganizationName(
  db: AppDatabase,
  userId: string,
  input: UpdateOrganizationNameInput,
): AccountWorkspaceResponse {
  const workspace = requireOwner(db, userId);
  const name = input.name.trim();

  if (!name) {
    throw new InvalidWorkspaceInputError("Organization name is required");
  }

  db.update(organizations)
    .set({ name, updatedAt: nowIso() })
    .where(eq(organizations.id, workspace.organizationId))
    .run();

  return getAccountWorkspace(db, userId);
}

export async function inviteWorkspaceMember(
  db: AppDatabase,
  inviterUserId: string,
  input: InviteWorkspaceMemberInput,
): Promise<InviteWorkspaceMemberResponse> {
  const workspace = requireOwner(db, inviterUserId);
  const email = normalizeEmail(input.email);
  const role = normalizeWorkspaceRole(input.role);

  if (!email) {
    throw new InvalidWorkspaceInputError("Email is required");
  }

  if (db.select().from(users).where(eq(users.email, email)).limit(1).get()) {
    throw new WorkspaceEmailExistsError();
  }

  const timestamp = nowIso();
  const password = temporaryPassword();
  const user = {
    id: `user_${crypto.randomUUID()}`,
    email,
    passwordHash: await hashPassword(password),
    displayName: normalizeDisplayName(input.displayName),
    role: "user" as UserRole,
    accountTier: "free" as AccountTier,
    isDisabled: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    db.insert(users).values(user).run();
  } catch (error) {
    if (isUniqueEmailConflict(error)) {
      throw new WorkspaceEmailExistsError();
    }

    throw error;
  }

  db.insert(organizationMemberships)
    .values({
      organizationId: workspace.organizationId,
      userId: user.id,
      role,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return {
    member: {
      userId: user.id,
      email,
      displayName: user.displayName,
      workspaceRole: role,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    temporaryPassword: password,
  };
}

export function workspaceUserEntitlements(row: { role?: string | null; accountTier?: string | null }) {
  return {
    role: normalizeUserRole(row.role),
    tier: normalizeAccountTier(row.accountTier),
  };
}
