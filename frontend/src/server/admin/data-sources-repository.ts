import { desc, eq } from "drizzle-orm";
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

function toAdminLog(row: typeof crawlerLogs.$inferSelect): AdminCrawlerLog {
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
  };
}

function toAdminSource(
  row: typeof dataSources.$inferSelect,
  latestLog: AdminCrawlerLog | null,
): AdminDataSource {
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

  const sources = sourceRows.map((source) =>
    toAdminSource(source, latestLogsBySource.get(source.label) ?? latestLogsBySource.get(source.id) ?? null),
  );

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
