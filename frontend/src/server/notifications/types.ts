import type { BidQuery } from "@/server/bids/types";

export type NotificationChannel = "email";
export type NotificationFrequency = "daily" | "weekly";
export type NotificationStatus = "pending" | "sent" | "failed";

export interface NotificationBidSummary {
  id: string;
  title: string;
  issuerName: string;
  sourceUrl: string;
  deadlineDate: string;
}

export interface MatchedAlertNotification {
  alertId: string;
  userId: string;
  alertName: string;
  frequency: NotificationFrequency;
  notificationChannel: NotificationChannel;
  bidIds: string[];
  bids: NotificationBidSummary[];
  query: BidQuery;
}

export interface NotificationOutboxInput {
  id: string;
  alertId: string;
  userId: string;
  channel: NotificationChannel;
  recipient: string;
  frequency: NotificationFrequency;
  dedupeKey: string;
  subject: string;
  bodyText: string;
  matchedBidIds: string[];
  createdAt: string;
}

export interface NotificationOutboxRow extends NotificationOutboxInput {
  matchedBidIds: string[];
  status: NotificationStatus;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
}

export interface EnqueueNotificationResult {
  created: boolean;
  notification: NotificationOutboxRow;
}

export interface NotificationSendPayload {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string;
  bodyText: string;
  dedupeKey: string;
  matchedBidIds: string[];
}

export type NotificationSendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string };

export interface NotificationProvider {
  send(payload: NotificationSendPayload): Promise<NotificationSendResult>;
}

export interface SendMatchedAlertNotificationResult {
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
}
