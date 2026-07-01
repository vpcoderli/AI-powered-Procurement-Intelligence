import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import {
  awardOutcomes,
  responsePackageExports,
  responsePackageSnapshots,
  responseWorkspaceItemArtifacts,
  responseWorkspaceItems,
  submissionConfirmations,
  submissionPaths,
  supplierArtifacts,
} from "@/server/db/schema";
import type {
  CreateSubmissionConfirmationInput,
  GeneratedSubmissionGuidance,
  SubmissionEvidenceSnapshot,
  SubmissionMethod,
  SubmissionStatus,
  UpdateSubmissionGuidanceInput,
} from "./types";

export type SubmissionPathRow = typeof submissionPaths.$inferSelect;
export type SubmissionConfirmationRow = typeof submissionConfirmations.$inferSelect;
export interface SubmissionEvidenceResponsePackageExportRow {
  id: string;
  intentId: string;
  snapshotId: string;
  snapshotTitle: string;
  createdAt: string;
  format: string | null;
  reviewStatus: string | null;
  readinessJson: string;
}
export type SubmissionEvidenceLinkedSupplierArtifactRow = Pick<
  typeof supplierArtifacts.$inferSelect,
  "id" | "title" | "fileName" | "artifactType" | "purpose"
>;
export type SubmissionEvidenceAwardOutcomeRow = Pick<
  typeof awardOutcomes.$inferSelect,
  "status" | "awardNoticeUrl"
>;

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
  status?: string | null;
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
  evidenceSnapshotJson: string;
  createdAt: string;
  updatedAt: string;
}

interface MysqlSubmissionEvidenceResponsePackageExportRow {
  id: string;
  intentId: string;
  snapshotId: string;
  snapshotTitle: string;
  createdAt: string;
  format: string | null;
  reviewStatus: string | null;
  readinessJson: string;
}

interface MysqlSubmissionEvidenceLinkedSupplierArtifactRow {
  id: string;
  title: string;
  fileName: string;
  artifactType: string;
  purpose: string;
}

interface MysqlSubmissionEvidenceAwardOutcomeRow {
  status: string;
  awardNoticeUrl: string;
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
    status: normalizeSubmissionStatus(row.status),
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
    evidenceSnapshotJson: row.evidenceSnapshotJson,
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
        status,
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
      status: "draft",
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
        status,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.intentId,
      input.bidId,
      input.userId,
      input.guidance.method,
      "draft",
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
  if (input.status !== undefined) values.status = input.status;
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
  if (input.status !== undefined) {
    assignments.push("status = ?");
    values.push(input.status);
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
    evidenceSnapshot: SubmissionEvidenceSnapshot;
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
      evidenceSnapshotJson: JSON.stringify(input.evidenceSnapshot),
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
    evidenceSnapshot: SubmissionEvidenceSnapshot;
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
        evidence_snapshot_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.intentId,
      input.userId,
      input.submittedAt,
      input.method,
      input.confirmationReference ?? "",
      input.confirmationNotes ?? "",
      JSON.stringify(input.evidenceSnapshot),
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
        evidence_snapshot_json AS evidenceSnapshotJson,
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
        evidence_snapshot_json AS evidenceSnapshotJson,
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

export function listSubmissionEvidenceResponsePackageExportRows(
  db: AppDatabase,
  userId: string,
  intentId: string,
) {
  return db
    .select({
      id: responsePackageExports.id,
      intentId: responsePackageExports.intentId,
      snapshotId: responsePackageExports.snapshotId,
      snapshotTitle: responsePackageSnapshots.title,
      createdAt: responsePackageExports.createdAt,
      format: responsePackageExports.format,
      reviewStatus: responsePackageExports.reviewStatus,
      readinessJson: responsePackageExports.readinessJson,
    })
    .from(responsePackageExports)
    .innerJoin(responsePackageSnapshots, eq(responsePackageExports.snapshotId, responsePackageSnapshots.id))
    .where(and(eq(responsePackageExports.userId, userId), eq(responsePackageExports.intentId, intentId)))
    .orderBy(desc(responsePackageExports.createdAt), desc(responsePackageExports.id))
    .all();
}

export async function listSubmissionEvidenceResponsePackageExportRowsFromMysql(
  mysql: MysqlSubmissionRepository,
  userId: string,
  intentId: string,
) {
  return mysqlSelectMany<MysqlSubmissionEvidenceResponsePackageExportRow>(
    mysql,
    `
      SELECT
        response_package_exports.id,
        response_package_exports.intent_id AS intentId,
        response_package_exports.snapshot_id AS snapshotId,
        response_package_snapshots.title AS snapshotTitle,
        response_package_exports.created_at AS createdAt,
        response_package_exports.format,
        response_package_exports.review_status AS reviewStatus,
        response_package_exports.readiness_json AS readinessJson
      FROM response_package_exports
      INNER JOIN response_package_snapshots
        ON response_package_snapshots.id = response_package_exports.snapshot_id
      WHERE response_package_exports.user_id = ? AND response_package_exports.intent_id = ?
      ORDER BY response_package_exports.created_at DESC, response_package_exports.id DESC
    `,
    [userId, intentId],
  );
}

export function listSubmissionEvidenceLinkedSupplierArtifactRows(
  db: AppDatabase,
  userId: string,
  intentId: string,
) {
  return db
    .select({
      id: supplierArtifacts.id,
      title: supplierArtifacts.title,
      fileName: supplierArtifacts.fileName,
      artifactType: supplierArtifacts.artifactType,
      purpose: supplierArtifacts.purpose,
    })
    .from(responseWorkspaceItemArtifacts)
    .innerJoin(responseWorkspaceItems, eq(responseWorkspaceItemArtifacts.itemId, responseWorkspaceItems.id))
    .innerJoin(supplierArtifacts, eq(responseWorkspaceItemArtifacts.artifactId, supplierArtifacts.id))
    .where(and(
      eq(responseWorkspaceItems.userId, userId),
      eq(responseWorkspaceItems.intentId, intentId),
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      isNull(supplierArtifacts.deletedAt),
    ))
    .orderBy(asc(supplierArtifacts.title), asc(supplierArtifacts.id))
    .all();
}

export async function listSubmissionEvidenceLinkedSupplierArtifactRowsFromMysql(
  mysql: MysqlSubmissionRepository,
  userId: string,
  intentId: string,
) {
  return mysqlSelectMany<MysqlSubmissionEvidenceLinkedSupplierArtifactRow>(
    mysql,
    `
      SELECT
        supplier_artifacts.id,
        supplier_artifacts.title,
        supplier_artifacts.file_name AS fileName,
        supplier_artifacts.artifact_type AS artifactType,
        supplier_artifacts.purpose
      FROM response_workspace_item_artifacts
      INNER JOIN response_workspace_items
        ON response_workspace_items.id = response_workspace_item_artifacts.item_id
      INNER JOIN supplier_artifacts
        ON supplier_artifacts.id = response_workspace_item_artifacts.artifact_id
      WHERE response_workspace_items.user_id = ?
        AND response_workspace_items.intent_id = ?
        AND supplier_artifacts.user_id = ?
        AND supplier_artifacts.intent_id = ?
        AND supplier_artifacts.deleted_at IS NULL
      ORDER BY supplier_artifacts.title ASC, supplier_artifacts.id ASC
    `,
    [userId, intentId, userId, intentId],
  );
}

export function findSubmissionEvidenceAwardOutcomeRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
) {
  return db
    .select({
      status: awardOutcomes.status,
      awardNoticeUrl: awardOutcomes.awardNoticeUrl,
    })
    .from(awardOutcomes)
    .where(and(eq(awardOutcomes.userId, userId), eq(awardOutcomes.intentId, intentId)))
    .limit(1)
    .get();
}

export async function findSubmissionEvidenceAwardOutcomeRowFromMysql(
  mysql: MysqlSubmissionRepository,
  userId: string,
  intentId: string,
) {
  return mysqlSelectOne<MysqlSubmissionEvidenceAwardOutcomeRow>(
    mysql,
    `
      SELECT
        status,
        award_notice_url AS awardNoticeUrl
      FROM award_outcomes
      WHERE user_id = ? AND intent_id = ?
      LIMIT 1
    `,
    [userId, intentId],
  );
}

export function normalizeSubmissionMethod(value: string): SubmissionMethod {
  return value as SubmissionMethod;
}

export function normalizeSubmissionStatus(value: string | null | undefined): SubmissionStatus {
  if (value === "ready" || value === "submitted" || value === "needs_recovery") {
    return value;
  }

  return "draft";
}
