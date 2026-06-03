import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { expandMysqlInClause, mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { bidAttachments, bidFieldCorrections, bids } from "@/server/db/schema";

export type AdminBidQaReviewStatus = "unreviewed" | "needs_review" | "reviewed" | "suppressed";
export type AdminBidQaArchiveStatus = "failed" | "unavailable" | "archived" | "not_archived";
export type AdminBidQaDisplayStatus = "pending_qa" | "published" | "suppressed";
export type AdminBidQaCorrectionField =
  | "title"
  | "deadlineDate"
  | "issuerName"
  | "amount"
  | "originalCategory"
  | "sourceUrl"
  | "contactName"
  | "contactEmail"
  | "contactPhone";

export interface ListAdminBidQaFilters {
  limit?: number;
  q?: string;
  stateCode?: string;
  reviewStatus?: AdminBidQaReviewStatus;
  archiveStatus?: AdminBidQaArchiveStatus;
  displayStatus?: AdminBidQaDisplayStatus;
  sourceConfidence?: string;
  minQualityScore?: number;
  maxQualityScore?: number;
  reviewerId?: string;
  reviewedFrom?: string;
  reviewedTo?: string;
}

export interface UpdateAdminBidQaReviewInput {
  reviewStatus: AdminBidQaReviewStatus;
  note?: string | null;
  reviewerId: string;
  reviewedAt?: string;
}

export interface UpdateAdminBidQaDisplayStatusInput {
  displayStatus: AdminBidQaDisplayStatus;
  reviewerId: string;
  reviewedAt?: string;
}

export interface UpdateAdminBidQaCorrectionInput {
  corrections: Partial<Record<AdminBidQaCorrectionField, string | null>>;
  note?: string | null;
  reviewerId: string;
  correctedAt?: string;
}

export interface BatchUpdateAdminBidQaInput {
  bidIds: string[];
  reviewStatus?: AdminBidQaReviewStatus;
  displayStatus?: AdminBidQaDisplayStatus;
  note?: string | null;
  reviewerId: string;
  reviewedAt?: string;
}

export interface AdminBidQaCorrectionHistoryItem {
  id: string;
  bidId: string;
  fieldName: AdminBidQaCorrectionField;
  originalValue: string | null;
  correctedValue: string | null;
  note: string | null;
  correctedBy: string;
  correctedAt: string;
}

export interface BatchUpdateAdminBidQaResult {
  updatedCount: number;
  items: AdminBidQaItem[];
}

export interface AdminBidQaItem {
  id: string;
  title: string;
  source: string;
  sourceBidId: string | null;
  issuerName: string;
  stateCode: string;
  deadlineDate: string | null;
  sourceConfidence: string;
  qualityFlags: string[];
  qualityScore: number;
  adminReviewStatus: AdminBidQaReviewStatus;
  adminReviewNote: string | null;
  adminReviewedAt: string | null;
  adminReviewedBy: string | null;
  displayStatus: AdminBidQaDisplayStatus;
  detailArchiveStatus: string;
  detailArchiveError: string | null;
  attachmentCount: number;
  archiveIssueCount: number;
  archiveFailedCount: number;
  archiveUnavailableCount: number;
  correctionCount: number;
  updatedAt: string;
}

export interface AdminBidQaSummary {
  total: number;
  needsReview: number;
  archiveIssues: number;
  lowQuality: number;
}

export interface AdminBidQaResponse {
  summary: AdminBidQaSummary;
  items: AdminBidQaItem[];
}

interface AttachmentArchiveStats {
  attachmentCount: number;
  failed: number;
  unavailable: number;
  statuses: Set<string>;
}

interface MysqlBidQaStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

type BidRow = typeof bids.$inferSelect;
type BidAttachmentRow = typeof bidAttachments.$inferSelect;
type BidFieldCorrectionRow = typeof bidFieldCorrections.$inferSelect;

const CORRECTION_FIELD_TO_MYSQL_COLUMN = {
  title: "title",
  deadlineDate: "deadline_date",
  issuerName: "issuer_name",
  amount: "amount",
  originalCategory: "original_category",
  sourceUrl: "source_url",
  contactName: "contact_name",
  contactEmail: "contact_email",
  contactPhone: "contact_phone",
} as const satisfies Record<AdminBidQaCorrectionField, string>;

export class AdminBidQaNotFoundError extends Error {
  constructor(id: string) {
    super(`Bid ${id} was not found`);
    this.name = "AdminBidQaNotFoundError";
  }
}

const REVIEW_STATUSES = new Set<AdminBidQaReviewStatus>(["unreviewed", "needs_review", "reviewed", "suppressed"]);
const DISPLAY_STATUSES = new Set<AdminBidQaDisplayStatus>(["pending_qa", "published", "suppressed"]);
const CORRECTION_FIELD_TO_COLUMN = {
  title: "title",
  deadlineDate: "deadlineDate",
  issuerName: "issuerName",
  amount: "amount",
  originalCategory: "originalCategory",
  sourceUrl: "sourceUrl",
  contactName: "contactName",
  contactEmail: "contactEmail",
  contactPhone: "contactPhone",
} as const satisfies Record<AdminBidQaCorrectionField, keyof typeof bids.$inferSelect>;

export function isAdminBidQaReviewStatus(value: unknown): value is AdminBidQaReviewStatus {
  return typeof value === "string" && REVIEW_STATUSES.has(value as AdminBidQaReviewStatus);
}

export function isAdminBidQaDisplayStatus(value: unknown): value is AdminBidQaDisplayStatus {
  return typeof value === "string" && DISPLAY_STATUSES.has(value as AdminBidQaDisplayStatus);
}

export function isAdminBidQaCorrectionField(value: unknown): value is AdminBidQaCorrectionField {
  return typeof value === "string" && value in CORRECTION_FIELD_TO_COLUMN;
}

function parseQualityFlags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function countDetailArchiveStatus(status: string) {
  return {
    failed: status === "failed" ? 1 : 0,
    unavailable: status === "unavailable" ? 1 : 0,
  };
}

function calculateQualityScore(input: {
  deadlineDate: string | null;
  sourceConfidence: string;
  qualityFlags: string[];
  archiveFailedCount: number;
  archiveUnavailableCount: number;
}) {
  let score = 100;

  if (!input.deadlineDate) score -= 20;
  if (input.sourceConfidence === "low") score -= 20;
  if (input.sourceConfidence === "medium") score -= 10;

  score -= Math.min(input.qualityFlags.length * 5, 20);
  score -= input.archiveFailedCount * 15;
  score -= input.archiveUnavailableCount * 8;

  return Math.max(0, Math.min(100, score));
}

function attachmentStats(rows: Array<typeof bidAttachments.$inferSelect>) {
  const byBid = new Map<string, AttachmentArchiveStats>();

  for (const row of rows) {
    const current = byBid.get(row.bidId) ?? {
      attachmentCount: 0,
      failed: 0,
      unavailable: 0,
      statuses: new Set<string>(),
    };
    current.attachmentCount += 1;
    current.statuses.add(row.archiveStatus);
    if (row.archiveStatus === "failed") current.failed += 1;
    if (row.archiveStatus === "unavailable") current.unavailable += 1;
    byBid.set(row.bidId, current);
  }

  return byBid;
}

function correctionCounts(rows: Array<typeof bidFieldCorrections.$inferSelect>) {
  const byBid = new Map<string, number>();
  for (const row of rows) {
    byBid.set(row.bidId, (byBid.get(row.bidId) ?? 0) + 1);
  }
  return byBid;
}

function mysqlString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = row[key];
  return value === null || value === undefined ? fallback : String(value);
}

function mysqlNullableString(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function mysqlNullableNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value === null || value === undefined ? null : Number(value);
}

function mysqlBidRow(row: Record<string, unknown>): BidRow {
  return {
    id: mysqlString(row, "id"),
    source: mysqlString(row, "source"),
    sourceBidId: mysqlNullableString(row, "source_bid_id"),
    dedupeKey: mysqlString(row, "dedupe_key"),
    title: mysqlString(row, "title"),
    description: mysqlString(row, "description"),
    fullDescription: mysqlNullableString(row, "full_description"),
    originalCategory: mysqlNullableString(row, "original_category"),
    amount: mysqlNullableString(row, "amount"),
    amountMin: mysqlNullableNumber(row, "amount_min"),
    amountMax: mysqlNullableNumber(row, "amount_max"),
    currency: mysqlString(row, "currency", "USD"),
    publishedDate: mysqlNullableString(row, "published_date"),
    deadlineDate: mysqlNullableString(row, "deadline_date"),
    issuerName: mysqlString(row, "issuer_name"),
    issuerType: mysqlString(row, "issuer_type"),
    stateCode: mysqlString(row, "state_code"),
    contactName: mysqlNullableString(row, "contact_name"),
    contactEmail: mysqlNullableString(row, "contact_email"),
    contactPhone: mysqlNullableString(row, "contact_phone"),
    sourceUrl: mysqlString(row, "source_url"),
    isActive: Number(row.is_active ?? 1),
    rawPayload: mysqlNullableString(row, "raw_payload"),
    sourceConfidence: mysqlString(row, "source_confidence", "medium"),
    qualityFlagsJson: mysqlString(row, "quality_flags_json", "[]"),
    adminReviewStatus: mysqlString(row, "admin_review_status", "unreviewed"),
    adminReviewNote: mysqlNullableString(row, "admin_review_note"),
    adminReviewedAt: mysqlNullableString(row, "admin_reviewed_at"),
    adminReviewedBy: mysqlNullableString(row, "admin_reviewed_by"),
    displayStatus: mysqlString(row, "display_status", "published"),
    detailArchiveStatus: mysqlString(row, "detail_archive_status", "not_archived"),
    detailArchivePath: mysqlNullableString(row, "detail_archive_path"),
    detailFetchedAt: mysqlNullableString(row, "detail_fetched_at"),
    detailChecksumSha256: mysqlNullableString(row, "detail_checksum_sha256"),
    detailArchiveError: mysqlNullableString(row, "detail_archive_error"),
    firstSeenAt: mysqlString(row, "first_seen_at"),
    lastSeenAt: mysqlString(row, "last_seen_at"),
    createdAt: mysqlString(row, "created_at"),
    updatedAt: mysqlString(row, "updated_at"),
  };
}

function mysqlAttachmentRow(row: Record<string, unknown>): BidAttachmentRow {
  return {
    id: mysqlString(row, "id"),
    bidId: mysqlString(row, "bid_id"),
    name: mysqlString(row, "name"),
    url: mysqlString(row, "url"),
    originalUrl: mysqlNullableString(row, "original_url"),
    storagePath: mysqlNullableString(row, "storage_path"),
    byteSize: mysqlNullableNumber(row, "byte_size"),
    contentType: mysqlNullableString(row, "content_type"),
    checksumSha256: mysqlNullableString(row, "checksum_sha256"),
    fetchedAt: mysqlNullableString(row, "fetched_at"),
    archiveStatus: mysqlString(row, "archive_status", "not_archived"),
    archiveError: mysqlNullableString(row, "archive_error"),
    sizeLabel: mysqlNullableString(row, "size_label"),
    mimeType: mysqlNullableString(row, "mime_type"),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: mysqlString(row, "created_at"),
  };
}

function mysqlCorrectionRow(row: Record<string, unknown>): BidFieldCorrectionRow {
  return {
    id: mysqlString(row, "id"),
    bidId: mysqlString(row, "bid_id"),
    fieldName: mysqlString(row, "field_name"),
    originalValue: mysqlNullableString(row, "original_value"),
    correctedValue: mysqlNullableString(row, "corrected_value"),
    note: mysqlNullableString(row, "note"),
    correctedBy: mysqlString(row, "corrected_by"),
    correctedAt: mysqlString(row, "corrected_at"),
  };
}

async function mysqlAllAttachmentStats(mysql: MysqlBidQaStore, bidIds?: string[]) {
  if (bidIds && bidIds.length === 0) return new Map<string, AttachmentArchiveStats>();
  const where = bidIds ? `WHERE bid_id IN (${expandMysqlInClause(bidIds).placeholders})` : "";
  const values = bidIds ? expandMysqlInClause(bidIds).values : [];
  const rows = await mysqlSelectMany<Record<string, unknown>>(mysql, `SELECT * FROM bid_attachments ${where}`, values);
  return attachmentStats(rows.map((row) => mysqlAttachmentRow(row)));
}

async function mysqlCorrectionCountMap(mysql: MysqlBidQaStore, bidIds?: string[]) {
  if (bidIds && bidIds.length === 0) return new Map<string, number>();
  const where = bidIds ? `WHERE bid_id IN (${expandMysqlInClause(bidIds).placeholders})` : "";
  const values = bidIds ? expandMysqlInClause(bidIds).values : [];
  const rows = await mysqlSelectMany<Record<string, unknown>>(mysql, `SELECT * FROM bid_field_corrections ${where}`, values);
  return correctionCounts(rows.map((row) => mysqlCorrectionRow(row)));
}

async function mysqlBidById(mysql: MysqlBidQaStore, id: string) {
  const row = await mysqlSelectOne<Record<string, unknown>>(mysql, "SELECT * FROM bids WHERE id = ? LIMIT 1", [id]);
  return row ? mysqlBidRow(row) : null;
}

async function mysqlBidQaItem(mysql: MysqlBidQaStore, id: string): Promise<AdminBidQaItem> {
  const row = await mysqlBidById(mysql, id);
  if (!row) {
    throw new AdminBidQaNotFoundError(id);
  }

  const attachmentMap = await mysqlAllAttachmentStats(mysql, [id]);
  const correctionMap = await mysqlCorrectionCountMap(mysql, [id]);
  return toQaItem(row, attachmentMap, correctionMap.get(id) ?? 0);
}

function applyCorrectionValue(
  setValues: Partial<typeof bids.$inferInsert>,
  field: AdminBidQaCorrectionField,
  value: string | null | undefined,
) {
  switch (field) {
    case "title":
      setValues.title = value ?? "";
      break;
    case "deadlineDate":
      setValues.deadlineDate = value ?? null;
      break;
    case "issuerName":
      setValues.issuerName = value ?? "";
      break;
    case "amount":
      setValues.amount = value ?? null;
      break;
    case "originalCategory":
      setValues.originalCategory = value ?? null;
      break;
    case "sourceUrl":
      setValues.sourceUrl = value ?? "";
      break;
    case "contactName":
      setValues.contactName = value ?? null;
      break;
    case "contactEmail":
      setValues.contactEmail = value ?? null;
      break;
    case "contactPhone":
      setValues.contactPhone = value ?? null;
      break;
  }
}

function toQaItem(
  row: typeof bids.$inferSelect,
  stats: Map<string, AttachmentArchiveStats>,
  correctionCount = 0,
): AdminBidQaItem {
  const qualityFlags = parseQualityFlags(row.qualityFlagsJson);
  const attachment = stats.get(row.id) ?? {
    attachmentCount: 0,
    failed: 0,
    unavailable: 0,
    statuses: new Set<string>(),
  };
  const detail = countDetailArchiveStatus(row.detailArchiveStatus);
  const archiveFailedCount = attachment.failed + detail.failed;
  const archiveUnavailableCount = attachment.unavailable + detail.unavailable;
  const qualityScore = calculateQualityScore({
    deadlineDate: row.deadlineDate,
    sourceConfidence: row.sourceConfidence,
    qualityFlags,
    archiveFailedCount,
    archiveUnavailableCount,
  });

  return {
    id: row.id,
    title: row.title,
    source: row.source,
    sourceBidId: row.sourceBidId,
    issuerName: row.issuerName,
    stateCode: row.stateCode,
    deadlineDate: row.deadlineDate,
    sourceConfidence: row.sourceConfidence,
    qualityFlags,
    qualityScore,
    adminReviewStatus: row.adminReviewStatus as AdminBidQaReviewStatus,
    adminReviewNote: row.adminReviewNote,
    adminReviewedAt: row.adminReviewedAt,
    adminReviewedBy: row.adminReviewedBy,
    displayStatus: row.displayStatus as AdminBidQaDisplayStatus,
    detailArchiveStatus: row.detailArchiveStatus,
    detailArchiveError: row.detailArchiveError,
    attachmentCount: attachment.attachmentCount,
    archiveIssueCount: archiveFailedCount + archiveUnavailableCount,
    archiveFailedCount,
    archiveUnavailableCount,
    correctionCount,
    updatedAt: row.updatedAt,
  };
}

function matchesText(item: AdminBidQaItem, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [item.title, item.source, item.issuerName, item.sourceBidId ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

function matchesArchiveStatus(
  item: AdminBidQaItem,
  attachment: AttachmentArchiveStats | undefined,
  archiveStatus?: AdminBidQaArchiveStatus,
) {
  if (!archiveStatus) return true;
  if (item.detailArchiveStatus === archiveStatus) return true;
  return attachment?.statuses.has(archiveStatus) ?? false;
}

function sortQaItems(left: AdminBidQaItem, right: AdminBidQaItem) {
  if (left.qualityScore !== right.qualityScore) return left.qualityScore - right.qualityScore;
  return right.updatedAt.localeCompare(left.updatedAt);
}

export async function listAdminBidQaItems(
  db: AppDatabase,
  filters: ListAdminBidQaFilters = {},
): Promise<AdminBidQaResponse> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const attachmentRows = db.select().from(bidAttachments).all();
  const stats = attachmentStats(attachmentRows);
  const corrections = correctionCounts(db.select().from(bidFieldCorrections).all());
  const rows = db.select().from(bids).orderBy(desc(bids.updatedAt)).all();

  const allItems = rows.map((row) => toQaItem(row, stats, corrections.get(row.id) ?? 0)).sort(sortQaItems);
  const filtered = allItems.filter((item) => {
    if (filters.reviewStatus && item.adminReviewStatus !== filters.reviewStatus) return false;
    if (filters.displayStatus && item.displayStatus !== filters.displayStatus) return false;
    if (filters.sourceConfidence && item.sourceConfidence !== filters.sourceConfidence) return false;
    if (filters.minQualityScore !== undefined && item.qualityScore < filters.minQualityScore) return false;
    if (filters.maxQualityScore !== undefined && item.qualityScore > filters.maxQualityScore) return false;
    if (filters.reviewerId && item.adminReviewedBy !== filters.reviewerId) return false;
    if (filters.reviewedFrom && (!item.adminReviewedAt || item.adminReviewedAt < filters.reviewedFrom)) return false;
    if (filters.reviewedTo && (!item.adminReviewedAt || item.adminReviewedAt > filters.reviewedTo)) return false;
    if (filters.stateCode && item.stateCode !== filters.stateCode) return false;
    if (!matchesText(item, filters.q ?? "")) return false;
    if (!matchesArchiveStatus(item, stats.get(item.id), filters.archiveStatus)) return false;
    return true;
  });

  return {
    summary: {
      total: allItems.length,
      needsReview: allItems.filter((item) => item.adminReviewStatus === "needs_review" || item.qualityScore < 70).length,
      archiveIssues: allItems.filter((item) => item.archiveIssueCount > 0).length,
      lowQuality: allItems.filter((item) => item.qualityScore < 70).length,
    },
    items: filtered.slice(0, limit),
  };
}

export async function listAdminBidQaItemsFromMysql(
  mysql: MysqlBidQaStore,
  filters: ListAdminBidQaFilters = {},
): Promise<AdminBidQaResponse> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const stats = await mysqlAllAttachmentStats(mysql);
  const corrections = await mysqlCorrectionCountMap(mysql);
  const rows = await mysqlSelectMany<Record<string, unknown>>(mysql, "SELECT * FROM bids ORDER BY updated_at DESC");

  const allItems = rows.map((row) => {
    const bid = mysqlBidRow(row);
    return toQaItem(bid, stats, corrections.get(bid.id) ?? 0);
  }).sort(sortQaItems);
  const filtered = allItems.filter((item) => {
    if (filters.reviewStatus && item.adminReviewStatus !== filters.reviewStatus) return false;
    if (filters.displayStatus && item.displayStatus !== filters.displayStatus) return false;
    if (filters.sourceConfidence && item.sourceConfidence !== filters.sourceConfidence) return false;
    if (filters.minQualityScore !== undefined && item.qualityScore < filters.minQualityScore) return false;
    if (filters.maxQualityScore !== undefined && item.qualityScore > filters.maxQualityScore) return false;
    if (filters.reviewerId && item.adminReviewedBy !== filters.reviewerId) return false;
    if (filters.reviewedFrom && (!item.adminReviewedAt || item.adminReviewedAt < filters.reviewedFrom)) return false;
    if (filters.reviewedTo && (!item.adminReviewedAt || item.adminReviewedAt > filters.reviewedTo)) return false;
    if (filters.stateCode && item.stateCode !== filters.stateCode) return false;
    if (!matchesText(item, filters.q ?? "")) return false;
    if (!matchesArchiveStatus(item, stats.get(item.id), filters.archiveStatus)) return false;
    return true;
  });

  return {
    summary: {
      total: allItems.length,
      needsReview: allItems.filter((item) => item.adminReviewStatus === "needs_review" || item.qualityScore < 70).length,
      archiveIssues: allItems.filter((item) => item.archiveIssueCount > 0).length,
      lowQuality: allItems.filter((item) => item.qualityScore < 70).length,
    },
    items: filtered.slice(0, limit),
  };
}

export async function listAdminBidQaCorrections(
  db: AppDatabase,
  bidId: string,
): Promise<AdminBidQaCorrectionHistoryItem[]> {
  const existing = db.select().from(bids).where(eq(bids.id, bidId)).limit(1).get();
  if (!existing) {
    throw new AdminBidQaNotFoundError(bidId);
  }

  return db
    .select()
    .from(bidFieldCorrections)
    .where(eq(bidFieldCorrections.bidId, bidId))
    .orderBy(desc(bidFieldCorrections.correctedAt))
    .all()
    .map((row) => ({
      id: row.id,
      bidId: row.bidId,
      fieldName: row.fieldName as AdminBidQaCorrectionField,
      originalValue: row.originalValue,
      correctedValue: row.correctedValue,
      note: row.note,
      correctedBy: row.correctedBy,
      correctedAt: row.correctedAt,
    }));
}

export async function listAdminBidQaCorrectionsFromMysql(
  mysql: MysqlBidQaStore,
  bidId: string,
): Promise<AdminBidQaCorrectionHistoryItem[]> {
  const existing = await mysqlBidById(mysql, bidId);
  if (!existing) {
    throw new AdminBidQaNotFoundError(bidId);
  }

  const rows = await mysqlSelectMany<Record<string, unknown>>(
    mysql,
    "SELECT * FROM bid_field_corrections WHERE bid_id = ? ORDER BY corrected_at DESC",
    [bidId],
  );

  return rows.map((row) => {
    const correction = mysqlCorrectionRow(row);
    return {
      id: correction.id,
      bidId: correction.bidId,
      fieldName: correction.fieldName as AdminBidQaCorrectionField,
      originalValue: correction.originalValue,
      correctedValue: correction.correctedValue,
      note: correction.note,
      correctedBy: correction.correctedBy,
      correctedAt: correction.correctedAt,
    };
  });
}

export async function batchUpdateAdminBidQaItems(
  db: AppDatabase,
  input: BatchUpdateAdminBidQaInput,
): Promise<BatchUpdateAdminBidQaResult> {
  const bidIds = [...new Set(input.bidIds.map((id) => id.trim()).filter(Boolean))];
  if (bidIds.length === 0 || Boolean(input.reviewStatus) === Boolean(input.displayStatus)) {
    return { updatedCount: 0, items: [] };
  }

  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const note = input.note?.trim() ? input.note.trim() : null;
  const rows = db.select().from(bids).where(inArray(bids.id, bidIds)).all();
  const foundIds = new Set(rows.map((row) => row.id));
  if (foundIds.size === 0) {
    return { updatedCount: 0, items: [] };
  }

  const updateValues: Partial<typeof bids.$inferInsert> = {
    adminReviewedAt: reviewedAt,
    adminReviewedBy: input.reviewerId,
    updatedAt: reviewedAt,
  };

  if (input.reviewStatus) {
    updateValues.adminReviewStatus = input.reviewStatus;
    updateValues.adminReviewNote = note;
  }
  if (input.displayStatus) {
    updateValues.displayStatus = input.displayStatus;
  }

  db.update(bids).set(updateValues).where(inArray(bids.id, [...foundIds])).run();

  const updatedRows = db.select().from(bids).where(inArray(bids.id, [...foundIds])).all();
  const attachmentMap = attachmentStats(db.select().from(bidAttachments).where(inArray(bidAttachments.bidId, [...foundIds])).all());
  const correctionMap = correctionCounts(
    db.select().from(bidFieldCorrections).where(inArray(bidFieldCorrections.bidId, [...foundIds])).all(),
  );
  const byId = new Map(updatedRows.map((row) => [row.id, row]));

  return {
    updatedCount: updatedRows.length,
    items: bidIds
      .map((id) => byId.get(id))
      .filter((row): row is typeof bids.$inferSelect => Boolean(row))
      .map((row) => toQaItem(row, attachmentMap, correctionMap.get(row.id) ?? 0)),
  };
}

export async function batchUpdateAdminBidQaItemsFromMysql(
  mysql: MysqlBidQaStore,
  input: BatchUpdateAdminBidQaInput,
): Promise<BatchUpdateAdminBidQaResult> {
  const bidIds = [...new Set(input.bidIds.map((id) => id.trim()).filter(Boolean))];
  if (bidIds.length === 0 || Boolean(input.reviewStatus) === Boolean(input.displayStatus)) {
    return { updatedCount: 0, items: [] };
  }

  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const note = input.note?.trim() ? input.note.trim() : null;
  const inputClause = expandMysqlInClause(bidIds);
  const rows = await mysqlSelectMany<Record<string, unknown>>(
    mysql,
    `SELECT * FROM bids WHERE id IN (${inputClause.placeholders})`,
    inputClause.values,
  );
  const foundIds = rows.map((row) => mysqlString(row, "id"));
  if (foundIds.length === 0) {
    return { updatedCount: 0, items: [] };
  }

  const foundClause = expandMysqlInClause(foundIds);
  if (input.reviewStatus) {
    await mysqlExecute(
      mysql,
      `
        UPDATE bids
        SET admin_review_status = ?,
            admin_review_note = ?,
            admin_reviewed_at = ?,
            admin_reviewed_by = ?,
            updated_at = ?
        WHERE id IN (${foundClause.placeholders})
      `,
      [input.reviewStatus, note, reviewedAt, input.reviewerId, reviewedAt, ...foundClause.values],
    );
  }

  if (input.displayStatus) {
    await mysqlExecute(
      mysql,
      `
        UPDATE bids
        SET display_status = ?,
            admin_reviewed_at = ?,
            admin_reviewed_by = ?,
            updated_at = ?
        WHERE id IN (${foundClause.placeholders})
      `,
      [input.displayStatus, reviewedAt, input.reviewerId, reviewedAt, ...foundClause.values],
    );
  }

  const updatedRows = await mysqlSelectMany<Record<string, unknown>>(
    mysql,
    `SELECT * FROM bids WHERE id IN (${foundClause.placeholders})`,
    foundClause.values,
  );
  const updatedBids = updatedRows.map((row) => mysqlBidRow(row));
  const attachmentMap = await mysqlAllAttachmentStats(mysql, foundIds);
  const correctionMap = await mysqlCorrectionCountMap(mysql, foundIds);
  const byId = new Map(updatedBids.map((row) => [row.id, row]));

  return {
    updatedCount: updatedBids.length,
    items: bidIds
      .map((id) => byId.get(id))
      .filter((row): row is BidRow => Boolean(row))
      .map((row) => toQaItem(row, attachmentMap, correctionMap.get(row.id) ?? 0)),
  };
}

export async function updateAdminBidQaReview(
  db: AppDatabase,
  id: string,
  input: UpdateAdminBidQaReviewInput,
): Promise<AdminBidQaItem> {
  const existing = db.select().from(bids).where(eq(bids.id, id)).limit(1).get();
  if (!existing) {
    throw new AdminBidQaNotFoundError(id);
  }

  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const note = input.note?.trim() ? input.note.trim() : null;

  db.update(bids)
    .set({
      adminReviewStatus: input.reviewStatus,
      adminReviewNote: note,
      adminReviewedAt: reviewedAt,
      adminReviewedBy: input.reviewerId,
      updatedAt: reviewedAt,
    })
    .where(eq(bids.id, id))
    .run();

  const updated = db.select().from(bids).where(eq(bids.id, id)).limit(1).get();
  if (!updated) {
    throw new AdminBidQaNotFoundError(id);
  }

  return toQaItem(
    updated,
    attachmentStats(db.select().from(bidAttachments).where(eq(bidAttachments.bidId, id)).all()),
    db.select().from(bidFieldCorrections).where(eq(bidFieldCorrections.bidId, id)).all().length,
  );
}

export async function updateAdminBidQaReviewFromMysql(
  mysql: MysqlBidQaStore,
  id: string,
  input: UpdateAdminBidQaReviewInput,
): Promise<AdminBidQaItem> {
  const existing = await mysqlBidById(mysql, id);
  if (!existing) {
    throw new AdminBidQaNotFoundError(id);
  }

  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const note = input.note?.trim() ? input.note.trim() : null;
  await mysqlExecute(
    mysql,
    `
      UPDATE bids
      SET admin_review_status = ?,
          admin_review_note = ?,
          admin_reviewed_at = ?,
          admin_reviewed_by = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [input.reviewStatus, note, reviewedAt, input.reviewerId, reviewedAt, id],
  );

  return mysqlBidQaItem(mysql, id);
}

export async function updateAdminBidQaDisplayStatus(
  db: AppDatabase,
  id: string,
  input: UpdateAdminBidQaDisplayStatusInput,
): Promise<AdminBidQaItem> {
  const existing = db.select().from(bids).where(eq(bids.id, id)).limit(1).get();
  if (!existing) {
    throw new AdminBidQaNotFoundError(id);
  }

  const reviewedAt = input.reviewedAt ?? new Date().toISOString();

  db.update(bids)
    .set({
      displayStatus: input.displayStatus,
      adminReviewedAt: reviewedAt,
      adminReviewedBy: input.reviewerId,
      updatedAt: reviewedAt,
    })
    .where(eq(bids.id, id))
    .run();

  const updated = db.select().from(bids).where(eq(bids.id, id)).limit(1).get();
  if (!updated) {
    throw new AdminBidQaNotFoundError(id);
  }

  return toQaItem(
    updated,
    attachmentStats(db.select().from(bidAttachments).where(eq(bidAttachments.bidId, id)).all()),
    db.select().from(bidFieldCorrections).where(eq(bidFieldCorrections.bidId, id)).all().length,
  );
}

export async function updateAdminBidQaDisplayStatusFromMysql(
  mysql: MysqlBidQaStore,
  id: string,
  input: UpdateAdminBidQaDisplayStatusInput,
): Promise<AdminBidQaItem> {
  const existing = await mysqlBidById(mysql, id);
  if (!existing) {
    throw new AdminBidQaNotFoundError(id);
  }

  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  await mysqlExecute(
    mysql,
    `
      UPDATE bids
      SET display_status = ?,
          admin_reviewed_at = ?,
          admin_reviewed_by = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [input.displayStatus, reviewedAt, input.reviewerId, reviewedAt, id],
  );

  return mysqlBidQaItem(mysql, id);
}

export async function updateAdminBidQaCorrection(
  db: AppDatabase,
  id: string,
  input: UpdateAdminBidQaCorrectionInput,
): Promise<AdminBidQaItem> {
  const existing = db.select().from(bids).where(eq(bids.id, id)).limit(1).get();
  if (!existing) {
    throw new AdminBidQaNotFoundError(id);
  }

  const correctedAt = input.correctedAt ?? new Date().toISOString();
  const note = input.note?.trim() ? input.note.trim() : null;
  const setValues: Partial<typeof bids.$inferInsert> = {
    adminReviewStatus: "needs_review",
    adminReviewNote: note,
    adminReviewedAt: correctedAt,
    adminReviewedBy: input.reviewerId,
    updatedAt: correctedAt,
  };

  for (const [field, correctedValue] of Object.entries(input.corrections)) {
    if (!isAdminBidQaCorrectionField(field)) continue;

    const column = CORRECTION_FIELD_TO_COLUMN[field];
    const originalValue = existing[column];
    if ((originalValue ?? null) === (correctedValue ?? null)) continue;

    applyCorrectionValue(setValues, field, correctedValue);
    db.insert(bidFieldCorrections)
      .values({
        id: randomUUID(),
        bidId: id,
        fieldName: field,
        originalValue: originalValue === null || originalValue === undefined ? null : String(originalValue),
        correctedValue,
        note,
        correctedBy: input.reviewerId,
        correctedAt,
      })
      .run();
  }

  db.update(bids).set(setValues).where(eq(bids.id, id)).run();

  const updated = db.select().from(bids).where(eq(bids.id, id)).limit(1).get();
  if (!updated) {
    throw new AdminBidQaNotFoundError(id);
  }

  return toQaItem(
    updated,
    attachmentStats(db.select().from(bidAttachments).where(eq(bidAttachments.bidId, id)).all()),
    db.select().from(bidFieldCorrections).where(eq(bidFieldCorrections.bidId, id)).all().length,
  );
}

export async function updateAdminBidQaCorrectionFromMysql(
  mysql: MysqlBidQaStore,
  id: string,
  input: UpdateAdminBidQaCorrectionInput,
): Promise<AdminBidQaItem> {
  const existing = await mysqlBidById(mysql, id);
  if (!existing) {
    throw new AdminBidQaNotFoundError(id);
  }

  const correctedAt = input.correctedAt ?? new Date().toISOString();
  const note = input.note?.trim() ? input.note.trim() : null;
  const setValues = new Map<string, unknown>([
    ["admin_review_status", "needs_review"],
    ["admin_review_note", note],
    ["admin_reviewed_at", correctedAt],
    ["admin_reviewed_by", input.reviewerId],
    ["updated_at", correctedAt],
  ]);

  for (const [field, correctedValue] of Object.entries(input.corrections)) {
    if (!isAdminBidQaCorrectionField(field)) continue;

    const column = CORRECTION_FIELD_TO_COLUMN[field];
    const originalValue = existing[column];
    if ((originalValue ?? null) === (correctedValue ?? null)) continue;

    setValues.set(CORRECTION_FIELD_TO_MYSQL_COLUMN[field], correctedValue ?? (
      field === "title" || field === "issuerName" || field === "sourceUrl" ? "" : null
    ));
    await mysqlExecute(
      mysql,
      `
        INSERT INTO bid_field_corrections (
          id,
          bid_id,
          field_name,
          original_value,
          corrected_value,
          note,
          corrected_by,
          corrected_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        randomUUID(),
        id,
        field,
        originalValue === null || originalValue === undefined ? null : String(originalValue),
        correctedValue,
        note,
        input.reviewerId,
        correctedAt,
      ],
    );
  }

  const assignments = [...setValues.keys()].map((column) => `${column} = ?`).join(", ");
  await mysqlExecute(mysql, `UPDATE bids SET ${assignments} WHERE id = ?`, [...setValues.values(), id]);

  return mysqlBidQaItem(mysql, id);
}
