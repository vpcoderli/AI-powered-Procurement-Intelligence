import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments } from "@/server/db/schema";

export interface LocalBidAttachment {
  filePath: string;
  filename: string;
  mimeType: string | null;
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

function candidatePaths(value: string) {
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

  return [path.resolve(defaultAttachmentDir(), relativeAttachmentPath(value))];
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

  const allowedDirs = await Promise.all(allowedAttachmentDirs().map(canonicalPath));

  for (const candidate of candidatePaths(value)) {
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

export async function getLocalBidAttachment(
  db: AppDatabase,
  bidId: string,
  attachmentId: string,
): Promise<LocalBidAttachment | undefined> {
  const row = db
    .select()
    .from(bidAttachments)
    .where(and(eq(bidAttachments.bidId, bidId), eq(bidAttachments.id, attachmentId)))
    .limit(1)
    .get();

  if (!row) return undefined;

  const filePath = await resolveAllowedLocalPath(row.url);
  if (!filePath) return undefined;

  return {
    filePath,
    filename: row.name,
    mimeType: row.mimeType,
  };
}
