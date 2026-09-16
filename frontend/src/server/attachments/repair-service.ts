/**
 * Attachment repair run (contract C3).
 *
 * One run does three things, in order:
 *   1. Verify pass (local IO only): re-check archived files, rewrite non-portable paths, and
 *      degrade missing/corrupt archives so they are repaired in this same run.
 *   2. Candidate selection: everything never archived, failed and due, or parked long enough.
 *   3. Per source: take the `attachment_repair:<id>` lease, hand the batch to the Python
 *      `archive-attachments` CLI, and write the results back in one transaction.
 *
 * Every read and write has a SQLite (Drizzle) and a MySQL (hand-written SQL) implementation;
 * the `db` export is a throwing Proxy under MySQL, so the Drizzle branch is never entered when
 * `options.mysql` is present.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "@/server/crawler/lock-repository";
import {
  attachmentSourceUrl,
  classifyArchivedFile,
  isRepairableAttachmentUrl,
  resolveRepairOutcome,
} from "./anomaly";
import { withAttachmentLease } from "./lease";
import {
  applyAttachmentRepairWritesToMysql,
  listAttachmentRepairCandidatesFromMysql,
  listAttachmentsForVerificationFromMysql,
  type MysqlAttachmentStore,
} from "./mysql-repository";
import { DEFAULT_ATTACHMENT_POLICY, parseAttachmentPolicy, type AttachmentPolicy } from "./policy";
import {
  runArchiveAttachments,
  type ArchiveAttachmentsRequest,
  type ArchiveAttachmentsResponse,
} from "./python-runner";
import {
  applyAttachmentRepairWrites,
  listAttachmentRepairCandidates,
  listAttachmentsForVerification,
} from "./repository";
import {
  ATTACHMENT_REPAIR_LOG_SOURCE,
  type AttachmentRepairLogRow,
  type AttachmentRepairRow,
  type AttachmentRowUpdate,
} from "./types";
import { probeArchivedAttachment } from "./verify";

export const DEFAULT_VERIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AttachmentRepairRunOptions {
  database: AppDatabase;
  mysql?: MysqlCrawlerLockStore;
  owner: string;
  now?: () => Date;
  archiveRoot?: string;
  browserDownloaderUrl?: string | null;
  maxPerSource?: number;
  verifyIntervalMs?: number;
  sourceIds?: string[];
  runner?: (request: ArchiveAttachmentsRequest) => Promise<ArchiveAttachmentsResponse>;
}

export interface AttachmentRepairSourceResult {
  sourceId: string;
  status: "success" | "failure" | "locked" | "skipped";
  attempted: number;
  repaired: number;
  failed: number;
  unavailable: number;
  error?: string;
}

export interface AttachmentRepairRunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "failure";
  candidates: number;
  verified: number;
  repaired: number;
  metadataFixed: number;
  failed: number;
  unavailable: number;
  skipped: number;
  bySource: AttachmentRepairSourceResult[];
  byKind: Record<string, number>;
}

function resolveArchiveRoot(explicit?: string) {
  if (explicit?.trim()) return path.resolve(explicit);
  const configured = (process.env.CRAWLER_ATTACHMENT_DIR ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  return path.resolve(configured[0] ?? path.join(process.cwd(), "data", "attachments"));
}

function resolveMaxPerSource(explicit?: number) {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);
  const configured = Number(process.env.ATTACHMENT_REPAIR_MAX_PER_SOURCE ?? "");
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : undefined;
}

function policyForRow(row: AttachmentRepairRow): AttachmentPolicy {
  if (!row.fetchConfig?.trim()) return DEFAULT_ATTACHMENT_POLICY;
  try {
    const parsed: unknown = JSON.parse(row.fetchConfig);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parseAttachmentPolicy(parsed as Record<string, unknown>)
      : DEFAULT_ATTACHMENT_POLICY;
  } catch {
    return DEFAULT_ATTACHMENT_POLICY;
  }
}

function expectedExtension(name: string): string | null {
  const extension = path.extname(name ?? "").toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : null;
}

function sourceKey(row: AttachmentRepairRow) {
  return row.sourceId ?? row.bidSource;
}

interface Writer {
  apply: (input: { updates?: AttachmentRowUpdate[]; log?: AttachmentRepairLogRow }) => Promise<void>;
  listVerification: (input: { verifyBefore: Date; sourceIds?: string[] }) => Promise<AttachmentRepairRow[]>;
  listCandidates: (input: { now: Date; sourceIds?: string[] }) => Promise<AttachmentRepairRow[]>;
}

function createWriter(options: AttachmentRepairRunOptions): Writer {
  if (options.mysql) {
    const store = options.mysql as unknown as MysqlAttachmentStore;
    return {
      apply: async (input) => {
        await applyAttachmentRepairWritesToMysql(store, input);
      },
      listVerification: (input) => listAttachmentsForVerificationFromMysql(store, input),
      listCandidates: (input) => listAttachmentRepairCandidatesFromMysql(store, input),
    };
  }

  return {
    apply: async (input) => {
      applyAttachmentRepairWrites(options.database, input);
    },
    listVerification: async (input) => listAttachmentsForVerification(options.database, input),
    listCandidates: async (input) => listAttachmentRepairCandidates(options.database, input),
  };
}

export async function runAttachmentRepairOnce(
  options: AttachmentRepairRunOptions,
): Promise<AttachmentRepairRunResult> {
  const now = options.now ?? (() => new Date());
  const runId = randomUUID();
  const startedAtDate = now();
  const startedAt = startedAtDate.toISOString();
  const writer = createWriter(options);
  const archiveRoot = resolveArchiveRoot(options.archiveRoot);
  const browserDownloaderUrl =
    options.browserDownloaderUrl !== undefined
      ? options.browserDownloaderUrl
      : process.env.BROWSER_DOWNLOADER_URL?.trim() || null;
  const maxPerSourceOverride = resolveMaxPerSource(options.maxPerSource);
  const verifyIntervalMs = options.verifyIntervalMs ?? DEFAULT_VERIFY_INTERVAL_MS;
  const runner = options.runner ?? ((request: ArchiveAttachmentsRequest) => runArchiveAttachments(request));

  const byKind: Record<string, number> = {};
  const countKind = (kind: string | null | undefined) => {
    if (!kind) return;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  };

  let verified = 0;
  let metadataFixed = 0;
  let repaired = 0;
  let failed = 0;
  let unavailable = 0;
  let skipped = 0;
  const bySource: AttachmentRepairSourceResult[] = [];
  let status: "success" | "failure" = "success";
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    // ---- 1. Verify pass -------------------------------------------------------------------
    const verifyNow = now();
    const verifyRows = await writer.listVerification({
      verifyBefore: new Date(verifyNow.getTime() - verifyIntervalMs),
      sourceIds: options.sourceIds,
    });

    const verifyUpdates: AttachmentRowUpdate[] = [];
    for (const row of verifyRows) {
      const probe = await probeArchivedAttachment(row.storagePath);
      const verdict = classifyArchivedFile(row, probe);
      const verifiedAt = now().toISOString();

      if (verdict === "healthy") {
        verified += 1;
        verifyUpdates.push({ id: row.id, verifiedAt });
        continue;
      }

      if (verdict === "path_not_portable") {
        metadataFixed += 1;
        verifyUpdates.push({
          id: row.id,
          storagePath: probe.relativePath,
          byteSize: probe.byteSize,
          verifiedAt,
        });
        continue;
      }

      countKind(verdict);
      verifyUpdates.push({
        id: row.id,
        archiveStatus: "failed",
        failureKind: verdict,
        // Repaired in this same run rather than after a backoff window.
        nextRepairAt: verifiedAt,
        verifiedAt: null,
        archiveError:
          verdict === "archive_missing"
            ? "Archived file is missing from every allowed attachment root."
            : "Archived file failed content verification (size, checksum or magic bytes).",
      });
    }

    if (verifyUpdates.length > 0) {
      await writer.apply({ updates: verifyUpdates });
    }

    // ---- 2. Candidate selection ----------------------------------------------------------
    const candidateRows = await writer.listCandidates({ now: now(), sourceIds: options.sourceIds });

    // Seed/demo rows point at in-app relative links; they are parked without ever being fetched.
    const seedUpdates: AttachmentRowUpdate[] = [];
    const repairable: AttachmentRepairRow[] = [];
    for (const row of candidateRows) {
      if (isRepairableAttachmentUrl(attachmentSourceUrl(row))) {
        repairable.push(row);
        continue;
      }
      unavailable += 1;
      countKind("unavailable");
      seedUpdates.push({
        id: row.id,
        archiveStatus: "unavailable",
        failureKind: "unavailable",
        repairAttempts: row.repairAttempts,
        nextRepairAt: now().toISOString(),
        archiveError: "Attachment URL is not a public http(s) link; nothing to download.",
      });
    }

    if (seedUpdates.length > 0) {
      await writer.apply({ updates: seedUpdates });
    }

    // ---- 3. Per-source download + write-back ---------------------------------------------
    const groups = new Map<string, AttachmentRepairRow[]>();
    for (const row of repairable) {
      const key = sourceKey(row);
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }

    for (const [key, rows] of groups) {
      const policy = policyForRow(rows[0]);
      const summary: AttachmentRepairSourceResult = {
        sourceId: key,
        status: "success",
        attempted: 0,
        repaired: 0,
        failed: 0,
        unavailable: 0,
      };

      if (!policy.archive) {
        // Archiving is switched off for this source: rows are left untouched, never marked.
        summary.status = "skipped";
        skipped += rows.length;
        bySource.push(summary);
        continue;
      }

      const limit = Math.max(1, Math.min(policy.maxPerRun, maxPerSourceOverride ?? policy.maxPerRun));
      const batch = rows.slice(0, limit);
      skipped += rows.length - batch.length;

      const request: ArchiveAttachmentsRequest = {
        archive_root: archiveRoot,
        browser_downloader_url: browserDownloaderUrl,
        source: {
          id: key,
          label: rows[0].sourceLabel ?? rows[0].bidSource,
          mode: policy.mode,
          min_interval_seconds: policy.minIntervalSeconds,
          timeout_seconds: policy.timeoutSeconds,
          max_bytes: policy.maxBytes,
          browser_link_selector: policy.browserLinkSelector,
        },
        items: batch.map((row) => ({
          id: row.id,
          bid_id: row.bidId,
          bid_source: row.bidSource,
          source_bid_id: row.bidSourceBidId,
          page_url: row.bidSourceUrl,
          url: attachmentSourceUrl(row),
          name: row.name,
          expected_extension: expectedExtension(row.name),
        })),
      };

      let outcome;
      try {
        outcome = await withAttachmentLease(
          {
            database: options.database,
            mysql: options.mysql,
            sourceId: key,
            owner: options.owner,
            now,
          },
          async () => runner(request),
        );
      } catch (error) {
        // A downloader crash leaves this source's rows untouched: no partial write-back, no
        // attempt counted against them, and the run as a whole is reported as a failure.
        summary.status = "failure";
        summary.error = error instanceof Error ? error.message : String(error);
        skipped += batch.length;
        status = "failure";
        errorCode = errorCode ?? (error instanceof Error ? error.name : "AttachmentRepairError");
        errorMessage = errorMessage ?? summary.error;
        bySource.push(summary);
        continue;
      }

      if (outcome.status === "locked") {
        summary.status = "locked";
        summary.error = outcome.lockedBy ? `Locked by ${outcome.lockedBy}` : "Locked by another worker";
        skipped += batch.length;
        bySource.push(summary);
        continue;
      }

      const response = outcome.value;
      const resultsById = new Map(response.results.map((result) => [result.id, result]));
      const updates: AttachmentRowUpdate[] = [];

      for (const row of batch) {
        const result = resultsById.get(row.id);
        if (!result) {
          // The downloader silently dropped the item; treat it as one failed attempt.
          const dropped = resolveRepairOutcome({
            row,
            archiveStatus: "failed",
            failureKind: "network",
            now: now(),
          });
          countKind(dropped.failureKind);
          summary.attempted += 1;
          summary.failed += 1;
          failed += 1;
          updates.push({
            id: row.id,
            archiveStatus: dropped.archiveStatus,
            failureKind: dropped.failureKind,
            repairAttempts: dropped.repairAttempts,
            nextRepairAt: dropped.nextRepairAt,
            archiveError: "archive-attachments returned no result for this attachment.",
            verifiedAt: null,
          });
          continue;
        }

        summary.attempted += 1;
        const resolved = resolveRepairOutcome({
          row,
          archiveStatus: result.archive_status,
          failureKind: result.failure_kind,
          now: now(),
        });
        countKind(resolved.failureKind);

        if (resolved.archiveStatus === "archived") {
          summary.repaired += 1;
          repaired += 1;
          updates.push({
            id: row.id,
            archiveStatus: "archived",
            storagePath: result.storage_path,
            byteSize: result.byte_size,
            contentType: result.content_type,
            checksumSha256: result.checksum_sha256,
            fetchedAt: result.fetched_at ?? now().toISOString(),
            archiveError: null,
            failureKind: null,
            repairAttempts: 0,
            nextRepairAt: null,
            verifiedAt: now().toISOString(),
          });
          continue;
        }

        if (resolved.archiveStatus === "unavailable") {
          summary.unavailable += 1;
          unavailable += 1;
        } else {
          summary.failed += 1;
          failed += 1;
        }

        updates.push({
          id: row.id,
          archiveStatus: resolved.archiveStatus,
          failureKind: resolved.failureKind,
          repairAttempts: resolved.repairAttempts,
          nextRepairAt: resolved.nextRepairAt,
          archiveError: result.archive_error,
          verifiedAt: null,
        });
      }

      await writer.apply({ updates });
      bySource.push(summary);
    }

    for (const source of bySource) {
      if (source.status === "failure") status = "failure";
    }
  } catch (error) {
    status = "failure";
    errorCode = error instanceof Error ? error.name : "AttachmentRepairError";
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const finishedAtDate = now();
  const finishedAt = finishedAtDate.toISOString();
  const candidates = bySource.reduce((total, source) => total + source.attempted, 0) + unavailable + skipped;

  const log: AttachmentRepairLogRow = {
    id: randomUUID(),
    runId,
    status,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAtDate.getTime() - startedAtDate.getTime()),
    fetchedCount: candidates,
    insertedCount: repaired,
    updatedCount: metadataFixed,
    skippedCount: skipped,
    failedCount: failed,
    errorCode,
    errorMessage,
    metadata: JSON.stringify({ verified, unavailable, byKind, bySource }),
  };

  try {
    await writer.apply({ log });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "attachment_repair_log_failed",
        source: ATTACHMENT_REPAIR_LOG_SOURCE,
        runId,
        error: String(error),
      }),
    );
  }

  return {
    runId,
    startedAt,
    finishedAt,
    status,
    candidates,
    verified,
    repaired,
    metadataFixed,
    failed,
    unavailable,
    skipped,
    bySource,
    byKind,
  };
}
