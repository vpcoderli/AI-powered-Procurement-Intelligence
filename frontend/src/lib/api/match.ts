import type { BidMatchResponse } from "@/server/match/types";
import { ApiError } from "./bids";

export async function fetchBidMatch(id: string) {
  const response = await fetch(`/api/bids/${encodeURIComponent(id)}/match`);
  const body = await response.json();

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? "INTERNAL_ERROR",
      body.error?.message ?? "Request failed",
    );
  }

  return body as BidMatchResponse;
}
