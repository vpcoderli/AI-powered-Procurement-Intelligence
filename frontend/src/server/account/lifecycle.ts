import { and, asc, eq, ne } from "drizzle-orm";
import {
  WorkspaceMemberNotFoundError,
  WorkspacePermissionError,
  getAccountWorkspace,
} from "@/server/account/workspace";
import { normalizeAccountTier, normalizeUserRole, type AccountTier, type UserRole } from "@/server/auth/entitlements";
import type { AppDatabase } from "@/server/db/client";
import {
  accountSubscriptions,
  alerts,
  billingCheckoutSessions,
  billingInvoices,
  complianceManifestItems,
  intentToBid,
  organizationMemberships,
  organizations,
  passwordResetTokens,
  pursuitDecisions,
  savedBids,
  sessions,
  submissionConfirmations,
  submissionPaths,
  subscriptionEvents,
  supplierProfiles,
  users,
} from "@/server/db/schema";

export interface AccountExportData {
  generatedAt: string;
  account: {
    id: string;
    email: string;
    displayName: string | null;
    role: UserRole;
    tier: AccountTier;
    isDisabled: boolean;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
  };
  workspace: ReturnType<typeof getAccountWorkspace> | null;
  subscription: typeof accountSubscriptions.$inferSelect | null;
  billingCheckoutSessions: (typeof billingCheckoutSessions.$inferSelect)[];
  billingInvoices: (typeof billingInvoices.$inferSelect)[];
  subscriptionEvents: (typeof subscriptionEvents.$inferSelect)[];
  savedBids: (typeof savedBids.$inferSelect)[];
  supplierProfile: typeof supplierProfiles.$inferSelect | null;
  intents: (typeof intentToBid.$inferSelect)[];
  submissionPaths: (typeof submissionPaths.$inferSelect)[];
  submissionConfirmations: (typeof submissionConfirmations.$inferSelect)[];
  complianceManifestItems: (typeof complianceManifestItems.$inferSelect)[];
  pursuitDecisions: (typeof pursuitDecisions.$inferSelect)[];
  searchAlerts: (typeof alerts.$inferSelect)[];
}

export class AccountLifecycleUserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "AccountLifecycleUserNotFoundError";
  }
}

export class AccountDeletionRequiresOwnerTransferError extends Error {
  constructor() {
    super("Transfer workspace ownership before deleting this account");
    this.name = "AccountDeletionRequiresOwnerTransferError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function findUser(db: AppDatabase, userId: string) {
  return db.select().from(users).where(eq(users.id, userId)).limit(1).get();
}

function activeMemberships(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")))
    .all();
}

function activeOtherMemberCount(db: AppDatabase, organizationId: string, userId: string) {
  return db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.status, "active"),
      ne(organizationMemberships.userId, userId),
    ))
    .all().length;
}

function activeOwnerCount(db: AppDatabase, organizationId: string) {
  return db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, organizationId),
      eq(organizationMemberships.status, "active"),
      eq(organizationMemberships.role, "owner"),
    ))
    .all().length;
}

function ensureCanDeleteMemberships(db: AppDatabase, userId: string) {
  for (const membership of activeMemberships(db, userId)) {
    if (
      membership.role === "owner" &&
      activeOwnerCount(db, membership.organizationId) <= 1 &&
      activeOtherMemberCount(db, membership.organizationId, userId) > 0
    ) {
      throw new AccountDeletionRequiresOwnerTransferError();
    }
  }
}

export function exportAccountData(db: AppDatabase, userId: string): AccountExportData {
  const user = findUser(db, userId);

  if (!user?.email) {
    throw new AccountLifecycleUserNotFoundError();
  }

  return {
    generatedAt: nowIso(),
    account: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: normalizeUserRole(user.role),
      tier: normalizeAccountTier(user.accountTier),
      isDisabled: user.isDisabled === 1,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
    },
    workspace: getAccountWorkspace(db, userId),
    subscription: db.select().from(accountSubscriptions).where(eq(accountSubscriptions.userId, userId)).limit(1).get() ?? null,
    billingCheckoutSessions: db
      .select()
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.userId, userId))
      .orderBy(asc(billingCheckoutSessions.createdAt))
      .all(),
    billingInvoices: db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.userId, userId))
      .orderBy(asc(billingInvoices.createdAt))
      .all(),
    subscriptionEvents: db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.userId, userId))
      .orderBy(asc(subscriptionEvents.createdAt))
      .all(),
    savedBids: db.select().from(savedBids).where(eq(savedBids.userId, userId)).orderBy(asc(savedBids.createdAt)).all(),
    supplierProfile: db.select().from(supplierProfiles).where(eq(supplierProfiles.userId, userId)).limit(1).get() ?? null,
    intents: db.select().from(intentToBid).where(eq(intentToBid.userId, userId)).orderBy(asc(intentToBid.createdAt)).all(),
    submissionPaths: db
      .select()
      .from(submissionPaths)
      .where(eq(submissionPaths.userId, userId))
      .orderBy(asc(submissionPaths.createdAt))
      .all(),
    submissionConfirmations: db
      .select()
      .from(submissionConfirmations)
      .where(eq(submissionConfirmations.userId, userId))
      .orderBy(asc(submissionConfirmations.createdAt))
      .all(),
    complianceManifestItems: db
      .select()
      .from(complianceManifestItems)
      .where(eq(complianceManifestItems.userId, userId))
      .orderBy(asc(complianceManifestItems.createdAt))
      .all(),
    pursuitDecisions: db
      .select()
      .from(pursuitDecisions)
      .where(eq(pursuitDecisions.userId, userId))
      .orderBy(asc(pursuitDecisions.createdAt))
      .all(),
    searchAlerts: db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(asc(alerts.createdAt)).all(),
  };
}

export function softDeleteAccount(db: AppDatabase, userId: string) {
  const user = findUser(db, userId);

  if (!user) {
    throw new AccountLifecycleUserNotFoundError();
  }

  ensureCanDeleteMemberships(db, userId);

  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId)).run();
  db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId)).run();

  const timestamp = nowIso();
  db.update(users)
    .set({
      email: `deleted-${userId}@deleted.local`,
      passwordHash: null,
      displayName: null,
      isDisabled: 1,
      updatedAt: timestamp,
    })
    .where(eq(users.id, userId))
    .run();

  return { ok: true as const };
}

export function transferWorkspaceOwnership(db: AppDatabase, actorUserId: string, targetUserId: string) {
  const actorMembership = db
    .select()
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.userId, actorUserId),
      eq(organizationMemberships.role, "owner"),
      eq(organizationMemberships.status, "active"),
    ))
    .orderBy(asc(organizationMemberships.createdAt))
    .limit(1)
    .get();

  if (!actorMembership) {
    throw new WorkspacePermissionError();
  }

  const targetMembership = db
    .select()
    .from(organizationMemberships)
    .where(and(
      eq(organizationMemberships.organizationId, actorMembership.organizationId),
      eq(organizationMemberships.userId, targetUserId),
      eq(organizationMemberships.status, "active"),
    ))
    .limit(1)
    .get();

  if (!targetMembership) {
    throw new WorkspaceMemberNotFoundError();
  }

  const timestamp = nowIso();
  db.update(organizationMemberships)
    .set({ role: "owner", updatedAt: timestamp })
    .where(and(
      eq(organizationMemberships.organizationId, actorMembership.organizationId),
      eq(organizationMemberships.userId, targetUserId),
    ))
    .run();
  db.update(organizationMemberships)
    .set({ role: "member", updatedAt: timestamp })
    .where(and(
      eq(organizationMemberships.organizationId, actorMembership.organizationId),
      eq(organizationMemberships.userId, actorUserId),
    ))
    .run();
  db.update(organizations)
    .set({ updatedAt: timestamp })
    .where(eq(organizations.id, actorMembership.organizationId))
    .run();

  return getAccountWorkspace(db, actorUserId);
}
