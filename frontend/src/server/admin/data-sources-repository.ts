import { desc, eq } from "drizzle-orm";
import {
  getStateCrawlerSourceMetadata,
  STATE_CRAWLER_SOURCE_IDS_BY_STATE,
  type CrawlerAdapterKind,
  type CrawlerCapability,
  type CrawlerMaturity,
} from "@/lib/state-crawler-sources";
import type { AppDatabase } from "@/server/db/client";
import { crawlerLogs, dataSources } from "@/server/db/schema";

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
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  crawlerSourceId: string | null;
  crawlerAdapterKind: CrawlerAdapterKind;
  crawlerMaturity: CrawlerMaturity;
  crawlerCapabilities: CrawlerCapability[];
  crawlerBaseUrl: string | null;
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
  createdAt: string;
  updatedAt: string;
  latestLog: AdminCrawlerLog | null;
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

export class AdminDataSourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Data source ${id} was not found`);
    this.name = "AdminDataSourceNotFoundError";
  }
}

const CRAWLER_LOG_SOURCE_BY_STATE = STATE_CRAWLER_SOURCE_IDS_BY_STATE;

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

function toAdminSource(
  row: typeof dataSources.$inferSelect,
  latestLog: AdminCrawlerLog | null,
): AdminDataSource {
  const crawlerMetadata = row.issuerType === "state" ? getStateCrawlerSourceMetadata(row.stateCode) : null;
  const crawlerCapabilities = [...(crawlerMetadata?.capabilities ?? [])];
  const crawlerMaturity = crawlerMetadata?.maturity ?? "none";

  return {
    id: row.id,
    label: row.label,
    issuerType: row.issuerType,
    stateCode: row.stateCode,
    baseUrl: row.baseUrl,
    isEnabled: row.isEnabled === 1,
    cadence: row.cadence,
    lastSuccessAt: row.lastSuccessAt,
    lastFailureAt: row.lastFailureAt,
    consecutiveFailures: row.consecutiveFailures,
    crawlerSourceId: crawlerMetadata?.id ?? null,
    crawlerAdapterKind: crawlerMetadata?.adapterKind ?? "none",
    crawlerMaturity,
    crawlerCapabilities,
    crawlerBaseUrl: crawlerMetadata?.baseUrl ?? null,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    latestLog,
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
  const latestLogsBySource = new Map<string, AdminCrawlerLog>();

  for (const row of logRows) {
    if (!latestLogsBySource.has(row.source)) {
      latestLogsBySource.set(row.source, toAdminLog(row));
    }
  }

  const sources = sourceRows.map((source) => toAdminSource(source, latestLogForSource(source, latestLogsBySource)));

  return {
    summary: {
      totalSources: sources.length,
      enabledSources: sources.filter((source) => source.isEnabled).length,
      healthySources: sources.filter(isHealthy).length,
      failingSources: sources.filter(isFailing).length,
    },
    sources,
  };
}

export async function updateAdminDataSource(
  db: AppDatabase,
  id: string,
  input: { isEnabled: boolean },
): Promise<AdminDataSource> {
  const existing = db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1).get();
  if (!existing) {
    throw new AdminDataSourceNotFoundError(id);
  }

  const updatedAt = new Date().toISOString();
  db.update(dataSources)
    .set({ isEnabled: input.isEnabled ? 1 : 0, updatedAt })
    .where(eq(dataSources.id, id))
    .run();

  const updated = db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1).get();
  if (!updated) {
    throw new AdminDataSourceNotFoundError(id);
  }

  return toAdminSource(updated, null);
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
