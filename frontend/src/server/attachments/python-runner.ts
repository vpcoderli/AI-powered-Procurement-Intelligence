/**
 * Node side of contract C1: `python -m apsi_crawler.cli archive-attachments` (stdin JSON in,
 * stdout JSON out). Same spawn shape as `crawler/state-runner.ts`'s `fetch-task`.
 */

import { execFile } from "node:child_process";
import { crawlerRuntime } from "@/server/crawler/execution-context";
import type { AttachmentMode } from "./policy";

export interface ArchiveAttachmentsSource {
  id: string;
  label: string;
  mode: AttachmentMode;
  min_interval_seconds: number;
  timeout_seconds: number;
  max_bytes: number;
  browser_link_selector: string | null;
}

export interface ArchiveAttachmentsItem {
  id: string;
  bid_id: string;
  bid_source: string;
  source_bid_id: string | null;
  page_url: string;
  url: string;
  name: string;
  expected_extension: string | null;
}

export interface ArchiveAttachmentsRequest {
  archive_root: string;
  browser_downloader_url: string | null;
  source: ArchiveAttachmentsSource;
  items: ArchiveAttachmentsItem[];
}

export type ArchiveAttachmentsStatus = "archived" | "failed" | "unavailable";

export interface ArchiveAttachmentsResultItem {
  id: string;
  archive_status: ArchiveAttachmentsStatus;
  storage_path: string | null;
  byte_size: number | null;
  content_type: string | null;
  checksum_sha256: string | null;
  archive_error: string | null;
  failure_kind: string | null;
  final_url: string | null;
  fetched_at: string | null;
  method: string | null;
}

export interface ArchiveAttachmentsStats {
  archived: number;
  failed: number;
  unavailable: number;
  duration_ms: number;
}

export interface ArchiveAttachmentsResponse {
  results: ArchiveAttachmentsResultItem[];
  stats: ArchiveAttachmentsStats;
}

export class ArchiveAttachmentsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveAttachmentsContractError";
  }
}

const STATUSES: readonly string[] = ["archived", "failed", "unavailable"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function counted(value: unknown): number {
  return optionalNumber(value) ?? 0;
}

/** Defensive parse of the C1 response document. Throws on anything that is not that shape. */
export function parseArchiveAttachmentsResponse(stdout: string): ArchiveAttachmentsResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ArchiveAttachmentsContractError("archive-attachments did not write a JSON document to stdout.");
  }

  if (!isRecord(parsed)) {
    throw new ArchiveAttachmentsContractError("archive-attachments stdout was not a JSON object.");
  }
  if (!Array.isArray(parsed.results)) {
    throw new ArchiveAttachmentsContractError("archive-attachments response is missing a results array.");
  }

  const results = parsed.results.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ArchiveAttachmentsContractError(`archive-attachments result ${index} was not a JSON object.`);
    }
    const id = entry.id;
    if (typeof id !== "string" || !id) {
      throw new ArchiveAttachmentsContractError(`archive-attachments result ${index} is missing an id.`);
    }
    const status = entry.archive_status;
    if (typeof status !== "string" || !STATUSES.includes(status)) {
      throw new ArchiveAttachmentsContractError(
        `archive-attachments result ${id} has an unsupported archive_status: ${String(status)}.`,
      );
    }

    return {
      id,
      archive_status: status as ArchiveAttachmentsStatus,
      storage_path: optionalText(entry.storage_path),
      byte_size: optionalNumber(entry.byte_size),
      content_type: optionalText(entry.content_type),
      checksum_sha256: optionalText(entry.checksum_sha256),
      archive_error: optionalText(entry.archive_error),
      failure_kind: optionalText(entry.failure_kind),
      final_url: optionalText(entry.final_url),
      fetched_at: optionalText(entry.fetched_at),
      method: optionalText(entry.method),
    } satisfies ArchiveAttachmentsResultItem;
  });

  const stats = isRecord(parsed.stats) ? parsed.stats : {};

  return {
    results,
    stats: {
      archived: counted(stats.archived),
      failed: counted(stats.failed),
      unavailable: counted(stats.unavailable),
      duration_ms: counted(stats.duration_ms),
    },
  };
}

export interface RunArchiveAttachmentsOptions {
  signal?: AbortSignal;
}

/** Spawn the crawler CLI, feed it the request on stdin and parse its stdout document. */
export function runArchiveAttachments(
  request: ArchiveAttachmentsRequest,
  options: RunArchiveAttachmentsOptions = {},
): Promise<ArchiveAttachmentsResponse> {
  const { python, ...runtime } = crawlerRuntime();

  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      ["-m", "apsi_crawler.cli", "archive-attachments"],
      { ...runtime, env: process.env, signal: options.signal },
      (error, stdout, stderr) => {
        try {
          const response = parseArchiveAttachmentsResponse(String(stdout ?? ""));
          // Exit 0 is expected even when items fail; a non-zero exit means the document (if any)
          // cannot be trusted as the run's outcome.
          if (error) {
            reject(
              new ArchiveAttachmentsContractError(
                `archive-attachments exited abnormally: ${error.message}${stderr ? ` (${String(stderr).trim()})` : ""}`,
              ),
            );
            return;
          }
          resolve(response);
        } catch (parseError) {
          const detail = stderr ? ` (${String(stderr).trim()})` : "";
          reject(
            parseError instanceof ArchiveAttachmentsContractError && !error
              ? new ArchiveAttachmentsContractError(`${parseError.message}${detail}`)
              : new ArchiveAttachmentsContractError(
                  `archive-attachments failed: ${error?.message ?? (parseError as Error).message}${detail}`,
                ),
          );
        }
      },
    );

    child.stdin?.end(JSON.stringify(request));
  });
}
