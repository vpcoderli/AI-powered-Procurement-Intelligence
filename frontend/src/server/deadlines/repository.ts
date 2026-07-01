import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import {
  deadlineReminders,
  quoteRequests,
  responseWorkspaceItems,
  submissionConfirmations,
  submissionPaths,
  supplierArtifacts,
} from "@/server/db/schema";

export type DeadlineReminderRow = typeof deadlineReminders.$inferSelect;
export type NewDeadlineReminderRow = typeof deadlineReminders.$inferInsert;
export type ResponseWorkspaceDeadlineRow = typeof responseWorkspaceItems.$inferSelect;
export type SupplierArtifactDeadlineRow = typeof supplierArtifacts.$inferSelect;
export type QuoteRequestDeadlineRow = typeof quoteRequests.$inferSelect;
export type SubmissionPathDeadlineRow = Pick<
  typeof submissionPaths.$inferSelect,
  "id" | "intentId" | "bidId" | "userId" | "method" | "status" | "updatedAt"
>;
export type SubmissionConfirmationDeadlineRow = Pick<
  typeof submissionConfirmations.$inferSelect,
  "id" | "intentId" | "userId" | "submittedAt" | "method" | "confirmationReference" | "createdAt"
>;

export interface MysqlDeadlineReminderRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlDeadlineReminderRow {
  id: string;
  organizationId: string;
  userId: string;
  intentId: string;
  bidId: string;
  kind: string;
  linkedObjectType: string;
  linkedObjectId: string;
  dedupeKey: string;
  title: string;
  dueAt: string;
  reminderAt: string;
  status: string;
  priority: string;
  source: string;
  metadataJson: string;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MysqlSubmissionPathDeadlineRow {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  method: string;
  status: string;
  updatedAt: string;
}

interface MysqlSubmissionConfirmationDeadlineRow {
  id: string;
  intentId: string;
  userId: string;
  submittedAt: string;
  method: string;
  confirmationReference: string;
  createdAt: string;
}

type DeadlineReminderUpdateValues = Partial<
  Pick<DeadlineReminderRow, "status" | "acknowledgedAt" | "snoozedUntil" | "updatedAt">
>;

function deadlineReminderSelect(whereClause: string) {
  return `
    SELECT
      id,
      organization_id AS organizationId,
      user_id AS userId,
      intent_id AS intentId,
      bid_id AS bidId,
      kind,
      linked_object_type AS linkedObjectType,
      linked_object_id AS linkedObjectId,
      dedupe_key AS dedupeKey,
      title,
      due_at AS dueAt,
      reminder_at AS reminderAt,
      status,
      priority,
      source,
      metadata_json AS metadataJson,
      acknowledged_at AS acknowledgedAt,
      snoozed_until AS snoozedUntil,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM deadline_reminders
    ${whereClause}
  `;
}

function toDeadlineReminderRow(row: MysqlDeadlineReminderRow): DeadlineReminderRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    intentId: row.intentId,
    bidId: row.bidId,
    kind: row.kind,
    linkedObjectType: row.linkedObjectType,
    linkedObjectId: row.linkedObjectId,
    dedupeKey: row.dedupeKey,
    title: row.title,
    dueAt: row.dueAt,
    reminderAt: row.reminderAt,
    status: row.status,
    priority: row.priority,
    source: row.source,
    metadataJson: row.metadataJson,
    acknowledgedAt: row.acknowledgedAt,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDeadlineReminderRow(db: AppDatabase, row: NewDeadlineReminderRow) {
  db.insert(deadlineReminders)
    .values(row)
    .onConflictDoNothing({ target: deadlineReminders.dedupeKey })
    .run();
}

export async function createDeadlineReminderRowFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  row: NewDeadlineReminderRow,
) {
  await mysqlExecute(
    mysql,
    `
      INSERT IGNORE INTO deadline_reminders (
        id,
        organization_id,
        user_id,
        intent_id,
        bid_id,
        kind,
        linked_object_type,
        linked_object_id,
        dedupe_key,
        title,
        due_at,
        reminder_at,
        status,
        priority,
        source,
        metadata_json,
        acknowledged_at,
        snoozed_until,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.organizationId,
      row.userId,
      row.intentId,
      row.bidId,
      row.kind,
      row.linkedObjectType,
      row.linkedObjectId,
      row.dedupeKey,
      row.title,
      row.dueAt,
      row.reminderAt,
      row.status,
      row.priority,
      row.source,
      row.metadataJson,
      row.acknowledgedAt,
      row.snoozedUntil,
      row.createdAt,
      row.updatedAt,
    ],
  );
}

export function listDeadlineReminderRows(db: AppDatabase, organizationId: string, intentId: string) {
  return db
    .select()
    .from(deadlineReminders)
    .where(and(
      eq(deadlineReminders.organizationId, organizationId),
      eq(deadlineReminders.intentId, intentId),
    ))
    .orderBy(asc(deadlineReminders.dueAt), asc(deadlineReminders.kind), asc(deadlineReminders.id))
    .all();
}

export async function listDeadlineReminderRowsFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  organizationId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlDeadlineReminderRow>(
    mysql,
    `${deadlineReminderSelect("WHERE organization_id = ? AND intent_id = ?")}
     ORDER BY due_at ASC, kind ASC, id ASC`,
    [organizationId, intentId],
  );

  return rows.map(toDeadlineReminderRow);
}

export function listOrganizationDeadlineReminderRows(db: AppDatabase, organizationId: string) {
  return db
    .select()
    .from(deadlineReminders)
    .where(eq(deadlineReminders.organizationId, organizationId))
    .orderBy(asc(deadlineReminders.dueAt), asc(deadlineReminders.kind), asc(deadlineReminders.id))
    .all();
}

export async function listOrganizationDeadlineReminderRowsFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  organizationId: string,
) {
  const rows = await mysqlSelectMany<MysqlDeadlineReminderRow>(
    mysql,
    `${deadlineReminderSelect("WHERE organization_id = ?")}
     ORDER BY due_at ASC, kind ASC, id ASC`,
    [organizationId],
  );

  return rows.map(toDeadlineReminderRow);
}

export function findOrganizationDeadlineReminderRow(
  db: AppDatabase,
  organizationId: string,
  reminderId: string,
) {
  return db
    .select()
    .from(deadlineReminders)
    .where(and(
      eq(deadlineReminders.organizationId, organizationId),
      eq(deadlineReminders.id, reminderId),
    ))
    .limit(1)
    .get();
}

export async function findOrganizationDeadlineReminderRowFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  organizationId: string,
  reminderId: string,
) {
  const row = await mysqlSelectOne<MysqlDeadlineReminderRow>(
    mysql,
    `${deadlineReminderSelect("WHERE organization_id = ? AND id = ?")}
     LIMIT 1`,
    [organizationId, reminderId],
  );

  return row ? toDeadlineReminderRow(row) : undefined;
}

export function updateOrganizationDeadlineReminderRow(
  db: AppDatabase,
  organizationId: string,
  reminderId: string,
  values: DeadlineReminderUpdateValues,
) {
  db.update(deadlineReminders)
    .set(values)
    .where(and(
      eq(deadlineReminders.organizationId, organizationId),
      eq(deadlineReminders.id, reminderId),
    ))
    .run();
}

export async function updateOrganizationDeadlineReminderRowFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  organizationId: string,
  reminderId: string,
  values: DeadlineReminderUpdateValues,
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE deadline_reminders
      SET
        status = ?,
        acknowledged_at = ?,
        snoozed_until = ?,
        updated_at = ?
      WHERE organization_id = ? AND id = ?
    `,
    [
      values.status,
      values.acknowledgedAt,
      values.snoozedUntil,
      values.updatedAt,
      organizationId,
      reminderId,
    ],
  );
}

export function findDeadlineReminderRow(
  db: AppDatabase,
  organizationId: string,
  intentId: string,
  reminderId: string,
) {
  return db
    .select()
    .from(deadlineReminders)
    .where(and(
      eq(deadlineReminders.organizationId, organizationId),
      eq(deadlineReminders.intentId, intentId),
      eq(deadlineReminders.id, reminderId),
    ))
    .limit(1)
    .get();
}

export async function findDeadlineReminderRowFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  organizationId: string,
  intentId: string,
  reminderId: string,
) {
  const row = await mysqlSelectOne<MysqlDeadlineReminderRow>(
    mysql,
    `${deadlineReminderSelect("WHERE organization_id = ? AND intent_id = ? AND id = ?")}
     LIMIT 1`,
    [organizationId, intentId, reminderId],
  );

  return row ? toDeadlineReminderRow(row) : undefined;
}

export function updateDeadlineReminderRow(
  db: AppDatabase,
  organizationId: string,
  intentId: string,
  reminderId: string,
  values: DeadlineReminderUpdateValues,
) {
  db.update(deadlineReminders)
    .set(values)
    .where(and(
      eq(deadlineReminders.organizationId, organizationId),
      eq(deadlineReminders.intentId, intentId),
      eq(deadlineReminders.id, reminderId),
    ))
    .run();
}

export async function updateDeadlineReminderRowFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  organizationId: string,
  intentId: string,
  reminderId: string,
  values: DeadlineReminderUpdateValues,
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE deadline_reminders
      SET
        status = ?,
        acknowledged_at = ?,
        snoozed_until = ?,
        updated_at = ?
      WHERE organization_id = ? AND intent_id = ? AND id = ?
    `,
    [
      values.status,
      values.acknowledgedAt,
      values.snoozedUntil,
      values.updatedAt,
      organizationId,
      intentId,
      reminderId,
    ],
  );
}

export function listResponseWorkspaceDeadlineRows(db: AppDatabase, intentId: string) {
  return db
    .select()
    .from(responseWorkspaceItems)
    .where(eq(responseWorkspaceItems.intentId, intentId))
    .all();
}

export function listSupplierArtifactDeadlineRows(db: AppDatabase, intentId: string) {
  return db
    .select()
    .from(supplierArtifacts)
    .where(eq(supplierArtifacts.intentId, intentId))
    .all();
}

export function listQuoteRequestDeadlineRows(db: AppDatabase, intentId: string) {
  return db
    .select()
    .from(quoteRequests)
    .where(eq(quoteRequests.intentId, intentId))
    .all();
}

export function listSubmissionPathDeadlineRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select({
      id: submissionPaths.id,
      intentId: submissionPaths.intentId,
      bidId: submissionPaths.bidId,
      userId: submissionPaths.userId,
      method: submissionPaths.method,
      status: submissionPaths.status,
      updatedAt: submissionPaths.updatedAt,
    })
    .from(submissionPaths)
    .where(and(eq(submissionPaths.userId, userId), eq(submissionPaths.intentId, intentId)))
    .all();
}

export async function listSubmissionPathDeadlineRowsFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  userId: string,
  intentId: string,
) {
  return mysqlSelectMany<MysqlSubmissionPathDeadlineRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        method,
        status,
        updated_at AS updatedAt
      FROM submission_paths
      WHERE user_id = ? AND intent_id = ?
    `,
    [userId, intentId],
  );
}

export function listSubmissionConfirmationDeadlineRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select({
      id: submissionConfirmations.id,
      intentId: submissionConfirmations.intentId,
      userId: submissionConfirmations.userId,
      submittedAt: submissionConfirmations.submittedAt,
      method: submissionConfirmations.method,
      confirmationReference: submissionConfirmations.confirmationReference,
      createdAt: submissionConfirmations.createdAt,
    })
    .from(submissionConfirmations)
    .where(and(eq(submissionConfirmations.userId, userId), eq(submissionConfirmations.intentId, intentId)))
    .all();
}

export async function listSubmissionConfirmationDeadlineRowsFromMysql(
  mysql: MysqlDeadlineReminderRepository,
  userId: string,
  intentId: string,
) {
  return mysqlSelectMany<MysqlSubmissionConfirmationDeadlineRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        user_id AS userId,
        submitted_at AS submittedAt,
        method,
        confirmation_reference AS confirmationReference,
        created_at AS createdAt
      FROM submission_confirmations
      WHERE user_id = ? AND intent_id = ?
    `,
    [userId, intentId],
  );
}
