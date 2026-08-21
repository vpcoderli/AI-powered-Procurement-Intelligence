import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  getStateCrawlerSourceMetadata,
  STATE_CRAWLER_SOURCE_IDS_BY_STATE,
  type CrawlerAdapterKind,
  type CrawlerCapability,
  type CrawlerMaturity,
  type SourceAuthority,
  type SourceEvidenceMode,
  type SourceAccessPattern,
  type SourceApprovalStatus,
  type SourceLegalReviewStatus,
  type SourceTrustStatus,
} from "@/lib/state-crawler-sources";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { crawlerLogs, dataSources, sourceApprovalEvents } from "@/server/db/schema";
import {
  latestLiveSourceHealthBySource,
  listLiveSourceHealthSnapshots,
  listLiveSourceHealthSnapshotsFromMysql,
  type LatestLiveSourceHealth,
  sourceHealthTrendBySource,
  type SourceHealthTrend,
} from "@/server/source-validity/health-snapshots";

export interface AdminCrawlerLog {
  id: string;
  source: string;
  runId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: string | null;
  fallbackSource: string | null;
  fallbackReason: string | null;
  fallbackFixture: string | null;
}

export interface AdminDataSource {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string | null;
  isEnabled: boolean;
  cadence: string;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  crawlerSourceId: string | null;
  crawlerAdapterKind: CrawlerAdapterKind;
  crawlerMaturity: CrawlerMaturity;
  crawlerCapabilities: CrawlerCapability[];
  crawlerBaseUrl: string | null;
  sourceAuthority: SourceAuthority | null;
  trustStatus: SourceTrustStatus | null;
  evidenceMode: SourceEvidenceMode | null;
  validityNotes: string | null;
  providerFamily: string;
  accessMode: string;
  sourceType: string;
  sourceConfidence: string;
  activationStatus: string;
  requiresBrowser: boolean;
  requiresManual: boolean;
  requiresLogin: boolean;
  supportsQuery: boolean;
  supportsPagination: boolean;
  supportsAttachmentMetadata: boolean;
  supportsDetailPageFetch: boolean;
  fallbackNotes: string | null;
  approvedForIngestion: boolean;
  approvalStatus: SourceApprovalStatus;
  accessPattern: SourceAccessPattern;
  legalReviewStatus: SourceLegalReviewStatus;
  sourceOwner: string;
  approvalNotes: string | null;
  lastApprovalReviewedAt: string | null;
  liveHealthOwner: string | null;
  liveHealthDisposition: string | null;
  liveHealthNextReviewAt: string | null;
  liveHealthNotes: string | null;
  liveHealthReviewedAt: string | null;
  robotsTxtStatus: string | null;
  robotsTxtCheckedAt: string | null;
  robotsTxtHash: string | null;
  robotsTxtDisallowsCrawledPaths: boolean | null;
  robotsTxtFlagReason: string | null;
  tosReviewed: boolean | null;
  tosReviewedAt: string | null;
  tosUrl: string | null;
  complianceReviewer: string | null;
  legalOpinionReference: string | null;
  complianceReviewDueAt: string | null;
  complianceNotes: string | null;
  createdAt: string;
  updatedAt: string;
  latestLog: AdminCrawlerLog | null;
  latestLiveHealth: AdminLiveSourceHealth | null;
  sourceHealthTrend: AdminSourceHealthTrend | null;
  approvalHistory: AdminSourceApprovalEvent[];
}

export interface AdminSourceApprovalEvent {
  id: string;
  sourceId: string;
  actorUserId: string | null;
  action: string;
  previousApprovalStatus: SourceApprovalStatus | null;
  nextApprovalStatus: SourceApprovalStatus | null;
  previousLegalReviewStatus: SourceLegalReviewStatus | null;
  nextLegalReviewStatus: SourceLegalReviewStatus | null;
  previousApprovedForIngestion: boolean | null;
  nextApprovedForIngestion: boolean | null;
  reason: string | null;
  createdAt: string;
}

export interface AdminDataSourceSummary {
  totalSources: number;
  enabledSources: number;
  healthySources: number;
  failingSources: number;
}

export interface AdminDataSourcesResponse {
  summary: AdminDataSourceSummary;
  sources: AdminDataSource[];
}

export interface AdminLiveSourceHealth {
  checkedAt: string;
  status: string;
  method: string | null;
  httpStatus: number | null;
  statusCode: number | null;
  statusText: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  error: string | null;
  classification: string | null;
  reason: string | null;
  evidenceSnippets: string[];
  latencyMs: number | null;
  url: string | null;
  operationalSeverity: string | null;
  recommendedAction: string | null;
}

export type AdminSourceHealthTrend = SourceHealthTrend;

interface MysqlAdminCrawlerLogRow {
  id: string;
  source: string;
  runId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | string | null;
  fetchedCount: number | string;
  insertedCount: number | string;
  updatedCount: number | string;
  skippedCount: number | string;
  failedCount: number | string;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: string | null;
}

export interface MysqlAdminCrawlerLogsReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

export interface MysqlDataSourcesStore extends MysqlAdminCrawlerLogsReader {
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

type DataSourceRow = typeof dataSources.$inferSelect;

export class AdminDataSourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Data source ${id} was not found`);
    this.name = "AdminDataSourceNotFoundError";
  }
}

export interface UpdateAdminDataSourceInput {
  isEnabled?: boolean;
  approvedForIngestion?: boolean;
  approvalStatus?: SourceApprovalStatus;
  legalReviewStatus?: SourceLegalReviewStatus;
  approvalNotes?: string | null;
  liveHealthOwner?: string | null;
  liveHealthDisposition?: string | null;
  liveHealthNextReviewAt?: string | null;
  liveHealthNotes?: string | null;
  liveHealthReviewedAt?: string | null;
  tosReviewed?: boolean | null;
  tosReviewedAt?: string | null;
  tosUrl?: string | null;
  complianceReviewer?: string | null;
  legalOpinionReference?: string | null;
  complianceReviewDueAt?: string | null;
  complianceNotes?: string | null;
}

export interface UpdateAdminDataSourceOptions {
  actorUserId?: string | null;
}

const CRAWLER_LOG_SOURCE_BY_STATE = STATE_CRAWLER_SOURCE_IDS_BY_STATE;

type SourceApprovalEventRow = typeof sourceApprovalEvents.$inferSelect;

function redactLiveHealthNotes(value: string | null) {
  if (value === null) return null;

  return value.replace(
    /\b(password|token|secret|api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token)\b(\s*[:=]\s*)([^\s;,]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`,
  );
}

function hasLiveHealthTriageUpdate(input: UpdateAdminDataSourceInput) {
  return (
    input.liveHealthOwner !== undefined ||
    input.liveHealthDisposition !== undefined ||
    input.liveHealthNextReviewAt !== undefined ||
    input.liveHealthNotes !== undefined ||
    input.liveHealthReviewedAt !== undefined
  );
}

function hasComplianceLedgerUpdate(input: UpdateAdminDataSourceInput) {
  return (
    input.tosReviewed !== undefined ||
    input.tosReviewedAt !== undefined ||
    input.tosUrl !== undefined ||
    input.complianceReviewer !== undefined ||
    input.legalOpinionReference !== undefined ||
    input.complianceReviewDueAt !== undefined ||
    input.complianceNotes !== undefined
  );
}

function crawlerLogKeysForSource(source: typeof dataSources.$inferSelect) {
  return [CRAWLER_LOG_SOURCE_BY_STATE[source.stateCode], source.label, source.id].filter(
    (value): value is string => Boolean(value),
  );
}

function latestLogForSource(
  source: typeof dataSources.$inferSelect,
  latestLogsBySource: Map<string, AdminCrawlerLog>,
) {
  for (const key of crawlerLogKeysForSource(source)) {
    const log = latestLogsBySource.get(key);
    if (log) return log;
  }

  return null;
}

function toAdminSourceApprovalEvent(row: SourceApprovalEventRow): AdminSourceApprovalEvent {
  return {
    id: row.id,
    sourceId: row.sourceId,
    actorUserId: row.actorUserId,
    action: row.action,
    previousApprovalStatus: row.previousApprovalStatus as SourceApprovalStatus | null,
    nextApprovalStatus: row.nextApprovalStatus as SourceApprovalStatus | null,
    previousLegalReviewStatus: row.previousLegalReviewStatus as SourceLegalReviewStatus | null,
    nextLegalReviewStatus: row.nextLegalReviewStatus as SourceLegalReviewStatus | null,
    previousApprovedForIngestion:
      row.previousApprovedForIngestion === null ? null : row.previousApprovedForIngestion === 1,
    nextApprovedForIngestion: row.nextApprovedForIngestion === null ? null : row.nextApprovedForIngestion === 1,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function approvalHistoryBySource(rows: SourceApprovalEventRow[]) {
  const grouped = new Map<string, AdminSourceApprovalEvent[]>();

  for (const row of rows) {
    const history = grouped.get(row.sourceId) ?? [];
    if (history.length < 5) {
      history.push(toAdminSourceApprovalEvent(row));
      grouped.set(row.sourceId, history);
    }
  }

  return grouped;
}

function latestLiveHealthForSource(
  source: typeof dataSources.$inferSelect,
  crawlerSourceId: string | null,
  latestLiveHealthBySource: Map<string, LatestLiveSourceHealth>,
) {
  const candidates = [
    crawlerSourceId,
    source.id,
    source.stateCode.toLowerCase(),
    source.stateCode,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const health = latestLiveHealthBySource.get(candidate);
    if (health) {
      const statusCode = latestHealthStatusCode(health.result);
      const error = latestHealthError(health.result);

      return {
        checkedAt: health.checkedAt,
        status: health.result.status,
        method: health.result.method,
        httpStatus: statusCode,
        statusCode,
        statusText: health.result.statusText,
        errorCode: health.result.errorCode,
        errorMessage: error,
        error,
        classification: latestHealthStringField(health.result, "classification"),
        reason: latestHealthStringField(health.result, "reason"),
        evidenceSnippets: latestHealthStringArrayField(health.result, "evidenceSnippets"),
        latencyMs: latestHealthLatencyMs(health.result),
        url: health.result.url,
        operationalSeverity: latestHealthStringField(health.result, "operationalSeverity"),
        recommendedAction: latestHealthStringField(health.result, "recommendedAction"),
      } satisfies AdminLiveSourceHealth;
    }
  }

  return null;
}

function sourceHealthTrendForSource(
  source: typeof dataSources.$inferSelect,
  crawlerSourceId: string | null,
  trendBySource: Map<string, SourceHealthTrend>,
) {
  const candidates = [
    crawlerSourceId,
    source.id,
    source.stateCode.toLowerCase(),
    source.stateCode,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const trend = trendBySource.get(candidate);
    if (trend) return trend;
  }

  return null;
}


function latestHealthNumberField(result: LatestLiveSourceHealth["result"], key: string) {
  const value = (result as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function latestHealthStringField(result: LatestLiveSourceHealth["result"], key: string) {
  const value = (result as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function latestHealthStringArrayField(result: LatestLiveSourceHealth["result"], key: string) {
  const value = (result as unknown as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function latestHealthStatusCode(result: LatestLiveSourceHealth["result"]) {
  return result.httpStatus ?? latestHealthNumberField(result, "statusCode");
}

function latestHealthError(result: LatestLiveSourceHealth["result"]) {
  return result.errorMessage ?? latestHealthStringField(result, "error");
}

function latestHealthLatencyMs(result: LatestLiveSourceHealth["result"]) {
  return result.latencyMs ?? latestHealthNumberField(result, "latency");
}

function metadataStringValue(metadata: unknown, key: string) {
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseLogMetadata(metadata: string | null) {
  if (!metadata) {
    return {
      fallbackSource: null,
      fallbackReason: null,
      fallbackFixture: null,
    };
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    return {
      fallbackSource: metadataStringValue(parsed, "fallback_source"),
      fallbackReason: metadataStringValue(parsed, "fallback_reason"),
      fallbackFixture: metadataStringValue(parsed, "fallback_fixture"),
    };
  } catch {
    return {
      fallbackSource: null,
      fallbackReason: null,
      fallbackFixture: null,
    };
  }
}

function toAdminLog(row: typeof crawlerLogs.$inferSelect): AdminCrawlerLog {
  const parsedMetadata = parseLogMetadata(row.metadata);

  return {
    id: row.id,
    source: row.source,
    runId: row.runId,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    fetchedCount: row.fetchedCount,
    insertedCount: row.insertedCount,
    updatedCount: row.updatedCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    metadata: row.metadata,
    fallbackSource: parsedMetadata.fallbackSource,
    fallbackReason: parsedMetadata.fallbackReason,
    fallbackFixture: parsedMetadata.fallbackFixture,
  };
}

function toNullableNumber(value: number | string | null) {
  if (value === null) return null;
  return Number(value);
}

function toNumber(value: number | string) {
  return Number(value);
}

function toAdminLogFromMysql(row: MysqlAdminCrawlerLogRow): AdminCrawlerLog {
  const parsedMetadata = parseLogMetadata(row.metadata);

  return {
    id: row.id,
    source: row.source,
    runId: row.runId,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: toNullableNumber(row.durationMs),
    fetchedCount: toNumber(row.fetchedCount),
    insertedCount: toNumber(row.insertedCount),
    updatedCount: toNumber(row.updatedCount),
    skippedCount: toNumber(row.skippedCount),
    failedCount: toNumber(row.failedCount),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    metadata: row.metadata,
    fallbackSource: parsedMetadata.fallbackSource,
    fallbackReason: parsedMetadata.fallbackReason,
    fallbackFixture: parsedMetadata.fallbackFixture,
  };
}

function defaultProviderFamily(row: typeof dataSources.$inferSelect) {
  if (row.issuerType === "state") return "state_portal";
  if (row.issuerType === "federal") return "federal_portal";
  return "public_portal";
}

function defaultSourceConfidence(maturity: CrawlerMaturity, issuerType: string) {
  if (maturity === "verified" || issuerType === "federal") return "high";
  if (maturity === "none") return "medium";
  return "medium";
}

function nullableBoolean(value: number | null, fallback: boolean) {
  if (value === null) return fallback;
  return value === 1;
}

function hasCapability(capabilities: CrawlerCapability[], capability: CrawlerCapability) {
  return capabilities.includes(capability);
}

function booleanOverride(value: number | null, fallback: boolean) {
  if (value === null) return fallback;
  return value === 1;
}

function toAdminSource(
  row: DataSourceRow,
  latestLog: AdminCrawlerLog | null,
  latestLiveHealthBySource = new Map<string, LatestLiveSourceHealth>(),
  sourceHealthTrendBySourceMap = new Map<string, SourceHealthTrend>(),
  approvalHistory: AdminSourceApprovalEvent[] = [],
): AdminDataSource {
  const crawlerMetadata = row.issuerType === "state" ? getStateCrawlerSourceMetadata(row.stateCode) : null;
  const crawlerCapabilities = [...(crawlerMetadata?.capabilities ?? [])];
  const crawlerMaturity = crawlerMetadata?.maturity ?? "none";
  const crawlerSourceId = crawlerMetadata?.id ?? null;
  const defaultGovernance = crawlerMetadata ?? {
    approvedForIngestion: row.issuerType !== "state",
    approvalStatus: "approved" as SourceApprovalStatus,
    accessPattern: "public_http" as SourceAccessPattern,
    legalReviewStatus: "approved_public" as SourceLegalReviewStatus,
    sourceOwner: "APSI Data Ops",
    approvalNotes: "Default public non-state source governance.",
    lastApprovalReviewedAt: null,
  };

  return {
    id: row.id,
    label: row.label,
    issuerType: row.issuerType,
    stateCode: row.stateCode,
    baseUrl: row.baseUrl,
    isEnabled: row.isEnabled === 1,
    cadence: row.cadence,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    jurisdictionName: row.jurisdictionName ?? null,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    consecutiveFailures: row.consecutiveFailures,
    crawlerSourceId,
    crawlerAdapterKind: crawlerMetadata?.adapterKind ?? "none",
    crawlerMaturity,
    crawlerCapabilities,
    crawlerBaseUrl: crawlerMetadata?.baseUrl ?? null,
    sourceAuthority: crawlerMetadata?.sourceAuthority ?? null,
    trustStatus: crawlerMetadata?.trustStatus ?? null,
    evidenceMode: crawlerMetadata?.evidenceMode ?? null,
    validityNotes: crawlerMetadata?.validityNotes ?? null,
    providerFamily: row.providerFamily ?? defaultProviderFamily(row),
    accessMode: row.accessMode ?? "http",
    sourceType: row.sourceType ?? "primary",
    sourceConfidence: row.sourceConfidence ?? defaultSourceConfidence(crawlerMaturity, row.issuerType),
    activationStatus: row.activationStatus ?? (row.isEnabled === 1 ? "active" : "paused"),
    requiresBrowser: nullableBoolean(row.requiresBrowser, false),
    requiresManual: nullableBoolean(row.requiresManual, false),
    requiresLogin: nullableBoolean(row.requiresLogin, false),
    supportsQuery: nullableBoolean(row.supportsQuery, hasCapability(crawlerCapabilities, "query")),
    supportsPagination: nullableBoolean(row.supportsPagination, hasCapability(crawlerCapabilities, "pagination")),
    supportsAttachmentMetadata: nullableBoolean(
      row.supportsAttachmentMetadata,
      hasCapability(crawlerCapabilities, "attachments"),
    ),
    supportsDetailPageFetch: nullableBoolean(
      row.supportsDetailPageFetch,
      hasCapability(crawlerCapabilities, "detail_pages"),
    ),
    fallbackNotes: row.fallbackNotes,
    approvedForIngestion: booleanOverride(row.approvedForIngestion, defaultGovernance.approvedForIngestion),
    approvalStatus: (row.approvalStatus as SourceApprovalStatus | null) ?? defaultGovernance.approvalStatus,
    accessPattern: (row.accessPattern as SourceAccessPattern | null) ?? defaultGovernance.accessPattern,
    legalReviewStatus:
      (row.legalReviewStatus as SourceLegalReviewStatus | null) ?? defaultGovernance.legalReviewStatus,
    sourceOwner: row.sourceOwner ?? defaultGovernance.sourceOwner,
    approvalNotes: row.approvalNotes ?? defaultGovernance.approvalNotes,
    lastApprovalReviewedAt: row.lastApprovalReviewedAt ?? defaultGovernance.lastApprovalReviewedAt,
    liveHealthOwner: row.liveHealthOwner,
    liveHealthDisposition: row.liveHealthDisposition,
    liveHealthNextReviewAt: row.liveHealthNextReviewAt,
    liveHealthNotes: row.liveHealthNotes,
    liveHealthReviewedAt: row.liveHealthReviewedAt,
    robotsTxtStatus: row.robotsTxtStatus,
    robotsTxtCheckedAt: row.robotsTxtCheckedAt,
    robotsTxtHash: row.robotsTxtHash,
    robotsTxtDisallowsCrawledPaths: row.robotsTxtDisallowsCrawledPaths === null ? null : row.robotsTxtDisallowsCrawledPaths === 1,
    robotsTxtFlagReason: row.robotsTxtFlagReason,
    tosReviewed: row.tosReviewed === null ? null : row.tosReviewed === 1,
    tosReviewedAt: row.tosReviewedAt,
    tosUrl: row.tosUrl,
    complianceReviewer: row.complianceReviewer,
    legalOpinionReference: row.legalOpinionReference,
    complianceReviewDueAt: row.complianceReviewDueAt,
    complianceNotes: row.complianceNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    latestLog,
    latestLiveHealth: latestLiveHealthForSource(row, crawlerSourceId, latestLiveHealthBySource),
    sourceHealthTrend: sourceHealthTrendForSource(row, crawlerSourceId, sourceHealthTrendBySourceMap),
    approvalHistory,
  };
}

function dataSourceSelectSql(where = "") {
  return `
    SELECT
      id,
      label,
      issuer_type AS issuerType,
      state_code AS stateCode,
      base_url AS baseUrl,
      is_enabled AS isEnabled,
      cadence,
      jurisdiction_level AS jurisdictionLevel,
      jurisdiction_name AS jurisdictionName,
      provider_family AS providerFamily,
      access_mode AS accessMode,
      source_type AS sourceType,
      source_confidence AS sourceConfidence,
      activation_status AS activationStatus,
      requires_browser AS requiresBrowser,
      requires_manual AS requiresManual,
      requires_login AS requiresLogin,
      supports_query AS supportsQuery,
      supports_pagination AS supportsPagination,
      supports_attachment_metadata AS supportsAttachmentMetadata,
      supports_detail_page_fetch AS supportsDetailPageFetch,
      fallback_notes AS fallbackNotes,
      approved_for_ingestion AS approvedForIngestion,
      approval_status AS approvalStatus,
      access_pattern AS accessPattern,
      legal_review_status AS legalReviewStatus,
      source_owner AS sourceOwner,
      approval_notes AS approvalNotes,
      last_approval_reviewed_at AS lastApprovalReviewedAt,
      live_health_owner AS liveHealthOwner,
      live_health_disposition AS liveHealthDisposition,
      live_health_next_review_at AS liveHealthNextReviewAt,
      live_health_notes AS liveHealthNotes,
      live_health_reviewed_at AS liveHealthReviewedAt,
      robots_txt_status AS robotsTxtStatus,
      robots_txt_checked_at AS robotsTxtCheckedAt,
      robots_txt_hash AS robotsTxtHash,
      robots_txt_disallows_crawled_paths AS robotsTxtDisallowsCrawledPaths,
      robots_txt_flag_reason AS robotsTxtFlagReason,
      tos_reviewed AS tosReviewed,
      tos_reviewed_at AS tosReviewedAt,
      tos_url AS tosUrl,
      compliance_reviewer AS complianceReviewer,
      legal_opinion_reference AS legalOpinionReference,
      compliance_review_due_at AS complianceReviewDueAt,
      compliance_notes AS complianceNotes,
      last_success_at AS lastSuccessAt,
      last_failure_at AS lastFailureAt,
      consecutive_failures AS consecutiveFailures,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM data_sources
    ${where}
  `;
}

function dataSourcesSummary(sources: AdminDataSource[]): AdminDataSourceSummary {
  return {
    totalSources: sources.length,
    enabledSources: sources.filter((source) => source.isEnabled).length,
    healthySources: sources.filter(isHealthy).length,
    failingSources: sources.filter(isFailing).length,
  };
}

function isHealthy(source: AdminDataSource) {
  if (source.latestLog) {
    return source.latestLog.status === "success";
  }

  return source.consecutiveFailures === 0 && !source.lastFailureAt;
}

function isFailing(source: AdminDataSource) {
  if (source.latestLog) {
    return source.latestLog.status !== "success";
  }

  return source.consecutiveFailures > 0 || Boolean(source.lastFailureAt);
}

export async function listAdminDataSources(db: AppDatabase): Promise<AdminDataSourcesResponse> {
  const sourceRows = db.select().from(dataSources).orderBy(dataSources.label).all();
  const logRows = db.select().from(crawlerLogs).orderBy(desc(crawlerLogs.startedAt)).all();
  const approvalHistory = approvalHistoryBySource(
    db.select().from(sourceApprovalEvents).orderBy(desc(sourceApprovalEvents.createdAt)).all(),
  );
  const healthSnapshots = listLiveSourceHealthSnapshots(db, 10);
  const latestLiveHealth = latestLiveSourceHealthBySource(healthSnapshots.slice(0, 1));
  const sourceHealthTrend = sourceHealthTrendBySource(healthSnapshots);
  const latestLogsBySource = new Map<string, AdminCrawlerLog>();

  for (const row of logRows) {
    if (!latestLogsBySource.has(row.source)) {
      latestLogsBySource.set(row.source, toAdminLog(row));
    }
  }

  const sources = sourceRows.map((source) =>
    toAdminSource(
      source,
      latestLogForSource(source, latestLogsBySource),
      latestLiveHealth,
      sourceHealthTrend,
      approvalHistory.get(source.id),
    ),
  );

  return {
    summary: dataSourcesSummary(sources),
    sources,
  };
}

export async function listAdminDataSourcesFromMysql(mysql: MysqlDataSourcesStore): Promise<AdminDataSourcesResponse> {
  const sourceRows = await mysqlSelectMany<DataSourceRow>(
    mysql,
    `${dataSourceSelectSql()} ORDER BY label ASC`,
  );
  const logRows = await listAdminCrawlerLogsFromMysql(mysql, { limit: 100 });
  const approvalHistory = approvalHistoryBySource(await listSourceApprovalEventsFromMysql(mysql));
  const healthSnapshots = await listLiveSourceHealthSnapshotsFromMysql(mysql, 10);
  const latestLiveHealth = latestLiveSourceHealthBySource(healthSnapshots.slice(0, 1));
  const sourceHealthTrend = sourceHealthTrendBySource(healthSnapshots);
  const latestLogsBySource = new Map<string, AdminCrawlerLog>();

  for (const row of logRows) {
    if (!latestLogsBySource.has(row.source)) {
      latestLogsBySource.set(row.source, row);
    }
  }

  const sources = sourceRows.map((source) =>
    toAdminSource(
      source,
      latestLogForSource(source, latestLogsBySource),
      latestLiveHealth,
      sourceHealthTrend,
      approvalHistory.get(source.id),
    ),
  );

  return {
    summary: dataSourcesSummary(sources),
    sources,
  };
}

export async function updateAdminDataSource(
  db: AppDatabase,
  id: string,
  input: UpdateAdminDataSourceInput,
  options: UpdateAdminDataSourceOptions = {},
): Promise<AdminDataSource> {
  const existing = db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1).get();
  if (!existing) {
    throw new AdminDataSourceNotFoundError(id);
  }

  const updatedAt = new Date().toISOString();
  const previousSource = toAdminSource(existing, null);
  const lastApprovalReviewedAt = hasGovernanceUpdate(input) ? updatedAt : existing.lastApprovalReviewedAt;
  const liveHealthReviewedAt =
    input.liveHealthReviewedAt !== undefined
      ? input.liveHealthReviewedAt
      : hasLiveHealthTriageUpdate(input)
        ? updatedAt
        : existing.liveHealthReviewedAt;
  const tosReviewedAt =
    input.tosReviewedAt !== undefined
      ? input.tosReviewedAt
      : hasComplianceLedgerUpdate(input)
        ? updatedAt
        : existing.tosReviewedAt;
  db.update(dataSources)
    .set({
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled ? 1 : 0 } : {}),
      ...(input.approvedForIngestion !== undefined
        ? { approvedForIngestion: input.approvedForIngestion ? 1 : 0 }
        : {}),
      ...(input.approvalStatus !== undefined ? { approvalStatus: input.approvalStatus } : {}),
      ...(input.legalReviewStatus !== undefined ? { legalReviewStatus: input.legalReviewStatus } : {}),
      ...(input.approvalNotes !== undefined ? { approvalNotes: input.approvalNotes } : {}),
      ...(input.liveHealthOwner !== undefined ? { liveHealthOwner: input.liveHealthOwner } : {}),
      ...(input.liveHealthDisposition !== undefined ? { liveHealthDisposition: input.liveHealthDisposition } : {}),
      ...(input.liveHealthNextReviewAt !== undefined ? { liveHealthNextReviewAt: input.liveHealthNextReviewAt } : {}),
      ...(input.liveHealthNotes !== undefined ? { liveHealthNotes: redactLiveHealthNotes(input.liveHealthNotes) } : {}),
      ...(hasLiveHealthTriageUpdate(input) ? { liveHealthReviewedAt } : {}),
      ...(input.tosReviewed !== undefined ? { tosReviewed: input.tosReviewed === null ? null : input.tosReviewed ? 1 : 0 } : {}),
      ...(input.tosUrl !== undefined ? { tosUrl: input.tosUrl } : {}),
      ...(input.complianceReviewer !== undefined ? { complianceReviewer: input.complianceReviewer } : {}),
      ...(input.legalOpinionReference !== undefined ? { legalOpinionReference: input.legalOpinionReference } : {}),
      ...(input.complianceReviewDueAt !== undefined ? { complianceReviewDueAt: input.complianceReviewDueAt } : {}),
      ...(input.complianceNotes !== undefined ? { complianceNotes: input.complianceNotes } : {}),
      ...(hasComplianceLedgerUpdate(input) ? { tosReviewedAt } : {}),
      lastApprovalReviewedAt,
      updatedAt,
    })
    .where(eq(dataSources.id, id))
    .run();

  const updated = db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1).get();
  if (!updated) {
    throw new AdminDataSourceNotFoundError(id);
  }

  if (hasGovernanceUpdate(input)) {
    const nextSource = toAdminSource(updated, null);
    db.insert(sourceApprovalEvents)
      .values({
        id: `source_approval_${randomUUID()}`,
        sourceId: id,
        actorUserId: options.actorUserId ?? null,
        action: actionForApprovalChange(input),
        previousApprovalStatus: previousSource.approvalStatus,
        nextApprovalStatus: nextSource.approvalStatus,
        previousLegalReviewStatus: previousSource.legalReviewStatus,
        nextLegalReviewStatus: nextSource.legalReviewStatus,
        previousApprovedForIngestion: previousSource.approvedForIngestion ? 1 : 0,
        nextApprovedForIngestion: nextSource.approvedForIngestion ? 1 : 0,
        reason: input.approvalNotes ?? null,
        createdAt: updatedAt,
      })
      .run();
  }

  const approvalHistory = approvalHistoryBySource(
    db.select().from(sourceApprovalEvents).where(eq(sourceApprovalEvents.sourceId, id)).orderBy(desc(sourceApprovalEvents.createdAt)).all(),
  );

  return toAdminSource(updated, null, undefined, undefined, approvalHistory.get(id));
}

export async function updateAdminDataSourceFromMysql(
  mysql: MysqlDataSourcesStore,
  id: string,
  input: UpdateAdminDataSourceInput,
  options: UpdateAdminDataSourceOptions = {},
): Promise<AdminDataSource> {
  const existing = await mysqlSelectOne<DataSourceRow>(
    mysql,
    `${dataSourceSelectSql("WHERE id = ?")} LIMIT 1`,
    [id],
  );
  if (!existing) {
    throw new AdminDataSourceNotFoundError(id);
  }

  const updatedAt = new Date().toISOString();
  const previousSource = toAdminSource(existing, null);
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.isEnabled !== undefined) {
    fields.push("is_enabled = ?");
    values.push(input.isEnabled ? 1 : 0);
  }
  if (input.approvedForIngestion !== undefined) {
    fields.push("approved_for_ingestion = ?");
    values.push(input.approvedForIngestion ? 1 : 0);
  }
  if (input.approvalStatus !== undefined) {
    fields.push("approval_status = ?");
    values.push(input.approvalStatus);
  }
  if (input.legalReviewStatus !== undefined) {
    fields.push("legal_review_status = ?");
    values.push(input.legalReviewStatus);
  }
  if (input.approvalNotes !== undefined) {
    fields.push("approval_notes = ?");
    values.push(input.approvalNotes);
  }
  if (input.liveHealthOwner !== undefined) {
    fields.push("live_health_owner = ?");
    values.push(input.liveHealthOwner);
  }
  if (input.liveHealthDisposition !== undefined) {
    fields.push("live_health_disposition = ?");
    values.push(input.liveHealthDisposition);
  }
  if (input.liveHealthNextReviewAt !== undefined) {
    fields.push("live_health_next_review_at = ?");
    values.push(input.liveHealthNextReviewAt);
  }
  if (input.liveHealthNotes !== undefined) {
    fields.push("live_health_notes = ?");
    values.push(redactLiveHealthNotes(input.liveHealthNotes));
  }
  if (hasLiveHealthTriageUpdate(input)) {
    fields.push("live_health_reviewed_at = ?");
    values.push(input.liveHealthReviewedAt !== undefined ? input.liveHealthReviewedAt : updatedAt);
  }
  if (input.tosReviewed !== undefined) {
    fields.push("tos_reviewed = ?");
    values.push(input.tosReviewed === null ? null : input.tosReviewed ? 1 : 0);
  }
  if (input.tosUrl !== undefined) {
    fields.push("tos_url = ?");
    values.push(input.tosUrl);
  }
  if (input.complianceReviewer !== undefined) {
    fields.push("compliance_reviewer = ?");
    values.push(input.complianceReviewer);
  }
  if (input.legalOpinionReference !== undefined) {
    fields.push("legal_opinion_reference = ?");
    values.push(input.legalOpinionReference);
  }
  if (input.complianceReviewDueAt !== undefined) {
    fields.push("compliance_review_due_at = ?");
    values.push(input.complianceReviewDueAt);
  }
  if (input.complianceNotes !== undefined) {
    fields.push("compliance_notes = ?");
    values.push(input.complianceNotes);
  }
  if (hasComplianceLedgerUpdate(input)) {
    fields.push("tos_reviewed_at = ?");
    values.push(input.tosReviewedAt !== undefined ? input.tosReviewedAt : updatedAt);
  }
  if (hasGovernanceUpdate(input)) {
    fields.push("last_approval_reviewed_at = ?");
    values.push(updatedAt);
  }

  fields.push("updated_at = ?");
  values.push(updatedAt, id);

  await mysqlExecute(
    mysql,
    `UPDATE data_sources SET ${fields.join(", ")} WHERE id = ?`,
    values,
  );

  const updated = await mysqlSelectOne<DataSourceRow>(
    mysql,
    `${dataSourceSelectSql("WHERE id = ?")} LIMIT 1`,
    [id],
  );
  if (!updated) {
    throw new AdminDataSourceNotFoundError(id);
  }

  if (hasGovernanceUpdate(input)) {
    const nextSource = toAdminSource(updated, null);
    await mysqlExecute(
      mysql,
      `
        INSERT INTO source_approval_events (
          id,
          source_id,
          actor_user_id,
          action,
          previous_approval_status,
          next_approval_status,
          previous_legal_review_status,
          next_legal_review_status,
          previous_approved_for_ingestion,
          next_approved_for_ingestion,
          reason,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `source_approval_${randomUUID()}`,
        id,
        options.actorUserId ?? null,
        actionForApprovalChange(input),
        previousSource.approvalStatus,
        nextSource.approvalStatus,
        previousSource.legalReviewStatus,
        nextSource.legalReviewStatus,
        previousSource.approvedForIngestion ? 1 : 0,
        nextSource.approvedForIngestion ? 1 : 0,
        input.approvalNotes ?? null,
        updatedAt,
      ],
    );
  }

  const approvalHistory = approvalHistoryBySource(await listSourceApprovalEventsFromMysql(mysql, id));

  return toAdminSource(updated, null, undefined, undefined, approvalHistory.get(id));
}

async function listSourceApprovalEventsFromMysql(mysql: MysqlDataSourcesStore, sourceId?: string) {
  const where = sourceId ? "WHERE source_id = ?" : "";
  return mysqlSelectMany<SourceApprovalEventRow>(
    mysql,
    `
      SELECT
        id,
        source_id AS sourceId,
        actor_user_id AS actorUserId,
        action,
        previous_approval_status AS previousApprovalStatus,
        next_approval_status AS nextApprovalStatus,
        previous_legal_review_status AS previousLegalReviewStatus,
        next_legal_review_status AS nextLegalReviewStatus,
        previous_approved_for_ingestion AS previousApprovedForIngestion,
        next_approved_for_ingestion AS nextApprovedForIngestion,
        reason,
        created_at AS createdAt
      FROM source_approval_events
      ${where}
      ORDER BY created_at DESC
      LIMIT 500
    `,
    sourceId ? [sourceId] : [],
  );
}

function actionForApprovalChange(input: UpdateAdminDataSourceInput) {
  if (input.approvalStatus === "approved") return "approved";
  if (input.approvalStatus === "blocked") return "blocked";
  if (input.approvalStatus === "needs_review") return "held";
  return "updated";
}

function hasGovernanceUpdate(input: UpdateAdminDataSourceInput) {
  return (
    input.approvedForIngestion !== undefined ||
    input.approvalStatus !== undefined ||
    input.legalReviewStatus !== undefined ||
    input.approvalNotes !== undefined
  );
}

export async function listAdminCrawlerLogs(
  db: AppDatabase,
  options: { limit?: number } = {},
): Promise<AdminCrawlerLog[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

  return db
    .select()
    .from(crawlerLogs)
    .orderBy(desc(crawlerLogs.startedAt))
    .limit(limit)
    .all()
    .map(toAdminLog);
}

export async function listAdminCrawlerLogsFromMysql(
  mysql: MysqlAdminCrawlerLogsReader,
  options: { limit?: number } = {},
): Promise<AdminCrawlerLog[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const rows = await mysqlSelectMany<MysqlAdminCrawlerLogRow>(
    mysql,
    `
      SELECT
        id,
        source,
        run_id AS runId,
        status,
        started_at AS startedAt,
        finished_at AS finishedAt,
        duration_ms AS durationMs,
        fetched_count AS fetchedCount,
        inserted_count AS insertedCount,
        updated_count AS updatedCount,
        skipped_count AS skippedCount,
        failed_count AS failedCount,
        error_code AS errorCode,
        error_message AS errorMessage,
        metadata
      FROM crawler_logs
      ORDER BY started_at DESC
      LIMIT ?
    `,
    [limit],
  );

  return rows.map(toAdminLogFromMysql);
}
