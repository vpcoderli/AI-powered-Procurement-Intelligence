import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  tier: AccountTier;
  features: FeatureKey[];
}

export interface AuthResponse {
  user: PublicUser;
}

export interface SessionResponse {
  user: PublicUser | null;
}

type AuthErrorCode =
  | "ACCOUNT_DISABLED"
  | "EMAIL_ALREADY_REGISTERED"
  | "INVALID_CREDENTIALS"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR"
  | "WEAK_PASSWORD";

interface ApiErrorResponse {
  error: {
    code: AuthErrorCode;
    message: string;
  };
}

export class AuthApiError extends Error {
  status: number;
  code: AuthErrorCode;

  constructor(status: number, code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthApiError";
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
    typeof message === "string" &&
    (code === "ACCOUNT_DISABLED" ||
      code === "EMAIL_ALREADY_REGISTERED" ||
      code === "INVALID_CREDENTIALS" ||
      code === "INVALID_REQUEST" ||
      code === "INTERNAL_ERROR" ||
      code === "WEAK_PASSWORD")
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new AuthApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  if (!response.ok) {
    if (isApiErrorResponse(body)) {
      throw new AuthApiError(response.status, body.error.code, body.error.message);
    }

    throw new AuthApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

export async function getSession(): Promise<SessionResponse> {
  const response = await fetch("/api/auth/session");

  return parseResponse<SessionResponse>(response);
}

export async function register(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthResponse> {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AuthResponse>(response);
}

export async function login(input: { email: string; password: string }): Promise<AuthResponse> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AuthResponse>(response);
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
  });

  await parseResponse<{ ok: true }>(response);
}
