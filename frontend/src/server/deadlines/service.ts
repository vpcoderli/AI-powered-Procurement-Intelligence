import crypto from "node:crypto";
import { ensureMysqlUserWorkspace } from "@/server/account/mysql-workspace";
import { ensureUserWorkspace } from "@/server/account/workspace";
import { listSupplierArtifactRowsFromMysql } from "@/server/artifacts/repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { listQuoteRequestRowsFromMysql } from "@/server/quotes/repository";
import { listResponseWorkspaceItemRowsFromMysql } from "@/server/response-workspace/repository";
import {
  createDeadlineReminderRow,
  createDeadlineReminderRowFromMysql,
  findDeadlineReminderRow,
  findDeadlineReminderRowFromMysql,
  findOrganizationDeadlineReminderRow,
  findOrganizationDeadlineReminderRowFromMysql,
  listDeadlineReminderRows,
  listDeadlineReminderRowsFromMysql,
  listOrganizationDeadlineReminderRows,
  listOrganizationDeadlineReminderRowsFromMysql,
  listQuoteRequestDeadlineRows,
  listResponseWorkspaceDeadlineRows,
  listSubmissionConfirmationDeadlineRows,
  listSubmissionConfirmationDeadlineRowsFromMysql,
  listSubmissionPathDeadlineRows,
  listSubmissionPathDeadlineRowsFromMysql,
  listSupplierArtifactDeadlineRows,
  updateDeadlineReminderRow,
  updateDeadlineReminderRowFromMysql,
  updateOrganizationDeadlineReminderRow,
  updateOrganizationDeadlineReminderRowFromMysql,
  type DeadlineReminderRow,
  type NewDeadlineReminderRow,
  type MysqlDeadlineReminderRepository,
} from "./repository";
import {
  isDeadlineReminderKind,
  isDeadlineReminderPriority,
  isDeadlineReminderStatus,
  type DeadlineReminder,
  type DeadlineReminderKind,
  type DeadlineReminderPriority,
  type DeadlineWorkspace,
  type AccountDeadlineReminderCenter,
  type UpdateDeadlineReminderInput,
} from "./types";

const DEFAULT_REMINDER_LEAD_DAYS = 2;

export class DeadlineReminderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineReminderValidationError";
  }
}

interface DeadlineWorkspaceOptions {
  now?: string;
}

type UserIntent = NonNullable<Awaited<ReturnType<typeof getUserIntent>>>;

interface ReminderCandidate {
  kind: DeadlineReminderKind;
  linkedObjectType: string;
  linkedObjectId: string;
  title: string;
  dueAt: string;
  priority: DeadlineReminderPriority;
  metadata?: Record<string, unknown>;
}

function nowIso() {
  return new Date().toISOString();
}

async function workspaceForUser(db: AppDatabase, userId: string) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const workspace = mysql
    ? await ensureMysqlUserWorkspace(mysql, userId)
    : ensureUserWorkspace(db, userId);

  return { mysql, workspace };
}

function normalizeDateOnly(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;

  return normalized.length >= 10 ? normalized.slice(0, 10) : normalized;
}

function reminderAtForDueDate(dueAt: string) {
  const date = new Date(`${dueAt.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return `${dueAt}T00:00:00.000Z`;
  date.setUTCDate(date.getUTCDate() - DEFAULT_REMINDER_LEAD_DAYS);

  return date.toISOString();
}

function daysUntil(dueAt: string, now: string) {
  const due = new Date(`${dueAt.slice(0, 10)}T00:00:00.000Z`).getTime();
  const current = new Date(`${now.slice(0, 10)}T00:00:00.000Z`).getTime();
  if (Number.isNaN(due) || Number.isNaN(current)) return Number.POSITIVE_INFINITY;

  return Math.ceil((due - current) / 86_400_000);
}

function dedupeKey(input: {
  organizationId: string;
  intentId: string;
  kind: DeadlineReminderKind;
  linkedObjectType: string;
  linkedObjectId: string;
}) {
  return [
    input.organizationId,
    input.intentId,
    input.kind,
    input.linkedObjectType,
    input.linkedObjectId,
  ].join(":");
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function hydrateReminder(row: DeadlineReminderRow): DeadlineReminder {
  if (!isDeadlineReminderKind(row.kind)) {
    throw new Error("Invalid deadline reminder kind.");
  }
  if (!isDeadlineReminderStatus(row.status)) {
    throw new Error("Invalid deadline reminder status.");
  }
  if (!isDeadlineReminderPriority(row.priority)) {
    throw new Error("Invalid deadline reminder priority.");
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    intentId: row.intentId,
    bidId: row.bidId,
    kind: row.kind,
    linkedObjectType: row.linkedObjectType,
    linkedObjectId: row.linkedObjectId,
    title: row.title,
    dueAt: row.dueAt,
    reminderAt: row.reminderAt,
    status: row.status,
    priority: row.priority,
    source: row.source === "manual" ? "manual" : "generated",
    metadata: parseMetadata(row.metadataJson),
    acknowledgedAt: row.acknowledgedAt,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildSummary(reminders: DeadlineReminder[], now: string) {
  const activeReminders = reminders.filter((reminder) => reminder.status === "active");

  return {
    total: reminders.length,
    active: activeReminders.length,
    dueSoon: activeReminders.filter((reminder) => {
      const remainingDays = daysUntil(reminder.dueAt, now);
      return remainingDays >= 0 && remainingDays <= 7;
    }).length,
    overdue: activeReminders.filter((reminder) => daysUntil(reminder.dueAt, now) < 0).length,
    acknowledged: reminders.filter((reminder) => reminder.status === "acknowledged").length,
    snoozed: reminders.filter((reminder) => reminder.status === "snoozed").length,
  };
}

function generatedRow(input: {
  organizationId: string;
  userId: string;
  intentId: string;
  bidId: string;
  timestamp: string;
  candidate: ReminderCandidate;
}): NewDeadlineReminderRow {
  return {
    id: `deadline_reminder_${crypto.randomUUID()}`,
    organizationId: input.organizationId,
    userId: input.userId,
    intentId: input.intentId,
    bidId: input.bidId,
    kind: input.candidate.kind,
    linkedObjectType: input.candidate.linkedObjectType,
    linkedObjectId: input.candidate.linkedObjectId,
    dedupeKey: dedupeKey({
      organizationId: input.organizationId,
      intentId: input.intentId,
      kind: input.candidate.kind,
      linkedObjectType: input.candidate.linkedObjectType,
      linkedObjectId: input.candidate.linkedObjectId,
    }),
    title: input.candidate.title,
    dueAt: input.candidate.dueAt,
    reminderAt: reminderAtForDueDate(input.candidate.dueAt),
    status: "active",
    priority: input.candidate.priority,
    source: "generated",
    metadataJson: JSON.stringify(input.candidate.metadata ?? {}),
    acknowledgedAt: null,
    snoozedUntil: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

async function reminderCandidates(
  db: AppDatabase,
  mysql: MysqlDeadlineReminderRepository | null,
  userId: string,
  organizationId: string,
  intent: UserIntent,
): Promise<ReminderCandidate[]> {
  const candidates: ReminderCandidate[] = [];
  const bidDeadline = normalizeDateOnly(intent.bid.deadlineDate);
  if (bidDeadline) {
    candidates.push({
      kind: "bid_deadline",
      linkedObjectType: "bid",
      linkedObjectId: intent.bid.id,
      title: `Bid deadline: ${intent.bid.title}`,
      dueAt: bidDeadline,
      priority: "high",
      metadata: { issuerName: intent.bid.issuerName },
    });
  }

  const submissionPathRows = mysql
    ? await listSubmissionPathDeadlineRowsFromMysql(mysql, userId, intent.id)
    : listSubmissionPathDeadlineRows(db, userId, intent.id);
  for (const submissionPath of submissionPathRows) {
    if (!bidDeadline || submissionPath.status === "submitted") continue;
    candidates.push({
      kind: "submission_checkpoint",
      linkedObjectType: "submission_path",
      linkedObjectId: submissionPath.id,
      title: `Submission checkpoint: ${intent.bid.title}`,
      dueAt: bidDeadline,
      priority: submissionPath.status === "needs_recovery" ? "high" : "medium",
      metadata: {
        method: submissionPath.method,
        status: submissionPath.status,
      },
    });
  }

  const submissionConfirmationRows = mysql
    ? await listSubmissionConfirmationDeadlineRowsFromMysql(mysql, userId, intent.id)
    : listSubmissionConfirmationDeadlineRows(db, userId, intent.id);
  for (const confirmation of submissionConfirmationRows) {
    if (confirmation.confirmationReference.trim()) continue;
    const dueAt = normalizeDateOnly(confirmation.submittedAt) ?? normalizeDateOnly(confirmation.createdAt);
    if (!dueAt) continue;
    candidates.push({
      kind: "submission_confirmation_recovery",
      linkedObjectType: "submission_confirmation",
      linkedObjectId: confirmation.id,
      title: `Recover confirmation: ${intent.bid.title}`,
      dueAt,
      priority: "high",
      metadata: {
        method: confirmation.method,
        submittedAt: confirmation.submittedAt,
      },
    });
  }

  const responseRows = mysql
    ? await listResponseWorkspaceItemRowsFromMysql(mysql, userId, intent.id)
    : listResponseWorkspaceDeadlineRows(db, intent.id);
  for (const item of responseRows) {
    const dueAt = normalizeDateOnly(item.dueAt);
    if (!dueAt || item.status === "done") continue;
    candidates.push({
      kind: "response_task",
      linkedObjectType: "response_workspace_item",
      linkedObjectId: item.id,
      title: `Response task: ${item.title}`,
      dueAt,
      priority: item.status === "blocked" ? "high" : "medium",
      metadata: { kind: item.kind, status: item.status },
    });
  }

  const quoteRows = mysql
    ? await listQuoteRequestRowsFromMysql(mysql, organizationId, intent.id)
    : listQuoteRequestDeadlineRows(db, intent.id);
  for (const quote of quoteRows) {
    const dueAt = normalizeDateOnly(quote.requestedDueAt);
    if (!dueAt || quote.status === "accepted" || quote.status === "declined") continue;
    candidates.push({
      kind: "quote_due",
      linkedObjectType: "quote_request",
      linkedObjectId: quote.id,
      title: `Quote due: ${quote.title}`,
      dueAt,
      priority: "medium",
      metadata: { status: quote.status },
    });
  }

  const artifactRows = mysql
    ? await listSupplierArtifactRowsFromMysql(mysql, userId, intent.id)
    : listSupplierArtifactDeadlineRows(db, intent.id);
  for (const artifact of artifactRows) {
    const dueAt = normalizeDateOnly(artifact.expiresAt);
    if (!dueAt) continue;
    candidates.push({
      kind: "artifact_expiry",
      linkedObjectType: "supplier_artifact",
      linkedObjectId: artifact.id,
      title: `Artifact expires: ${artifact.title}`,
      dueAt,
      priority: artifact.reviewStatus === "needs_update" ? "high" : "medium",
      metadata: {
        artifactType: artifact.artifactType,
        purpose: artifact.purpose,
        reviewStatus: artifact.reviewStatus,
      },
    });
  }

  return candidates;
}

async function generateReminders(db: AppDatabase, userId: string, intentId: string, timestamp: string) {
  const { mysql, workspace } = await workspaceForUser(db, userId);
  const intent = await getUserIntent(db, userId, intentId);
  if (!intent) throw new IntentNotFoundError();

  for (const candidate of await reminderCandidates(db, mysql, userId, workspace.organizationId, intent)) {
    const row = generatedRow({
      organizationId: workspace.organizationId,
      userId,
      intentId: intent.id,
      bidId: intent.bid.id,
      timestamp,
      candidate,
    });
    if (mysql) {
      await createDeadlineReminderRowFromMysql(mysql, row);
    } else {
      createDeadlineReminderRow(db, row);
    }
  }

  return { mysql, organizationId: workspace.organizationId, intent };
}

export async function getDeadlineWorkspace(
  db: AppDatabase,
  userId: string,
  intentId: string,
  options: DeadlineWorkspaceOptions = {},
): Promise<DeadlineWorkspace> {
  const timestamp = options.now ?? nowIso();
  const { mysql, organizationId, intent } = await generateReminders(db, userId, intentId, timestamp);
  const rows = mysql
    ? await listDeadlineReminderRowsFromMysql(mysql, organizationId, intent.id)
    : listDeadlineReminderRows(db, organizationId, intent.id);
  const reminders = rows.map(hydrateReminder);

  return {
    intentId: intent.id,
    bidId: intent.bid.id,
    organizationId,
    summary: buildSummary(reminders, timestamp),
    reminders,
  };
}

async function requireReminder(
  db: AppDatabase,
  mysql: MysqlDeadlineReminderRepository | null,
  organizationId: string,
  intentId: string,
  reminderId: string,
) {
  const row = mysql
    ? await findDeadlineReminderRowFromMysql(mysql, organizationId, intentId, reminderId)
    : findDeadlineReminderRow(db, organizationId, intentId, reminderId);
  if (!row) {
    throw new DeadlineReminderValidationError("Reminder is not available.");
  }

  return row;
}

export async function acknowledgeDeadlineReminder(
  db: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateDeadlineReminderInput,
): Promise<DeadlineWorkspace> {
  const timestamp = input.now ?? nowIso();
  const workspace = await getDeadlineWorkspace(db, userId, intentId, { now: timestamp });
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  await requireReminder(db, mysql, workspace.organizationId, workspace.intentId, input.reminderId);

  const values = {
    status: "acknowledged",
    acknowledgedAt: timestamp,
    snoozedUntil: null,
    updatedAt: timestamp,
  };
  if (mysql) {
    await updateDeadlineReminderRowFromMysql(mysql, workspace.organizationId, workspace.intentId, input.reminderId, values);
  } else {
    updateDeadlineReminderRow(db, workspace.organizationId, workspace.intentId, input.reminderId, values);
  }

  return getDeadlineWorkspace(db, userId, intentId, { now: timestamp });
}

export async function snoozeDeadlineReminder(
  db: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateDeadlineReminderInput,
): Promise<DeadlineWorkspace> {
  const timestamp = input.now ?? nowIso();
  if (!input.snoozedUntil || Number.isNaN(new Date(input.snoozedUntil).getTime())) {
    throw new DeadlineReminderValidationError("Snooze time is invalid.");
  }

  const workspace = await getDeadlineWorkspace(db, userId, intentId, { now: timestamp });
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  await requireReminder(db, mysql, workspace.organizationId, workspace.intentId, input.reminderId);

  const values = {
    status: "snoozed",
    acknowledgedAt: null,
    snoozedUntil: input.snoozedUntil,
    updatedAt: timestamp,
  };
  if (mysql) {
    await updateDeadlineReminderRowFromMysql(mysql, workspace.organizationId, workspace.intentId, input.reminderId, values);
  } else {
    updateDeadlineReminderRow(db, workspace.organizationId, workspace.intentId, input.reminderId, values);
  }

  return getDeadlineWorkspace(db, userId, intentId, { now: timestamp });
}

export async function getAccountDeadlineReminderCenter(
  db: AppDatabase,
  userId: string,
  options: DeadlineWorkspaceOptions = {},
): Promise<AccountDeadlineReminderCenter> {
  const timestamp = options.now ?? nowIso();
  const { mysql, workspace } = await workspaceForUser(db, userId);
  const rows = mysql
    ? await listOrganizationDeadlineReminderRowsFromMysql(mysql, workspace.organizationId)
    : listOrganizationDeadlineReminderRows(db, workspace.organizationId);
  const reminders = rows.map(hydrateReminder);

  return {
    organizationId: workspace.organizationId,
    summary: buildSummary(reminders, timestamp),
    reminders,
  };
}

async function requireAccountReminder(
  db: AppDatabase,
  mysql: MysqlDeadlineReminderRepository | null,
  organizationId: string,
  reminderId: string,
) {
  const row = mysql
    ? await findOrganizationDeadlineReminderRowFromMysql(mysql, organizationId, reminderId)
    : findOrganizationDeadlineReminderRow(db, organizationId, reminderId);
  if (!row) {
    throw new DeadlineReminderValidationError("Reminder is not available.");
  }

  return row;
}

export async function acknowledgeAccountDeadlineReminder(
  db: AppDatabase,
  userId: string,
  input: UpdateDeadlineReminderInput,
): Promise<AccountDeadlineReminderCenter> {
  const timestamp = input.now ?? nowIso();
  const { mysql, workspace } = await workspaceForUser(db, userId);
  await requireAccountReminder(db, mysql, workspace.organizationId, input.reminderId);

  const values = {
    status: "acknowledged",
    acknowledgedAt: timestamp,
    snoozedUntil: null,
    updatedAt: timestamp,
  };
  if (mysql) {
    await updateOrganizationDeadlineReminderRowFromMysql(mysql, workspace.organizationId, input.reminderId, values);
  } else {
    updateOrganizationDeadlineReminderRow(db, workspace.organizationId, input.reminderId, values);
  }

  return getAccountDeadlineReminderCenter(db, userId, { now: timestamp });
}

export async function snoozeAccountDeadlineReminder(
  db: AppDatabase,
  userId: string,
  input: UpdateDeadlineReminderInput,
): Promise<AccountDeadlineReminderCenter> {
  const timestamp = input.now ?? nowIso();
  if (!input.snoozedUntil || Number.isNaN(new Date(input.snoozedUntil).getTime())) {
    throw new DeadlineReminderValidationError("Snooze time is invalid.");
  }

  const { mysql, workspace } = await workspaceForUser(db, userId);
  await requireAccountReminder(db, mysql, workspace.organizationId, input.reminderId);

  const values = {
    status: "snoozed",
    acknowledgedAt: null,
    snoozedUntil: input.snoozedUntil,
    updatedAt: timestamp,
  };
  if (mysql) {
    await updateOrganizationDeadlineReminderRowFromMysql(mysql, workspace.organizationId, input.reminderId, values);
  } else {
    updateOrganizationDeadlineReminderRow(db, workspace.organizationId, input.reminderId, values);
  }

  return getAccountDeadlineReminderCenter(db, userId, { now: timestamp });
}
