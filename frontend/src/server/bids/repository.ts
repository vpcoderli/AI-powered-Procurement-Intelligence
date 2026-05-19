import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids, savedBids, users } from "@/server/db/schema";
import type { Bid } from "./domain";

function nowIso() {
  return new Date().toISOString();
}

function isPresent(value: string | null): value is string {
  return value !== null && value.length > 0;
}

function tagsFromBid(row: typeof bids.$inferSelect) {
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
      url: row.url,
      size: row.sizeLabel ?? "",
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
  const rows = db.select().from(bids).orderBy(asc(bids.id)).all();
  const attachmentMap = attachmentsForBids(
    db,
    rows.map((row) => row.id),
  );
  const savedSet = new Set(savedBidIds);

  return rows.map((row) => toBid(row, attachmentMap.get(row.id) ?? [], savedSet));
}

export async function getBidByIdFromRepository(db: AppDatabase, id: string) {
  const row = db.select().from(bids).where(eq(bids.id, id)).limit(1).get();
  if (!row) return undefined;

  const attachmentMap = attachmentsForBids(db, [id]);
  return toBid(row, attachmentMap.get(id) ?? [], new Set());
}

export async function listSavedBidIds(db: AppDatabase, userId: string) {
  await ensureUser(db, userId);

  const rows = db
    .select({ bidId: savedBids.bidId })
    .from(savedBids)
    .where(eq(savedBids.userId, userId))
    .orderBy(asc(savedBids.createdAt), asc(savedBids.bidId))
    .all();

  return rows.map((row) => row.bidId);
}

export async function saveSavedBidId(db: AppDatabase, userId: string, bidId: string) {
  await ensureUser(db, userId);

  db.insert(savedBids)
    .values({
      userId,
      bidId,
      createdAt: nowIso(),
    })
    .onConflictDoNothing()
    .run();

  return listSavedBidIds(db, userId);
}

export async function removeSavedBidId(db: AppDatabase, userId: string, bidId: string) {
  db.delete(savedBids)
    .where(and(eq(savedBids.userId, userId), eq(savedBids.bidId, bidId)))
    .run();

  return listSavedBidIds(db, userId);
}

export function resetBidRepositoryForTests() {
  // Repository state now lives in SQLite. Kept as a no-op for legacy tests that
  // only need to clear spies/mocks around route handlers.
}
