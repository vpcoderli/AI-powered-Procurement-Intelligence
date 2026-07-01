import type { Bid, IssuerType } from "./domain";

export type SortOption = "relevance" | "newest" | "deadline";
export type ApiIssuerType = "all" | IssuerType;
export type DeadlinePreset = "any" | "next7" | "next30";
export type PublishedPreset = "any" | "last24" | "last7";

export interface BidQuery {
  q?: string;
  states?: string[];
  issuerType?: ApiIssuerType;
  deadline?: DeadlinePreset;
  published?: PublishedPreset;
  sort?: SortOption;
}

export interface BidQueryOptions {
  referenceDate?: Date;
}

export interface NormalizedBidQuery {
  q: string;
  states: string[];
  issuerType: ApiIssuerType;
  deadline: DeadlinePreset;
  published: PublishedPreset;
  sort: SortOption;
}

export interface BidListResponse {
  bids: Bid[];
  total: number;
  filters: NormalizedBidQuery;
}

export interface BidDetailResponse {
  bid: Bid;
}

export interface SavedBidsResponse {
  savedBidIds: string[];
  bids: Bid[];
}

export interface ApiErrorResponse {
  error: {
    code: "BID_NOT_FOUND" | "AUTH_REQUIRED" | "INVALID_REQUEST" | "INTERNAL_ERROR" | "USAGE_LIMIT_REACHED";
    message: string;
    feature?: string;
    limit?: number;
    used?: number;
    requiredTier?: string | null;
  };
}

export class BidNotFoundError extends Error {
  constructor(message = "Bid not found") {
    super(message);
    this.name = "BidNotFoundError";
  }
}
