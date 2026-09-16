import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids, crawlerLocks, crawlerLogs } from "@/server/db/schema";
import type { CrawlerJsonImportResult, CrawlerJsonRunPayload } from "./mysql-json-importer";
import type { CrawlableSource } from "./source-registry";

import { mergePersistedAttachments, mergePersistedBid, snakeCaseRecord } from "./persistence-merge";
import { CrawlerPersistenceError, persistenceFailurePayload, validateCrawlerImport } from "./persistence-errors";
import { CrawlerLeaseLostError, type CrawlerLeaseFence } from "./execution-context";
import { assertPersistenceLease } from "./persistence-lease";

type SqliteImportStore = Pick<AppDatabase, "select" | "insert">;

type JsonRecord = Record<string, unknown>;

function jsonString(value: unknown, fallback: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? fallback);
}

function stringValue(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value);
}

function activeValue(value: unknown) {
  if (value === false || value === 0 || value === "0") return 0;
  return 1;
}

function normalizedBidId(row: JsonRecord) {
  return stringValue(
    row.id,
    `${stringValue(row.source, "crawler")}:${stringValue(row.source_bid_id ?? row.dedupe_key, "unknown")}`,
  );
}

/**
 * Fields that are safe to overwrite on every run. Mirrors mysql-json-importer.ts's
 * `bidUpdateColumns` (bidColumns minus id/source/dedupe_key/first_seen_at/created_at) — those
 * five are identity/creation-time fields set once at insert and never touched again.
 */
function bidUpdateValues(row: JsonRecord, fallbackTimestamp: string) {
  return {
    sourceBidId: optionalString(row.source_bid_id),
    title: stringValue(row.title, "Untitled opportunity"),
    description: stringValue(row.description, ""),
    fullDescription: optionalString(row.full_description),
    originalCategory: optionalString(row.original_category),
    amount: optionalString(row.amount),
    amountMin: optionalNumber(row.amount_min),
    amountMax: optionalNumber(row.amount_max),
    currency: stringValue(row.currency, "USD"),
    publishedDate: optionalString(row.published_date),
    deadlineDate: optionalString(row.deadline_date),
    issuerName: stringValue(row.issuer_name, "Unknown issuer"),
    issuerType: stringValue(row.issuer_type, "state"),
    stateCode: stringValue(row.state_code, "US"),
    contactName: optionalString(row.contact_name),
    contactEmail: optionalString(row.contact_email),
    contactPhone: optionalString(row.contact_phone),
    sourceUrl: stringValue(row.source_url),
    isActive: activeValue(row.is_active),
    rawPayload: jsonString(row.raw_payload, row),
    sourceConfidence: stringValue(row.source_confidence, "medium"),
    qualityFlagsJson: jsonString(row.quality_flags_json, []),
    adminReviewStatus: stringValue(row.admin_review_status, "unreviewed"),
    detailArchiveStatus: stringValue(row.detail_archive_status, "not_archived"),
    detailArchivePath: optionalString(row.detail_archive_path),
    detailFetchedAt: optionalString(row.detail_fetched_at),
    detailChecksumSha256: optionalString(row.detail_checksum_sha256),
    detailArchiveError: optionalString(row.detail_archive_error),
    jurisdictionLevel: optionalString(row.jurisdiction_level),
    jurisdictionName: optionalString(row.jurisdiction_name),
    fipsCode: optionalString(row.fips_code),
    lastSeenAt: stringValue(row.last_seen_at, fallbackTimestamp),
    updatedAt: stringValue(row.updated_at, fallbackTimestamp),
  };
}

/**
 * Field-for-field mirror of mysql-json-importer.ts's attachmentRowsForBid: same column set,
 * same fallback defaults (id/name synthesized from index, archive_status defaults to
 * "not_archived", sort_order falls back to array index).
 */
function attachmentRowsForBid(row: JsonRecord, bidId: string, fallbackTimestamp: string) {
  const attachments = Array.isArray(row.attachments) ? (row.attachments as JsonRecord[]) : [];
  return attachments.map((attachment, index) => ({
    id: stringValue(attachment.id, `${bidId}:attachment:${index + 1}`),
    bidId,
    name: stringValue(attachment.name, `Attachment ${index + 1}`),
    url: stringValue(attachment.url),
    originalUrl: optionalString(attachment.original_url),
    storagePath: optionalString(attachment.storage_path),
    byteSize: optionalNumber(attachment.byte_size),
    contentType: optionalString(attachment.content_type),
    checksumSha256: optionalString(attachment.checksum_sha256),
    fetchedAt: optionalString(attachment.fetched_at),
    archiveStatus: stringValue(attachment.archive_status, "not_archived"),
    archiveError: optionalString(attachment.archive_error),
    sizeLabel: optionalString(attachment.size_label),
    mimeType: optionalString(attachment.mime_type),
    sortOrder: optionalNumber(attachment.sort_order) ?? index,
    createdAt: stringValue(attachment.created_at, fallbackTimestamp),
  }));
}

function mergeAttachments(db: SqliteImportStore, row: JsonRecord, bidId: string, fallbackTimestamp: string) {
  if (!Array.isArray(row.attachments) || row.attachments.length === 0) return;
  const existing = db.select().from(bidAttachments).where(eq(bidAttachments.bidId, bidId)).all().map(snakeCaseRecord);
  const incoming = mergePersistedAttachments(existing, row.attachments as JsonRecord[], bidId);
  for (const attachmentRow of attachmentRowsForBid({ attachments: incoming }, bidId, fallbackTimestamp)) {
    const insert = db.insert(bidAttachments).values(attachmentRow);
    if (existing.some((attachment) => attachment.id === attachmentRow.id)) {
      insert.onConflictDoUpdate({ target: bidAttachments.id, set: attachmentRow }).run();
    } else {
      // A supplied ID colliding with another bid must fail the run, not move its attachment.
      insert.run();
    }
  }
}

/** Resolve the persisted row for a payload bid by primary id, then by dedupe key (MySQL twin does the same). */
function existingBidFor(db: SqliteImportStore, row: JsonRecord) {
  const byId = db.select().from(bids).where(eq(bids.id, normalizedBidId(row))).get();
  if (byId) return byId;
  const dedupeKey = stringValue(row.dedupe_key);
  return dedupeKey ? db.select().from(bids).where(eq(bids.dedupeKey, dedupeKey)).get() : undefined;
}

function upsertBid(db: SqliteImportStore, row: JsonRecord, fallbackTimestamp: string): { id: string; status: "inserted" | "updated" } {
  const existing = existingBidFor(db, row);
  // A dedupe-key match under another primary id updates that row instead of failing the run.
  const id = existing?.id ?? normalizedBidId(row);
  const merged = mergePersistedBid(row, existing ? snakeCaseRecord(existing) : undefined);
  const updateValues = bidUpdateValues(merged, fallbackTimestamp);
  const insertValues = {
    id,
    source: stringValue(row.source),
    dedupeKey: stringValue(row.dedupe_key),
    firstSeenAt: stringValue(row.first_seen_at, fallbackTimestamp),
    createdAt: stringValue(row.created_at, fallbackTimestamp),
    ...updateValues,
  };

  db.insert(bids)
    .values(insertValues)
    .onConflictDoUpdate({ target: bids.id, set: updateValues })
    .run();

  return { id, status: existing ? "updated" : "inserted" };
}

function insertCrawlerLog(
  db: SqliteImportStore,
  payload: CrawlerJsonRunPayload,
  counts: Pick<CrawlerJsonImportResult, "fetchedCount" | "insertedCount" | "updatedCount">,
  id = `${payload.runId}:log`,
) {
  db.insert(crawlerLogs)
    .values({
      id,
      source: payload.source,
      runId: payload.runId,
      status: payload.status,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt ?? null,
      durationMs: payload.durationMs ?? null,
      fetchedCount: counts.fetchedCount,
      insertedCount: counts.insertedCount,
      updatedCount: counts.updatedCount,
      skippedCount: 0,
      failedCount: payload.status === "failure" ? 1 : 0,
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
      errorStack: payload.errorStack ?? null,
      metadata: jsonString(payload.metadata, {}),
    })
    .run();
}

/** Atomically commit every bid, attachment, and the successful run log. */
export function importCrawlerJsonRunIntoSqlite(
  db: AppDatabase,
  payload: CrawlerJsonRunPayload,
  lease?: CrawlerLeaseFence,
): CrawlerJsonImportResult {
  try {
    validateCrawlerImport(payload);
    return db.transaction((transaction) => {
      const checkLease = () => {
        if (!lease) return;
        const row = transaction.select().from(crawlerLocks).where(eq(crawlerLocks.source, lease.source)).get();
        assertPersistenceLease(lease, row);
      };
      checkLease();
      const bidRows = payload.bids ?? [];
      let insertedCount = 0;
      let updatedCount = 0;
      for (const row of bidRows) {
        const result = upsertBid(transaction, row, payload.startedAt);
        if (result.status === "inserted") insertedCount += 1;
        else updatedCount += 1;
        mergeAttachments(transaction, row, result.id, payload.startedAt);
      }
      const counts = { fetchedCount: bidRows.length, insertedCount, updatedCount };
      insertCrawlerLog(transaction, payload, counts);
      checkLease();
      return { ...counts, logCount: 1 };
    }, lease ? { behavior: "immediate" } : undefined);
  } catch (error) {
    const failure = error instanceof CrawlerLeaseLostError ? error : new CrawlerPersistenceError(error);
    try {
      insertCrawlerLog(db, persistenceFailurePayload(payload, error), { fetchedCount: 0, insertedCount: 0, updatedCount: 0 }, `${payload.runId}:failure:${randomUUID()}`);
      Object.assign(failure, { failureLogged: true });
    } catch { /* The original failure remains actionable even if logging is unavailable. */ }
    throw failure;
  }
}

function stampedValue(existing: unknown, sourceValue: string | null): unknown {
  if (existing !== undefined && existing !== null) return existing;
  return sourceValue ?? null;
}

/**
 * Stamps `jurisdiction_level`/`jurisdiction_name`/`fips_code` from the source registry onto
 * every bid in the payload, without overwriting a value the crawler already set. Pure — used by
 * configured-runner.ts ahead of both `importCrawlerJsonRunIntoSqlite` and
 * `importCrawlerJsonRunIntoMysql`, so the stamping logic lives in exactly one place for both
 * dialects.
 */
export function stampJurisdiction(
  payload: CrawlerJsonRunPayload,
  source: Pick<CrawlableSource, "jurisdictionLevel" | "jurisdictionName" | "fipsCode">,
): CrawlerJsonRunPayload {
  const bidRows = payload.bids;
  if (!bidRows || bidRows.length === 0) return payload;

  return {
    ...payload,
    bids: bidRows.map((row) => ({
      ...row,
      jurisdiction_level: stampedValue(row.jurisdiction_level, source.jurisdictionLevel),
      jurisdiction_name: stampedValue(row.jurisdiction_name, source.jurisdictionName),
      fips_code: stampedValue(row.fips_code, source.fipsCode),
    })),
  };
}
