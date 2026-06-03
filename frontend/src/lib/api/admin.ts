import type {
  AdminCrawlerLog,
  AdminDataSource,
  AdminDataSourcesResponse,
  AdminLiveSourceHealth,
  UpdateAdminDataSourceInput,
} from "@/server/admin/data-sources-repository";
import type {
  AdminBidQaArchiveStatus,
  AdminBidQaCorrectionField,
  AdminBidQaCorrectionHistoryItem,
  AdminBidQaDisplayStatus,
  AdminBidQaItem,
  AdminBidQaResponse,
  AdminBidQaReviewStatus,
} from "@/server/admin/bid-qa-repository";
import type {
  AdminUserAuditLog,
  AdminUserAuditAction,
  AdminUserAuditActorKind,
  AdminUserAuditLogsResponse,
  AdminUserFeatureOverridesResponse,
  AdminUserFilterStatus,
  AdminUser,
  AdminUsersResponse,
  CreateAdminUserInviteInput,
  CreateAdminUserInviteResponse,
  ListAdminUserAuditLogsOptions,
  ListAdminUsersFilters,
  UpdateAdminUserInput,
  UpdateAdminUserFeatureOverrideInput,
} from "@/server/admin/users-repository";
import type { NotificationOutboxRow, NotificationStatus } from "@/server/notifications/types";
import type { SubscriptionLifecycleReconcileResult } from "@/server/billing/subscriptions";
import type { ScheduleDunningRemindersResult } from "@/server/billing/dunning";
import type { RiskChecklistReport } from "@/server/risk/checklist";
import type { RiskChecklistSnapshot, RiskChecklistTrend } from "@/server/risk/snapshots";
import type {
  ConfigModule,
  ConfigRegistryEntry,
  ConfigScopeType,
  ConfigStatus,
} from "@/server/config/registry";

export type {
  AdminBidQaArchiveStatus,
  AdminBidQaCorrectionField,
  AdminBidQaCorrectionHistoryItem,
  AdminBidQaDisplayStatus,
  AdminBidQaItem,
  AdminBidQaResponse,
  AdminBidQaReviewStatus,
  AdminCrawlerLog,
  AdminDataSource,
  AdminDataSourcesResponse,
  AdminLiveSourceHealth,
  UpdateAdminDataSourceInput,
  AdminUserAuditLog,
  AdminUserAuditAction,
  AdminUserAuditActorKind,
  AdminUserAuditLogsResponse,
  AdminUserFeatureOverridesResponse,
  AdminUserFilterStatus,
  AdminUser,
  AdminUsersResponse,
  CreateAdminUserInviteInput,
  CreateAdminUserInviteResponse,
  ListAdminUserAuditLogsOptions,
  ListAdminUsersFilters,
  UpdateAdminUserInput,
  UpdateAdminUserFeatureOverrideInput,
};

export type AdminConfigRegistryEntry = ConfigRegistryEntry;

export interface AdminConfigEntriesResponse {
  entries: AdminConfigRegistryEntry[];
}

export interface UpdateAdminConfigEntryInput {
  configValue?: unknown;
  status?: ConfigStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
  changeReason: string;
}

export interface UpdateAdminConfigEntryResponse {
  entry: AdminConfigRegistryEntry;
}

export interface ListAdminConfigEntriesFilters {
  scopeType?: ConfigScopeType;
  scopeId?: string;
  module?: ConfigModule;
  configKey?: string;
  status?: ConfigStatus;
}

type AdminApiErrorCode =
  | "FORBIDDEN"
  | "EMAIL_EXISTS"
  | "INVALID_REQUEST"
  | "INVALID_CONFIG"
  | "CONFIG_NOT_FOUND"
  | "DATA_SOURCE_NOT_FOUND"
  | "BID_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export interface AdminCrawlerLogsResponse {
  logs: AdminCrawlerLog[];
}

export interface AdminRiskChecklistResponse {
  report: RiskChecklistReport;
  history: RiskChecklistSnapshot[];
  trend: RiskChecklistTrend;
}

export interface UpdateAdminBidQaReviewResponse {
  item: AdminBidQaItem;
}

export interface AdminBidQaCorrectionsResponse {
  corrections: AdminBidQaCorrectionHistoryItem[];
}

export interface BatchUpdateAdminBidQaResponse {
  updatedCount: number;
  items: AdminBidQaItem[];
}

export interface UpdateAdminDataSourceResponse {
  source: AdminDataSource;
}

export interface BatchUpdateAdminDataSourcesResponse {
  updatedCount: number;
  sources: AdminDataSource[];
}

export interface AdminDataSourceHealthCheckResponse {
  report: {
    ok: boolean;
    checkedAt: string;
    summary: {
      total: number;
      healthy: number;
      unhealthy: number;
      skipped: number;
    };
    results: unknown[];
  };
  source: AdminDataSource;
}

export interface UpdateAdminUserResponse {
  user: AdminUser;
}

export interface AdminNotificationsResponse {
  notifications: NotificationOutboxRow[];
}

export interface AdminNotificationDeliveryResponse {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

export type AdminSubscriptionReconcileResponse = SubscriptionLifecycleReconcileResult;
export type AdminBillingDunningResponse = ScheduleDunningRemindersResult;

export class AdminApiError extends Error {
  status: number;
  code: AdminApiErrorCode;

  constructor(status: number, code: AdminApiErrorCode, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

function isAdminErrorResponse(body: unknown): body is { error: { code: AdminApiErrorCode; message: string } } {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (
    (code === "FORBIDDEN" ||
      code === "EMAIL_EXISTS" ||
      code === "INVALID_REQUEST" ||
      code === "INVALID_CONFIG" ||
      code === "CONFIG_NOT_FOUND" ||
      code === "DATA_SOURCE_NOT_FOUND" ||
      code === "BID_NOT_FOUND" ||
      code === "USER_NOT_FOUND" ||
      code === "INTERNAL_ERROR") &&
    typeof message === "string"
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new AdminApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  if (!response.ok) {
    if (isAdminErrorResponse(body)) {
      throw new AdminApiError(response.status, body.error.code, body.error.message);
    }

    throw new AdminApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

export async function listAdminDataSources() {
  const response = await fetch("/api/admin/data-sources");

  return parseResponse<AdminDataSourcesResponse>(response);
}

export async function listAdminConfigEntries(filters: ListAdminConfigEntriesFilters = {}) {
  const response = await fetch(
    `/api/admin/config${buildQueryString({
      scopeType: filters.scopeType,
      scopeId: filters.scopeId,
      module: filters.module,
      configKey: filters.configKey,
      status: filters.status,
    })}`,
  );

  return parseResponse<AdminConfigEntriesResponse>(response);
}

export async function updateAdminConfigEntry(id: string, input: UpdateAdminConfigEntryInput) {
  const response = await fetch(`/api/admin/config/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<UpdateAdminConfigEntryResponse>(response);
}

export async function getAdminRiskChecklist() {
  const response = await fetch("/api/admin/risk-check");

  return parseResponse<AdminRiskChecklistResponse>(response);
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function listAdminUsers(filters: ListAdminUsersFilters = {}) {
  const response = await fetch(
    `/api/admin/users${buildQueryString({
      q: filters.q,
      role: filters.role,
      tier: filters.tier,
      status: filters.status,
    })}`,
  );

  return parseResponse<AdminUsersResponse>(response);
}

export async function listAdminUserAuditLogs(input: ListAdminUserAuditLogsOptions = {}) {
  const response = await fetch(
    `/api/admin/users/audit-logs${buildQueryString({
      limit: input.limit,
      actorKind: input.actorKind,
      action: input.action,
      target: input.target,
      featureKey: input.featureKey,
    })}`,
  );

  return parseResponse<AdminUserAuditLogsResponse>(response);
}

export async function listAdminUserFeatureOverrides(id: string) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}/feature-overrides`);

  return parseResponse<AdminUserFeatureOverridesResponse>(response);
}

export async function createAdminUser(input: CreateAdminUserInviteInput) {
  const response = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<CreateAdminUserInviteResponse>(response);
}

export async function updateAdminUser(id: string, input: UpdateAdminUserInput) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<UpdateAdminUserResponse>(response);
}

export async function updateAdminUserFeatureOverride(id: string, input: UpdateAdminUserFeatureOverrideInput) {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(id)}/feature-overrides`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AdminUserFeatureOverridesResponse>(response);
}

export async function updateAdminDataSource(id: string, input: UpdateAdminDataSourceInput) {
  const response = await fetch(`/api/admin/data-sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<UpdateAdminDataSourceResponse>(response);
}

export async function batchUpdateAdminDataSources(input: { sourceIds: string[]; action: "approve" | "hold" }) {
  const response = await fetch("/api/admin/data-sources/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<BatchUpdateAdminDataSourcesResponse>(response);
}

export async function checkAdminDataSourceHealth(id: string, input: { timeoutMs?: number } = {}) {
  const response = await fetch(`/api/admin/data-sources/${encodeURIComponent(id)}/health-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AdminDataSourceHealthCheckResponse>(response);
}

export async function listAdminCrawlerLogs() {
  const response = await fetch("/api/admin/crawler-logs");

  return parseResponse<AdminCrawlerLogsResponse>(response);
}

export async function listAdminBidQaItems(
  filters: {
    limit?: number;
    q?: string;
    stateCode?: string;
    reviewStatus?: AdminBidQaReviewStatus;
    archiveStatus?: AdminBidQaArchiveStatus;
    displayStatus?: AdminBidQaDisplayStatus;
    sourceConfidence?: string;
    minQualityScore?: number;
    maxQualityScore?: number;
    reviewerId?: string;
    reviewedFrom?: string;
    reviewedTo?: string;
  } = {},
) {
  const response = await fetch(`/api/admin/bids/qa${buildQueryString(filters)}`);

  return parseResponse<AdminBidQaResponse>(response);
}

export async function getAdminBidQaCorrections(id: string) {
  const response = await fetch(`/api/admin/bids/qa/${encodeURIComponent(id)}`);

  return parseResponse<AdminBidQaCorrectionsResponse>(response);
}

export async function batchUpdateAdminBidQaItems(
  input:
    | { bidIds: string[]; reviewStatus: AdminBidQaReviewStatus; note?: string | null }
    | { bidIds: string[]; displayStatus: AdminBidQaDisplayStatus },
) {
  const response = await fetch("/api/admin/bids/qa/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<BatchUpdateAdminBidQaResponse>(response);
}

export async function updateAdminBidQaReview(
  id: string,
  input:
    | { reviewStatus: AdminBidQaReviewStatus; note?: string | null }
    | { displayStatus: AdminBidQaDisplayStatus }
    | {
        corrections: Partial<Record<AdminBidQaCorrectionField, string | null>>;
        note?: string | null;
      },
) {
  const response = await fetch(`/api/admin/bids/qa/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<UpdateAdminBidQaReviewResponse>(response);
}

export async function listAdminNotifications(input: { limit?: number; status?: NotificationStatus } = {}) {
  const response = await fetch(`/api/admin/notifications${buildQueryString(input)}`);

  return parseResponse<AdminNotificationsResponse>(response);
}

export async function deliverAdminNotifications(input: { limit?: number; maxAttempts?: number } = {}) {
  const response = await fetch("/api/admin/notifications/deliver", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AdminNotificationDeliveryResponse>(response);
}

export async function scheduleAdminBillingDunning(input: { limit?: number } = {}) {
  const response = await fetch("/api/admin/billing/dunning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AdminBillingDunningResponse>(response);
}

export async function reconcileAdminSubscriptions(input: { pastDueGraceDays?: number } = {}) {
  const response = await fetch("/api/admin/subscriptions/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AdminSubscriptionReconcileResponse>(response);
}

export async function runSamGovCrawlerNow() {
  const response = await fetch("/api/crawler/sam-gov/run", { method: "POST" });

  return parseResponse<unknown>(response);
}

export async function runStateCrawlersNow(sourceIds?: string[]) {
  const hasSelectedSources = sourceIds && sourceIds.length > 0;
  const response = await fetch(
    "/api/crawler/state/run",
    hasSelectedSources
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: sourceIds }),
        }
      : { method: "POST" },
  );

  return parseResponse<unknown>(response);
}
