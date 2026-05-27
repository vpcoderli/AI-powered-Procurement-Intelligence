import type { BidMatchResponse } from "@/server/match/types";
import { ApiError } from "./bids";

type MatchApiErrorCode = "BID_NOT_FOUND" | "INTERNAL_ERROR";

interface MatchApiErrorResponse {
  error: {
    code: MatchApiErrorCode;
    message: string;
  };
}

function isApiErrorResponse(body: unknown): body is MatchApiErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (code === "BID_NOT_FOUND" || code === "INTERNAL_ERROR") && typeof message === "string";
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
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

export async function fetchBidMatch(id: string) {
  const response = await fetch(`/api/bids/${encodeURIComponent(id)}/match`);

  return parseResponse<BidMatchResponse>(response);
}
