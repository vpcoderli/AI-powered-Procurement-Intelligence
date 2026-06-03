import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import {
  deadlineReminders,
  quoteRequests,
  responseWorkspaceItems,
  supplierArtifacts,
} from "@/server/db/schema";

export type DeadlineReminderRow = typeof deadlineReminders.$inferSelect;
export type NewDeadlineReminderRow = typeof deadlineReminders.$inferInsert;
export type ResponseWorkspaceDeadlineRow = typeof responseWorkspaceItems.$inferSelect;
export type SupplierArtifactDeadlineRow = typeof supplierArtifacts.$inferSelect;
export type QuoteRequestDeadlineRow = typeof quoteRequests.$inferSelect;

export function createDeadlineReminderRow(db: AppDatabase, row: NewDeadlineReminderRow) {
  db.insert(deadlineReminders)
    .values(row)
    .onConflictDoNothing({ target: deadlineReminders.dedupeKey })
    .run();
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

export function listOrganizationDeadlineReminderRows(db: AppDatabase, organizationId: string) {
  return db
    .select()
    .from(deadlineReminders)
    .where(eq(deadlineReminders.organizationId, organizationId))
    .orderBy(asc(deadlineReminders.dueAt), asc(deadlineReminders.kind), asc(deadlineReminders.id))
    .all();
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

export function updateOrganizationDeadlineReminderRow(
  db: AppDatabase,
  organizationId: string,
  reminderId: string,
  values: Partial<Pick<DeadlineReminderRow, "status" | "acknowledgedAt" | "snoozedUntil" | "updatedAt">>,
) {
  db.update(deadlineReminders)
    .set(values)
    .where(and(
      eq(deadlineReminders.organizationId, organizationId),
      eq(deadlineReminders.id, reminderId),
    ))
    .run();
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

export function updateDeadlineReminderRow(
  db: AppDatabase,
  organizationId: string,
  intentId: string,
  reminderId: string,
  values: Partial<Pick<DeadlineReminderRow, "status" | "acknowledgedAt" | "snoozedUntil" | "updatedAt">>,
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
