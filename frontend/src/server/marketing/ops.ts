import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { writeEvent, writeEventFromMysql, type EventLogEntry } from "@/server/events/event-log";
import {
  enqueueNotification,
  enqueueNotificationFromMysql,
  listDeliverableNotifications,
  listDeliverableNotificationsFromMysql,
  markNotificationFailed,
  markNotificationFailedFromMysql,
  markNotificationSent,
  markNotificationSentFromMysql,
} from "@/server/notifications/outbox-repository";
import type {
  EnqueueNotificationResult,
  NotificationOutboxRow,
  NotificationProvider,
  NotificationSendPayload,
  NotificationSendResult,
} from "@/server/notifications/types";
import type { RequestDemoLeadInput, RequestDemoLeadResult } from "./funnel";

interface MysqlMarketingOpsStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export interface QueueRequestDemoLeadOperationsInput {
  lead: RequestDemoLeadResult;
  leadInput: RequestDemoLeadInput;
  occurredAt?: string;
}

export interface QueueRequestDemoLeadOperationsResult {
  notification: EnqueueNotificationResult;
  crmEvent: EventLogEntry;
}

export interface RequestDemoNotificationDeliveryOptions {
  now?: string;
  limit?: number;
  maxAttempts?: number;
  outcomes?: Record<string, NotificationSendResult>;
  defaultOutcome?: NotificationSendResult;
}

export interface RequestDemoNotificationDeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

const defaultMarketingRecipient = "marketing-ops@winbids.local";
const crmDestination = "crm.marketing_leads";
const notificationDedupePrefix = "marketing:request_demo:";
const notificationDedupeSuffix = ":notification";

function marketingNotificationRecipient() {
  const configured = process.env.MARKETING_DEMO_NOTIFICATION_RECIPIENT?.trim();
  return configured || defaultMarketingRecipient;
}

function normalizeText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || "Not provided";
}

function serviceStatesLine(values: string[] | undefined) {
  const states = values?.map((value) => value.trim().toUpperCase()).filter(Boolean) ?? [];
  return states.length > 0 ? states.join(", ") : "Not provided";
}

function renderRequestDemoNotification(input: QueueRequestDemoLeadOperationsInput) {
  const company = normalizeText(input.leadInput.companyName);

  return {
    subject: `New WinBids demo request: ${company}`,
    bodyText: [
      `Lead ID: ${input.lead.id}`,
      `Signup URL: ${input.lead.nextUrl}`,
      `Email: ${input.leadInput.email.trim().toLowerCase()}`,
      `Name: ${normalizeText(input.leadInput.fullName)}`,
      `Company: ${company}`,
      `Role: ${normalizeText(input.leadInput.role)}`,
      `Service states: ${serviceStatesLine(input.leadInput.serviceStates)}`,
      `Language: ${input.leadInput.language ?? "en"}`,
      "",
      "Notes:",
      normalizeText(input.leadInput.notes),
    ].join("\n"),
  };
}

function crmMetadata(input: QueueRequestDemoLeadOperationsInput) {
  return {
    leadEventId: input.lead.id,
    nextUrl: input.lead.nextUrl,
    destination: crmDestination,
    status: "pending",
    email: input.leadInput.email.trim().toLowerCase(),
    fullName: normalizeText(input.leadInput.fullName),
    companyName: normalizeText(input.leadInput.companyName),
    role: normalizeText(input.leadInput.role),
    serviceStates: input.leadInput.serviceStates?.map((value) => value.trim().toUpperCase()).filter(Boolean) ?? [],
    language: input.leadInput.language ?? "en",
  };
}

function requestDemoLeadIdFromNotification(notification: Pick<NotificationSendPayload, "dedupeKey">) {
  if (
    !notification.dedupeKey.startsWith(notificationDedupePrefix) ||
    !notification.dedupeKey.endsWith(notificationDedupeSuffix)
  ) {
    return null;
  }

  return notification.dedupeKey.slice(
    notificationDedupePrefix.length,
    notification.dedupeKey.length - notificationDedupeSuffix.length,
  );
}

function isRequestDemoNotification(notification: Pick<NotificationOutboxRow, "dedupeKey" | "alertId">) {
  return (
    notification.alertId === "marketing_request_demo" &&
    requestDemoLeadIdFromNotification(notification) !== null
  );
}

function requestDemoDeliverable(
  notifications: NotificationOutboxRow[],
  options: { limit: number },
) {
  return notifications.filter(isRequestDemoNotification).slice(0, options.limit);
}

export function createFakeRequestDemoNotificationProvider(
  options: Pick<RequestDemoNotificationDeliveryOptions, "outcomes" | "defaultOutcome"> = {},
): NotificationProvider {
  const defaultOutcome = options.defaultOutcome ?? { ok: true };

  return {
    async send(payload) {
      const leadId = requestDemoLeadIdFromNotification(payload);
      if (!leadId) {
        return { ok: false, error: "Notification is not a request-demo marketing notification" };
      }

      return options.outcomes?.[leadId] ?? defaultOutcome;
    },
  };
}

function emptyDeliveryResult(): RequestDemoNotificationDeliveryResult {
  return { attempted: 0, sent: 0, failed: 0, skipped: 0 };
}

async function deliverRequestDemoNotificationRows(
  rows: NotificationOutboxRow[],
  provider: NotificationProvider,
  options: {
    now: string;
    skipped: number;
    markSent: (id: string, sentAt: string) => NotificationOutboxRow | Promise<NotificationOutboxRow>;
    markFailed: (
      id: string,
      error: string,
      attemptedAt: string,
    ) => NotificationOutboxRow | Promise<NotificationOutboxRow>;
  },
) {
  const result = emptyDeliveryResult();
  result.skipped = options.skipped;

  for (const notification of rows) {
    result.attempted += 1;

    try {
      const sendResult = await provider.send({
        id: notification.id,
        channel: notification.channel,
        recipient: notification.recipient,
        subject: notification.subject,
        bodyText: notification.bodyText,
        dedupeKey: notification.dedupeKey,
        matchedBidIds: notification.matchedBidIds,
      });

      if (sendResult.ok) {
        await options.markSent(notification.id, options.now);
        result.sent += 1;
      } else {
        await options.markFailed(notification.id, sendResult.error, options.now);
        result.failed += 1;
      }
    } catch (error) {
      const failureReason = error instanceof Error
        ? error.message
        : "Request-demo fake provider threw an unknown error";
      await options.markFailed(notification.id, failureReason, options.now);
      result.failed += 1;
    }
  }

  return result;
}

export function queueRequestDemoLeadOperations(
  db: AppDatabase,
  input: QueueRequestDemoLeadOperationsInput,
): QueueRequestDemoLeadOperationsResult {
  const now = input.occurredAt ?? new Date().toISOString();
  const notificationContent = renderRequestDemoNotification(input);
  const notification = enqueueNotification(db, {
    id: `notification_${randomUUID()}`,
    alertId: "marketing_request_demo",
    userId: "marketing_ops",
    channel: "email",
    recipient: marketingNotificationRecipient(),
    frequency: "daily",
    dedupeKey: `marketing:request_demo:${input.lead.id}:notification`,
    subject: notificationContent.subject,
    bodyText: notificationContent.bodyText,
    matchedBidIds: [],
    createdAt: now,
  });
  const crmEvent = writeEvent(db, {
    eventName: "marketing.crm_handoff_queued",
    actorType: "system",
    targetType: "marketing_lead",
    targetId: input.lead.id,
    source: "marketing.request-demo",
    outcome: "success",
    severity: "info",
    idempotencyKey: `marketing:crm_handoff:${input.lead.id}`,
    retentionClass: "marketing",
    metadata: crmMetadata(input),
    outboxDestinations: [crmDestination],
    occurredAt: now,
  });

  return { notification, crmEvent };
}

export async function queueRequestDemoLeadOperationsFromMysql(
  mysql: MysqlMarketingOpsStore,
  input: QueueRequestDemoLeadOperationsInput,
): Promise<QueueRequestDemoLeadOperationsResult> {
  const now = input.occurredAt ?? new Date().toISOString();
  const notificationContent = renderRequestDemoNotification(input);
  const notification = await enqueueNotificationFromMysql(mysql, {
    id: `notification_${randomUUID()}`,
    alertId: "marketing_request_demo",
    userId: "marketing_ops",
    channel: "email",
    recipient: marketingNotificationRecipient(),
    frequency: "daily",
    dedupeKey: `marketing:request_demo:${input.lead.id}:notification`,
    subject: notificationContent.subject,
    bodyText: notificationContent.bodyText,
    matchedBidIds: [],
    createdAt: now,
  });
  const crmEvent = await writeEventFromMysql(mysql, {
    eventName: "marketing.crm_handoff_queued",
    actorType: "system",
    targetType: "marketing_lead",
    targetId: input.lead.id,
    source: "marketing.request-demo",
    outcome: "success",
    severity: "info",
    idempotencyKey: `marketing:crm_handoff:${input.lead.id}`,
    retentionClass: "marketing",
    metadata: crmMetadata(input),
    outboxDestinations: [crmDestination],
    occurredAt: now,
  });

  return { notification, crmEvent };
}

export async function deliverPendingRequestDemoNotifications(
  db: AppDatabase,
  options: RequestDemoNotificationDeliveryOptions = {},
): Promise<RequestDemoNotificationDeliveryResult> {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const candidates = listDeliverableNotifications(db, {
    limit: 100,
    maxAttempts,
  }).filter(isRequestDemoNotification);
  const deliverable = requestDemoDeliverable(candidates, { limit });
  const provider = createFakeRequestDemoNotificationProvider(options);

  return deliverRequestDemoNotificationRows(deliverable, provider, {
    now,
    skipped: Math.max(0, candidates.length - deliverable.length),
    markSent: (id, sentAt) => markNotificationSent(db, id, sentAt),
    markFailed: (id, error, attemptedAt) => markNotificationFailed(db, id, error, attemptedAt),
  });
}

export async function deliverPendingRequestDemoNotificationsFromMysql(
  mysql: MysqlMarketingOpsStore,
  options: RequestDemoNotificationDeliveryOptions = {},
): Promise<RequestDemoNotificationDeliveryResult> {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const candidates = (await listDeliverableNotificationsFromMysql(mysql, {
    limit: 100,
    maxAttempts,
  })).filter(isRequestDemoNotification);
  const deliverable = requestDemoDeliverable(candidates, { limit });
  const provider = createFakeRequestDemoNotificationProvider(options);

  return deliverRequestDemoNotificationRows(deliverable, provider, {
    now,
    skipped: Math.max(0, candidates.length - deliverable.length),
    markSent: (id, sentAt) => markNotificationSentFromMysql(mysql, id, sentAt),
    markFailed: (id, error, attemptedAt) => markNotificationFailedFromMysql(mysql, id, error, attemptedAt),
  });
}

export function markRequestDemoNotificationFailed(
  db: AppDatabase,
  id: string,
  error: string,
  attemptedAt: string,
) {
  return markNotificationFailed(db, id, error, attemptedAt);
}
