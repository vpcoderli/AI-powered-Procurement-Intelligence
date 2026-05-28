import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";
import type { WorkspaceRole } from "@/server/account/workspace";

export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled";
export type SubscriptionSource = "admin_override" | "local_checkout" | "billing_provider";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  tier: AccountTier;
  features: FeatureKey[];
  workspace?: {
    organizationId: string;
    organizationName: string;
    role: WorkspaceRole;
  };
}

export interface AuthResponse {
  user: PublicUser;
}

export interface SessionResponse {
  user: PublicUser | null;
}

export interface SubscriptionPlan {
  tier: AccountTier;
  label: string;
  priceMonthlyUsd: number | null;
  featureHighlights: string[];
}

export interface AccountSubscription {
  userId: string;
  tier: AccountTier;
  status: SubscriptionStatus;
  source: SubscriptionSource;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface AccountSubscriptionResponse {
  subscription: AccountSubscription;
  plans: SubscriptionPlan[];
}

export interface PasswordResetRequestResponse {
  ok: true;
  resetToken?: string;
  expiresAt?: string;
}

export interface AccountWorkspaceMember {
  userId: string;
  email: string | null;
  displayName: string | null;
  workspaceRole: WorkspaceRole;
  status: "active";
  createdAt: string;
  updatedAt: string;
}

export interface AccountWorkspaceResponse {
  organization: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  currentUserRole: WorkspaceRole;
  members: AccountWorkspaceMember[];
}

export interface InviteWorkspaceMemberResponse {
  member: AccountWorkspaceMember;
  temporaryPassword: string;
}

type AuthErrorCode =
  | "ACCOUNT_DISABLED"
  | "AUTH_REQUIRED"
  | "EMAIL_ALREADY_REGISTERED"
  | "FORBIDDEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_REQUEST"
  | "INVALID_RESET_TOKEN"
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
      code === "AUTH_REQUIRED" ||
      code === "EMAIL_ALREADY_REGISTERED" ||
      code === "FORBIDDEN" ||
      code === "INVALID_CREDENTIALS" ||
      code === "INVALID_REQUEST" ||
      code === "INVALID_RESET_TOKEN" ||
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

export async function updateAccountProfile(input: { displayName: string }): Promise<AuthResponse> {
  const response = await fetch("/api/account/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AuthResponse>(response);
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: true }> {
  const response = await fetch("/api/account/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<{ ok: true }>(response);
}

export async function fetchAccountSubscription(): Promise<AccountSubscriptionResponse> {
  const response = await fetch("/api/account/subscription");

  return parseResponse<AccountSubscriptionResponse>(response);
}

export async function requestPasswordReset(input: {
  email: string;
}): Promise<PasswordResetRequestResponse> {
  const response = await fetch("/api/auth/password-reset/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<PasswordResetRequestResponse>(response);
}

export async function confirmPasswordReset(input: {
  token: string;
  password: string;
}): Promise<{ ok: true }> {
  const response = await fetch("/api/auth/password-reset/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<{ ok: true }>(response);
}

export async function fetchAccountWorkspace(): Promise<AccountWorkspaceResponse> {
  const response = await fetch("/api/account/workspace");

  return parseResponse<AccountWorkspaceResponse>(response);
}

export async function updateAccountWorkspace(input: {
  name: string;
}): Promise<AccountWorkspaceResponse> {
  const response = await fetch("/api/account/workspace", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AccountWorkspaceResponse>(response);
}

export async function inviteWorkspaceMember(input: {
  email: string;
  displayName?: string;
  role: WorkspaceRole;
}): Promise<InviteWorkspaceMemberResponse> {
  const response = await fetch("/api/account/workspace/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<InviteWorkspaceMemberResponse>(response);
}
