import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids } from "@/server/db/schema";

export type AdminBidQaReviewStatus = "unreviewed" | "needs_review" | "reviewed" | "suppressed";
export type AdminBidQaArchiveStatus = "failed" | "unavailable" | "archived" | "not_archived";

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
  detailArchiveStatus: string;
  detailArchiveError: string | null;
  attachmentCount: number;
  archiveIssueCount: number;
  archiveFailedCount: number;
  archiveUnavailableCount: number;
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

export function isAdminBidQaReviewStatus(value: unknown): value is AdminBidQaReviewStatus {
  return typeof value === "string" && REVIEW_STATUSES.has(value as AdminBidQaReviewStatus);
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

function toQaItem(
  row: typeof bids.$inferSelect,
  stats: Map<string, AttachmentArchiveStats>,
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
    detailArchiveStatus: row.detailArchiveStatus,
    detailArchiveError: row.detailArchiveError,
    attachmentCount: attachment.attachmentCount,
    archiveIssueCount: archiveFailedCount + archiveUnavailableCount,
    archiveFailedCount,
    archiveUnavailableCount,
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
  const rows = db.select().from(bids).orderBy(desc(bids.updatedAt)).all();

  const allItems = rows.map((row) => toQaItem(row, stats)).sort(sortQaItems);
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

  return toQaItem(updated, attachmentStats(db.select().from(bidAttachments).where(eq(bidAttachments.bidId, id)).all()));
}
