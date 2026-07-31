import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bids, crawlerLogs } from "@/server/db/schema";
import type { CrawlerJsonImportResult, CrawlerJsonRunPayload } from "./mysql-json-importer";
import type { CrawlableSource } from "./source-registry";

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

function upsertBid(db: AppDatabase, row: JsonRecord, fallbackTimestamp: string): "inserted" | "updated" {
  const id = normalizedBidId(row);
  const updateValues = bidUpdateValues(row, fallbackTimestamp);
  const insertValues = {
    id,
    source: stringValue(row.source),
    dedupeKey: stringValue(row.dedupe_key),
    firstSeenAt: stringValue(row.first_seen_at, fallbackTimestamp),
    createdAt: stringValue(row.created_at, fallbackTimestamp),
    ...updateValues,
  };

  const existing = db.select({ id: bids.id }).from(bids).where(eq(bids.id, id)).get();

  db.insert(bids).values(insertValues).onConflictDoUpdate({ target: bids.id, set: updateValues }).run();

  return existing ? "updated" : "inserted";
}

function insertCrawlerLog(
  db: AppDatabase,
  payload: CrawlerJsonRunPayload,
  counts: Pick<CrawlerJsonImportResult, "fetchedCount" | "insertedCount" | "updatedCount">,
) {
  db.insert(crawlerLogs)
    .values({
      id: `${payload.runId}:log`,
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

/**
 * SQLite twin of `importCrawlerJsonRunIntoMysql` (mysql-json-importer.ts) — the JSON task
 * contract's Drizzle-backed importer. Upserts every bid in the payload by `id`
 * (onConflictDoUpdate) and writes exactly one `crawler_logs` row per call, success or failure.
 *
 * Unlike the MySQL twin, this does not replicate `bid_attachments` and does not reject a
 * successful run with zero bid rows — neither is part of this module's contract; see the task
 * report for the reasoning.
 */
export function importCrawlerJsonRunIntoSqlite(
  db: AppDatabase,
  payload: CrawlerJsonRunPayload,
): CrawlerJsonImportResult {
  const bidRows = payload.bids ?? [];

  let insertedCount = 0;
  let updatedCount = 0;

  for (const row of bidRows) {
    const status = upsertBid(db, row, payload.startedAt);
    if (status === "inserted") insertedCount += 1;
    else updatedCount += 1;
  }

  insertCrawlerLog(db, payload, {
    fetchedCount: bidRows.length,
    insertedCount,
    updatedCount,
  });

  return {
    fetchedCount: bidRows.length,
    insertedCount,
    updatedCount,
    logCount: 1,
  };
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
