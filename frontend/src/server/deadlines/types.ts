export const DEADLINE_REMINDER_KINDS = [
  "bid_deadline",
  "response_task",
  "quote_due",
  "artifact_expiry",
  "submission_checkpoint",
  "submission_confirmation_recovery",
] as const;

export const DEADLINE_REMINDER_STATUSES = [
  "active",
  "acknowledged",
  "snoozed",
  "suppressed",
] as const;

export const DEADLINE_REMINDER_PRIORITIES = ["low", "medium", "high"] as const;

export type DeadlineReminderKind = (typeof DEADLINE_REMINDER_KINDS)[number];
export type DeadlineReminderStatus = (typeof DEADLINE_REMINDER_STATUSES)[number];
export type DeadlineReminderPriority = (typeof DEADLINE_REMINDER_PRIORITIES)[number];

export interface DeadlineReminder {
  id: string;
  organizationId: string;
  userId: string;
  intentId: string;
  bidId: string;
  kind: DeadlineReminderKind;
  linkedObjectType: string;
  linkedObjectId: string;
  title: string;
  dueAt: string;
  reminderAt: string;
  status: DeadlineReminderStatus;
  priority: DeadlineReminderPriority;
  source: "generated" | "manual";
  metadata: Record<string, unknown>;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeadlineWorkspace {
  intentId: string;
  bidId: string;
  organizationId: string;
  summary: {
    total: number;
    active: number;
    dueSoon: number;
    overdue: number;
    acknowledged: number;
    snoozed: number;
  };
  reminders: DeadlineReminder[];
}

export interface AccountDeadlineReminderCenter {
  organizationId: string;
  summary: DeadlineWorkspace["summary"];
  reminders: DeadlineReminder[];
}

export interface UpdateDeadlineReminderInput {
  reminderId: string;
  snoozedUntil?: string;
  now?: string;
}

export interface DeadlineWorkspaceResponse {
  workspace: DeadlineWorkspace;
}

export function isDeadlineReminderKind(value: unknown): value is DeadlineReminderKind {
  return typeof value === "string" && DEADLINE_REMINDER_KINDS.includes(value as DeadlineReminderKind);
}

export function isDeadlineReminderStatus(value: unknown): value is DeadlineReminderStatus {
  return typeof value === "string" && DEADLINE_REMINDER_STATUSES.includes(value as DeadlineReminderStatus);
}

export function isDeadlineReminderPriority(value: unknown): value is DeadlineReminderPriority {
  return typeof value === "string" && DEADLINE_REMINDER_PRIORITIES.includes(value as DeadlineReminderPriority);
}
