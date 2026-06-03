import crypto from "node:crypto";
import { ensureUserWorkspace } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createDeadlineReminderRow,
  findDeadlineReminderRow,
  findOrganizationDeadlineReminderRow,
  listDeadlineReminderRows,
  listOrganizationDeadlineReminderRows,
  listQuoteRequestDeadlineRows,
  listResponseWorkspaceDeadlineRows,
  listSupplierArtifactDeadlineRows,
  updateDeadlineReminderRow,
  updateOrganizationDeadlineReminderRow,
  type DeadlineReminderRow,
  type NewDeadlineReminderRow,
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

async function reminderCandidates(db: AppDatabase, userId: string, intentId: string): Promise<ReminderCandidate[]> {
  const intent = await getUserIntent(db, userId, intentId);
  if (!intent) throw new IntentNotFoundError();

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

  for (const item of listResponseWorkspaceDeadlineRows(db, intent.id)) {
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

  for (const quote of listQuoteRequestDeadlineRows(db, intent.id)) {
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

  for (const artifact of listSupplierArtifactDeadlineRows(db, intent.id)) {
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
  const workspace = ensureUserWorkspace(db, userId);
  const intent = await getUserIntent(db, userId, intentId);
  if (!intent) throw new IntentNotFoundError();

  for (const candidate of await reminderCandidates(db, userId, intent.id)) {
    createDeadlineReminderRow(db, generatedRow({
      organizationId: workspace.organizationId,
      userId,
      intentId: intent.id,
      bidId: intent.bid.id,
      timestamp,
      candidate,
    }));
  }

  return { organizationId: workspace.organizationId, intent };
}

export async function getDeadlineWorkspace(
  db: AppDatabase,
  userId: string,
  intentId: string,
  options: DeadlineWorkspaceOptions = {},
): Promise<DeadlineWorkspace> {
  const timestamp = options.now ?? nowIso();
  const { organizationId, intent } = await generateReminders(db, userId, intentId, timestamp);
  const reminders = listDeadlineReminderRows(db, organizationId, intent.id).map(hydrateReminder);

  return {
    intentId: intent.id,
    bidId: intent.bid.id,
    organizationId,
    summary: buildSummary(reminders, timestamp),
    reminders,
  };
}

function requireReminder(
  db: AppDatabase,
  organizationId: string,
  intentId: string,
  reminderId: string,
) {
  const row = findDeadlineReminderRow(db, organizationId, intentId, reminderId);
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
  requireReminder(db, workspace.organizationId, workspace.intentId, input.reminderId);

  updateDeadlineReminderRow(db, workspace.organizationId, workspace.intentId, input.reminderId, {
    status: "acknowledged",
    acknowledgedAt: timestamp,
    snoozedUntil: null,
    updatedAt: timestamp,
  });

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
  requireReminder(db, workspace.organizationId, workspace.intentId, input.reminderId);

  updateDeadlineReminderRow(db, workspace.organizationId, workspace.intentId, input.reminderId, {
    status: "snoozed",
    acknowledgedAt: null,
    snoozedUntil: input.snoozedUntil,
    updatedAt: timestamp,
  });

  return getDeadlineWorkspace(db, userId, intentId, { now: timestamp });
}

export async function getAccountDeadlineReminderCenter(
  db: AppDatabase,
  userId: string,
  options: DeadlineWorkspaceOptions = {},
): Promise<AccountDeadlineReminderCenter> {
  const timestamp = options.now ?? nowIso();
  const workspace = ensureUserWorkspace(db, userId);
  const reminders = listOrganizationDeadlineReminderRows(db, workspace.organizationId).map(hydrateReminder);

  return {
    organizationId: workspace.organizationId,
    summary: buildSummary(reminders, timestamp),
    reminders,
  };
}

function requireAccountReminder(db: AppDatabase, organizationId: string, reminderId: string) {
  const row = findOrganizationDeadlineReminderRow(db, organizationId, reminderId);
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
  const workspace = ensureUserWorkspace(db, userId);
  requireAccountReminder(db, workspace.organizationId, input.reminderId);

  updateOrganizationDeadlineReminderRow(db, workspace.organizationId, input.reminderId, {
    status: "acknowledged",
    acknowledgedAt: timestamp,
    snoozedUntil: null,
    updatedAt: timestamp,
  });

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

  const workspace = ensureUserWorkspace(db, userId);
  requireAccountReminder(db, workspace.organizationId, input.reminderId);

  updateOrganizationDeadlineReminderRow(db, workspace.organizationId, input.reminderId, {
    status: "snoozed",
    acknowledgedAt: null,
    snoozedUntil: input.snoozedUntil,
    updatedAt: timestamp,
  });

  return getAccountDeadlineReminderCenter(db, userId, { now: timestamp });
}
