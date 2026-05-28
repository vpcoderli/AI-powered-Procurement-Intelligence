import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";
import type { AccountExportData } from "@/server/account/lifecycle";
import type { WorkspaceRole } from "@/server/account/workspace";
import type { AccountUsageResponse } from "@/server/account/usage";
import type {
  AccountNotificationPreferences,
  UpdateAccountNotificationPreferencesInput,
} from "@/server/account/notification-preferences";

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

export type AccountUsageData = AccountUsageResponse;
export type AccountNotificationPreferencesResponse = AccountNotificationPreferences;

export interface CheckoutSession {
  id: string;
  userId: string;
  tier: AccountTier;
  status: "open" | "completed" | "expired" | "canceled";
  provider: "local_checkout" | "billing_provider";
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSessionResponse {
  checkoutSession: CheckoutSession;
}

export type BillingInvoiceStatus = "open" | "paid" | "payment_failed" | "void" | "uncollectible";

export interface BillingInvoice {
  id: string;
  userId: string;
  provider: string;
  providerInvoiceId: string;
  invoiceNumber: string | null;
  status: BillingInvoiceStatus;
  currency: string;
  amountDueCents: number;
  amountPaidCents: number;
  invoiceUrl: string | null;
  invoicePdfUrl: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingInvoicesResponse {
  invoices: BillingInvoice[];
  summary: {
    totalInvoices: number;
    paidCount: number;
    failedCount: number;
    openCount: number;
    totalPaidCents: number;
    totalDueCents: number;
    downloadablePdfCount: number;
  };
}

export interface BillingPortalSession {
  userId: string;
  provider: "local_checkout" | "billing_provider";
  portalUrl: string;
  returnUrl: string;
  createdAt: string;
}

export interface BillingPortalSessionResponse {
  portalSession: BillingPortalSession;
}

export interface PasswordResetRequestResponse {
  ok: true;
  resetToken?: string;
  expiresAt?: string;
}

export type AccountExportResponse = AccountExportData;

export interface AccountWorkspaceMember {
  userId: string;
  email: string | null;
  displayName: string | null;
  workspaceRole: WorkspaceRole;
  status: "active" | "invited" | "disabled";
  invitationDelivery?: {
    status: "pending" | "sent" | "failed";
    attemptCount: number;
    lastError: string | null;
    sentAt: string | null;
    updatedAt: string;
  } | null;
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
  inviteToken: string;
  inviteUrl: string;
}

type AuthErrorCode =
  | "ACCOUNT_DISABLED"
  | "AUTH_REQUIRED"
  | "EMAIL_ALREADY_REGISTERED"
  | "FORBIDDEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_INVITATION_TOKEN"
  | "INVALID_REQUEST"
  | "INVALID_RESET_TOKEN"
  | "INVITATION_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "LAST_OWNER_REQUIRED"
  | "MEMBER_NOT_FOUND"
  | "OWNER_TRANSFER_REQUIRED"
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
      code === "INVALID_INVITATION_TOKEN" ||
      code === "INVALID_REQUEST" ||
      code === "INVALID_RESET_TOKEN" ||
      code === "INVITATION_NOT_FOUND" ||
      code === "INTERNAL_ERROR" ||
      code === "LAST_OWNER_REQUIRED" ||
      code === "MEMBER_NOT_FOUND" ||
      code === "OWNER_TRANSFER_REQUIRED" ||
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

export async function exportAccountData(): Promise<AccountExportResponse> {
  const response = await fetch("/api/account/export");

  return parseResponse<AccountExportResponse>(response);
}

export async function deleteAccount(): Promise<{ ok: true }> {
  const response = await fetch("/api/account", {
    method: "DELETE",
  });

  return parseResponse<{ ok: true }>(response);
}

export async function fetchAccountSubscription(): Promise<AccountSubscriptionResponse> {
  const response = await fetch("/api/account/subscription");

  return parseResponse<AccountSubscriptionResponse>(response);
}

export async function fetchAccountUsage(): Promise<AccountUsageData> {
  const response = await fetch("/api/account/usage");

  return parseResponse<AccountUsageData>(response);
}

export async function fetchAccountNotificationPreferences(): Promise<AccountNotificationPreferencesResponse> {
  const response = await fetch("/api/account/notification-preferences");

  return parseResponse<AccountNotificationPreferencesResponse>(response);
}

export async function updateAccountNotificationPreferences(
  input: UpdateAccountNotificationPreferencesInput,
): Promise<AccountNotificationPreferencesResponse> {
  const response = await fetch("/api/account/notification-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AccountNotificationPreferencesResponse>(response);
}

export async function createCheckoutSession(input: { tier: AccountTier }): Promise<CheckoutSessionResponse> {
  const response = await fetch("/api/account/subscription/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<CheckoutSessionResponse>(response);
}

export async function cancelAccountSubscription(): Promise<AccountSubscriptionResponse> {
  const response = await fetch("/api/account/subscription/cancel", {
    method: "POST",
  });

  return parseResponse<AccountSubscriptionResponse>(response);
}

export async function fetchBillingInvoices(input: { status?: BillingInvoiceStatus } = {}): Promise<BillingInvoicesResponse> {
  const searchParams = new URLSearchParams();
  if (input.status) searchParams.set("status", input.status);
  const query = searchParams.toString();
  const response = await fetch(`/api/account/billing/invoices${query ? `?${query}` : ""}`);

  return parseResponse<BillingInvoicesResponse>(response);
}

export async function createBillingPortalSession(): Promise<BillingPortalSessionResponse> {
  const response = await fetch("/api/account/billing/portal", {
    method: "POST",
  });

  return parseResponse<BillingPortalSessionResponse>(response);
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

export async function acceptWorkspaceInvitation(input: {
  token: string;
  password: string;
  displayName?: string;
}): Promise<AuthResponse> {
  const response = await fetch("/api/account/workspace/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AuthResponse>(response);
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

export async function updateWorkspaceMemberRole(
  userId: string,
  input: { role: WorkspaceRole },
): Promise<AccountWorkspaceResponse> {
  const response = await fetch(`/api/account/workspace/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AccountWorkspaceResponse>(response);
}

export async function setWorkspaceMemberStatus(
  userId: string,
  input: { status: "active" | "disabled" },
): Promise<AccountWorkspaceResponse> {
  const response = await fetch(`/api/account/workspace/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AccountWorkspaceResponse>(response);
}

export async function resendWorkspaceInvitation(userId: string): Promise<InviteWorkspaceMemberResponse> {
  const response = await fetch(`/api/account/workspace/invitations/${userId}/resend`, {
    method: "POST",
  });

  return parseResponse<InviteWorkspaceMemberResponse>(response);
}

export async function revokeWorkspaceInvitation(userId: string): Promise<AccountWorkspaceResponse> {
  const response = await fetch(`/api/account/workspace/invitations/${userId}`, {
    method: "DELETE",
  });

  return parseResponse<AccountWorkspaceResponse>(response);
}

export async function transferWorkspaceOwnership(userId: string): Promise<AccountWorkspaceResponse> {
  const response = await fetch("/api/account/workspace/ownership", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetUserId: userId }),
  });

  return parseResponse<AccountWorkspaceResponse>(response);
}

export async function removeWorkspaceMember(userId: string): Promise<AccountWorkspaceResponse> {
  const response = await fetch(`/api/account/workspace/members/${userId}`, {
    method: "DELETE",
  });

  return parseResponse<AccountWorkspaceResponse>(response);
}
