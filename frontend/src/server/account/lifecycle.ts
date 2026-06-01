import crypto from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  WorkspaceMemberNotFoundError,
  WorkspacePermissionError,
  getAccountWorkspace,
} from "@/server/account/workspace";
import { getMysqlAccountWorkspace } from "@/server/account/mysql-workspace";
import { normalizeAccountTier, normalizeUserRole, type AccountTier, type UserRole } from "@/server/auth/entitlements";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
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
  adminUserAuditLogs,
} from "@/server/db/schema";

interface MysqlAccountExportReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

const ACCOUNT_EXPORT_INCLUDED_SECTIONS = [
  "account",
  "workspace",
  "subscription",
  "billingCheckoutSessions",
  "billingInvoices",
  "subscriptionEvents",
  "savedBids",
  "supplierProfile",
  "intents",
  "submissionPaths",
  "submissionConfirmations",
  "complianceManifestItems",
  "pursuitDecisions",
  "searchAlerts",
] as const;

export interface AccountExportData {
  generatedAt: string;
  metadata: {
    formatVersion: 1;
    product: "WinBids";
    generatedAt: string;
    subjectUserId: string;
    subjectEmail: string;
    retentionNotice: string;
    includedSections: typeof ACCOUNT_EXPORT_INCLUDED_SECTIONS[number][];
  };
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

function camelizeKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelizeRecord<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelizeKey(key), value]),
  ) as Record<string, unknown>;
}

function camelizeRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => camelizeRecord(row));
}

async function mysqlExportRows(mysql: MysqlAccountExportReader, tableName: string, userId: string) {
  return camelizeRows(
    await mysqlSelectMany<Record<string, unknown>>(
      mysql,
      `SELECT * FROM ${tableName} WHERE user_id = ? ORDER BY created_at ASC`,
      [userId],
    ),
  );
}

async function mysqlExportOne(mysql: MysqlAccountExportReader, tableName: string, userId: string) {
  const row = await mysqlSelectOne<Record<string, unknown>>(
    mysql,
    `SELECT * FROM ${tableName} WHERE user_id = ? LIMIT 1`,
    [userId],
  );

  return row ? camelizeRecord(row) : null;
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

  const generatedAt = nowIso();

  return {
    generatedAt,
    metadata: {
      formatVersion: 1,
      product: "WinBids",
      generatedAt,
      subjectUserId: user.id,
      subjectEmail: user.email,
      retentionNotice: "Business records, audit logs, and billing records may be retained for legal and operational continuity.",
      includedSections: [...ACCOUNT_EXPORT_INCLUDED_SECTIONS],
    },
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

export async function exportMysqlAccountData(
  mysql: MysqlAccountExportReader,
  userId: string,
): Promise<AccountExportData> {
  const user = await mysqlSelectOne<{
    id: string;
    email: string | null;
    displayName: string | null;
    role: string | null;
    accountTier: string | null;
    isDisabled: number | string | boolean | null;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
  }>(
    mysql,
    `
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
      WHERE id = ?
      LIMIT 1
    `,
    [userId],
  );

  if (!user?.email) {
    throw new AccountLifecycleUserNotFoundError();
  }

  const generatedAt = nowIso();

  return {
    generatedAt,
    metadata: {
      formatVersion: 1,
      product: "WinBids",
      generatedAt,
      subjectUserId: user.id,
      subjectEmail: user.email,
      retentionNotice: "Business records, audit logs, and billing records may be retained for legal and operational continuity.",
      includedSections: [...ACCOUNT_EXPORT_INCLUDED_SECTIONS],
    },
    account: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: normalizeUserRole(user.role),
      tier: normalizeAccountTier(user.accountTier),
      isDisabled: user.isDisabled === true || user.isDisabled === 1 || user.isDisabled === "1",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
    },
    workspace: await getMysqlAccountWorkspace(mysql as never, userId),
    subscription: await mysqlExportOne(mysql, "account_subscriptions", userId) as AccountExportData["subscription"],
    billingCheckoutSessions: await mysqlExportRows(mysql, "billing_checkout_sessions", userId) as AccountExportData["billingCheckoutSessions"],
    billingInvoices: await mysqlExportRows(mysql, "billing_invoices", userId) as AccountExportData["billingInvoices"],
    subscriptionEvents: await mysqlExportRows(mysql, "subscription_events", userId) as AccountExportData["subscriptionEvents"],
    savedBids: await mysqlExportRows(mysql, "saved_bids", userId) as AccountExportData["savedBids"],
    supplierProfile: await mysqlExportOne(mysql, "supplier_profiles", userId) as AccountExportData["supplierProfile"],
    intents: await mysqlExportRows(mysql, "intent_to_bid", userId) as AccountExportData["intents"],
    submissionPaths: await mysqlExportRows(mysql, "submission_paths", userId) as AccountExportData["submissionPaths"],
    submissionConfirmations: await mysqlExportRows(mysql, "submission_confirmations", userId) as AccountExportData["submissionConfirmations"],
    complianceManifestItems: await mysqlExportRows(mysql, "compliance_manifest_items", userId) as AccountExportData["complianceManifestItems"],
    pursuitDecisions: await mysqlExportRows(mysql, "pursuit_decisions", userId) as AccountExportData["pursuitDecisions"],
    searchAlerts: await mysqlExportRows(mysql, "alerts", userId) as AccountExportData["searchAlerts"],
  };
}

export function softDeleteAccount(db: AppDatabase, userId: string) {
  const user = findUser(db, userId);

  if (!user) {
    throw new AccountLifecycleUserNotFoundError();
  }

  ensureCanDeleteMemberships(db, userId);

  const timestamp = nowIso();
  const anonymizedEmail = `deleted-${userId}@deleted.local`;
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId)).run();
  db.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId)).run();

  db.update(users)
    .set({
      email: anonymizedEmail,
      passwordHash: null,
      displayName: null,
      isDisabled: 1,
      updatedAt: timestamp,
    })
    .where(eq(users.id, userId))
    .run();

  db.insert(adminUserAuditLogs)
    .values({
      id: `audit_${crypto.randomUUID()}`,
      actorKind: "self-service",
      actorUserId: userId,
      targetUserId: userId,
      action: "user_self_deleted",
      changesJson: JSON.stringify([
        { field: "email", before: user.email, after: anonymizedEmail },
        { field: "isDisabled", before: user.isDisabled === 1, after: true },
        { field: "workspaceAccess", before: "active", after: "removed" },
      ]),
      createdAt: timestamp,
    })
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
