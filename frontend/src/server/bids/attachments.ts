import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { bidAttachments } from "@/server/db/schema";

export type AttachmentAvailability =
  | "archived_openable"
  | "local_openable"
  | "source_download_note"
  | "archive_missing"
  | "archive_failed";

export interface LocalBidAttachment {
  kind: "local";
  availability: "archived_openable" | "local_openable";
  downloadKind: "archived_file" | "local_file";
  filePath: string;
  filename: string;
  mimeType: string | null;
  originalUrl: string;
  archiveStatus: string;
  archiveError: string | null;
  storagePath: string | null;
  checksumSha256: string | null;
}

export interface FallbackBidAttachment {
  kind: "fallback";
  availability: "source_download_note" | "archive_missing" | "archive_failed";
  noteKind: "source_download_note" | "archive_status_note";
  filename: string;
  mimeType: "text/plain; charset=utf-8";
  originalUrl: string;
  archiveStatus: string;
  archiveError: string | null;
  reason: string;
}

export type BidAttachmentDownload = LocalBidAttachment | FallbackBidAttachment;

interface MysqlAttachmentReader {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<[MysqlBidAttachmentRow[]] | [MysqlBidAttachmentRow[], unknown]>;
}

interface MysqlBidAttachmentRow {
  id: string;
  bidId: string;
  name: string;
  url: string;
  originalUrl: string | null;
  storagePath: string | null;
  contentType: string | null;
  mimeType: string | null;
  checksumSha256: string | null;
  archiveStatus: string;
  archiveError: string | null;
}

export function isExternalAttachmentUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function hasUrlScheme(value: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

export function isLocalAttachmentUrl(value: string) {
  return value.startsWith("file://") || path.isAbsolute(value) || !hasUrlScheme(value);
}

export function attachmentDownloadUrl(bidId: string, attachmentId: string) {
  return `/api/bids/${encodeURIComponent(bidId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function frontendRoot() {
  return process.cwd();
}

function defaultAttachmentDir() {
  return path.join(frontendRoot(), "data", "attachments");
}

function allowedAttachmentDirs() {
  const configuredDirs = (process.env.CRAWLER_ATTACHMENT_DIR ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  return [defaultAttachmentDir(), ...configuredDirs].map((dir) => path.resolve(dir));
}

function relativeAttachmentPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.?\//, "");
  const withoutDataPrefix = normalized.replace(/^data\/attachments\//, "");
  return withoutDataPrefix;
}

function candidatePaths(value: string, relativeRoots: string[]) {
  if (value.startsWith("file://")) {
    try {
      return [fileURLToPath(value)];
    } catch {
      return [];
    }
  }

  if (path.isAbsolute(value)) {
    return [value];
  }

  const relativePath = relativeAttachmentPath(value);
  return relativeRoots.map((root) => path.resolve(root, relativePath));
}

async function canonicalPath(value: string) {
  return realpath(value).catch(() => path.resolve(value));
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveAllowedLocalPath(value: string) {
  if (!isLocalAttachmentUrl(value) || isExternalAttachmentUrl(value)) {
    return undefined;
  }

  const allowedDirCandidates = allowedAttachmentDirs();
  const allowedDirs = await Promise.all(allowedDirCandidates.map(canonicalPath));

  for (const candidate of candidatePaths(value, allowedDirCandidates)) {
    const resolvedCandidate = path.resolve(candidate);
    await access(resolvedCandidate).catch(() => undefined);
    const fileStats = await stat(resolvedCandidate).catch(() => undefined);
    if (!fileStats?.isFile()) continue;

    const realCandidate = await canonicalPath(resolvedCandidate);
    if (allowedDirs.some((dir) => isPathInside(dir, realCandidate))) {
      return realCandidate;
    }
  }

  return undefined;
}

function hasArchivedOpenableMetadata(row: {
  archiveStatus: string;
  storagePath: string | null;
  checksumSha256: string | null;
}) {
  return (
    row.archiveStatus === "archived" &&
    Boolean(row.storagePath?.trim()) &&
    Boolean(row.checksumSha256?.trim())
  );
}

function localAvailability(row: {
  archiveStatus: string;
  storagePath: string | null;
  checksumSha256: string | null;
}): LocalBidAttachment["availability"] {
  return hasArchivedOpenableMetadata(row) ? "archived_openable" : "local_openable";
}

function localDownloadKind(availability: LocalBidAttachment["availability"]): LocalBidAttachment["downloadKind"] {
  return availability === "archived_openable" ? "archived_file" : "local_file";
}

function fallbackAvailability(row: {
  archiveStatus: string;
  storagePath: string | null;
}): FallbackBidAttachment["availability"] {
  if (row.archiveStatus === "failed") return "archive_failed";
  if (row.storagePath?.trim()) return "archive_missing";
  return "source_download_note";
}

function fallbackReason(availability: FallbackBidAttachment["availability"]) {
  if (availability === "archive_failed") {
    return "Attachment archiving failed; no archived local file is available.";
  }
  if (availability === "archive_missing") {
    return "The archived attachment file is not available on disk.";
  }
  return "The attachment has not been archived locally yet.";
}

function fallbackNoteKind(availability: FallbackBidAttachment["availability"]): FallbackBidAttachment["noteKind"] {
  return availability === "source_download_note" ? "source_download_note" : "archive_status_note";
}

export async function getLocalBidAttachment(
  db: AppDatabase,
  bidId: string,
  attachmentId: string,
): Promise<LocalBidAttachment | undefined> {
  const attachment = await getBidAttachmentDownload(db, bidId, attachmentId);

  return attachment?.kind === "local" ? attachment : undefined;
}

export async function getBidAttachmentDownload(
  db: AppDatabase,
  bidId: string,
  attachmentId: string,
): Promise<BidAttachmentDownload | undefined> {
  if (isMysqlDatabaseUrlConfigured()) {
    return getBidAttachmentDownloadFromMysql(resolveMysqlPool(), bidId, attachmentId);
  }

  const row = db
    .select()
    .from(bidAttachments)
    .where(and(eq(bidAttachments.bidId, bidId), eq(bidAttachments.id, attachmentId)))
    .limit(1)
    .get();

  if (!row) return undefined;

  const originalUrl = row.originalUrl ?? row.url;
  const filePath = await resolveAllowedLocalPath(row.storagePath ?? row.url);
  if (!filePath) {
    const availability = fallbackAvailability(row);

    return {
      kind: "fallback",
      availability,
      noteKind: fallbackNoteKind(availability),
      filename: row.name,
      mimeType: "text/plain; charset=utf-8",
      originalUrl,
      archiveStatus: row.archiveStatus,
      archiveError: row.archiveError,
      reason: fallbackReason(availability),
    };
  }

  const availability = localAvailability(row);

  return {
    kind: "local",
    availability,
    downloadKind: localDownloadKind(availability),
    filePath,
    filename: row.name,
    mimeType: row.mimeType ?? row.contentType,
    originalUrl,
    archiveStatus: row.archiveStatus,
    archiveError: row.archiveError,
    storagePath: row.storagePath,
    checksumSha256: row.checksumSha256,
  };
}

export async function getBidAttachmentDownloadFromMysql(
  mysql: MysqlAttachmentReader,
  bidId: string,
  attachmentId: string,
): Promise<BidAttachmentDownload | undefined> {
  const [rows] = await mysql.query(
    `
      SELECT
        id,
        bid_id AS bidId,
        name,
        url,
        original_url AS originalUrl,
        storage_path AS storagePath,
        content_type AS contentType,
        mime_type AS mimeType,
        checksum_sha256 AS checksumSha256,
        archive_status AS archiveStatus,
        archive_error AS archiveError
      FROM bid_attachments
      WHERE bid_id = ? AND id = ?
      LIMIT 1
    `,
    [bidId, attachmentId],
  );
  const row = rows[0];

  if (!row) return undefined;

  const originalUrl = row.originalUrl ?? row.url;
  const filePath = await resolveAllowedLocalPath(row.storagePath ?? row.url);
  if (!filePath) {
    const availability = fallbackAvailability(row);

    return {
      kind: "fallback",
      availability,
      noteKind: fallbackNoteKind(availability),
      filename: row.name,
      mimeType: "text/plain; charset=utf-8",
      originalUrl,
      archiveStatus: row.archiveStatus,
      archiveError: row.archiveError,
      reason: fallbackReason(availability),
    };
  }

  const availability = localAvailability(row);

  return {
    kind: "local",
    availability,
    downloadKind: localDownloadKind(availability),
    filePath,
    filename: row.name,
    mimeType: row.mimeType ?? row.contentType,
    originalUrl,
    archiveStatus: row.archiveStatus,
    archiveError: row.archiveError,
    storagePath: row.storagePath,
    checksumSha256: row.checksumSha256,
  };
}
