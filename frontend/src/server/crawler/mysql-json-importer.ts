import { mysqlExecute, mysqlSelectOne } from "@/server/db/mysql-runtime";

interface MysqlCrawlerImportStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export interface CrawlerJsonImportResult {
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  logCount: number;
}

type JsonRecord = Record<string, unknown>;

export interface CrawlerJsonRunPayload {
  source: string;
  runId: string;
  status: "success" | "failure";
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  metadata?: JsonRecord | null;
  bids?: JsonRecord[];
  errorCode?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
}

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
  // Additive: appended at the end so existing positional column/value indices are unaffected.
  // Absent from payloads that don't carry them (e.g. SAM.gov) — valueByColumn below reads
  // those as null via optionalString, same as every other optional bid field.
  "jurisdiction_level",
  "jurisdiction_name",
  "fips_code",
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
  return stringValue(row.id, `${stringValue(row.source, "crawler")}:${stringValue(row.source_bid_id ?? row.dedupe_key, "unknown")}`);
}

function valueByColumn(row: JsonRecord, column: typeof bidColumns[number], fallbackTimestamp: string) {
  if (column === "id") return normalizedBidId(row);
  if (column === "source") return stringValue(row.source);
  if (column === "source_bid_id") return optionalString(row.source_bid_id);
  if (column === "dedupe_key") return stringValue(row.dedupe_key);
  if (column === "title") return stringValue(row.title, "Untitled opportunity");
  if (column === "description") return stringValue(row.description, "");
  if (column === "full_description") return optionalString(row.full_description);
  if (column === "original_category") return optionalString(row.original_category);
  if (column === "amount") return optionalString(row.amount);
  if (column === "amount_min") return optionalNumber(row.amount_min);
  if (column === "amount_max") return optionalNumber(row.amount_max);
  if (column === "currency") return stringValue(row.currency, "USD");
  if (column === "published_date") return optionalString(row.published_date);
  if (column === "deadline_date") return optionalString(row.deadline_date);
  if (column === "issuer_name") return stringValue(row.issuer_name, "Unknown issuer");
  if (column === "issuer_type") return stringValue(row.issuer_type, "state");
  if (column === "state_code") return stringValue(row.state_code, "US");
  if (column === "contact_name") return optionalString(row.contact_name);
  if (column === "contact_email") return optionalString(row.contact_email);
  if (column === "contact_phone") return optionalString(row.contact_phone);
  if (column === "source_url") return stringValue(row.source_url);
  if (column === "is_active") return activeValue(row.is_active);
  if (column === "raw_payload") return jsonString(row.raw_payload, row);
  if (column === "source_confidence") return stringValue(row.source_confidence, "medium");
  if (column === "quality_flags_json") return jsonString(row.quality_flags_json, []);
  if (column === "admin_review_status") return stringValue(row.admin_review_status, "unreviewed");
  if (column === "detail_archive_status") return stringValue(row.detail_archive_status, "not_archived");
  if (column === "detail_archive_path") return optionalString(row.detail_archive_path);
  if (column === "detail_fetched_at") return optionalString(row.detail_fetched_at);
  if (column === "detail_checksum_sha256") return optionalString(row.detail_checksum_sha256);
  if (column === "detail_archive_error") return optionalString(row.detail_archive_error);
  if (column === "first_seen_at") return stringValue(row.first_seen_at, fallbackTimestamp);
  if (column === "last_seen_at") return stringValue(row.last_seen_at, fallbackTimestamp);
  if (column === "created_at") return stringValue(row.created_at, fallbackTimestamp);
  if (column === "updated_at") return stringValue(row.updated_at, fallbackTimestamp);
  if (column === "jurisdiction_level") return optionalString(row.jurisdiction_level);
  if (column === "jurisdiction_name") return optionalString(row.jurisdiction_name);
  return optionalString(row.fips_code);
}

async function mysqlExistingBidId(mysql: MysqlCrawlerImportStore, dedupeKey: unknown) {
  return mysqlSelectOne<{ id: string }>(mysql, "SELECT id FROM bids WHERE dedupe_key = ? LIMIT 1", [dedupeKey]);
}

async function upsertBid(mysql: MysqlCrawlerImportStore, row: JsonRecord, fallbackTimestamp: string) {
  const existing = await mysqlExistingBidId(mysql, row.dedupe_key);
  await mysqlExecute(
    mysql,
    `
      INSERT INTO bids (${bidColumns.join(", ")})
      VALUES (${bidColumns.map(() => "?").join(", ")})
      ON DUPLICATE KEY UPDATE
        ${bidUpdateColumns.map((column) => `${column} = VALUES(${column})`).join(", ")}
    `,
    bidColumns.map((column) => valueByColumn(row, column, fallbackTimestamp)),
  );

  return {
    id: existing?.id ?? normalizedBidId(row),
    status: existing ? "updated" as const : "inserted" as const,
  };
}

function attachmentRowsForBid(row: JsonRecord, mysqlBidId: string, fallbackTimestamp: string) {
  const attachments = Array.isArray(row.attachments) ? row.attachments as JsonRecord[] : [];
  return attachments.map((attachment, index) => ({
    id: stringValue(attachment.id, `${mysqlBidId}:attachment:${index + 1}`),
    bid_id: mysqlBidId,
    name: stringValue(attachment.name, `Attachment ${index + 1}`),
    url: stringValue(attachment.url),
    original_url: optionalString(attachment.original_url),
    storage_path: optionalString(attachment.storage_path),
    byte_size: optionalNumber(attachment.byte_size),
    content_type: optionalString(attachment.content_type),
    checksum_sha256: optionalString(attachment.checksum_sha256),
    fetched_at: optionalString(attachment.fetched_at),
    archive_status: stringValue(attachment.archive_status, "not_archived"),
    archive_error: optionalString(attachment.archive_error),
    size_label: optionalString(attachment.size_label),
    mime_type: optionalString(attachment.mime_type),
    sort_order: optionalNumber(attachment.sort_order) ?? index,
    created_at: stringValue(attachment.created_at, fallbackTimestamp),
  }));
}

async function replaceAttachments(mysql: MysqlCrawlerImportStore, bidRows: JsonRecord[], bidIdByPayloadId: Map<string, string>, fallbackTimestamp: string) {
  for (const row of bidRows) {
    const payloadBidId = stringValue(row.id);
    const mysqlBidId = bidIdByPayloadId.get(payloadBidId) ?? payloadBidId;
    await mysqlExecute(mysql, "DELETE FROM bid_attachments WHERE bid_id = ?", [mysqlBidId]);

    for (const attachment of attachmentRowsForBid(row, mysqlBidId, fallbackTimestamp)) {
      await mysqlExecute(
        mysql,
        `
          INSERT INTO bid_attachments (${attachmentColumns.join(", ")})
          VALUES (${attachmentColumns.map(() => "?").join(", ")})
        `,
        attachmentColumns.map((column) => attachment[column]),
      );
    }
  }
}

async function insertCrawlerLog(
  mysql: MysqlCrawlerImportStore,
  payload: CrawlerJsonRunPayload,
  counts: Pick<CrawlerJsonImportResult, "fetchedCount" | "insertedCount" | "updatedCount">,
) {
  const row: Record<typeof crawlerLogColumns[number], unknown> = {
    id: `${payload.runId}:log`,
    source: payload.source,
    run_id: payload.runId,
    status: payload.status,
    started_at: payload.startedAt,
    finished_at: payload.finishedAt ?? null,
    duration_ms: payload.durationMs ?? null,
    fetched_count: counts.fetchedCount,
    inserted_count: counts.insertedCount,
    updated_count: counts.updatedCount,
    skipped_count: 0,
    failed_count: payload.status === "failure" ? 1 : 0,
    error_code: payload.errorCode ?? null,
    error_message: payload.errorMessage ?? null,
    error_stack: payload.errorStack ?? null,
    metadata: jsonString(payload.metadata, {}),
  };

  await mysqlExecute(
    mysql,
    `
      INSERT INTO crawler_logs (${crawlerLogColumns.join(", ")})
      VALUES (${crawlerLogColumns.map(() => "?").join(", ")})
    `,
    crawlerLogColumns.map((column) => row[column]),
  );
}

export async function importCrawlerJsonRunIntoMysql(
  mysql: MysqlCrawlerImportStore,
  payload: CrawlerJsonRunPayload,
): Promise<CrawlerJsonImportResult> {
  const bidRows = payload.bids ?? [];

  if (payload.status === "success" && bidRows.length === 0) {
    throw new Error("Crawler MySQL JSON import refused a successful run with no bid rows.");
  }

  const bidIdByPayloadId = new Map<string, string>();
  let insertedCount = 0;
  let updatedCount = 0;

  for (const row of bidRows) {
    const result = await upsertBid(mysql, row, payload.startedAt);
    bidIdByPayloadId.set(stringValue(row.id), result.id);
    if (result.status === "inserted") insertedCount += 1;
    if (result.status === "updated") updatedCount += 1;
  }

  await replaceAttachments(mysql, bidRows, bidIdByPayloadId, payload.startedAt);
  await insertCrawlerLog(mysql, payload, {
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
