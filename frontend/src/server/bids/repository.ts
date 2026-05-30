import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids, savedBids, users } from "@/server/db/schema";
import { attachmentDownloadUrl, isLocalAttachmentUrl } from "./attachments";
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
    const localAttachmentPath = row.storagePath ?? row.url;
    current.push({
      name: row.name,
      url: isLocalAttachmentUrl(localAttachmentPath) ? attachmentDownloadUrl(row.bidId, row.id) : row.url,
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

export async function listBids(db: AppDatabase, savedBidIds: string[] = []) {
  const rows = db.select().from(bids).where(ne(bids.displayStatus, "suppressed")).orderBy(asc(bids.id)).all();
  const attachmentMap = attachmentsForBids(
    db,
    rows.map((row) => row.id),
  );
  const savedSet = new Set(savedBidIds);

  return rows.map((row) => toBid(row, attachmentMap.get(row.id) ?? [], savedSet));
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

export function resetBidRepositoryForTests() {
  // Repository state now lives in SQLite. Kept as a no-op for legacy tests that
  // only need to clear spies/mocks around route handlers.
}
