import type { Bid } from "@/server/bids/domain";
import type { BidMatchResult } from "@/server/match/types";

export const INTENT_STATUSES = [
  "intent_added",
  "needs_review",
  "questions_needed",
  "sourcing_needed",
  "pursuit_decision_needed",
] as const;

export type IntentStatus = (typeof INTENT_STATUSES)[number];

export interface GeneratedIntentContent {
  aiBidBrief: string;
  keyDates: {
    publishedDate: string;
    deadlineDate: string;
  };
  initialChecklist: string[];
  riskFlags: string[];
}

export interface IntentSummary {
  id: string;
  userId: string;
  bid: Bid;
  status: IntentStatus;
  generated: GeneratedIntentContent;
  match: BidMatchResult;
  createdAt: string;
  updatedAt: string;
}

export type IntentDetail = IntentSummary;

export interface IntentResponse {
  intent: IntentDetail;
}

export interface IntentListResponse {
  intents: IntentSummary[];
}

export interface IntentApiErrorResponse {
  error: {
    code: "BID_NOT_FOUND" | "INTENT_NOT_FOUND" | "INVALID_REQUEST" | "INTERNAL_ERROR";
    message: string;
  };
}

export class IntentBidNotFoundError extends Error {
  constructor(message = "Bid not found") {
    super(message);
    this.name = "IntentBidNotFoundError";
  }
}

export class IntentNotFoundError extends Error {
  constructor(message = "Intent not found") {
    super(message);
    this.name = "IntentNotFoundError";
  }
}

export class InvalidIntentStatusError extends Error {
  constructor(message = "Unsupported intent status") {
    super(message);
    this.name = "InvalidIntentStatusError";
  }
}

export function isIntentStatus(value: unknown): value is IntentStatus {
  return typeof value === "string" && INTENT_STATUSES.includes(value as IntentStatus);
}
