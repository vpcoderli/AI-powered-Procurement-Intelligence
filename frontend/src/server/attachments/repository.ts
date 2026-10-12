/**
 * SQLite (Drizzle) reads and writes for the attachment repair run.
 *
 * The MySQL twin lives in `mysql-repository.ts`; both expose the same function shapes so
 * `repair-service.ts` can branch once and stay dialect-agnostic afterwards.
 */

import { and, asc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids, crawlerLogs, dataSources } from "@/server/db/schema";
import { UNAVAILABLE_RETRY_MS } from "./anomaly";
import { DEFAULT_ATTACHMENT_POLICY, attachmentBatchLimit, attachmentPolicyFromFetchConfig } from "./policy";
import {
  ATTACHMENT_REPAIR_LOG_SOURCE,
  ATTACHMENT_UPDATE_COLUMNS,
  type AttachmentRepairLogRow,
  type AttachmentRepairRow,
  type AttachmentRowUpdate,
} from "./types";

/** A source may be recorded on the bid by data-source id or by label; either can match. */
const DATA_SOURCE_JOIN = or(eq(dataSources.id, bids.source), eq(dataSources.label, bids.source));

const ROW_SELECTION = {
  id: bidAttachments.id,
  bidId: bidAttachments.bidId,
  name: bidAttachments.name,
  url: bidAttachments.url,
  originalUrl: bidAttachments.originalUrl,
  storagePath: bidAttachments.storagePath,
  byteSize: bidAttachments.byteSize,
  contentType: bidAttachments.contentType,
  checksumSha256: bidAttachments.checksumSha256,
  archiveStatus: bidAttachments.archiveStatus,
  archiveError: bidAttachments.archiveError,
  failureKind: bidAttachments.failureKind,
  repairAttempts: bidAttachments.repairAttempts,
  nextRepairAt: bidAttachments.nextRepairAt,
  verifiedAt: bidAttachments.verifiedAt,
  bidSource: bids.source,
  bidSourceUrl: bids.sourceUrl,
  bidSourceBidId: bids.sourceBidId,
  sourceId: dataSources.id,
  sourceLabel: dataSources.label,
  fetchConfig: dataSources.fetchConfig,
};

type RawRow = {
  [K in keyof typeof ROW_SELECTION]: unknown;
};

function normalizeRow(row: RawRow): AttachmentRepairRow {
  return {
    id: String(row.id),
    bidId: String(row.bidId),
    name: String(row.name ?? ""),
    url: String(row.url ?? ""),
    originalUrl: row.originalUrl === null || row.originalUrl === undefined ? null : String(row.originalUrl),
    storagePath: row.storagePath === null || row.storagePath === undefined ? null : String(row.storagePath),
    byteSize: row.byteSize === null || row.byteSize === undefined ? null : Number(row.byteSize),
    contentType: row.contentType === null || row.contentType === undefined ? null : String(row.contentType),
    checksumSha256: row.checksumSha256 === null || row.checksumSha256 === undefined ? null : String(row.checksumSha256),
    archiveStatus: String(row.archiveStatus ?? "not_archived"),
    archiveError: row.archiveError === null || row.archiveError === undefined ? null : String(row.archiveError),
    failureKind: row.failureKind === null || row.failureKind === undefined ? null : String(row.failureKind),
    repairAttempts: Number(row.repairAttempts ?? 0),
    nextRepairAt: row.nextRepairAt === null || row.nextRepairAt === undefined ? null : String(row.nextRepairAt),
    verifiedAt: row.verifiedAt === null || row.verifiedAt === undefined ? null : String(row.verifiedAt),
    bidSource: String(row.bidSource ?? ""),
    bidSourceUrl: String(row.bidSourceUrl ?? ""),
    bidSourceBidId: row.bidSourceBidId === null || row.bidSourceBidId === undefined ? null : String(row.bidSourceBidId),
    sourceId: row.sourceId === null || row.sourceId === undefined ? null : String(row.sourceId),
    sourceLabel: row.sourceLabel === null || row.sourceLabel === undefined ? null : String(row.sourceLabel),
    fetchConfig: row.fetchConfig === null || row.fetchConfig === undefined ? null : String(row.fetchConfig),
  };
}

/**
 * The `data_sources` join can match a row twice (id and label both pointing at the same source
 * in different `data_sources` rows), so the first match per attachment wins.
 */
export function dedupeAttachmentRows(rows: AttachmentRepairRow[]): AttachmentRepairRow[] {
  const seen = new Set<string>();
  const deduped: AttachmentRepairRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  return deduped;
}

export interface ListAttachmentRepairCandidatesOptions {
  now: Date;
  /** Run-wide cap, cut in per-source rank order so it can never crowd a source out. */
  limit?: number;
  sourceIds?: string[];
  /** Lowers (never raises) every source's `max_per_run` for this run. */
  maxPerSource?: number;
}

/**
 * Memory and run-length guard over all sources together. Every source already has its own
 * `max_per_run` window, and every source's first candidate comes before any source's second.
 */
export const DEFAULT_CANDIDATE_LIMIT = 5000;
export const DEFAULT_VERIFY_LIMIT = 2000;

export function unavailableReeligibleBefore(now: Date) {
  return new Date(now.getTime() - UNAVAILABLE_RETRY_MS).toISOString();
}

/** One `data_sources` row's stored policy, as candidate selection reads it. */
export interface AttachmentSourcePolicyRow {
  id: string;
  fetchConfig: string | null;
}

/**
 * The per-source windows of one run. A bid source without a `data_sources` row, or with the
 * default policy, takes `defaultLimit`; `sourceLimits` lists only the windows that differ from
 * it, and `excludedSourceIds` the sources whose policy switches archiving off.
 */
export interface AttachmentCandidateQuotas {
  defaultLimit: number;
  excludedSourceIds: string[];
  sourceLimits: Array<{ sourceId: string; limit: number }>;
}

/** Shared by both dialects, so the SQL windows follow exactly the policy rules the service applies. */
export function attachmentCandidateQuotas(
  sources: AttachmentSourcePolicyRow[],
  maxPerSource?: number,
): AttachmentCandidateQuotas {
  const defaultLimit = attachmentBatchLimit(DEFAULT_ATTACHMENT_POLICY, maxPerSource);
  const excludedSourceIds: string[] = [];
  const sourceLimits: Array<{ sourceId: string; limit: number }> = [];
  for (const source of sources) {
    const policy = attachmentPolicyFromFetchConfig(source.fetchConfig);
    if (!policy.archive) {
      excludedSourceIds.push(source.id);
      continue;
    }
    const limit = attachmentBatchLimit(policy, maxPerSource);
    if (limit !== defaultLimit) sourceLimits.push({ sourceId: source.id, limit });
  }
  return { defaultLimit, excludedSourceIds, sourceLimits };
}

function sourceFilter(sourceIds: string[] | undefined) {
  if (!sourceIds?.length) return undefined;
  return or(inArray(bids.source, sourceIds), inArray(dataSources.id, sourceIds));
}

function archivingEnabled(excludedSourceIds: string[]) {
  if (excludedSourceIds.length === 0) return undefined;
  return or(isNull(dataSources.id), notInArray(dataSources.id, excludedSourceIds));
}

/**
 * Repair order inside one source: previously archived files that went missing/corrupt are
 * user-visible breakage, so they come before never-archived rows, then other failed retries.
 */
const REPAIR_PRIORITY = sql`CASE WHEN ${bidAttachments.failureKind} IN ('archive_missing', 'archive_corrupt') THEN 0 WHEN ${bidAttachments.archiveStatus} = 'not_archived' THEN 1 ELSE 2 END`;

/** The key the service groups a run by: the matched data source, else the bid's own source. */
const SOURCE_KEY = sql`COALESCE(${dataSources.id}, ${bids.source})`;

function readSourcePolicies(db: AppDatabase): AttachmentSourcePolicyRow[] {
  return db
    .select({ id: dataSources.id, fetchConfig: dataSources.fetchConfig })
    .from(dataSources)
    .where(isNotNull(dataSources.fetchConfig))
    .all();
}

export function listAttachmentRepairCandidates(
  db: AppDatabase,
  options: ListAttachmentRepairCandidatesOptions,
): AttachmentRepairRow[] {
  const quotas = attachmentCandidateQuotas(readSourcePolicies(db), options.maxPerSource);
  const nowIso = options.now.toISOString();
  const due = or(isNull(bidAttachments.nextRepairAt), lte(bidAttachments.nextRepairAt, nowIso));
  const eligible = or(
    and(inArray(bidAttachments.archiveStatus, ["not_archived", "failed"]), due),
    and(
      eq(bidAttachments.archiveStatus, "unavailable"),
      lte(bidAttachments.nextRepairAt, unavailableReeligibleBefore(options.now)),
    ),
  );

  // Rank every eligible attachment inside its own source. Only ids and keys travel through the
  // window sort; the full rows are read for the picked ones alone.
  const ranked = db
    .select({
      id: bidAttachments.id,
      dataSourceId: sql<string | null>`${dataSources.id}`.as("data_source_id"),
      sourceKey: sql<string>`${SOURCE_KEY}`.as("source_key"),
      sourceRank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${SOURCE_KEY} ORDER BY ${REPAIR_PRIORITY}, ${bidAttachments.id})`.as("source_rank"),
    })
    .from(bidAttachments)
    .innerJoin(bids, eq(bids.id, bidAttachments.bidId))
    .leftJoin(dataSources, DATA_SOURCE_JOIN)
    .where(and(eligible, sourceFilter(options.sourceIds), archivingEnabled(quotas.excludedSourceIds)))
    .as("ranked");

  const windowLimit =
    quotas.sourceLimits.length === 0
      ? sql`${quotas.defaultLimit}`
      : sql`CASE ${ranked.dataSourceId} ${sql.join(
          quotas.sourceLimits.map(({ sourceId, limit }) => sql`WHEN ${sourceId} THEN ${limit}`),
          sql` `,
        )} ELSE ${quotas.defaultLimit} END`;

  // Each source keeps its own window; the run-wide cap is cut in rank order.
  const picked = db
    .select({ id: ranked.id, dataSourceId: ranked.dataSourceId, sourceKey: ranked.sourceKey, sourceRank: ranked.sourceRank })
    .from(ranked)
    .where(lte(ranked.sourceRank, windowLimit))
    .orderBy(asc(ranked.sourceRank), asc(ranked.sourceKey), asc(ranked.id))
    .limit(options.limit ?? DEFAULT_CANDIDATE_LIMIT)
    .as("picked");

  // Each row comes back with the data source it was ranked under, not every join match.
  const rows = db
    .select(ROW_SELECTION)
    .from(picked)
    .innerJoin(bidAttachments, eq(bidAttachments.id, picked.id))
    .innerJoin(bids, eq(bids.id, bidAttachments.bidId))
    .leftJoin(dataSources, eq(dataSources.id, picked.dataSourceId))
    .orderBy(asc(picked.sourceRank), asc(picked.sourceKey), asc(bidAttachments.id))
    .all();

  return dedupeAttachmentRows(rows.map((row) => normalizeRow(row as RawRow)));
}

export interface ListAttachmentsForVerificationOptions {
  verifyBefore: Date;
  limit?: number;
  sourceIds?: string[];
}

export function listAttachmentsForVerification(
  db: AppDatabase,
  options: ListAttachmentsForVerificationOptions,
): AttachmentRepairRow[] {
  const cutoff = options.verifyBefore.toISOString();
  const rows = db
    .select(ROW_SELECTION)
    .from(bidAttachments)
    .innerJoin(bids, eq(bids.id, bidAttachments.bidId))
    .leftJoin(dataSources, DATA_SOURCE_JOIN)
    .where(
      and(
        eq(bidAttachments.archiveStatus, "archived"),
        or(isNull(bidAttachments.verifiedAt), lte(bidAttachments.verifiedAt, cutoff)),
        sourceFilter(options.sourceIds),
      ),
    )
    .orderBy(asc(bids.source), asc(bidAttachments.id))
    .limit(options.limit ?? DEFAULT_VERIFY_LIMIT)
    .all();

  return dedupeAttachmentRows(rows.map((row) => normalizeRow(row as RawRow)));
}

type DrizzleWriter = Pick<AppDatabase, "update" | "insert">;

function updateValues(update: AttachmentRowUpdate) {
  const values: Record<string, unknown> = {};
  for (const [key] of ATTACHMENT_UPDATE_COLUMNS) {
    if (key === "id") continue;
    const value = update[key];
    if (value !== undefined) values[key] = value;
  }
  return values;
}

function applyUpdate(writer: DrizzleWriter, update: AttachmentRowUpdate) {
  const values = updateValues(update);
  if (Object.keys(values).length === 0) return;
  writer.update(bidAttachments).set(values).where(eq(bidAttachments.id, update.id)).run();
}

function insertLog(writer: DrizzleWriter, log: AttachmentRepairLogRow) {
  writer
    .insert(crawlerLogs)
    .values({
      id: log.id,
      source: ATTACHMENT_REPAIR_LOG_SOURCE,
      runId: log.runId,
      status: log.status,
      startedAt: log.startedAt,
      finishedAt: log.finishedAt,
      durationMs: log.durationMs,
      fetchedCount: log.fetchedCount,
      insertedCount: log.insertedCount,
      updatedCount: log.updatedCount,
      skippedCount: log.skippedCount,
      failedCount: log.failedCount,
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      metadata: log.metadata,
    })
    .run();
}

export interface ApplyAttachmentRepairWriteInput {
  updates?: AttachmentRowUpdate[];
  log?: AttachmentRepairLogRow;
}

/** Atomically apply a batch of row updates and (optionally) the run's `crawler_logs` row. */
export function applyAttachmentRepairWrites(db: AppDatabase, input: ApplyAttachmentRepairWriteInput): number {
  const updates = input.updates ?? [];
  if (updates.length === 0 && !input.log) return 0;

  return db.transaction((transaction) => {
    for (const update of updates) applyUpdate(transaction as unknown as DrizzleWriter, update);
    if (input.log) insertLog(transaction as unknown as DrizzleWriter, input.log);
    return updates.length;
  });
}
