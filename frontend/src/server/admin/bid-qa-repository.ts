import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
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
