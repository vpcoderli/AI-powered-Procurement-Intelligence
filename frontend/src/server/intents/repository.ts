import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { intentToBid } from "@/server/db/schema";
import type { BidMatchResult } from "@/server/match/types";
import type { GeneratedIntentContent, IntentStatus } from "./types";

export type IntentRow = typeof intentToBid.$inferSelect;

interface CreateIntentRowInput {
  id: string;
  userId: string;
  bidId: string;
  status: IntentStatus;
  generated: GeneratedIntentContent;
  match: BidMatchResult;
  timestamp: string;
}

export function findIntentByUserAndBid(db: AppDatabase, userId: string, bidId: string) {
  return db
    .select()
    .from(intentToBid)
    .where(and(eq(intentToBid.userId, userId), eq(intentToBid.bidId, bidId)))
    .limit(1)
    .get();
}

export function findIntentByUserAndId(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(intentToBid)
    .where(and(eq(intentToBid.userId, userId), eq(intentToBid.id, intentId)))
    .limit(1)
    .get();
}

export function listIntentRowsForUser(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(intentToBid)
    .where(eq(intentToBid.userId, userId))
    .orderBy(asc(intentToBid.createdAt), asc(intentToBid.id))
    .all();
}

export function createIntentRow(db: AppDatabase, input: CreateIntentRowInput) {
  db.insert(intentToBid)
    .values({
      id: input.id,
      userId: input.userId,
      bidId: input.bidId,
      status: input.status,
      aiBidBrief: input.generated.aiBidBrief,
      keyDatesJson: JSON.stringify(input.generated.keyDates),
      initialChecklistJson: JSON.stringify(input.generated.initialChecklist),
      riskFlagsJson: JSON.stringify(input.generated.riskFlags),
      matchScoreSnapshotJson: JSON.stringify(input.match),
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .onConflictDoNothing({ target: [intentToBid.userId, intentToBid.bidId] })
    .run();

  return findIntentByUserAndBid(db, input.userId, input.bidId);
}

export function updateIntentRowStatus(
  db: AppDatabase,
  userId: string,
  intentId: string,
  status: IntentStatus,
  timestamp: string,
) {
  db.update(intentToBid)
    .set({ status, updatedAt: timestamp })
    .where(and(eq(intentToBid.userId, userId), eq(intentToBid.id, intentId)))
    .run();

  return findIntentByUserAndId(db, userId, intentId);
}
