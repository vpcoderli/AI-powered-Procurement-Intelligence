import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { hashPassword } from "@/server/auth/password";
import { UsageLimitError, getUsageLimitStatus } from "@/server/auth/usage-limits";
import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  hashSessionToken,
} from "@/server/auth/session";
import {
  normalizeAccountTier,
  normalizeUserRole,
  featuresForUser,
  type AccountTier,
  type UserRole,
} from "@/server/auth/entitlements";
import type { AppDatabase } from "@/server/db/client";
import {
  notificationOutbox,
  organizationMemberships,
  organizations,
  sessions,
  users,
  workspaceInvitations,
} from "@/server/db/schema";
import { enqueueNotification } from "@/server/notifications/outbox-repository";

export const WORKSPACE_ROLES = ["owner", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type WorkspaceMemberStatus = "active" | "invited" | "disabled";

export interface PublicWorkspace {
  organizationId: string;
  organizationName: string;
  role: WorkspaceRole;
  tier: AccountTier;
}

export interface AccountWorkspaceOrganization {
  id: string;
  name: string;
  tier: AccountTier;
  createdAt: string;
  updatedAt: string;
}

export interface AccountWorkspaceMember {
  userId: string;
  email: string | null;
  displayName: string | null;
  workspaceRole: WorkspaceRole;
  status: WorkspaceMemberStatus;
  invitationDelivery?: WorkspaceInvitationDelivery | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInvitationDelivery {
  status: "pending" | "sent" | "failed";
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
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

export interface UpdateWorkspaceMemberRoleInput {
  role: WorkspaceRole;
}

export interface InviteWorkspaceMemberResponse {
  member: AccountWorkspaceMember;
  inviteToken: string;
  inviteUrl: string;
}

export interface AcceptWorkspaceInvitationInput {
  token: string;
  password: string;
  displayName?: string;
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

export class WorkspaceMemberNotFoundError extends Error {
  constructor() {
    super("Workspace member not found");
    this.name = "WorkspaceMemberNotFoundError";
  }
}

export class WorkspaceLastOwnerError extends Error {
  constructor() {
    super("A workspace must keep at least one owner");
    this.name = "WorkspaceLastOwnerError";
  }
}

export class InvalidWorkspaceInputError extends Error {
  constructor(message = "Invalid workspace input") {
    super(message);
    this.name = "InvalidWorkspaceInputError";
  }
}

export class InvalidWorkspaceInvitationTokenError extends Error {
  constructor() {
    super("Invalid or expired invitation token");
    this.name = "InvalidWorkspaceInvitationTokenError";
  }
}

export class WorkspaceInvitationNotFoundError extends InvalidWorkspaceInvitationTokenError {
  constructor() {
    super();
    this.name = "WorkspaceInvitationNotFoundError";
    this.message = "Pending invitation not found";
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

function createInviteToken() {
  return `invite_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function inviteUrl(token: string) {
  return `/accept-invite?token=${encodeURIComponent(token)}`;
}

function enqueueWorkspaceInvitationNotification(
  db: AppDatabase,
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

  enqueueNotification(db, {
    id: `notification_${crypto.randomUUID()}`,
    alertId: `workspace_invite:${input.invitationId}`,
    userId: input.invitedUserId,
    channel: "email",
    recipient: input.email,
    frequency: "daily",
    dedupeKey: `workspace_invite:${input.invitationId}:${hashInviteToken(input.token)}`,
    subject: `You're invited to ${input.organizationName} on WinBids`,
    bodyText: [
      `You have been invited to join ${input.organizationName} on WinBids.`,
      `Accept the invitation here: ${url}`,
      "This invitation expires in 7 days.",
    ].join("\n\n"),
    matchedBidIds: [],
    createdAt: input.createdAt,
  });
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
  accountTier?: string | null;
}): PublicWorkspace {
  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: normalizeWorkspaceRole(row.role),
    tier: normalizeAccountTier(row.accountTier),
  };
}

function toWorkspaceMember(row: {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: string;
  status: string;
  invitationDelivery?: WorkspaceInvitationDelivery | null;
  createdAt: string;
  updatedAt: string;
}): AccountWorkspaceMember {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    workspaceRole: normalizeWorkspaceRole(row.role),
    status: normalizeWorkspaceMemberStatus(row.status),
    invitationDelivery: row.invitationDelivery ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeWorkspaceMemberStatus(status: unknown): WorkspaceMemberStatus {
  if (status === "invited" || status === "disabled") {
    return status;
  }

  return "active";
}

function getCurrentWorkspace(db: AppDatabase, userId: string) {
  return db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      accountTier: organizations.accountTier,
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
  const organization = {
    id: `org_${crypto.randomUUID()}`,
    name: defaultWorkspaceName(user),
    accountTier: tier,
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
    tier,
  };
}

export function listWorkspaceMemberUserIds(db: AppDatabase, userId: string): string[] {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!user?.email) {
    return [userId];
  }

  const workspace = ensureUserWorkspace(db, userId);
  if (!workspace.organizationId) {
    return [userId];
  }

  return db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, workspace.organizationId),
      eq(organizationMemberships.status, "active"),
    ))
    .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.userId))
    .all()
    .map((row) => row.userId);
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

  const invitationDeliveryByUserId = new Map<string, WorkspaceInvitationDelivery>();
  const invitations = db
    .select()
    .from(workspaceInvitations)
    .where(and(
      eq(workspaceInvitations.organizationId, organization.id),
      isNull(workspaceInvitations.acceptedAt),
      isNull(workspaceInvitations.revokedAt),
    ))
    .all();

  for (const invitation of invitations) {
    const latest = db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.alertId, `workspace_invite:${invitation.id}`))
      .orderBy(desc(notificationOutbox.createdAt), desc(notificationOutbox.id))
      .limit(1)
      .get();

    if (!latest) continue;

    invitationDeliveryByUserId.set(invitation.invitedUserId, {
      status: latest.status,
      attemptCount: latest.attemptCount,
      lastError: latest.lastError,
      sentAt: latest.sentAt,
      updatedAt: latest.sentAt ?? latest.createdAt,
    });
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      tier: normalizeAccountTier(organization.accountTier),
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
      .where(and(
        eq(organizationMemberships.organizationId, organization.id),
      ))
      .orderBy(desc(organizationMemberships.role), asc(organizationMemberships.createdAt), asc(users.email))
      .all()
      .map((member) =>
        toWorkspaceMember({
          ...member,
          invitationDelivery: invitationDeliveryByUserId.get(member.userId) ?? null,
        }),
      ),
  };
}

function requireOwner(db: AppDatabase, userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();
  if (user?.isDisabled === 1) {
    throw new WorkspacePermissionError();
  }

  const workspace = ensureUserWorkspace(db, userId);
  if (workspace.role !== "owner") {
    throw new WorkspacePermissionError();
  }

  return workspace;
}

function getWorkspaceMembership(db: AppDatabase, organizationId: string, userId: string) {
  return db
    .select()
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.userId, userId),
    ))
    .limit(1)
    .get();
}

function countActiveWorkspaceOwners(db: AppDatabase, organizationId: string) {
  return db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.role, "owner"),
      eq(organizationMemberships.status, "active"),
    ))
    .all().length;
}

function workspaceSeatUserIds(db: AppDatabase, organizationId: string) {
  return db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, organizationId),
      inArray(organizationMemberships.status, ["active", "invited"]),
    ))
    .orderBy(asc(organizationMemberships.createdAt), asc(organizationMemberships.userId))
    .all()
    .map((row) => row.userId);
}

function organizationBillingTier(db: AppDatabase, organizationId: string) {
  const organization = db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1).get();

  return normalizeAccountTier(organization?.accountTier);
}

function enforceWorkspaceSeatLimit(
  db: AppDatabase,
  organizationId: string,
  fallbackUserId: string,
  mode: "create" | "activateReserved" = "create",
) {
  const scopeUserIds = workspaceSeatUserIds(db, organizationId);
  const status = getUsageLimitStatus(
    db,
    fallbackUserId,
    organizationBillingTier(db, organizationId),
    "team_members",
    { scopeUserIds },
  );

  if (status.limit !== null && (mode === "create" ? status.used >= status.limit : status.used > status.limit)) {
    throw new UsageLimitError({
      feature: status.feature,
      tier: status.tier,
      used: status.used,
      limit: status.limit,
      requiredTier: status.requiredTier,
    });
  }
}

export function workspaceTierForUser(db: AppDatabase, userId: string) {
  return ensureUserWorkspace(db, userId).tier;
}

export function syncOwnedWorkspaceTier(
  db: AppDatabase,
  userId: string,
  tier: AccountTier,
  timestamp = nowIso(),
) {
  const organizationIds = db
    .select({ organizationId: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.userId, userId),
      eq(organizationMemberships.role, "owner"),
      eq(organizationMemberships.status, "active"),
    ))
    .all()
    .map((row) => row.organizationId);

  if (organizationIds.length === 0) return;

  db.update(organizations)
    .set({ accountTier: tier, updatedAt: timestamp })
    .where(inArray(organizations.id, organizationIds))
    .run();
}

function requireManageableMember(db: AppDatabase, organizationId: string, targetUserId: string) {
  const membership = getWorkspaceMembership(db, organizationId, targetUserId);

  if (!membership) {
    throw new WorkspaceMemberNotFoundError();
  }

  return membership;
}

function requirePendingInvitation(db: AppDatabase, organizationId: string, targetUserId: string) {
  const membership = getWorkspaceMembership(db, organizationId, targetUserId);
  if (!membership || membership.status !== "invited") {
    throw new WorkspaceInvitationNotFoundError();
  }

  const invitation = db
    .select()
    .from(workspaceInvitations)
    .where(and(
      eq(workspaceInvitations.organizationId, organizationId),
      eq(workspaceInvitations.invitedUserId, targetUserId),
      isNull(workspaceInvitations.acceptedAt),
      isNull(workspaceInvitations.revokedAt),
    ))
    .orderBy(desc(workspaceInvitations.createdAt))
    .limit(1)
    .get();

  if (!invitation) {
    throw new WorkspaceInvitationNotFoundError();
  }

  return { membership, invitation };
}

async function createSession(db: AppDatabase, userId: string) {
  const sessionToken = createSessionToken();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  db.insert(sessions)
    .values({
      id: `session_${crypto.randomUUID()}`,
      userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    })
    .run();

  return sessionToken;
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

  enforceWorkspaceSeatLimit(db, workspace.organizationId, inviterUserId);

  const timestamp = nowIso();
  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  const user = {
    id: `user_${crypto.randomUUID()}`,
    email,
    passwordHash: null,
    displayName: normalizeDisplayName(input.displayName),
    role: "user" as UserRole,
    accountTier: "free" as AccountTier,
    isDisabled: 1,
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
      status: "invited",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  db.insert(workspaceInvitations)
    .values({
      id: `workspace_invite_${crypto.randomUUID()}`,
      organizationId: workspace.organizationId,
      invitedUserId: user.id,
      invitedByUserId: inviterUserId,
      email,
      tokenHash: hashInviteToken(token),
      expiresAt,
      acceptedAt: null,
      revokedAt: null,
      lastSentAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const invitation = db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.tokenHash, hashInviteToken(token)))
    .limit(1)
    .get();

  if (invitation) {
    enqueueWorkspaceInvitationNotification(db, {
      invitationId: invitation.id,
      invitedUserId: user.id,
      email,
      organizationName: workspace.organizationName,
      token,
      createdAt: timestamp,
    });
  }

  return {
    member: {
      userId: user.id,
      email,
      displayName: user.displayName,
      workspaceRole: role,
      status: "invited",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    inviteToken: token,
    inviteUrl: inviteUrl(token),
  };
}

export async function acceptWorkspaceInvitation(db: AppDatabase, input: AcceptWorkspaceInvitationInput) {
  if (input.password.length < 8) {
    throw new InvalidWorkspaceInputError("Password must be at least 8 characters");
  }

  const invitation = db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.tokenHash, hashInviteToken(input.token)))
    .limit(1)
    .get();

  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    new Date(invitation.expiresAt).getTime() <= Date.now()
  ) {
    throw new WorkspaceInvitationNotFoundError();
  }

  const membership = getWorkspaceMembership(db, invitation.organizationId, invitation.invitedUserId);
  if (!membership || membership.status !== "invited") {
    throw new WorkspaceInvitationNotFoundError();
  }

  enforceWorkspaceSeatLimit(db, invitation.organizationId, invitation.invitedByUserId, "activateReserved");

  const timestamp = nowIso();
  db.update(users)
    .set({
      passwordHash: await hashPassword(input.password),
      displayName: normalizeDisplayName(input.displayName) ?? undefined,
      isDisabled: 0,
      updatedAt: timestamp,
    })
    .where(eq(users.id, invitation.invitedUserId))
    .run();
  db.update(organizationMemberships)
    .set({ status: "active", updatedAt: timestamp })
    .where(and(
      eq(organizationMemberships.organizationId, invitation.organizationId),
      eq(organizationMemberships.userId, invitation.invitedUserId),
    ))
    .run();
  db.update(workspaceInvitations)
    .set({ acceptedAt: timestamp, updatedAt: timestamp })
    .where(eq(workspaceInvitations.id, invitation.id))
    .run();

  const user = db.select().from(users).where(eq(users.id, invitation.invitedUserId)).limit(1).get();
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
      workspace: ensureUserWorkspace(db, user.id),
    },
    sessionToken: await createSession(db, user.id),
  };
}

export function resendWorkspaceInvitation(
  db: AppDatabase,
  actorUserId: string,
  targetUserId: string,
): InviteWorkspaceMemberResponse {
  const workspace = requireOwner(db, actorUserId);
  const { membership, invitation } = requirePendingInvitation(db, workspace.organizationId, targetUserId);
  const user = db.select().from(users).where(eq(users.id, targetUserId)).limit(1).get();

  if (!user?.email) {
    throw new WorkspaceInvitationNotFoundError();
  }

  const timestamp = nowIso();
  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();

  db.update(workspaceInvitations)
    .set({
      tokenHash: hashInviteToken(token),
      expiresAt,
      lastSentAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(workspaceInvitations.id, invitation.id))
    .run();
  db.update(organizationMemberships)
    .set({ updatedAt: timestamp })
    .where(and(
      eq(organizationMemberships.organizationId, workspace.organizationId),
      eq(organizationMemberships.userId, targetUserId),
    ))
    .run();

  enqueueWorkspaceInvitationNotification(db, {
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

export function revokeWorkspaceInvitation(
  db: AppDatabase,
  actorUserId: string,
  targetUserId: string,
): AccountWorkspaceResponse {
  const workspace = requireOwner(db, actorUserId);
  const { invitation } = requirePendingInvitation(db, workspace.organizationId, targetUserId);
  const timestamp = nowIso();

  db.update(workspaceInvitations)
    .set({ revokedAt: timestamp, updatedAt: timestamp })
    .where(eq(workspaceInvitations.id, invitation.id))
    .run();
  db.delete(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, workspace.organizationId),
      eq(organizationMemberships.userId, targetUserId),
    ))
    .run();
  db.update(users)
    .set({
      email: null,
      passwordHash: null,
      displayName: null,
      isDisabled: 1,
      updatedAt: timestamp,
    })
    .where(eq(users.id, targetUserId))
    .run();
  db.delete(sessions).where(eq(sessions.userId, targetUserId)).run();

  return getAccountWorkspace(db, actorUserId);
}

export function updateWorkspaceMemberRole(
  db: AppDatabase,
  actorUserId: string,
  targetUserId: string,
  input: UpdateWorkspaceMemberRoleInput,
): AccountWorkspaceResponse {
  const workspace = requireOwner(db, actorUserId);
  const membership = requireManageableMember(db, workspace.organizationId, targetUserId);
  const role = normalizeWorkspaceRole(input.role);

  if (
    membership.role === "owner" &&
    role !== "owner" &&
    countActiveWorkspaceOwners(db, workspace.organizationId) <= 1
  ) {
    throw new WorkspaceLastOwnerError();
  }

  db.update(organizationMemberships)
    .set({ role, updatedAt: nowIso() })
    .where(and(
      eq(organizationMemberships.organizationId, workspace.organizationId),
      eq(organizationMemberships.userId, targetUserId),
    ))
    .run();

  return getAccountWorkspace(db, actorUserId);
}

export function disableWorkspaceMember(
  db: AppDatabase,
  actorUserId: string,
  targetUserId: string,
): AccountWorkspaceResponse {
  const workspace = requireOwner(db, actorUserId);
  const membership = requireManageableMember(db, workspace.organizationId, targetUserId);

  if (membership.role === "owner" && countActiveWorkspaceOwners(db, workspace.organizationId) <= 1) {
    throw new WorkspaceLastOwnerError();
  }

  const timestamp = nowIso();
  db.update(organizationMemberships)
    .set({ status: "disabled", updatedAt: timestamp })
    .where(and(
      eq(organizationMemberships.organizationId, workspace.organizationId),
      eq(organizationMemberships.userId, targetUserId),
    ))
    .run();
  db.update(users)
    .set({ isDisabled: 1, updatedAt: timestamp })
    .where(eq(users.id, targetUserId))
    .run();
  db.delete(sessions).where(eq(sessions.userId, targetUserId)).run();

  return getAccountWorkspace(db, actorUserId);
}

export function restoreWorkspaceMember(
  db: AppDatabase,
  actorUserId: string,
  targetUserId: string,
): AccountWorkspaceResponse {
  const workspace = requireOwner(db, actorUserId);
  const membership = requireManageableMember(db, workspace.organizationId, targetUserId);

  if (membership.status !== "disabled") {
    throw new InvalidWorkspaceInputError("Only disabled members can be restored");
  }

  const timestamp = nowIso();
  db.update(organizationMemberships)
    .set({ status: "active", updatedAt: timestamp })
    .where(and(
      eq(organizationMemberships.organizationId, workspace.organizationId),
      eq(organizationMemberships.userId, targetUserId),
    ))
    .run();
  db.update(users)
    .set({ isDisabled: 0, updatedAt: timestamp })
    .where(eq(users.id, targetUserId))
    .run();

  return getAccountWorkspace(db, actorUserId);
}

export function removeWorkspaceMember(
  db: AppDatabase,
  actorUserId: string,
  targetUserId: string,
): AccountWorkspaceResponse {
  const workspace = requireOwner(db, actorUserId);
  const membership = requireManageableMember(db, workspace.organizationId, targetUserId);

  if (membership.role === "owner" && countActiveWorkspaceOwners(db, workspace.organizationId) <= 1) {
    throw new WorkspaceLastOwnerError();
  }

  db.delete(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, workspace.organizationId),
      eq(organizationMemberships.userId, targetUserId),
    ))
    .run();

  return getAccountWorkspace(db, actorUserId);
}

export function workspaceUserEntitlements(row: { role?: string | null; accountTier?: string | null }) {
  return {
    role: normalizeUserRole(row.role),
    tier: normalizeAccountTier(row.accountTier),
  };
}
