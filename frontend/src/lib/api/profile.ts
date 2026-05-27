import type { SupplierProfileInput, SupplierProfileResponse } from "@/server/profile/types";

type ApiErrorCode = "INVALID_REQUEST" | "INTERNAL_ERROR";

interface ProfileApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
  };
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

function isApiErrorResponse(body: unknown): body is ProfileApiErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (code === "INVALID_REQUEST" || code === "INTERNAL_ERROR") && typeof message === "string";
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

export async function fetchSupplierProfile() {
  const response = await fetch("/api/company/profile");

  return parseResponse<SupplierProfileResponse>(response);
}

export async function updateSupplierProfile(input: SupplierProfileInput) {
  const response = await fetch("/api/company/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<SupplierProfileResponse>(response);
}
