import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { writeAuditEvent, writeAuditEventFromMysql } from "@/server/events/event-log";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { isAwardOutcomeStatus } from "@/server/awards/types";
import {
  type ArtifactEvidenceLink,
  isResponsePackageExportFormat,
  isResponsePackageExportReviewStatus,
} from "@/server/response-workspace/types";
import { generateSubmissionGuidance } from "./generator";
import {
  createSubmissionConfirmationRow,
  createSubmissionConfirmationRowFromMysql,
  createSubmissionPathRow,
  createSubmissionPathRowFromMysql,
  findSubmissionEvidenceAwardOutcomeRow,
  findSubmissionEvidenceAwardOutcomeRowFromMysql,
  findSubmissionPathByIntent,
  findSubmissionPathByIntentFromMysql,
  listSubmissionEvidenceLinkedSupplierArtifactRows,
  listSubmissionEvidenceLinkedSupplierArtifactRowsFromMysql,
  listSubmissionEvidenceResponsePackageExportRows,
  listSubmissionEvidenceResponsePackageExportRowsFromMysql,
  listSubmissionConfirmationRows,
  listSubmissionConfirmationRowsFromMysql,
  normalizeSubmissionMethod,
  normalizeSubmissionStatus,
  type SubmissionEvidenceAwardOutcomeRow,
  type SubmissionEvidenceLinkedSupplierArtifactRow,
  type SubmissionEvidenceResponsePackageExportRow,
  updateSubmissionPathRow,
  updateSubmissionPathRowFromMysql,
  type SubmissionConfirmationRow,
  type SubmissionPathRow,
} from "./repository";
import type {
  CreateSubmissionConfirmationInput,
  SubmissionConfirmation,
  SubmissionConfirmationResponse,
  SubmissionEvidenceLinks,
  SubmissionEvidenceSnapshot,
  SubmissionGuidance,
  SubmissionReadinessBlocker,
  SubmissionReadinessGate,
  SubmissionStatus,
  UpdateSubmissionGuidanceInput,
} from "./types";

export class SubmissionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionValidationError";
  }
}

const MANUAL_SUBMISSION_STATUSES = new Set<SubmissionStatus>(["draft", "ready"]);

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
    status: normalizeSubmissionStatus(row.status),
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
    evidenceSnapshot: parseSubmissionEvidenceSnapshot(row.evidenceSnapshotJson, row.createdAt),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function responsePackageExportDownloadUrl(intentId: string, exportId: string) {
  return `/api/intents/${encodeURIComponent(intentId)}/response-workspace/package/exports/${encodeURIComponent(exportId)}`;
}

function classifyArtifactEvidence(
  row: Pick<SubmissionEvidenceLinkedSupplierArtifactRow, "id" | "title" | "fileName" | "artifactType" | "purpose">,
): ArtifactEvidenceLink[] {
  const searchable = [row.artifactType, row.title, row.fileName, row.purpose].join(" ").toLowerCase();
  const complianceCategory = /capabil|sam|cert|eligib|registr|license|bond/.test(searchable)
    ? "eligibility"
    : /price|pricing|quote|cost|rate|budget/.test(searchable)
      ? "pricing"
      : /submit|signed|response|receipt|confirmation/.test(searchable)
        ? "submission"
        : /risk|security|insurance|audit|privacy/.test(searchable)
          ? "risk"
          : "documents";

  return [{
    complianceCategory,
    evidenceRole: `${complianceCategory}_evidence`,
    submissionEvidenceKey: `supplier_artifact:${row.id}`,
    label: row.title.trim() || row.fileName || row.id,
  }];
}

function emptyEvidenceSnapshot(capturedAt: string): SubmissionEvidenceSnapshot {
  return {
    capturedAt,
    responsePackageExports: [],
    linkedSupplierArtifacts: [],
    awardOutcome: null,
  };
}

function parseSubmissionEvidenceSnapshot(
  value: string | null | undefined,
  fallbackCapturedAt: string,
): SubmissionEvidenceSnapshot {
  if (!value || value === "{}") return emptyEvidenceSnapshot(fallbackCapturedAt);

  try {
    const parsed = JSON.parse(value) as Partial<SubmissionEvidenceSnapshot>;

    return {
      capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : fallbackCapturedAt,
      responsePackageExports: Array.isArray(parsed.responsePackageExports) ? parsed.responsePackageExports : [],
      linkedSupplierArtifacts: Array.isArray(parsed.linkedSupplierArtifacts) ? parsed.linkedSupplierArtifacts : [],
      awardOutcome: parsed.awardOutcome ?? null,
    };
  } catch {
    return emptyEvidenceSnapshot(fallbackCapturedAt);
  }
}

function snapshotVersionNumberById(exportRows: SubmissionEvidenceResponsePackageExportRow[]) {
  const versionBySnapshotId = new Map<string, number>();
  const chronologicalSnapshotIds = [...exportRows]
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt);
      return left.snapshotId.localeCompare(right.snapshotId);
    })
    .map((row) => row.snapshotId);

  for (const snapshotId of chronologicalSnapshotIds) {
    if (!versionBySnapshotId.has(snapshotId)) {
      versionBySnapshotId.set(snapshotId, versionBySnapshotId.size + 1);
    }
  }

  return versionBySnapshotId;
}

function hydrateSubmissionEvidenceLinks(
  exportRows: SubmissionEvidenceResponsePackageExportRow[],
  artifactRows: SubmissionEvidenceLinkedSupplierArtifactRow[],
  awardRow: SubmissionEvidenceAwardOutcomeRow | null | undefined,
): SubmissionEvidenceLinks {
  const linkedSupplierArtifacts: SubmissionEvidenceLinks["linkedSupplierArtifacts"] = [];
  const seenArtifactIds = new Set<string>();

  for (const row of artifactRows) {
    if (seenArtifactIds.has(row.id)) continue;
    seenArtifactIds.add(row.id);
    linkedSupplierArtifacts.push({
      id: row.id,
      name: row.title.trim() || row.fileName || row.id,
      artifactType: row.artifactType,
      purpose: row.purpose,
      evidenceLinks: classifyArtifactEvidence(row),
    });
  }

  let awardOutcome: SubmissionEvidenceLinks["awardOutcome"] = null;
  if (awardRow) {
    const status = awardRow.status;
    if (!isAwardOutcomeStatus(status)) {
      throw new Error("Invalid award outcome status.");
    }
    awardOutcome = {
      status,
      awardNoticeUrl: awardRow.awardNoticeUrl,
    };
  }
  const versionBySnapshotId = snapshotVersionNumberById(exportRows);

  return {
    responsePackageExports: exportRows.map((row) => ({
      id: row.id,
      format: isResponsePackageExportFormat(row.format) ? row.format : "markdown",
      downloadUrl: responsePackageExportDownloadUrl(row.intentId, row.id),
      snapshotId: row.snapshotId,
      snapshotTitle: row.snapshotTitle,
      snapshotVersionNumber: versionBySnapshotId.get(row.snapshotId) ?? 1,
      exportedAt: row.createdAt,
      reviewStatus: isResponsePackageExportReviewStatus(row.reviewStatus) ? row.reviewStatus : "pending_review",
    })),
    linkedSupplierArtifacts,
    awardOutcome,
  };
}

function freezeSubmissionEvidenceLinks(
  evidenceLinks: SubmissionEvidenceLinks,
  capturedAt: string,
): SubmissionEvidenceSnapshot {
  return {
    capturedAt,
    responsePackageExports: evidenceLinks.responsePackageExports.map((exportRecord) => ({ ...exportRecord })),
    linkedSupplierArtifacts: evidenceLinks.linkedSupplierArtifacts.map((artifact) => ({ ...artifact })),
    awardOutcome: evidenceLinks.awardOutcome ? { ...evidenceLinks.awardOutcome } : null,
  };
}

async function loadSubmissionEvidenceRows(
  database: AppDatabase,
  userId: string,
  intentId: string,
) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const [exportRows, artifactRows, awardRow] = mysql
    ? await Promise.all([
      listSubmissionEvidenceResponsePackageExportRowsFromMysql(mysql, userId, intentId),
      listSubmissionEvidenceLinkedSupplierArtifactRowsFromMysql(mysql, userId, intentId),
      findSubmissionEvidenceAwardOutcomeRowFromMysql(mysql, userId, intentId),
    ])
    : [
      listSubmissionEvidenceResponsePackageExportRows(database, userId, intentId),
      listSubmissionEvidenceLinkedSupplierArtifactRows(database, userId, intentId),
      findSubmissionEvidenceAwardOutcomeRow(database, userId, intentId),
    ];

  return { exportRows, artifactRows, awardRow };
}

function parseResponsePackageExportReadiness(row: SubmissionEvidenceResponsePackageExportRow) {
  try {
    const parsed = JSON.parse(row.readinessJson) as Record<string, unknown>;
    return {
      ready: parsed.ready === true,
      missingArtifactLinks: typeof parsed.missingArtifactLinks === "number"
        ? parsed.missingArtifactLinks
        : Number(parsed.missingArtifactLinks ?? 0),
    };
  } catch {
    return { ready: false, missingArtifactLinks: 0 };
  }
}

function approvedExportHasCompleteArtifacts(row: SubmissionEvidenceResponsePackageExportRow) {
  const readiness = parseResponsePackageExportReadiness(row);
  return readiness.ready && readiness.missingArtifactLinks === 0;
}

function buildSubmissionReadinessGate(input: {
  exportRows: SubmissionEvidenceResponsePackageExportRow[];
  artifactRows: SubmissionEvidenceLinkedSupplierArtifactRow[];
  confirmationReference?: string | null;
}): SubmissionReadinessGate {
  const approvedExportRows = input.exportRows.filter((row) => row.reviewStatus === "approved");
  const confirmationReferencePresent = Boolean(input.confirmationReference?.trim());
  const blockers: SubmissionReadinessBlocker[] = [];

  if (approvedExportRows.length === 0) {
    blockers.push({
      code: "approved_response_package_export_required",
      message: "Approve at least one response package export before confirming submission.",
    });
  }

  if (!confirmationReferencePresent) {
    blockers.push({
      code: "confirmation_reference_required",
      message: "Add a confirmation reference or receipt number before marking the submission submitted.",
    });
  }

  if (approvedExportRows.length > 0 && !approvedExportRows.some(approvedExportHasCompleteArtifacts)) {
    blockers.push({
      code: "required_artifact_missing",
      message: "Approved response package export must include all required artifact links before submission.",
    });
  } else if (input.artifactRows.length === 0) {
    blockers.push({
      code: "required_artifact_missing",
      message: "Link at least one required supplier artifact to the response workspace before submission.",
    });
  }

  return {
    canSubmit: blockers.length === 0,
    blockers,
    approvedResponsePackageExportCount: approvedExportRows.length,
    linkedSupplierArtifactCount: input.artifactRows.length,
    confirmationReferencePresent,
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
  if (input.status !== undefined && !MANUAL_SUBMISSION_STATUSES.has(input.status)) {
    throw new SubmissionValidationError("Submission status can only be manually set to draft or ready.");
  }

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

export async function listSubmissionConfirmations(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<SubmissionConfirmation[]> {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listSubmissionConfirmationRowsFromMysql(mysql, userId, intentId)
    : listSubmissionConfirmationRows(database, userId, intentId);

  return rows.map(hydrateSubmissionConfirmation);
}

export async function getSubmissionEvidenceLinks(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<SubmissionEvidenceLinks> {
  const { exportRows, artifactRows, awardRow } = await loadSubmissionEvidenceRows(database, userId, intentId);

  return hydrateSubmissionEvidenceLinks(exportRows, artifactRows, awardRow);
}

export async function getSubmissionReadinessGate(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: { confirmationReference?: string | null } = {},
): Promise<SubmissionReadinessGate> {
  await getOrCreateSubmissionGuidance(database, userId, intentId);
  const { exportRows, artifactRows } = await loadSubmissionEvidenceRows(database, userId, intentId);

  return buildSubmissionReadinessGate({
    exportRows,
    artifactRows,
    confirmationReference: input.confirmationReference,
  });
}

export async function createSubmissionConfirmation(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreateSubmissionConfirmationInput,
): Promise<SubmissionConfirmationResponse> {
  await getOrCreateSubmissionGuidance(database, userId, intentId);

  const timestamp = nowIso();
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const { exportRows, artifactRows, awardRow } = await loadSubmissionEvidenceRows(database, userId, intentId);
  const evidenceLinks = hydrateSubmissionEvidenceLinks(exportRows, artifactRows, awardRow);
  const readinessGate = buildSubmissionReadinessGate({
    exportRows,
    artifactRows,
    confirmationReference: input.confirmationReference,
  });
  const evidenceSnapshot = freezeSubmissionEvidenceLinks(evidenceLinks, timestamp);
  const row = mysql
    ? await createSubmissionConfirmationRowFromMysql(mysql, {
      id: `submission_confirmation_${crypto.randomUUID()}`,
      intentId,
      userId,
      submittedAt: input.submittedAt,
      method: input.method,
      confirmationReference: input.confirmationReference,
      confirmationNotes: input.confirmationNotes,
      evidenceSnapshot,
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
      evidenceSnapshot,
      timestamp,
    });

  if (!row) {
    throw new Error("Failed to create submission confirmation");
  }

  const status = readinessGate.canSubmit ? "submitted" : "needs_recovery";
  const submissionRow = mysql
    ? await updateSubmissionPathRowFromMysql(mysql, userId, intentId, { status }, nowIso())
    : updateSubmissionPathRow(database, userId, intentId, { status }, nowIso());

  if (!submissionRow) {
    throw new Error("Failed to update submission status");
  }

  if (mysql) {
    await writeAuditEventFromMysql(mysql, {
      eventName: "submission.confirmed",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "submission_confirmation",
      targetId: row.id,
      outcome: "success",
      severity: "info",
      source: "submission",
      occurredAt: timestamp,
      metadata: {
        intentId,
        method: input.method,
        status,
        hasConfirmationReference: Boolean(input.confirmationReference?.trim()),
        packageExportCount: evidenceSnapshot.responsePackageExports.length,
        linkedArtifactCount: evidenceSnapshot.linkedSupplierArtifacts.length,
        hasAwardOutcome: Boolean(evidenceSnapshot.awardOutcome),
        readinessGateCanSubmit: readinessGate.canSubmit,
        readinessBlockers: readinessGate.blockers.map((blocker) => blocker.code),
      },
      idempotencyKey: `submission_confirmation:${row.id}:confirmed`,
    });
  } else {
    writeAuditEvent(database, {
      eventName: "submission.confirmed",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "submission_confirmation",
      targetId: row.id,
      outcome: "success",
      severity: "info",
      source: "submission",
      occurredAt: timestamp,
      metadata: {
        intentId,
        method: input.method,
        status,
        hasConfirmationReference: Boolean(input.confirmationReference?.trim()),
        packageExportCount: evidenceSnapshot.responsePackageExports.length,
        linkedArtifactCount: evidenceSnapshot.linkedSupplierArtifacts.length,
        hasAwardOutcome: Boolean(evidenceSnapshot.awardOutcome),
        readinessGateCanSubmit: readinessGate.canSubmit,
        readinessBlockers: readinessGate.blockers.map((blocker) => blocker.code),
      },
      idempotencyKey: `submission_confirmation:${row.id}:confirmed`,
    });
  }

  return {
    confirmation: hydrateSubmissionConfirmation(row),
    submission: hydrateSubmissionPath(submissionRow),
    confirmations: await listSubmissionConfirmations(database, userId, intentId),
    evidenceLinks,
    readinessGate,
  };
}
