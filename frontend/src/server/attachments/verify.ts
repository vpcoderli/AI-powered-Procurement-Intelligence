/**
 * Local-IO verification of archived attachment files. No network access: it only resolves the
 * stored `storage_path` under the allowed archive roots, hashes the bytes and sniffs magic bytes.
 */

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { allowedAttachmentDirs, resolveAllowedLocalPath } from "@/server/bids/attachments";
import { MISSING_ARCHIVE_PROBE, type ArchiveFileProbe } from "./anomaly";

/** `<!doctype …` / `<html …`, leading whitespace and a BOM tolerated. */
export function looksLikeHtml(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<?xml-stylesheet");
}

async function canonicalRoots() {
  const roots = allowedAttachmentDirs();
  return Promise.all(
    roots.map(async (root) => ({
      root,
      real: await realpath(root).catch(() => path.resolve(root)),
    })),
  );
}

function relativeToRoot(roots: Array<{ root: string; real: string }>, resolvedPath: string): string | null {
  for (const { root, real } of roots) {
    for (const base of new Set([root, real])) {
      const relative = path.relative(base, resolvedPath);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return relative.split(path.sep).join("/");
      }
    }
  }
  return null;
}

/** Probe the local file backing an archived row. Never throws. */
export async function probeArchivedAttachment(storagePath: string | null | undefined): Promise<ArchiveFileProbe> {
  const value = storagePath?.trim();
  if (!value) return MISSING_ARCHIVE_PROBE;

  const storagePathIsAbsolute = path.isAbsolute(value) || value.startsWith("file://");
  const resolvedPath = await resolveAllowedLocalPath(value).catch(() => undefined);
  if (!resolvedPath) return { ...MISSING_ARCHIVE_PROBE, storagePathIsAbsolute };

  const bytes = await readFile(resolvedPath).catch(() => undefined);
  if (!bytes) return { ...MISSING_ARCHIVE_PROBE, storagePathIsAbsolute };

  return {
    resolvedPath,
    byteSize: bytes.byteLength,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    looksLikeHtml: looksLikeHtml(bytes),
    storagePathIsAbsolute,
    relativePath: relativeToRoot(await canonicalRoots(), resolvedPath),
  };
}
