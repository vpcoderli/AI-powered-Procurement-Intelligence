import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids, savedBids, users } from "@/server/db/schema";
import { attachmentDownloadUrl } from "./attachments";
import type { Bid } from "./domain";

function nowIso() {
  return new Date().toISOString();
}

function isPresent(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }

  return value;
}

function parseStringArrayJson(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return stringArray(parsed) ?? [];
  } catch {
    return [];
  }
}

function tagsFromBid(row: typeof bids.$inferSelect) {
  if (row.rawPayload) {
    try {
      const parsed: unknown = JSON.parse(row.rawPayload);
      if (typeof parsed === "object" && parsed !== null && "tags" in parsed) {
        const tags = stringArray(parsed.tags);
        if (tags) return tags;
      }
    } catch {
      // Fall back to derived tags for imported rows with non-JSON payloads.
    }
  }

  return [row.originalCategory, row.stateCode, row.issuerType].filter(isPresent);
}

function attachmentsForBids(db: AppDatabase, bidIds: string[]) {
  if (bidIds.length === 0) return new Map<string, Bid["attachments"]>();

  const rows = db
    .select()
    .from(bidAttachments)
    .where(inArray(bidAttachments.bidId, bidIds))
    .orderBy(asc(bidAttachments.bidId), asc(bidAttachments.sortOrder))
    .all();

  const byBid = new Map<string, Bid["attachments"]>();
  rows.forEach((row) => {
    const current = byBid.get(row.bidId) ?? [];
    current.push({
      name: row.name,
      url: attachmentDownloadUrl(row.bidId, row.id),
      size: row.sizeLabel ?? "",
      originalUrl: row.originalUrl ?? row.url,
      archiveStatus: row.archiveStatus,
      storagePath: row.storagePath ?? "",
      byteSize: row.byteSize,
      contentType: row.contentType ?? row.mimeType ?? "",
      checksumSha256: row.checksumSha256 ?? "",
      fetchedAt: row.fetchedAt ?? "",
      archiveError: row.archiveError ?? "",
    });
    byBid.set(row.bidId, current);
  });

  return byBid;
}

interface MysqlBidRow {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  issuerName: string;
  issuerType: string;
  stateCode: string;
  originalCategory: string | null;
  description: string;
  fullDescription: string | null;
  amount: string | null;
  publishedDate: string | null;
  deadlineDate: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  rawPayload: string | null;
  sourceConfidence: string;
  qualityFlagsJson: string | null;
  adminReviewStatus: string;
  detailArchiveStatus: string;
  detailArchivePath: string | null;
  detailFetchedAt: string | null;
  detailChecksumSha256: string | null;
  detailArchiveError: string | null;
  isActive: number;
  updatedAt: string;
}

interface MysqlAttachmentRow {
  id: string;
  bidId: string;
  name: string;
  url: string;
  originalUrl: string | null;
  storagePath: string | null;
  byteSize: number | null;
  contentType: string | null;
  checksumSha256: string | null;
  fetchedAt: string | null;
  archiveStatus: string;
  archiveError: string | null;
  sizeLabel: string | null;
  mimeType: string | null;
  sortOrder: number;
}

export interface MysqlBidsReader {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<[MysqlBidRow[] | MysqlAttachmentRow[]] | [MysqlBidRow[] | MysqlAttachmentRow[], unknown]>;
}

async function executeMysqlBidsWrite(mysql: MysqlBidsReader, sql: string, values: unknown[] = []) {
  const executable = mysql as MysqlBidsReader & {
    execute?: (sql: string, values?: unknown[]) => Promise<unknown>;
  };

  if (executable.execute) {
    await executable.execute(sql, values);
    return;
  }

  await mysql.query(sql, values);
}

function tagsFromMysqlBid(row: MysqlBidRow) {
  if (row.rawPayload) {
    try {
      const parsed: unknown = JSON.parse(row.rawPayload);
      if (typeof parsed === "object" && parsed !== null && "tags" in parsed) {
        const tags = stringArray((parsed as { tags?: unknown }).tags);
        if (tags) return tags;
      }
    } catch {
      // Fall back to derived tags for imported rows with non-JSON payloads.
    }
  }

  return [row.originalCategory, row.stateCode, row.issuerType].filter(isPresent);
}

function attachmentsFromMysqlRows(rows: MysqlAttachmentRow[]) {
  const byBid = new Map<string, Bid["attachments"]>();

  for (const row of rows) {
    const current = byBid.get(row.bidId) ?? [];
    current.push({
      name: row.name,
      url: attachmentDownloadUrl(row.bidId, row.id),
      size: row.sizeLabel ?? "",
      originalUrl: row.originalUrl ?? row.url,
      archiveStatus: row.archiveStatus,
      storagePath: row.storagePath ?? "",
      byteSize: row.byteSize,
      contentType: row.contentType ?? row.mimeType ?? "",
      checksumSha256: row.checksumSha256 ?? "",
      fetchedAt: row.fetchedAt ?? "",
      archiveError: row.archiveError ?? "",
    });
    byBid.set(row.bidId, current);
  }

  return byBid;
}

function toBid(
  row: typeof bids.$inferSelect,
  attachments: Bid["attachments"],
  savedBidIds: Set<string>,
): Bid {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    sourceUrl: row.sourceUrl,
    issuerName: row.issuerName,
    issuerType: row.issuerType as Bid["issuerType"],
    stateCode: row.stateCode,
    originalCategory: row.originalCategory ?? "",
    description: row.description,
    fullDescription: row.fullDescription ?? "",
    amount: row.amount ?? "",
    publishedDate: row.publishedDate ?? "",
    deadlineDate: row.deadlineDate ?? "",
    contactName: row.contactName ?? "",
    contactEmail: row.contactEmail ?? "",
    contactPhone: row.contactPhone ?? "",
    attachments,
    tags: tagsFromBid(row),
    sourceConfidence: row.sourceConfidence,
    qualityFlags: parseStringArrayJson(row.qualityFlagsJson),
    adminReviewStatus: row.adminReviewStatus,
    detailArchiveStatus: row.detailArchiveStatus,
    detailArchivePath: row.detailArchivePath ?? "",
    detailFetchedAt: row.detailFetchedAt ?? "",
    detailChecksumSha256: row.detailChecksumSha256 ?? "",
    detailArchiveError: row.detailArchiveError ?? "",
    saved: savedBidIds.has(row.id),
    isActive: row.isActive === 1,
    updatedAt: row.updatedAt,
  };
}

function toBidFromMysql(
  row: MysqlBidRow,
  attachments: Bid["attachments"],
  savedBidIds: Set<string>,
): Bid {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    sourceUrl: row.sourceUrl,
    issuerName: row.issuerName,
    issuerType: row.issuerType as Bid["issuerType"],
    stateCode: row.stateCode,
    originalCategory: row.originalCategory ?? "",
    description: row.description,
    fullDescription: row.fullDescription ?? "",
    amount: row.amount ?? "",
    publishedDate: row.publishedDate ?? "",
    deadlineDate: row.deadlineDate ?? "",
    contactName: row.contactName ?? "",
    contactEmail: row.contactEmail ?? "",
    contactPhone: row.contactPhone ?? "",
    attachments,
    tags: tagsFromMysqlBid(row),
    sourceConfidence: row.sourceConfidence,
    qualityFlags: parseStringArrayJson(row.qualityFlagsJson),
    adminReviewStatus: row.adminReviewStatus,
    detailArchiveStatus: row.detailArchiveStatus,
    detailArchivePath: row.detailArchivePath ?? "",
    detailFetchedAt: row.detailFetchedAt ?? "",
    detailChecksumSha256: row.detailChecksumSha256 ?? "",
    detailArchiveError: row.detailArchiveError ?? "",
    saved: savedBidIds.has(row.id),
    isActive: row.isActive === 1,
    updatedAt: row.updatedAt,
  };
}

export async function ensureUser(db: AppDatabase, userId: string) {
  const timestamp = nowIso();

  db.insert(users)
    .values({
      id: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();
}

export async function ensureUserFromMysql(mysql: MysqlBidsReader, userId: string) {
  const timestamp = nowIso();
  const sql = `
    INSERT INTO users (id, role, account_tier, is_disabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE id = id
  `;
  const values = [userId, "user", "free", 0, timestamp, timestamp];

  await executeMysqlBidsWrite(mysql, sql, values);
}

export async function listBids(db: AppDatabase, savedBidIds: string[] = []) {
  const rows = db.select().from(bids).where(ne(bids.displayStatus, "suppressed")).orderBy(asc(bids.id)).all();
  const attachmentMap = attachmentsForBids(
    db,
    rows.map((row) => row.id),
  );
  const savedSet = new Set(savedBidIds);

  return rows.map((row) => toBid(row, attachmentMap.get(row.id) ?? [], savedSet));
}

export async function listBidsFromMysql(mysql: MysqlBidsReader, savedBidIds: string[] = []) {
  const [bidRows] = await mysql.query(`
    SELECT
      id,
      title,
      source,
      source_url AS sourceUrl,
      issuer_name AS issuerName,
      issuer_type AS issuerType,
      state_code AS stateCode,
      original_category AS originalCategory,
      description,
      full_description AS fullDescription,
      amount,
      published_date AS publishedDate,
      deadline_date AS deadlineDate,
      contact_name AS contactName,
      contact_email AS contactEmail,
      contact_phone AS contactPhone,
      raw_payload AS rawPayload,
      source_confidence AS sourceConfidence,
      quality_flags_json AS qualityFlagsJson,
      admin_review_status AS adminReviewStatus,
      detail_archive_status AS detailArchiveStatus,
      detail_archive_path AS detailArchivePath,
      detail_fetched_at AS detailFetchedAt,
      detail_checksum_sha256 AS detailChecksumSha256,
      detail_archive_error AS detailArchiveError,
      is_active AS isActive,
      updated_at AS updatedAt
    FROM bids
    WHERE display_status <> 'suppressed'
    ORDER BY id ASC
  `);
  const typedBidRows = bidRows as MysqlBidRow[];
  const bidIds = typedBidRows.map((row) => row.id);
  const savedSet = new Set(savedBidIds);

  if (bidIds.length === 0) {
    return [];
  }

  const placeholders = bidIds.map(() => "?").join(", ");
  const [attachmentRows] = await mysql.query(
    `
      SELECT
        id,
        bid_id AS bidId,
        name,
        url,
        original_url AS originalUrl,
        storage_path AS storagePath,
        byte_size AS byteSize,
        content_type AS contentType,
        checksum_sha256 AS checksumSha256,
        fetched_at AS fetchedAt,
        archive_status AS archiveStatus,
        archive_error AS archiveError,
        size_label AS sizeLabel,
        mime_type AS mimeType,
        sort_order AS sortOrder
      FROM bid_attachments
      WHERE bid_id IN (${placeholders})
      ORDER BY bid_id ASC, sort_order ASC
    `,
    bidIds,
  );
  const attachmentMap = attachmentsFromMysqlRows(attachmentRows as MysqlAttachmentRow[]);

  return typedBidRows.map((row) => toBidFromMysql(row, attachmentMap.get(row.id) ?? [], savedSet));
}

export async function getBidByIdFromRepository(db: AppDatabase, id: string) {
  const row = db
    .select()
    .from(bids)
    .where(and(eq(bids.id, id), ne(bids.displayStatus, "suppressed")))
    .limit(1)
    .get();
  if (!row) return undefined;

  const attachmentMap = attachmentsForBids(db, [id]);
  return toBid(row, attachmentMap.get(id) ?? [], new Set());
}

export async function getBidByIdFromMysql(mysql: MysqlBidsReader, id: string) {
  const [bidRows] = await mysql.query(
    `
      SELECT
        id,
        title,
        source,
        source_url AS sourceUrl,
        issuer_name AS issuerName,
        issuer_type AS issuerType,
        state_code AS stateCode,
        original_category AS originalCategory,
        description,
        full_description AS fullDescription,
        amount,
        published_date AS publishedDate,
        deadline_date AS deadlineDate,
        contact_name AS contactName,
        contact_email AS contactEmail,
        contact_phone AS contactPhone,
        raw_payload AS rawPayload,
        source_confidence AS sourceConfidence,
        quality_flags_json AS qualityFlagsJson,
        admin_review_status AS adminReviewStatus,
        detail_archive_status AS detailArchiveStatus,
        detail_archive_path AS detailArchivePath,
        detail_fetched_at AS detailFetchedAt,
        detail_checksum_sha256 AS detailChecksumSha256,
        detail_archive_error AS detailArchiveError,
        is_active AS isActive,
        updated_at AS updatedAt
      FROM bids
      WHERE id = ? AND display_status <> 'suppressed'
      LIMIT 1
    `,
    [id],
  );
  const row = (bidRows as MysqlBidRow[])[0];
  if (!row) return undefined;

  const [attachmentRows] = await mysql.query(
    `
      SELECT
        id,
        bid_id AS bidId,
        name,
        url,
        original_url AS originalUrl,
        storage_path AS storagePath,
        byte_size AS byteSize,
        content_type AS contentType,
        checksum_sha256 AS checksumSha256,
        fetched_at AS fetchedAt,
        archive_status AS archiveStatus,
        archive_error AS archiveError,
        size_label AS sizeLabel,
        mime_type AS mimeType,
        sort_order AS sortOrder
      FROM bid_attachments
      WHERE bid_id = ?
      ORDER BY sort_order ASC
    `,
    [id],
  );
  const attachmentMap = attachmentsFromMysqlRows(attachmentRows as MysqlAttachmentRow[]);

  return toBidFromMysql(row, attachmentMap.get(row.id) ?? [], new Set());
}

function scopedUserIds(userId: string, scopeUserIds?: string[]) {
  return scopeUserIds && scopeUserIds.length > 0 ? scopeUserIds : [userId];
}

export async function listSavedBidIds(db: AppDatabase, userId: string, scopeUserIds?: string[]) {
  await ensureUser(db, userId);
  const userIds = scopedUserIds(userId, scopeUserIds);

  const rows = db
    .select({ bidId: savedBids.bidId })
    .from(savedBids)
    .where(inArray(savedBids.userId, userIds))
    .orderBy(asc(savedBids.createdAt), asc(savedBids.bidId))
    .all();

  return [...new Set(rows.map((row) => row.bidId))];
}

export async function saveSavedBidId(
  db: AppDatabase,
  userId: string,
  bidId: string,
  scopeUserIds?: string[],
) {
  await ensureUser(db, userId);
  const userIds = scopedUserIds(userId, scopeUserIds);

  const existing = db
    .select()
    .from(savedBids)
    .where(and(inArray(savedBids.userId, userIds), eq(savedBids.bidId, bidId)))
    .limit(1)
    .get();

  if (existing) {
    return listSavedBidIds(db, userId, userIds);
  }

  db.insert(savedBids)
    .values({
      userId,
      bidId,
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
    .run();

  return listSavedBidIds(db, userId, userIds);
}

export async function removeSavedBidId(
  db: AppDatabase,
  userId: string,
  bidId: string,
  scopeUserIds?: string[],
) {
  const userIds = scopedUserIds(userId, scopeUserIds);

  db.delete(savedBids)
    .where(and(inArray(savedBids.userId, userIds), eq(savedBids.bidId, bidId)))
    .run();

  return listSavedBidIds(db, userId, userIds);
}

export async function mergeSavedBidIds(db: AppDatabase, fromUserId: string, toUserId: string) {
  await ensureUser(db, toUserId);

  if (fromUserId === toUserId) {
    return listSavedBidIds(db, toUserId);
  }

  const sourceRows = db
    .select({ bidId: savedBids.bidId })
    .from(savedBids)
    .where(eq(savedBids.userId, fromUserId))
    .orderBy(asc(savedBids.createdAt), asc(savedBids.bidId))
    .all();

  const mergeStartedAt = Date.now();

  sourceRows.forEach((row, index) => {
    db.insert(savedBids)
      .values({
        userId: toUserId,
        bidId: row.bidId,
        createdAt: new Date(mergeStartedAt + index + 1).toISOString(),
      })
      .onConflictDoNothing()
      .run();
  });

  return listSavedBidIds(db, toUserId);
}

export async function mergeSavedBidIdsFromMysql(mysql: MysqlBidsReader, fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) {
    return listSavedBidIdsFromMysql(mysql, toUserId);
  }

  const [sourceRows] = await mysql.query(
    "SELECT bid_id AS bidId, created_at AS createdAt FROM saved_bids WHERE user_id = ? ORDER BY created_at ASC, bid_id ASC",
    [fromUserId],
  );
  const mergeStartedAt = Date.now();

  for (const [index, row] of (sourceRows as Array<{ bidId: string }>).entries()) {
    const sql = `
      INSERT INTO saved_bids (user_id, bid_id, created_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE created_at = created_at
    `;
    const values = [toUserId, row.bidId, new Date(mergeStartedAt + index + 1).toISOString()];

    await executeMysqlBidsWrite(mysql, sql, values);
  }

  return listSavedBidIdsFromMysql(mysql, toUserId);
}

export async function listSavedBidIdsFromMysql(mysql: MysqlBidsReader, userId: string, scopeUserIds?: string[]) {
  await ensureUserFromMysql(mysql, userId);
  const userIds = scopedUserIds(userId, scopeUserIds);
  const placeholders = userIds.map(() => "?").join(", ");
  const [rows] = await mysql.query(
    `
      SELECT bid_id AS bidId
      FROM saved_bids
      WHERE user_id IN (${placeholders})
      ORDER BY created_at ASC, bid_id ASC
    `,
    userIds,
  );

  return [...new Set((rows as Array<{ bidId: string }>).map((row) => row.bidId))];
}

export async function saveSavedBidIdFromMysql(
  mysql: MysqlBidsReader,
  userId: string,
  bidId: string,
  scopeUserIds?: string[],
) {
  await ensureUserFromMysql(mysql, userId);
  const userIds = scopedUserIds(userId, scopeUserIds);
  const placeholders = userIds.map(() => "?").join(", ");
  const [existingRows] = await mysql.query(
    `SELECT bid_id AS bidId FROM saved_bids WHERE user_id IN (${placeholders}) AND bid_id = ? LIMIT 1`,
    [...userIds, bidId],
  );

  if ((existingRows as unknown[]).length === 0) {
    const sql = `
      INSERT INTO saved_bids (user_id, bid_id, created_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE created_at = created_at
    `;
    const values = [userId, bidId, nowIso()];

    await executeMysqlBidsWrite(mysql, sql, values);
  }

  return listSavedBidIdsFromMysql(mysql, userId, userIds);
}

export async function removeSavedBidIdFromMysql(
  mysql: MysqlBidsReader,
  userId: string,
  bidId: string,
  scopeUserIds?: string[],
) {
  const userIds = scopedUserIds(userId, scopeUserIds);
  const placeholders = userIds.map(() => "?").join(", ");
  const sql = `DELETE FROM saved_bids WHERE user_id IN (${placeholders}) AND bid_id = ?`;
  const values = [...userIds, bidId];

  await executeMysqlBidsWrite(mysql, sql, values);

  return listSavedBidIdsFromMysql(mysql, userId, userIds);
}

export function resetBidRepositoryForTests() {
  // Repository state now lives in SQLite. Kept as a no-op for legacy tests that
  // only need to clear spies/mocks around route handlers.
}
