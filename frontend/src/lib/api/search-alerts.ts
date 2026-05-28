import type {
  CreateSearchAlertInput,
  SearchAlertApiErrorResponse,
  SearchAlertResponse,
  SearchAlertsResponse,
  UpdateSearchAlertInput,
} from "@/server/search-alerts/types";

type ApiErrorCode = SearchAlertApiErrorResponse["error"]["code"];

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

function isApiErrorResponse(body: unknown): body is SearchAlertApiErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (
    (code === "ALERT_NOT_FOUND" ||
      code === "INVALID_REQUEST" ||
      code === "USAGE_LIMIT_REACHED" ||
      code === "INTERNAL_ERROR") &&
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
      throw new ApiError(response.status, body.error.code, body.error.message);
    }

    throw new ApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

export async function listSearchAlerts() {
  const response = await fetch("/api/search-alerts");

  return parseResponse<SearchAlertsResponse>(response);
}

export async function createSearchAlert(input: CreateSearchAlertInput) {
  const response = await fetch("/api/search-alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<SearchAlertResponse>(response);
}

export async function updateSearchAlert(id: string, input: UpdateSearchAlertInput) {
  const response = await fetch(`/api/search-alerts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<SearchAlertResponse>(response);
}

export async function deleteSearchAlert(id: string) {
  const response = await fetch(`/api/search-alerts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  await parseResponse<Record<string, never>>(response);
}
