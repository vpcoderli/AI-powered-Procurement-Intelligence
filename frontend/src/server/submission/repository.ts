import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { submissionConfirmations, submissionPaths } from "@/server/db/schema";
import type {
  CreateSubmissionConfirmationInput,
  GeneratedSubmissionGuidance,
  SubmissionMethod,
  UpdateSubmissionGuidanceInput,
} from "./types";

export type SubmissionPathRow = typeof submissionPaths.$inferSelect;
export type SubmissionConfirmationRow = typeof submissionConfirmations.$inferSelect;

interface CreateSubmissionPathInput {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  guidance: GeneratedSubmissionGuidance;
  timestamp: string;
}

export function findSubmissionPathByIntent(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(submissionPaths)
    .where(and(eq(submissionPaths.userId, userId), eq(submissionPaths.intentId, intentId)))
    .limit(1)
    .get();
}

export function createSubmissionPathRow(db: AppDatabase, input: CreateSubmissionPathInput) {
  db.insert(submissionPaths)
    .values({
      id: input.id,
      intentId: input.intentId,
      bidId: input.bidId,
      userId: input.userId,
      method: input.guidance.method,
      portalUrl: input.guidance.portalUrl,
      contactEmail: input.guidance.contactEmail,
      requiresRegistration: input.guidance.requiresRegistration ? 1 : 0,
      requiresPhysicalDelivery: input.guidance.requiresPhysicalDelivery ? 1 : 0,
      requiresAddendaAcknowledgement: input.guidance.requiresAddendaAcknowledgement ? 1 : 0,
      complexityScore: input.guidance.complexityScore,
      guidanceText: input.guidance.guidanceText,
      readinessChecklistJson: JSON.stringify(input.guidance.readinessChecklist),
      riskFlagsJson: JSON.stringify(input.guidance.riskFlags),
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .onConflictDoNothing({ target: submissionPaths.intentId })
    .run();

  return findSubmissionPathByIntent(db, input.userId, input.intentId);
}

export function updateSubmissionPathRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateSubmissionGuidanceInput,
  timestamp: string,
) {
  const values: Partial<typeof submissionPaths.$inferInsert> = { updatedAt: timestamp };

  if (input.method !== undefined) values.method = input.method;
  if (input.portalUrl !== undefined) values.portalUrl = input.portalUrl;
  if (input.contactEmail !== undefined) values.contactEmail = input.contactEmail;
  if (input.requiresRegistration !== undefined) {
    values.requiresRegistration = input.requiresRegistration ? 1 : 0;
  }
  if (input.requiresPhysicalDelivery !== undefined) {
    values.requiresPhysicalDelivery = input.requiresPhysicalDelivery ? 1 : 0;
  }
  if (input.requiresAddendaAcknowledgement !== undefined) {
    values.requiresAddendaAcknowledgement = input.requiresAddendaAcknowledgement ? 1 : 0;
  }

  db.update(submissionPaths)
    .set(values)
    .where(and(eq(submissionPaths.userId, userId), eq(submissionPaths.intentId, intentId)))
    .run();

  return findSubmissionPathByIntent(db, userId, intentId);
}

export function createSubmissionConfirmationRow(
  db: AppDatabase,
  input: CreateSubmissionConfirmationInput & {
    id: string;
    intentId: string;
    userId: string;
    timestamp: string;
  },
) {
  db.insert(submissionConfirmations)
    .values({
      id: input.id,
      intentId: input.intentId,
      userId: input.userId,
      submittedAt: input.submittedAt,
      method: input.method,
      confirmationReference: input.confirmationReference ?? "",
      confirmationNotes: input.confirmationNotes ?? "",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .run();

  return db
    .select()
    .from(submissionConfirmations)
    .where(eq(submissionConfirmations.id, input.id))
    .limit(1)
    .get();
}

export function listSubmissionConfirmationRows(
  db: AppDatabase,
  userId: string,
  intentId: string,
) {
  return db
    .select()
    .from(submissionConfirmations)
    .where(and(eq(submissionConfirmations.userId, userId), eq(submissionConfirmations.intentId, intentId)))
    .orderBy(asc(submissionConfirmations.createdAt), asc(submissionConfirmations.id))
    .all();
}

export function normalizeSubmissionMethod(value: string): SubmissionMethod {
  return value as SubmissionMethod;
}
