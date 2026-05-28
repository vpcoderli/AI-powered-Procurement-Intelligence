import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { pursuitDecisions } from "@/server/db/schema";
import type { CreatePursuitDecisionInput } from "./types";

export type PursuitDecisionRow = typeof pursuitDecisions.$inferSelect;

interface CreatePursuitDecisionRowInput extends Required<CreatePursuitDecisionInput> {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  timestamp: string;
}

export function listPursuitDecisionRows(db: AppDatabase, intentId: string) {
  return db
    .select()
    .from(pursuitDecisions)
    .where(eq(pursuitDecisions.intentId, intentId))
    .orderBy(asc(pursuitDecisions.createdAt), asc(pursuitDecisions.id))
    .all();
}

export function createPursuitDecisionRow(db: AppDatabase, input: CreatePursuitDecisionRowInput) {
  db.insert(pursuitDecisions)
    .values({
      id: input.id,
      intentId: input.intentId,
      bidId: input.bidId,
      userId: input.userId,
      decision: input.decision,
      reasonsJson: JSON.stringify(input.reasons),
      notes: input.notes,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .run();

  return listPursuitDecisionRows(db, input.intentId);
}
