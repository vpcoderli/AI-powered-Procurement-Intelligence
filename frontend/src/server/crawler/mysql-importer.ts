import Database from "better-sqlite3";
import { mysqlExecute, mysqlSelectOne } from "@/server/db/mysql-runtime";

interface MysqlCrawlerImportStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface CrawlerImportResult {
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  logCount: number;
}

type SqliteRow = Record<string, unknown>;

const bidColumns = [
  "id",
  "source",
  "source_bid_id",
  "dedupe_key",
  "title",
  "description",
  "full_description",
  "original_category",
  "amount",
  "amount_min",
  "amount_max",
  "currency",
  "published_date",
  "deadline_date",
  "issuer_name",
  "issuer_type",
  "state_code",
  "contact_name",
  "contact_email",
  "contact_phone",
  "source_url",
  "is_active",
  "raw_payload",
  "source_confidence",
  "quality_flags_json",
  "admin_review_status",
  "detail_archive_status",
  "detail_archive_path",
  "detail_fetched_at",
  "detail_checksum_sha256",
  "detail_archive_error",
  "first_seen_at",
  "last_seen_at",
  "created_at",
  "updated_at",
] as const;

const bidUpdateColumns = bidColumns.filter((column) =>
  column !== "id" &&
  column !== "source" &&
  column !== "dedupe_key" &&
  column !== "first_seen_at" &&
  column !== "created_at"
);

const attachmentColumns = [
  "id",
  "bid_id",
  "name",
  "url",
  "original_url",
  "storage_path",
  "byte_size",
  "content_type",
  "checksum_sha256",
  "fetched_at",
  "archive_status",
  "archive_error",
  "size_label",
  "mime_type",
  "sort_order",
  "created_at",
] as const;

const crawlerLogColumns = [
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
  "error_stack",
  "metadata",
] as const;

function sqliteRows(sqlite: Database.Database, tableName: string) {
  const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  if (!row) return [];
  return sqlite.prepare(`SELECT * FROM ${tableName}`).all() as SqliteRow[];
}

function value(row: SqliteRow, column: string) {
  return row[column] ?? null;
}

async function mysqlExistingBidId(mysql: MysqlCrawlerImportStore, dedupeKey: unknown) {
  return mysqlSelectOne<{ id: string }>(mysql, "SELECT id FROM bids WHERE dedupe_key = ? LIMIT 1", [dedupeKey]);
}

async function upsertBid(mysql: MysqlCrawlerImportStore, row: SqliteRow) {
  const existing = await mysqlExistingBidId(mysql, row.dedupe_key);
  await mysqlExecute(
    mysql,
    `
      INSERT INTO bids (${bidColumns.join(", ")})
      VALUES (${bidColumns.map(() => "?").join(", ")})
      ON DUPLICATE KEY UPDATE
        ${bidUpdateColumns.map((column) => `${column} = VALUES(${column})`).join(", ")}
    `,
    bidColumns.map((column) => value(row, column)),
  );

  return {
    id: existing?.id ?? String(row.id),
    status: existing ? "updated" as const : "inserted" as const,
  };
}

async function replaceAttachments(mysql: MysqlCrawlerImportStore, rows: SqliteRow[], bidIdBySqliteId: Map<string, string>) {
  const rowsByBid = new Map<string, SqliteRow[]>();
  for (const row of rows) {
    const sqliteBidId = String(row.bid_id);
    const mysqlBidId = bidIdBySqliteId.get(sqliteBidId) ?? sqliteBidId;
    rowsByBid.set(mysqlBidId, [...(rowsByBid.get(mysqlBidId) ?? []), row]);
  }

  for (const [mysqlBidId, attachmentRows] of rowsByBid) {
    await mysqlExecute(mysql, "DELETE FROM bid_attachments WHERE bid_id = ?", [mysqlBidId]);
    for (const row of attachmentRows) {
      await mysqlExecute(
        mysql,
        `
          INSERT INTO bid_attachments (${attachmentColumns.join(", ")})
          VALUES (${attachmentColumns.map(() => "?").join(", ")})
        `,
        attachmentColumns.map((column) => column === "bid_id" ? mysqlBidId : value(row, column)),
      );
    }
  }
}

async function insertCrawlerLogs(
  mysql: MysqlCrawlerImportStore,
  rows: SqliteRow[],
  counts: Pick<CrawlerImportResult, "fetchedCount" | "insertedCount" | "updatedCount">,
) {
  for (const row of rows) {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO crawler_logs (${crawlerLogColumns.join(", ")})
        VALUES (${crawlerLogColumns.map(() => "?").join(", ")})
      `,
      crawlerLogColumns.map((column) => {
        if (column === "fetched_count") return counts.fetchedCount;
        if (column === "inserted_count") return counts.insertedCount;
        if (column === "updated_count") return counts.updatedCount;
        return value(row, column);
      }),
    );
  }
}

export async function importCrawlerSqliteRunIntoMysql(
  mysql: MysqlCrawlerImportStore,
  databasePath: string,
): Promise<CrawlerImportResult> {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });

  try {
    const bidRows = sqliteRows(sqlite, "bids");
    const attachmentRows = sqliteRows(sqlite, "bid_attachments");
    const logRows = sqliteRows(sqlite, "crawler_logs");
    const hasSuccessfulLog = logRows.some((row) => row.status === "success");

    if (hasSuccessfulLog && bidRows.length === 0) {
      throw new Error("Crawler MySQL import refused a successful run with no bid rows.");
    }

    const bidIdBySqliteId = new Map<string, string>();
    let insertedCount = 0;
    let updatedCount = 0;

    for (const row of bidRows) {
      const result = await upsertBid(mysql, row);
      bidIdBySqliteId.set(String(row.id), result.id);
      if (result.status === "inserted") insertedCount += 1;
      if (result.status === "updated") updatedCount += 1;
    }

    await replaceAttachments(mysql, attachmentRows, bidIdBySqliteId);
    await insertCrawlerLogs(mysql, logRows, {
      fetchedCount: bidRows.length,
      insertedCount,
      updatedCount,
    });

    return {
      fetchedCount: bidRows.length,
      insertedCount,
      updatedCount,
      logCount: logRows.length,
    };
  } finally {
    sqlite.close();
  }
}
