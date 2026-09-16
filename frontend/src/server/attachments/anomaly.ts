/**
 * Attachment anomaly classification, retry backoff and terminal rules.
 *
 * Pure functions shared by both dialects — no database or filesystem access. Callers hand in a
 * row plus (for archived rows) the result of a local file probe.
 *
 * See docs/superpowers/specs/2026-09-16-attachment-repair-design.md §4.1.
 */

import type { AttachmentRepairRow } from "./types";

export const ATTACHMENT_ANOMALIES = [
  "never_archived",
  "archive_failed",
  "archive_missing",
  "archive_corrupt",
  "path_not_portable",
  "unavailable",
  "healthy",
] as const;
export type AttachmentAnomaly = (typeof ATTACHMENT_ANOMALIES)[number];

export const HOUR_MS = 60 * 60 * 1000;
export const MAX_BACKOFF_MS = 7 * 24 * HOUR_MS;
/** After this many failed attempts a row is parked as `unavailable`. */
export const MAX_REPAIR_ATTEMPTS = 6;
/** A parked row is queued once more this long after its `next_repair_at`. */
export const UNAVAILABLE_RETRY_MS = 30 * 24 * HOUR_MS;
/**
 * Kinds that describe a site mechanism rather than a transient hiccup: two in a row means the
 * portal will never hand us the bytes over this path.
 */
export const STRUCTURAL_FAILURE_KINDS = ["login_wall", "html_response"] as const;

export function isRepairableAttachmentUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

/** The URL the downloader should fetch: the portal's original link wins over a rewritten one. */
export function attachmentSourceUrl(row: Pick<AttachmentRepairRow, "url" | "originalUrl">): string {
  const original = row.originalUrl?.trim();
  return original ? original : row.url.trim();
}

/** `now + 1h × 2^attempts`, capped at 7 days. `attempts` is the count *before* this failure. */
export function nextRepairAt(attempts: number, now: Date): Date {
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.min(Math.trunc(attempts), 32) : 0;
  const delay = Math.min(HOUR_MS * 2 ** safeAttempts, MAX_BACKOFF_MS);
  return new Date(now.getTime() + delay);
}

function isStructuralKind(value: string | null | undefined): boolean {
  return typeof value === "string" && (STRUCTURAL_FAILURE_KINDS as readonly string[]).includes(value);
}

/** True once retries should stop: attempt budget spent, or two structural failures in a row. */
export function isTerminalFailure(input: {
  attempts: number;
  previousKind: string | null;
  currentKind: string | null;
}): boolean {
  if (input.attempts >= MAX_REPAIR_ATTEMPTS) return true;
  return isStructuralKind(input.previousKind) && isStructuralKind(input.currentKind);
}

/** A parked row becomes a candidate again 30 days after the moment it was parked. */
export function isUnavailableReeligible(nextRepairAtIso: string | null, now: Date): boolean {
  if (!nextRepairAtIso) return false;
  const parked = Date.parse(nextRepairAtIso);
  if (Number.isNaN(parked)) return false;
  return now.getTime() >= parked + UNAVAILABLE_RETRY_MS;
}

/** Whether a `not_archived` / `failed` row's backoff window has elapsed. */
export function isDueForRepair(row: Pick<AttachmentRepairRow, "nextRepairAt">, now: Date): boolean {
  if (!row.nextRepairAt) return true;
  const due = Date.parse(row.nextRepairAt);
  if (Number.isNaN(due)) return true;
  return now.getTime() >= due;
}

/** Facts gathered about the local file backing an `archived` row. */
export interface ArchiveFileProbe {
  /** Absolute path under an allowed archive root, or null when no readable file was found. */
  resolvedPath: string | null;
  byteSize: number;
  checksumSha256: string | null;
  looksLikeHtml: boolean;
  /** The stored `storage_path` is an absolute path (not portable across machines/containers). */
  storagePathIsAbsolute: boolean;
  /** `resolvedPath` expressed relative to the allowed root that contains it. */
  relativePath: string | null;
}

export const MISSING_ARCHIVE_PROBE: ArchiveFileProbe = {
  resolvedPath: null,
  byteSize: 0,
  checksumSha256: null,
  looksLikeHtml: false,
  storagePathIsAbsolute: false,
  relativePath: null,
};

function contentTypeIsHtml(value: string | null): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("text/html");
}

/** Classify the local file backing an `archived` row. */
export function classifyArchivedFile(
  row: Pick<AttachmentRepairRow, "checksumSha256" | "contentType">,
  probe: ArchiveFileProbe,
): Extract<AttachmentAnomaly, "healthy" | "archive_missing" | "archive_corrupt" | "path_not_portable"> {
  if (!probe.resolvedPath) return "archive_missing";
  if (probe.byteSize === 0) return "archive_corrupt";

  const expected = row.checksumSha256?.trim().toLowerCase();
  // An archived row without a checksum can never be proven intact, so it is re-fetched.
  if (!expected) return "archive_corrupt";
  if (probe.checksumSha256 !== expected) return "archive_corrupt";

  if (probe.looksLikeHtml && !contentTypeIsHtml(row.contentType)) return "archive_corrupt";
  if (probe.storagePathIsAbsolute && probe.relativePath) return "path_not_portable";

  return "healthy";
}

export interface ClassifyAttachmentOptions {
  now: Date;
  /** Required for `archived` rows; ignored otherwise. */
  probe?: ArchiveFileProbe | null;
}

/**
 * Classify one candidate row. Rows whose URL is not http(s) (seed/demo `/api/bids/...` links)
 * are `unavailable` and must never reach the downloader.
 */
export function classifyAttachment(row: AttachmentRepairRow, options: ClassifyAttachmentOptions): AttachmentAnomaly {
  if (row.archiveStatus === "archived") {
    return classifyArchivedFile(row, options.probe ?? MISSING_ARCHIVE_PROBE);
  }

  if (!isRepairableAttachmentUrl(attachmentSourceUrl(row))) return "unavailable";

  if (row.archiveStatus === "unavailable") {
    return isUnavailableReeligible(row.nextRepairAt, options.now) ? "archive_failed" : "unavailable";
  }

  if (row.archiveStatus === "failed") return "archive_failed";

  return "never_archived";
}

export interface RepairOutcome {
  archiveStatus: "archived" | "failed" | "unavailable";
  failureKind: string | null;
  repairAttempts: number;
  nextRepairAt: string | null;
}

/** Fold one downloader result into the row's retry bookkeeping. */
export function resolveRepairOutcome(input: {
  row: Pick<AttachmentRepairRow, "repairAttempts" | "failureKind">;
  archiveStatus: string;
  failureKind: string | null;
  now: Date;
}): RepairOutcome {
  if (input.archiveStatus === "archived") {
    return { archiveStatus: "archived", failureKind: null, repairAttempts: 0, nextRepairAt: null };
  }

  const priorAttempts = Number.isFinite(input.row.repairAttempts) ? Math.max(0, Math.trunc(input.row.repairAttempts)) : 0;
  const attempts = priorAttempts + 1;
  const failureKind = input.failureKind ?? (input.archiveStatus === "unavailable" ? "unavailable" : null);
  const terminal =
    input.archiveStatus === "unavailable" ||
    isTerminalFailure({ attempts, previousKind: input.row.failureKind, currentKind: failureKind });

  if (terminal) {
    // The 30-day re-eligibility window is measured from the moment the row was parked.
    return {
      archiveStatus: "unavailable",
      failureKind: failureKind ?? "unavailable",
      repairAttempts: attempts,
      nextRepairAt: input.now.toISOString(),
    };
  }

  return {
    archiveStatus: "failed",
    failureKind,
    repairAttempts: attempts,
    nextRepairAt: nextRepairAt(priorAttempts, input.now).toISOString(),
  };
}
