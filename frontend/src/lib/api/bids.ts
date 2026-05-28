import type {
  ApiErrorResponse,
  BidDetailResponse,
  BidListResponse,
  DeadlinePreset,
  PublishedPreset,
  SavedBidsResponse,
} from "@/server/bids/types";
import type { ApiIssuerType } from "@/server/bids/types";
import type { SortOption } from "@/lib/mock-data";

type ApiErrorCode = ApiErrorResponse["error"]["code"];

export interface FetchBidsParams {
  q?: string;
  states?: string[];
  issuerType?: ApiIssuerType;
  deadline?: DeadlinePreset;
  published?: PublishedPreset;
  sort?: SortOption;
}

export class ApiError extends Error {
  status: number;
  code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isApiErrorResponse(body: unknown): body is ApiErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (
    (code === "BID_NOT_FOUND" ||
      code === "INVALID_REQUEST" ||
      code === "INTERNAL_ERROR" ||
      code === "USAGE_LIMIT_REACHED") &&
    typeof message === "string"
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
    }

    throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  if (!response.ok) {
    if (isApiErrorResponse(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message);
    }

    throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

function buildBidsUrl(params: FetchBidsParams = {}) {
  const searchParams = new URLSearchParams();

  if (params.q) {
    searchParams.set("q", params.q);
  }

  if (params.states?.length) {
    searchParams.set("states", params.states.join(","));
  }

  if (params.issuerType) {
    searchParams.set("issuerType", params.issuerType);
  }

  if (params.deadline) {
    searchParams.set("deadline", params.deadline);
  }

  if (params.published) {
    searchParams.set("published", params.published);
  }

  if (params.sort) {
    searchParams.set("sort", params.sort);
  }

  const query = searchParams.toString();

  return query ? `/api/bids?${query}` : "/api/bids";
}

export async function fetchBids(params: FetchBidsParams = {}) {
  const response = await fetch(buildBidsUrl(params));

  return parseResponse<BidListResponse>(response);
}

export async function fetchBid(id: string) {
  const response = await fetch(`/api/bids/${encodeURIComponent(id)}`);

  return parseResponse<BidDetailResponse>(response);
}

export async function fetchSavedBids() {
  const response = await fetch("/api/saved-bids");

  return parseResponse<SavedBidsResponse>(response);
}

export async function saveBid(id: string) {
  const response = await fetch("/api/saved-bids", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bidId: id }),
  });

  return parseResponse<SavedBidsResponse>(response);
}

export async function removeSavedBid(id: string) {
  const response = await fetch(`/api/saved-bids/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  return parseResponse<SavedBidsResponse>(response);
}
