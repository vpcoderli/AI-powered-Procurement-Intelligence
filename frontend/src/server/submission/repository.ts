import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { submissionConfirmations, submissionPaths } from "@/server/db/schema";
import type {
  CreateSubmissionConfirmationInput,
  GeneratedSubmissionGuidance,
  SubmissionMethod,
  UpdateSubmissionGuidanceInput,
} from "./types";

export type SubmissionPathRow = typeof submissionPaths.$inferSelect;
export type SubmissionConfirmationRow = typeof submissionConfirmations.$inferSelect;

interface MysqlSubmissionRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlSubmissionPathRow {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  method: string;
  portalUrl: string;
  contactEmail: string;
  requiresRegistration: number | string | boolean;
  requiresPhysicalDelivery: number | string | boolean;
  requiresAddendaAcknowledgement: number | string | boolean;
  complexityScore: number | string;
  guidanceText: string;
  readinessChecklistJson: string;
  riskFlagsJson: string;
  createdAt: string;
  updatedAt: string;
}

interface MysqlSubmissionConfirmationRow {
  id: string;
  intentId: string;
  userId: string;
  submittedAt: string;
  method: string;
  confirmationReference: string;
  confirmationNotes: string;
  createdAt: string;
  updatedAt: string;
}

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

function mysqlBooleanToInteger(value: number | string | boolean) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

function toSubmissionPathRow(row: MysqlSubmissionPathRow): SubmissionPathRow {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    method: row.method,
    portalUrl: row.portalUrl,
    contactEmail: row.contactEmail,
    requiresRegistration: mysqlBooleanToInteger(row.requiresRegistration),
    requiresPhysicalDelivery: mysqlBooleanToInteger(row.requiresPhysicalDelivery),
    requiresAddendaAcknowledgement: mysqlBooleanToInteger(row.requiresAddendaAcknowledgement),
    complexityScore: Number(row.complexityScore),
    guidanceText: row.guidanceText,
    readinessChecklistJson: row.readinessChecklistJson,
    riskFlagsJson: row.riskFlagsJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSubmissionConfirmationRow(row: MysqlSubmissionConfirmationRow): SubmissionConfirmationRow {
  return {
    id: row.id,
    intentId: row.intentId,
    userId: row.userId,
    submittedAt: row.submittedAt,
    method: row.method,
    confirmationReference: row.confirmationReference,
    confirmationNotes: row.confirmationNotes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findSubmissionPathByIntentFromMysql(
  mysql: MysqlSubmissionRepository,
  userId: string,
  intentId: string,
) {
  const row = await mysqlSelectOne<MysqlSubmissionPathRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        method,
        portal_url AS portalUrl,
        contact_email AS contactEmail,
        requires_registration AS requiresRegistration,
        requires_physical_delivery AS requiresPhysicalDelivery,
        requires_addenda_acknowledgement AS requiresAddendaAcknowledgement,
        complexity_score AS complexityScore,
        guidance_text AS guidanceText,
        readiness_checklist_json AS readinessChecklistJson,
        risk_flags_json AS riskFlagsJson,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM submission_paths
      WHERE user_id = ? AND intent_id = ?
      LIMIT 1
    `,
    [userId, intentId],
  );

  return row ? toSubmissionPathRow(row) : null;
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

export async function createSubmissionPathRowFromMysql(
  mysql: MysqlSubmissionRepository,
  input: CreateSubmissionPathInput,
) {
  await mysqlExecute(
    mysql,
    `
      INSERT IGNORE INTO submission_paths (
        id,
        intent_id,
        bid_id,
        user_id,
        method,
        portal_url,
        contact_email,
        requires_registration,
        requires_physical_delivery,
        requires_addenda_acknowledgement,
        complexity_score,
        guidance_text,
        readiness_checklist_json,
        risk_flags_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.intentId,
      input.bidId,
      input.userId,
      input.guidance.method,
      input.guidance.portalUrl,
      input.guidance.contactEmail,
      input.guidance.requiresRegistration ? 1 : 0,
      input.guidance.requiresPhysicalDelivery ? 1 : 0,
      input.guidance.requiresAddendaAcknowledgement ? 1 : 0,
      input.guidance.complexityScore,
      input.guidance.guidanceText,
      JSON.stringify(input.guidance.readinessChecklist),
      JSON.stringify(input.guidance.riskFlags),
      input.timestamp,
      input.timestamp,
    ],
  );

  return findSubmissionPathByIntentFromMysql(mysql, input.userId, input.intentId);
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

export async function updateSubmissionPathRowFromMysql(
  mysql: MysqlSubmissionRepository,
  userId: string,
  intentId: string,
  input: UpdateSubmissionGuidanceInput,
  timestamp: string,
) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.method !== undefined) {
    assignments.push("method = ?");
    values.push(input.method);
  }
  if (input.portalUrl !== undefined) {
    assignments.push("portal_url = ?");
    values.push(input.portalUrl);
  }
  if (input.contactEmail !== undefined) {
    assignments.push("contact_email = ?");
    values.push(input.contactEmail);
  }
  if (input.requiresRegistration !== undefined) {
    assignments.push("requires_registration = ?");
    values.push(input.requiresRegistration ? 1 : 0);
  }
  if (input.requiresPhysicalDelivery !== undefined) {
    assignments.push("requires_physical_delivery = ?");
    values.push(input.requiresPhysicalDelivery ? 1 : 0);
  }
  if (input.requiresAddendaAcknowledgement !== undefined) {
    assignments.push("requires_addenda_acknowledgement = ?");
    values.push(input.requiresAddendaAcknowledgement ? 1 : 0);
  }

  assignments.push("updated_at = ?");
  values.push(timestamp, userId, intentId);

  await mysqlExecute(
    mysql,
    `
      UPDATE submission_paths
      SET ${assignments.join(", ")}
      WHERE user_id = ? AND intent_id = ?
    `,
    values,
  );

  return findSubmissionPathByIntentFromMysql(mysql, userId, intentId);
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

export async function createSubmissionConfirmationRowFromMysql(
  mysql: MysqlSubmissionRepository,
  input: CreateSubmissionConfirmationInput & {
    id: string;
    intentId: string;
    userId: string;
    timestamp: string;
  },
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO submission_confirmations (
        id,
        intent_id,
        user_id,
        submitted_at,
        method,
        confirmation_reference,
        confirmation_notes,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.intentId,
      input.userId,
      input.submittedAt,
      input.method,
      input.confirmationReference ?? "",
      input.confirmationNotes ?? "",
      input.timestamp,
      input.timestamp,
    ],
  );

  const row = await mysqlSelectOne<MysqlSubmissionConfirmationRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        user_id AS userId,
        submitted_at AS submittedAt,
        method,
        confirmation_reference AS confirmationReference,
        confirmation_notes AS confirmationNotes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM submission_confirmations
      WHERE id = ?
      LIMIT 1
    `,
    [input.id],
  );

  return row ? toSubmissionConfirmationRow(row) : null;
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

export async function listSubmissionConfirmationRowsFromMysql(
  mysql: MysqlSubmissionRepository,
  userId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlSubmissionConfirmationRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        user_id AS userId,
        submitted_at AS submittedAt,
        method,
        confirmation_reference AS confirmationReference,
        confirmation_notes AS confirmationNotes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM submission_confirmations
      WHERE user_id = ? AND intent_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [userId, intentId],
  );

  return rows.map(toSubmissionConfirmationRow);
}

export function normalizeSubmissionMethod(value: string): SubmissionMethod {
  return value as SubmissionMethod;
}
