import type {
  IntentApiErrorResponse,
  IntentListResponse,
  IntentResponse,
  IntentStatus,
} from "@/server/intents/types";
import type {
  CreateSubmissionConfirmationInput,
  SubmissionConfirmationResponse,
  SubmissionGuidanceResponse,
  UpdateSubmissionGuidanceInput,
} from "@/server/submission/types";
import { ApiError } from "./bids";

function isApiErrorResponse(body: unknown): body is IntentApiErrorResponse {
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
      code === "FEATURE_NOT_AVAILABLE" ||
      code === "INTENT_NOT_FOUND" ||
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
    throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  if (!response.ok) {
    if (isApiErrorResponse(body)) {
      throw new ApiError(response.status, body.error.code as "INTERNAL_ERROR", body.error.message);
    }

    throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

export async function createIntent(bidId: string) {
  const response = await fetch(`/api/bids/${encodeURIComponent(bidId)}/intent`, {
    method: "POST",
  });

  return parseResponse<IntentResponse>(response);
}

export async function fetchIntents() {
  const response = await fetch("/api/intents");

  return parseResponse<IntentListResponse>(response);
}

export async function fetchIntent(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}`);

  return parseResponse<IntentResponse>(response);
}

export async function updateIntentStatus(id: string, status: IntentStatus) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

  return parseResponse<IntentResponse>(response);
}

export async function fetchSubmissionGuidance(id: string) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/submission`);

  return parseResponse<SubmissionGuidanceResponse>(response);
}

export async function updateSubmissionGuidance(
  id: string,
  input: UpdateSubmissionGuidanceInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/submission`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<SubmissionGuidanceResponse>(response);
}

export async function confirmSubmission(
  id: string,
  input: CreateSubmissionConfirmationInput,
) {
  const response = await fetch(`/api/intents/${encodeURIComponent(id)}/submission/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<SubmissionConfirmationResponse>(response);
}
