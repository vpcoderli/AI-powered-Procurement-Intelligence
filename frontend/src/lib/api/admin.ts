import type {
  AdminCrawlerLog,
  AdminDataSource,
  AdminLiveSourceHealth,
  UpdateAdminDataSourceInput,
} from "@/server/admin/data-sources-repository";
import type {
  AdminDataSourceIndexResponse,
  AdminDataSourceListItem,
  AdminDataSourceListResponse,
  SourceFacetCount,
  SourceListFilters,
  SourceListQuery,
} from "@/server/admin/data-source-list-contract";
import type { AdminDataSourceDetail } from "@/server/admin/source-detail";
import type {
  AdminOverview,
  AdminOverviewBids,
  AdminOverviewCoverage,
  AdminOverviewCrawlHealth,
  AdminOverviewPipelineRow,
  AdminOverviewRunCounts,
  AdminOverviewSectionError,
  AdminOverviewSectionKey,
  CoverageLevelCounts,
} from "@/server/admin/overview";
import type {
  ApprovalReadinessBucket,
  ApprovalReadinessEntry,
  ApprovalReadinessSummary,
  LedgeredApprovalReason,
} from "@/server/admin/ledgered-approval";
import type {
  CreatePlatformReviewInput,
  EffectivePlatformReview,
  PlatformReview,
} from "@/server/admin/platform-reviews-repository";
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
import type { MarketingFunnelSummary } from "@/server/marketing/funnel";
import type { SubscriptionLifecycleReconcileResult } from "@/server/billing/subscriptions";
import type { ScheduleDunningRemindersResult } from "@/server/billing/dunning";
import type { RiskChecklistReport } from "@/server/risk/checklist";
import type { RiskChecklistSnapshot, RiskChecklistTrend } from "@/server/risk/snapshots";
import type {
  StateDataQualityReasonCode,
  StateDataQualityReport,
  StateDataQualityRiskLevel,
  StateDataQualityRow,
} from "@/server/source-validity/state-data-quality";
import type {
  ConfigModule,
  ConfigRegistryEntry,
  ConfigScopeType,
  ConfigStatus,
} from "@/server/config/registry";

export type {
  AdminDataSourceDetail,
  AdminDataSourceIndexResponse,
  AdminDataSourceListItem,
  AdminDataSourceListResponse,
  SourceFacetCount,
  SourceListFilters,
  SourceListQuery,
  AdminOverview,
  AdminOverviewBids,
  AdminOverviewCoverage,
  AdminOverviewCrawlHealth,
  AdminOverviewPipelineRow,
  AdminOverviewRunCounts,
  AdminOverviewSectionError,
  AdminOverviewSectionKey,
  CoverageLevelCounts,
  AdminBidQaArchiveStatus,
  AdminBidQaCorrectionField,
  AdminBidQaCorrectionHistoryItem,
  AdminBidQaDisplayStatus,
  AdminBidQaItem,
  AdminBidQaResponse,
  AdminBidQaReviewStatus,
  AdminCrawlerLog,
  AdminDataSource,
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
  StateDataQualityReasonCode,
  StateDataQualityReport,
  StateDataQualityRiskLevel,
  StateDataQualityRow,
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
  | "INVALID_CRAWLER_CONFIG"
  | "CONFIG_NOT_FOUND"
  | "DATA_SOURCE_NOT_FOUND"
  | "BID_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "SOURCE_NOT_FOUND"
  | "PRECHECK_FAILED"
  | "CSRF_VALIDATION_FAILED"
  | "APPROVAL_REQUIREMENTS_UNMET"
  | "INTERNAL_ERROR";

const ADMIN_API_ERROR_CODES: readonly AdminApiErrorCode[] = [
  "FORBIDDEN",
  "EMAIL_EXISTS",
  "INVALID_REQUEST",
  "INVALID_CONFIG",
  "INVALID_CRAWLER_CONFIG",
  "CONFIG_NOT_FOUND",
  "DATA_SOURCE_NOT_FOUND",
  "BID_NOT_FOUND",
  "USER_NOT_FOUND",
  "SOURCE_NOT_FOUND",
  "PRECHECK_FAILED",
  "CSRF_VALIDATION_FAILED",
  "APPROVAL_REQUIREMENTS_UNMET",
  "INTERNAL_ERROR",
];

/** Where the next page of crawler logs starts: the (`started_at`, `id`) of the last row of this page. */
export interface AdminCrawlerLogsCursor {
  before: string;
  beforeId: string;
}

export interface AdminCrawlerLogsResponse {
  logs: AdminCrawlerLog[];
  nextCursor: AdminCrawlerLogsCursor | null;
}

export interface AdminRiskChecklistResponse {
  report: RiskChecklistReport;
  history: RiskChecklistSnapshot[];
  trend: RiskChecklistTrend;
  stateDataQuality?: StateDataQualityReport | null;
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

/**
 * Ledgered batch approval (spec 2026-09-24 §7.3): what happened to each requested source when the
 * batch answered `action: "approve"`. `approved` rows are in `sources`; a `skipped` local source
 * carries the reason that held it back and was not written to. Absent on `hold`.
 */
export type AdminLedgeredApprovalReason = LedgeredApprovalReason;

export interface AdminLedgeredBatchOutcome {
  sourceId: string;
  outcome: "approved" | "skipped" | "not_found";
  reason: AdminLedgeredApprovalReason | null;
}

export interface BatchUpdateAdminDataSourcesResponse {
  updatedCount: number;
  skippedCount?: number;
  outcomes?: AdminLedgeredBatchOutcome[];
  sources: AdminDataSource[];
}

/**
 * `GET /api/admin/data-sources/approval-readiness`: every local source (optionally of one
 * platform) placed in one console bucket, the count per bucket and, when a platform is named, its
 * effective platform review. Each entry carries the row's current `baseUrl` and, for a source whose
 * stored precheck holds one, the tenant probe's `suggestedBaseUrl` (spec §7.3). The suggestion is
 * display only; nothing applies it automatically.
 */
export type AdminApprovalReadinessBucket = ApprovalReadinessBucket;
export type AdminApprovalReadinessEntry = ApprovalReadinessEntry;
export type AdminApprovalReadinessSummary = ApprovalReadinessSummary;

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

/**
 * Approval pre-check (`POST /api/admin/data-sources/[id]/precheck`, contract C5 of
 * docs/superpowers/plans/2026-09-16-local-source-governance-recovery.md).
 *
 * The route runs, for one source and without persisting any bid: a robots.txt scan of the base
 * URL host, a dry-run `fetch-task` that deliberately bypasses the governance gate (the gate is
 * exactly what the pre-check informs), and — when the dry run came back HTTP 404 — a read-only
 * `discover-tenant` probe that may suggest a corrected `base_url`.
 *
 * Mirrors the server response shape exactly; it is declared here rather than imported so the
 * admin console is not coupled to the pre-check service module.
 */
export type AdminSourcePrecheckVerdict = "ready" | "empty" | "needs_fix";

/** `empty_verified` = HTTP 200 with a recognised "no open bids" marker and a confirmed tenant. */
export type AdminSourcePrecheckFetchStatus = "ok" | "empty_verified" | "failed";

export interface AdminSourcePrecheckRobots {
  /** Ledger value written to `data_sources.robots_txt_status` (e.g. "clear", "flagged"). */
  status: string;
  flagged: boolean;
  flagReason: string | null;
}

export interface AdminSourcePrecheckSampleItem {
  title: string | null;
  url: string | null;
}

export interface AdminSourcePrecheckFetch {
  status: AdminSourcePrecheckFetchStatus;
  items: number;
  sample: AdminSourcePrecheckSampleItem[];
  /** `metadata.listExtraction.method`: "scrapling" | "adapter" | "adapter_fallback". */
  listMethod: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  httpStatus: number | null;
  wafChallenge: boolean;
}

export interface AdminSourcePrecheckResult {
  sourceId: string;
  checkedAt: string;
  verdict: AdminSourcePrecheckVerdict;
  reasons: string[];
  robots: AdminSourcePrecheckRobots;
  fetch: AdminSourcePrecheckFetch;
  /** Set only when a 404 tenant path was probed and one candidate matched unambiguously. */
  suggestedBaseUrl: string | null;
}

export interface PrecheckAdminDataSourceOptions {
  /** Records fetched by the dry run; the route defaults to 5. */
  limit?: number;
}

/**
 * Body of `POST /api/admin/data-sources/precheck-requests`: name sources with `sourceIds`
 * (at most 500), or every source of a platform still awaiting a precheck with
 * `providerFamily` + `pending: true`.
 */
export interface RequestAdminSourcePrechecksInput {
  sourceIds?: string[];
  providerFamily?: string;
  pending?: boolean;
}

export interface RequestAdminSourcePrechecksResponse {
  requestedCount: number;
  sourceIds: string[];
}

/**
 * Platform compliance reviews (`/api/admin/platform-reviews`, spec 2026-09-24 §7.1): one ledger
 * row per review of a source platform. `effective` holds each platform's latest review with its
 * `valid | expired | missing` status; a platform with no row has no key.
 */
export type AdminPlatformReview = PlatformReview;
export type AdminEffectivePlatformReview = EffectivePlatformReview;
export type CreateAdminPlatformReviewInput = CreatePlatformReviewInput;

export interface AdminPlatformReviewsResponse {
  reviews: AdminPlatformReview[];
  effective: Record<string, AdminEffectivePlatformReview>;
}

/**
 * The one PATCH body the "approve local source" dialog posts (contract C6). Every field is
 * already part of `UpdateAdminDataSourceInput`; this alias exists so the dialog cannot silently
 * drop one half of the compliance ledger write (approval columns without reviewer/ToS trail).
 */
export interface ApproveLocalSourceInput extends UpdateAdminDataSourceInput {
  approvalStatus: "approved";
  legalReviewStatus: "approved_public";
  approvedForIngestion: true;
  isEnabled: true;
  tosReviewed: true;
  tosUrl: string | null;
  complianceReviewer: string;
  legalOpinionReference: string | null;
  complianceReviewDueAt: string | null;
  complianceNotes: string | null;
  approvalNotes: string | null;
}

export interface UpdateAdminUserResponse {
  user: AdminUser;
}

export interface AdminNotificationsResponse {
  notifications: NotificationOutboxRow[];
}

export interface AdminMarketingFunnelResponse {
  summary: MarketingFunnelSummary;
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
    typeof code === "string" &&
    (ADMIN_API_ERROR_CODES as readonly string[]).includes(code) &&
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

/** Spec §4: the overview's four blocks; a null block failed on the server (see `errors`). */
export async function getAdminOverview() {
  const response = await fetch("/api/admin/overview");

  return parseResponse<AdminOverview>(response);
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

export async function getAdminMarketingFunnel() {
  const response = await fetch("/api/admin/marketing/funnel");

  return parseResponse<AdminMarketingFunnelResponse>(response);
}

type QueryValue = string | number | readonly string[] | null | undefined;

function buildQueryString(params: Record<string, QueryValue>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") {
      for (const item of value) {
        if (item !== "") searchParams.append(key, item);
      }
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function sourceFilterParams(filters: Partial<SourceListFilters>): Record<string, QueryValue> {
  return {
    level: filters.levels,
    state: filters.states,
    platform: filters.platforms,
    approval: filters.approvals,
    health: filters.healths,
    q: filters.q,
  };
}

/** Spec §5.1: one page of the source list with facets. */
export async function listAdminDataSourcesPage(query: Partial<SourceListQuery> = {}) {
  const response = await fetch(
    `/api/admin/data-sources${buildQueryString({
      ...sourceFilterParams(query),
      sort: query.sort ? `${query.descending ? "-" : ""}${query.sort}` : undefined,
      page: query.page,
      pageSize: query.pageSize,
    })}`,
  );

  return parseResponse<AdminDataSourceListResponse>(response);
}

/** Spec §5.1 index (admin, operator): every source matching the list's filters. */
export async function listAdminDataSourceIndex(filters: Partial<SourceListFilters> = {}) {
  const response = await fetch(`/api/admin/data-sources/index${buildQueryString(sourceFilterParams(filters))}`);

  return parseResponse<AdminDataSourceIndexResponse>(response);
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

/**
 * How ready the local sources are for ledgered batch approval, grouped by bucket. Pass a
 * `providerFamily` (e.g. "bidnet") to scope it to one platform and get its effective review too.
 * Read-only; any admin-console role.
 */
export async function getAdminApprovalReadiness(providerFamily?: string) {
  const response = await fetch(`/api/admin/data-sources/approval-readiness${buildQueryString({ providerFamily })}`);

  return parseResponse<AdminApprovalReadinessSummary>(response);
}

export async function checkAdminDataSourceHealth(id: string, input: { timeoutMs?: number } = {}) {
  const response = await fetch(`/api/admin/data-sources/${encodeURIComponent(id)}/health-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AdminDataSourceHealthCheckResponse>(response);
}

/**
 * Runs the approval pre-check for one data source (C5). Admin or operator; mutating, so the
 * route enforces CSRF like every other admin POST.
 */
export async function precheckAdminDataSource(id: string, input: PrecheckAdminDataSourceOptions = {}) {
  const response = await fetch(`/api/admin/data-sources/${encodeURIComponent(id)}/precheck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<AdminSourcePrecheckResult>(response);
}

/**
 * Queues sources for the crawler worker's precheck loop (admin or operator). The worker runs the
 * precheck later within its platform budget; this only sets the request flag.
 */
export async function requestAdminSourcePrechecks(input: RequestAdminSourcePrechecksInput) {
  const response = await fetch("/api/admin/data-sources/precheck-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<RequestAdminSourcePrechecksResponse>(response);
}

/** Lists every platform review plus each platform's effective review. Any admin-console role. */
export async function listAdminPlatformReviews() {
  const response = await fetch("/api/admin/platform-reviews");

  return parseResponse<AdminPlatformReviewsResponse>(response);
}

/**
 * Records a platform review (admin only, CSRF-checked). The newest `reviewedAt` becomes the
 * platform's effective review. A 400 carries every validation issue joined by "; " in `message`.
 */
export async function createAdminPlatformReview(input: CreateAdminPlatformReviewInput) {
  const response = await fetch("/api/admin/platform-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<{ review: AdminPlatformReview }>(response);
}

export async function listAdminCrawlerLogs(
  options: { limit?: number; sources?: readonly string[]; before?: string; beforeId?: string } = {},
) {
  const response = await fetch(
    `/api/admin/crawler-logs${buildQueryString({
      limit: options.limit,
      source: options.sources,
      before: options.before,
      beforeId: options.beforeId,
    })}`,
  );

  return parseResponse<AdminCrawlerLogsResponse>(response);
}

/** Spec §6.1: one source with its run keys, states, readiness and bids. Any admin-console role. */
export async function getAdminDataSourceDetail(id: string) {
  const response = await fetch(`/api/admin/data-sources/${encodeURIComponent(id)}`);

  return parseResponse<AdminDataSourceDetail>(response);
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

export interface CrawlerRunWindowOptions {
  /** ISO yyyy-mm-dd published-date window (inclusive), passed through to the crawler. */
  postedFrom?: string;
  postedTo?: string;
}

/**
 * Verified-empty-list marker the crawler attaches to a zero-row success (contract C1): the list
 * page was HTTP 200, carried an explicit "no open bids" phrase and the tenant was confirmed from
 * the page itself. Present only on such runs, so the batch panel can show "no open bids" instead
 * of an indistinguishable "0 fetched".
 */
export interface CrawlerEmptyStateMetadata {
  verified?: boolean;
  marker?: string | null;
  tenant_confirmed?: boolean;
  method?: string | null;
}

/** Per-source result entry from /api/crawler/state/run (see orchestrator.ts's union). */
export interface StateCrawlerRunResultEntry {
  source: string;
  ok: boolean;
  /**
   * `success | failure | blocked | locked | disabled | deferred`. `deferred` (C7) means another
   * source on the same platform hit a challenge/throttle earlier in this tick, so the rest of
   * that platform's sources were skipped rather than run into a 403 wall.
   */
  status: string;
  reason?: string;
  runner?: {
    fetchedCount?: number;
    errorCode?: string | null;
    payload?: {
      metadata?: {
        dateFilter?: { kept?: number; dropped?: number; unparsed?: number };
        emptyState?: CrawlerEmptyStateMetadata | null;
      };
    } | null;
  };
}

export interface StateCrawlerRunResponse {
  ok: boolean;
  status: string;
  results: StateCrawlerRunResultEntry[];
  errors?: Array<{ source: string; code: string; message: string }>;
}

export async function runSamGovCrawlerNow(options: CrawlerRunWindowOptions = {}) {
  const hasBody = Boolean(options.postedFrom || options.postedTo);
  const response = await fetch(
    "/api/crawler/sam-gov/run",
    hasBody
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        }
      : { method: "POST" },
  );

  // SAM's route uses 409 for governance/lock skips and 500 for a completed runner
  // failure. Preserve those structured outcomes; auth/network failures still reject.
  if (response.status === 409 || response.status === 500) {
    const body: unknown = await response.clone().json().catch(() => null);
    if (typeof body === "object" && body !== null) {
      const outcome = body as { source?: unknown; status?: unknown; ok?: unknown };
      const expectedStatus = response.status === 409
        ? ["blocked", "locked", "disabled", "deferred"].includes(String(outcome.status))
        : outcome.status === "failure";
      if (outcome.source === "sam_gov" && outcome.ok === false && expectedStatus) return body;
    }
  }
  return parseResponse<unknown>(response);
}

export async function runStateCrawlersNow(sourceIds?: string[], options: CrawlerRunWindowOptions = {}) {
  const hasSelectedSources = sourceIds && sourceIds.length > 0;
  const hasWindow = Boolean(options.postedFrom || options.postedTo);
  const response = await fetch(
    "/api/crawler/state/run",
    hasSelectedSources || hasWindow
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(hasSelectedSources ? { sources: sourceIds } : {}),
            ...(options.postedFrom ? { postedFrom: options.postedFrom } : {}),
            ...(options.postedTo ? { postedTo: options.postedTo } : {}),
          }),
        }
      : { method: "POST" },
  );

  return parseResponse<StateCrawlerRunResponse>(response);
}
