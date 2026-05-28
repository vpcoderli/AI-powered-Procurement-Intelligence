import type { BidQuery } from "@/server/bids/types";

export type AlertFrequency = "daily" | "weekly";

export interface SearchAlert {
  id: string;
  userId: string;
  name: string;
  query: BidQuery;
  frequency: AlertFrequency;
  isEnabled: boolean;
  lastMatchedAt: string | null;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSearchAlertInput {
  name: string;
  query: BidQuery;
  frequency: AlertFrequency;
  isEnabled: boolean;
}

export interface UpdateSearchAlertInput {
  name?: string;
  query?: BidQuery;
  frequency?: AlertFrequency;
  isEnabled?: boolean;
}

export interface SearchAlertsResponse {
  alerts: SearchAlert[];
}

export interface SearchAlertResponse {
  alert: SearchAlert;
}

export interface SearchAlertApiErrorResponse {
  error: {
    code: "ALERT_NOT_FOUND" | "INVALID_REQUEST" | "USAGE_LIMIT_REACHED" | "INTERNAL_ERROR";
    message: string;
    feature?: string;
    limit?: number;
    used?: number;
    requiredTier?: string | null;
  };
}

export class SearchAlertNotFoundError extends Error {
  constructor() {
    super("Search alert not found");
    this.name = "SearchAlertNotFoundError";
  }
}
