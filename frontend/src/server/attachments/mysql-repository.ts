/**
 * MySQL twin of `repository.ts` — hand-written SQL, same function shapes.
 *
 * The Drizzle `db` export is a throwing Proxy under MySQL, so nothing in this module may touch it.
 */

import { expandMysqlInClause, mysqlSelectMany, mysqlTransaction } from "@/server/db/mysql-runtime";
import { UNAVAILABLE_RETRY_MS } from "./anomaly";
import { dedupeAttachmentRows, type ListAttachmentRepairCandidatesOptions, type ListAttachmentsForVerificationOptions } from "./repository";
import {
  ATTACHMENT_REPAIR_LOG_SOURCE,
  ATTACHMENT_UPDATE_COLUMNS,
  type AttachmentRepairLogRow,
  type AttachmentRepairRow,
  type AttachmentRowUpdate,
} from "./types";

export const DEFAULT_CANDIDATE_LIMIT = 5000;
export const DEFAULT_VERIFY_LIMIT = 2000;

export interface MysqlAttachmentConnection {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export interface MysqlAttachmentStore extends MysqlAttachmentConnection {
  getConnection?: () => Promise<
    MysqlAttachmentConnection & {
      beginTransaction: () => Promise<void>;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
      release: () => void;
    }
  >;
}

const SELECT_COLUMNS = `
        a.id AS id,
        a.bid_id AS bidId,
        a.name AS name,
        a.url AS url,
        a.original_url AS originalUrl,
        a.storage_path AS storagePath,
        a.byte_size AS byteSize,
        a.content_type AS contentType,
        a.checksum_sha256 AS checksumSha256,
        a.archive_status AS archiveStatus,
        a.archive_error AS archiveError,
        a.failure_kind AS failureKind,
        a.repair_attempts AS repairAttempts,
        a.next_repair_at AS nextRepairAt,
        a.verified_at AS verifiedAt,
        b.source AS bidSource,
        b.source_url AS bidSourceUrl,
        b.source_bid_id AS bidSourceBidId,
        d.id AS sourceId,
        d.label AS sourceLabel,
        d.fetch_config AS fetchConfig`;

const FROM_CLAUSE = `
      FROM bid_attachments a
      INNER JOIN bids b ON b.id = a.bid_id
      LEFT JOIN data_sources d ON d.id = b.source OR d.label = b.source`;

type RawMysqlRow = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function normalizeRow(row: RawMysqlRow): AttachmentRepairRow {
  return {
    id: String(row.id),
    bidId: String(row.bidId),
    name: String(row.name ?? ""),
    url: String(row.url ?? ""),
    originalUrl: text(row.originalUrl),
    storagePath: text(row.storagePath),
    byteSize: row.byteSize === null || row.byteSize === undefined ? null : Number(row.byteSize),
    contentType: text(row.contentType),
    checksumSha256: text(row.checksumSha256),
    archiveStatus: String(row.archiveStatus ?? "not_archived"),
    archiveError: text(row.archiveError),
    failureKind: text(row.failureKind),
    repairAttempts: Number(row.repairAttempts ?? 0),
    nextRepairAt: text(row.nextRepairAt),
    verifiedAt: text(row.verifiedAt),
    bidSource: String(row.bidSource ?? ""),
    bidSourceUrl: String(row.bidSourceUrl ?? ""),
    bidSourceBidId: text(row.bidSourceBidId),
    sourceId: text(row.sourceId),
    sourceLabel: text(row.sourceLabel),
    fetchConfig: text(row.fetchConfig),
  };
}

function sourceFilterClause(sourceIds: string[] | undefined) {
  if (!sourceIds?.length) return { clause: "", values: [] as unknown[] };
  const { placeholders, values } = expandMysqlInClause(sourceIds);
  return {
    clause: ` AND (b.source IN (${placeholders}) OR d.id IN (${placeholders}))`,
    values: [...values, ...values],
  };
}

export async function listAttachmentRepairCandidatesFromMysql(
  mysql: MysqlAttachmentConnection,
  options: ListAttachmentRepairCandidatesOptions,
): Promise<AttachmentRepairRow[]> {
  const nowIso = options.now.toISOString();
  const reeligibleBefore = new Date(options.now.getTime() - UNAVAILABLE_RETRY_MS).toISOString();
  const filter = sourceFilterClause(options.sourceIds);

  const rows = await mysqlSelectMany<RawMysqlRow>(
    mysql,
    `
      SELECT${SELECT_COLUMNS}${FROM_CLAUSE}
      WHERE (
        (a.archive_status IN ('not_archived', 'failed') AND (a.next_repair_at IS NULL OR a.next_repair_at <= ?))
        OR (a.archive_status = 'unavailable' AND a.next_repair_at IS NOT NULL AND a.next_repair_at <= ?)
      )${filter.clause}
      ORDER BY b.source ASC, CASE WHEN a.failure_kind IN ('archive_missing', 'archive_corrupt') THEN 0 WHEN a.archive_status = 'not_archived' THEN 1 ELSE 2 END ASC, a.id ASC
      LIMIT ${Math.max(1, Math.trunc(options.limit ?? DEFAULT_CANDIDATE_LIMIT))}
    `,
    [nowIso, reeligibleBefore, ...filter.values],
  );

  return dedupeAttachmentRows(rows.map(normalizeRow));
}

export async function listAttachmentsForVerificationFromMysql(
  mysql: MysqlAttachmentConnection,
  options: ListAttachmentsForVerificationOptions,
): Promise<AttachmentRepairRow[]> {
  const cutoff = options.verifyBefore.toISOString();
  const filter = sourceFilterClause(options.sourceIds);

  const rows = await mysqlSelectMany<RawMysqlRow>(
    mysql,
    `
      SELECT${SELECT_COLUMNS}${FROM_CLAUSE}
      WHERE a.archive_status = 'archived'
        AND (a.verified_at IS NULL OR a.verified_at <= ?)${filter.clause}
      ORDER BY b.source ASC, a.id ASC
      LIMIT ${Math.max(1, Math.trunc(options.limit ?? DEFAULT_VERIFY_LIMIT))}
    `,
    [cutoff, ...filter.values],
  );

  return dedupeAttachmentRows(rows.map(normalizeRow));
}

export function attachmentUpdateStatement(update: AttachmentRowUpdate): { sql: string; values: unknown[] } | null {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of ATTACHMENT_UPDATE_COLUMNS) {
    if (key === "id") continue;
    const value = update[key];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }

  if (assignments.length === 0) return null;
  values.push(update.id);

  return { sql: `UPDATE bid_attachments SET ${assignments.join(", ")} WHERE id = ?`, values };
}

const LOG_COLUMNS = [
  "id",
  "source",
  "run_id",
  "status",
  "started_at",
  "finished_at",
  "duration_ms",
  "fetched_count",
  "inserted_count",
  "updated_count",
  "skipped_count",
  "failed_count",
  "error_code",
  "error_message",
  "metadata",
] as const;

export function attachmentRepairLogStatement(log: AttachmentRepairLogRow): { sql: string; values: unknown[] } {
  return {
    sql: `INSERT INTO crawler_logs (${LOG_COLUMNS.join(", ")}) VALUES (${LOG_COLUMNS.map(() => "?").join(", ")})`,
    values: [
      log.id,
      ATTACHMENT_REPAIR_LOG_SOURCE,
      log.runId,
      log.status,
      log.startedAt,
      log.finishedAt,
      log.durationMs,
      log.fetchedCount,
      log.insertedCount,
      log.updatedCount,
      log.skippedCount,
      log.failedCount,
      log.errorCode,
      log.errorMessage,
      log.metadata,
    ],
  };
}

export interface ApplyAttachmentRepairWriteInput {
  updates?: AttachmentRowUpdate[];
  log?: AttachmentRepairLogRow;
}

/** Same contract as the SQLite writer: one transaction on a single connection. */
export async function applyAttachmentRepairWritesToMysql(
  mysql: MysqlAttachmentStore,
  input: ApplyAttachmentRepairWriteInput,
): Promise<number> {
  const updates = input.updates ?? [];
  if (updates.length === 0 && !input.log) return 0;

  const run = async (connection: MysqlAttachmentConnection) => {
    for (const update of updates) {
      const statement = attachmentUpdateStatement(update);
      if (!statement) continue;
      await connection.query(statement.sql, statement.values);
    }
    if (input.log) {
      const statement = attachmentRepairLogStatement(input.log);
      await connection.query(statement.sql, statement.values);
    }
    return updates.length;
  };

  if (typeof mysql.getConnection !== "function") {
    throw new Error("Attachment repair MySQL writes require a transaction-capable pool.");
  }

  return mysqlTransaction(
    mysql as unknown as Parameters<typeof mysqlTransaction>[0],
    (connection) => run(connection as unknown as MysqlAttachmentConnection),
  );
}
