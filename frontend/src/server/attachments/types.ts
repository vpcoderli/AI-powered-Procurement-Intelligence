/** Row shapes shared by the SQLite and MySQL attachment repositories. */

export const ATTACHMENT_ARCHIVE_STATUSES = ["archived", "failed", "unavailable", "not_archived"] as const;
export type AttachmentArchiveStatus = (typeof ATTACHMENT_ARCHIVE_STATUSES)[number];

/**
 * One `bid_attachments` row joined to its bid (for the portal detail page URL) and to the
 * `data_sources` row that governs it (for the per-source attachment policy).
 */
export interface AttachmentRepairRow {
  id: string;
  bidId: string;
  name: string;
  url: string;
  originalUrl: string | null;
  storagePath: string | null;
  byteSize: number | null;
  contentType: string | null;
  checksumSha256: string | null;
  archiveStatus: string;
  archiveError: string | null;
  failureKind: string | null;
  repairAttempts: number;
  nextRepairAt: string | null;
  verifiedAt: string | null;
  /** `bids.source` — the human label the crawler stamped on the bid. */
  bidSource: string;
  bidSourceUrl: string;
  bidSourceBidId: string | null;
  /** `data_sources.id`, when a data source matched `bids.source` by id or label. */
  sourceId: string | null;
  sourceLabel: string | null;
  fetchConfig: string | null;
}

/** A sparse `bid_attachments` update; only the provided keys are written. */
export interface AttachmentRowUpdate {
  id: string;
  archiveStatus?: string;
  storagePath?: string | null;
  byteSize?: number | null;
  contentType?: string | null;
  checksumSha256?: string | null;
  fetchedAt?: string | null;
  archiveError?: string | null;
  failureKind?: string | null;
  repairAttempts?: number;
  nextRepairAt?: string | null;
  verifiedAt?: string | null;
}

export interface AttachmentRepairLogRow {
  id: string;
  runId: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: string;
}

/** `crawler_logs.source` value every attachment repair run writes under. */
export const ATTACHMENT_REPAIR_LOG_SOURCE = "attachment_repair";

/** camelCase -> `bid_attachments` column, in a stable order for deterministic SQL. */
export const ATTACHMENT_UPDATE_COLUMNS: ReadonlyArray<[keyof AttachmentRowUpdate, string]> = [
  ["archiveStatus", "archive_status"],
  ["storagePath", "storage_path"],
  ["byteSize", "byte_size"],
  ["contentType", "content_type"],
  ["checksumSha256", "checksum_sha256"],
  ["fetchedAt", "fetched_at"],
  ["archiveError", "archive_error"],
  ["failureKind", "failure_kind"],
  ["repairAttempts", "repair_attempts"],
  ["nextRepairAt", "next_repair_at"],
  ["verifiedAt", "verified_at"],
];
