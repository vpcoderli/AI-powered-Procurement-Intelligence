import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { generateSubmissionGuidance } from "./generator";
import {
  createSubmissionConfirmationRow,
  createSubmissionConfirmationRowFromMysql,
  createSubmissionPathRow,
  createSubmissionPathRowFromMysql,
  findSubmissionPathByIntent,
  findSubmissionPathByIntentFromMysql,
  normalizeSubmissionMethod,
  updateSubmissionPathRow,
  updateSubmissionPathRowFromMysql,
  type SubmissionConfirmationRow,
  type SubmissionPathRow,
} from "./repository";
import type {
  CreateSubmissionConfirmationInput,
  SubmissionConfirmation,
  SubmissionGuidance,
  UpdateSubmissionGuidanceInput,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function parseJsonField<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid submission JSON field: ${field}`);
  }
}

function hydrateSubmissionPath(row: SubmissionPathRow): SubmissionGuidance {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    method: normalizeSubmissionMethod(row.method),
    portalUrl: row.portalUrl,
    contactEmail: row.contactEmail,
    requiresRegistration: row.requiresRegistration === 1,
    requiresPhysicalDelivery: row.requiresPhysicalDelivery === 1,
    requiresAddendaAcknowledgement: row.requiresAddendaAcknowledgement === 1,
    complexityScore: row.complexityScore,
    guidanceText: row.guidanceText,
    readinessChecklist: parseJsonField<string[]>(row.readinessChecklistJson, "readinessChecklistJson"),
    riskFlags: parseJsonField<string[]>(row.riskFlagsJson, "riskFlagsJson"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hydrateSubmissionConfirmation(row: SubmissionConfirmationRow): SubmissionConfirmation {
  return {
    id: row.id,
    intentId: row.intentId,
    userId: row.userId,
    submittedAt: row.submittedAt,
    method: normalizeSubmissionMethod(row.method),
    confirmationReference: row.confirmationReference,
    confirmationNotes: row.confirmationNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getOrCreateSubmissionGuidance(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<SubmissionGuidance> {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const existing = mysql
    ? await findSubmissionPathByIntentFromMysql(mysql, userId, intentId)
    : findSubmissionPathByIntent(database, userId, intentId);

  if (existing) {
    return hydrateSubmissionPath(existing);
  }

  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const timestamp = nowIso();
  const generated = generateSubmissionGuidance(intent.bid);
  const row = mysql
    ? await createSubmissionPathRowFromMysql(mysql, {
      id: `submission_path_${crypto.randomUUID()}`,
      intentId: intent.id,
      bidId: intent.bid.id,
      userId,
      guidance: generated,
      timestamp,
    })
    : createSubmissionPathRow(database, {
      id: `submission_path_${crypto.randomUUID()}`,
      intentId: intent.id,
      bidId: intent.bid.id,
      userId,
      guidance: generated,
      timestamp,
    });

  if (!row) {
    throw new Error("Failed to create submission guidance");
  }

  return hydrateSubmissionPath(row);
}

export async function updateSubmissionGuidance(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateSubmissionGuidanceInput,
): Promise<SubmissionGuidance> {
  await getOrCreateSubmissionGuidance(database, userId, intentId);

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const row = mysql
    ? await updateSubmissionPathRowFromMysql(mysql, userId, intentId, input, nowIso())
    : updateSubmissionPathRow(database, userId, intentId, input, nowIso());

  if (!row) {
    throw new IntentNotFoundError();
  }

  return hydrateSubmissionPath(row);
}

export async function createSubmissionConfirmation(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreateSubmissionConfirmationInput,
): Promise<SubmissionConfirmation> {
  await getOrCreateSubmissionGuidance(database, userId, intentId);

  const timestamp = nowIso();
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const row = mysql
    ? await createSubmissionConfirmationRowFromMysql(mysql, {
      id: `submission_confirmation_${crypto.randomUUID()}`,
      intentId,
      userId,
      submittedAt: input.submittedAt,
      method: input.method,
      confirmationReference: input.confirmationReference,
      confirmationNotes: input.confirmationNotes,
      timestamp,
    })
    : createSubmissionConfirmationRow(database, {
      id: `submission_confirmation_${crypto.randomUUID()}`,
      intentId,
      userId,
      submittedAt: input.submittedAt,
      method: input.method,
      confirmationReference: input.confirmationReference,
      confirmationNotes: input.confirmationNotes,
      timestamp,
    });

  if (!row) {
    throw new Error("Failed to create submission confirmation");
  }

  return hydrateSubmissionConfirmation(row);
}
