import crypto from "node:crypto";
import path from "node:path";
import { getMysqlAccountWorkspace } from "@/server/account/mysql-workspace";
import { getAccountWorkspace, ensureUserWorkspace } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { writeAuditEvent, writeAuditEventFromMysql } from "@/server/events/event-log";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { createObjectStorageProvider } from "@/server/storage/object-storage";
import { generateResponseWorkspaceItems } from "./generator";
import {
  createResponseWorkspaceActivityRows,
  createResponseWorkspaceActivityRowsFromMysql,
  createResponsePackageExportReviewEventRow,
  createResponsePackageExportReviewEventRowFromMysql,
  createResponsePackageSnapshotRow,
  createResponsePackageSnapshotRowFromMysql,
  createResponsePackageExportRow,
  createResponsePackageExportRowFromMysql,
  createResponseWorkspaceCommentRow,
  createResponseWorkspaceCommentRowFromMysql,
  createResponseWorkspaceItemRows,
  createResponseWorkspaceItemRowsFromMysql,
  findResponseWorkspaceCommentRow,
  findResponseWorkspaceCommentRowFromMysql,
  findResponseWorkspaceItemRow,
  findResponseWorkspaceItemRowFromMysql,
  findResponsePackageExportRow,
  findResponsePackageExportRowFromMysql,
  findResponsePackageSnapshotRow,
  findResponsePackageSnapshotRowFromMysql,
  listLinkableSupplierArtifactRows,
  listLinkableSupplierArtifactRowsFromMysql,
  listResponsePackageArtifactFileRows,
  listResponsePackageArtifactFileRowsFromMysql,
  listResponseWorkspaceLinkedArtifactRows,
  listResponseWorkspaceLinkedArtifactRowsFromMysql,
  listResponseWorkspaceActivityRows,
  listResponseWorkspaceActivityRowsFromMysql,
  listResponseWorkspaceCommentRows,
  listResponseWorkspaceCommentRowsFromMysql,
  listResponseWorkspaceItemRows,
  listResponseWorkspaceItemRowsFromMysql,
  listResponsePackageSnapshotRows,
  listResponsePackageSnapshotRowsFromMysql,
  listResponsePackageExportRows,
  listResponsePackageExportRowsFromMysql,
  listResponsePackageExportReviewEventRows,
  listResponsePackageExportReviewEventRowsFromMysql,
  markResponsePackageExportDownloadedRow,
  markResponsePackageExportDownloadedRowFromMysql,
  replaceResponseWorkspaceItemArtifactLinks,
  replaceResponseWorkspaceItemArtifactLinksFromMysql,
  updateResponsePackageExportReviewRow,
  updateResponsePackageExportReviewRowFromMysql,
  updateResponseWorkspaceItemRow,
  updateResponseWorkspaceItemRowFromMysql,
  type CreateResponseWorkspaceActivityRowInput,
  type ResponseWorkspaceActivityRow,
  type ResponseWorkspaceCommentRow,
  type ResponseWorkspaceItemRow,
  type ResponseWorkspaceLinkedArtifactRow,
  type ResponsePackageExportRow,
  type ResponsePackageExportReviewEventRow,
  type ResponsePackageSnapshotRow,
} from "./repository";
import { createStoredZip } from "./zip";
import {
  type CreateResponsePackageExportInput,
  type CreateResponsePackageSnapshotInput,
  type CreateResponseWorkspaceCommentInput,
  type ResponsePackageExport,
  type ResponsePackageExportFormat,
  type ResponsePackageExportReviewEvent,
  type ResponsePackageExportReviewStatus,
  type ResponsePackageGovernanceSummary,
  type ResponsePackageReviewerSummaryEntry,
  type ResponsePackageOutlineSection,
  type ResponsePackageComparisonItem,
  type ResponsePackageSnapshotComparison,
  type ResponsePackageReadinessSummary,
  type ResponsePackageSnapshot,
  type ResponsePackageSnapshotVersionChange,
  type ResponsePackageWorkspace,
  type ResponseWorkspaceActivity,
  type ResponseWorkspaceActivityEventType,
  type ArtifactEvidenceLink,
  isResponseWorkspaceItemKind,
  isResponseWorkspaceItemStatus,
  type ResponseWorkspaceComment,
  type ResponseWorkspaceLinkedArtifact,
  type ResponseWorkspace,
  type ResponseWorkspaceItem,
  type ResponseWorkspaceItemKind,
  type ResponseWorkspaceItemStatus,
  type ResponseWorkspaceUserSummary,
  type UpdateResponsePackageExportReviewInput,
  type UpdateResponseWorkspaceItemInput,
  isResponsePackageExportFormat,
  isResponsePackageExportReviewStatus,
} from "./types";

const MAX_TITLE_LENGTH = 180;
const MAX_NOTES_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 2000;
const MAX_REVIEW_NOTES_LENGTH = 2000;
const RESPONSE_PACKAGE_EXPORT_CONTENT_TYPE = "text/markdown; charset=utf-8";
const RESPONSE_PACKAGE_ZIP_CONTENT_TYPE = "application/zip";
const RESPONSE_PACKAGE_PDF_CONTENT_TYPE = "application/pdf";
const RESPONSE_PACKAGE_DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface ResponsePackageExportOptions {
  storageRoot?: string;
  now?: Date;
}

export class ResponseWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseWorkspaceValidationError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowIsoWithOptions(options: ResponsePackageExportOptions = {}) {
  return (options.now ?? new Date()).toISOString();
}

function normalizeResponsePackageExportFormat(value: unknown): ResponsePackageExportFormat {
  if (value === undefined || value === null || value === "") return "markdown";
  if (isResponsePackageExportFormat(value)) return value;
  throw new ResponseWorkspaceValidationError("Unsupported response package export format.");
}

function normalizeResponsePackageExportReviewInput(
  input: UpdateResponsePackageExportReviewInput,
): { reviewStatus: ResponsePackageExportReviewStatus; reviewNotes: string } {
  if (!isResponsePackageExportReviewStatus(input.reviewStatus)) {
    throw new ResponseWorkspaceValidationError("Unsupported response package review status.");
  }

  const reviewNotes = typeof input.reviewNotes === "string"
    ? truncate(input.reviewNotes.trim(), MAX_REVIEW_NOTES_LENGTH)
    : "";

  if (input.reviewStatus === "needs_changes" && !reviewNotes) {
    throw new ResponseWorkspaceValidationError("Review notes are required when requesting package changes.");
  }

  return {
    reviewStatus: input.reviewStatus,
    reviewNotes,
  };
}

function normalizeResponsePackageExportReviewStatus(value: unknown): ResponsePackageExportReviewStatus {
  if (isResponsePackageExportReviewStatus(value)) return value;
  throw new Error("Invalid response package export review status.");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function normalizeOptionalString(value: unknown, message: string, maxLength: number) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new ResponseWorkspaceValidationError(message);

  return truncate(value.trim(), maxLength);
}

function normalizeUpdateInput(input: UpdateResponseWorkspaceItemInput): UpdateResponseWorkspaceItemInput {
  if (typeof input.itemId !== "string" || !input.itemId.trim()) {
    throw new ResponseWorkspaceValidationError("Response workspace item is required.");
  }

  const normalized: UpdateResponseWorkspaceItemInput = { itemId: input.itemId.trim() };

  if (input.status !== undefined) {
    if (!isResponseWorkspaceItemStatus(input.status)) {
      throw new ResponseWorkspaceValidationError("Unsupported response workspace status.");
    }

    normalized.status = input.status;
  }

  if (input.title !== undefined) {
    const title = normalizeOptionalString(input.title, "Response workspace title must be a string.", MAX_TITLE_LENGTH);
    if (title === null || !title) {
      throw new ResponseWorkspaceValidationError("Response workspace title is required.");
    }
    normalized.title = title;
  }

  if (input.notes !== undefined) {
    const notes = normalizeOptionalString(input.notes, "Response workspace notes must be a string.", MAX_NOTES_LENGTH);
    normalized.notes = notes ?? "";
  }

  if (input.dueAt !== undefined) {
    if (input.dueAt !== null && typeof input.dueAt !== "string") {
      throw new ResponseWorkspaceValidationError("Response workspace due date must be a string.");
    }
    normalized.dueAt = input.dueAt?.trim() || null;
  }

  if (input.assignedUserId !== undefined) {
    if (input.assignedUserId !== null && typeof input.assignedUserId !== "string") {
      throw new ResponseWorkspaceValidationError("Assigned user must be a string.");
    }
    normalized.assignedUserId = input.assignedUserId?.trim() || null;
  }

  if (input.linkedArtifactIds !== undefined) {
    if (!Array.isArray(input.linkedArtifactIds)) {
      throw new ResponseWorkspaceValidationError("Linked artifacts must be an array.");
    }

    const linkedArtifactIds: string[] = [];
    for (const artifactId of input.linkedArtifactIds) {
      if (typeof artifactId !== "string" || !artifactId.trim()) {
        throw new ResponseWorkspaceValidationError("Linked artifact ids must be strings.");
      }
      const normalizedArtifactId = artifactId.trim();
      if (!linkedArtifactIds.includes(normalizedArtifactId)) {
        linkedArtifactIds.push(normalizedArtifactId);
      }
    }
    normalized.linkedArtifactIds = linkedArtifactIds;
  }

  return normalized;
}

function normalizeCommentInput(input: CreateResponseWorkspaceCommentInput): CreateResponseWorkspaceCommentInput {
  if (typeof input.itemId !== "string" || !input.itemId.trim()) {
    throw new ResponseWorkspaceValidationError("Response workspace item is required.");
  }

  if (typeof input.body !== "string" || !input.body.trim()) {
    throw new ResponseWorkspaceValidationError("Comment body is required.");
  }

  return {
    itemId: input.itemId.trim(),
    body: truncate(input.body.trim(), MAX_COMMENT_LENGTH),
  };
}

function hydrateItem(
  row: ResponseWorkspaceItemRow,
  membersByUserId: Map<string, ResponseWorkspaceUserSummary> = new Map(),
  linkedArtifacts: ResponseWorkspaceLinkedArtifact[] = [],
  activity: ResponseWorkspaceActivity[] = [],
): ResponseWorkspaceItem {
  if (!isResponseWorkspaceItemKind(row.kind)) {
    throw new Error("Invalid response workspace item field: kind");
  }

  if (!isResponseWorkspaceItemStatus(row.status)) {
    throw new Error("Invalid response workspace item field: status");
  }

  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    assignedUserId: row.assignedUserId,
    assignedUser: row.assignedUserId ? membersByUserId.get(row.assignedUserId) ?? null : null,
    kind: row.kind,
    title: row.title,
    status: row.status,
    notes: row.notes,
    dueAt: row.dueAt,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    linkedArtifacts,
    activity,
  };
}

function linkedArtifactDownloadUrl(intentId: string, artifactId: string) {
  return `/api/intents/${encodeURIComponent(intentId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function classifyArtifactEvidence(row: Pick<ResponseWorkspaceLinkedArtifactRow, "id" | "title" | "fileName" | "artifactType" | "purpose">): ArtifactEvidenceLink[] {
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

function hydrateLinkedArtifact(row: ResponseWorkspaceLinkedArtifactRow): ResponseWorkspaceLinkedArtifact {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    artifactType: row.artifactType,
    purpose: row.purpose,
    contentType: row.contentType,
    byteSize: Number(row.byteSize),
    checksumSha256: row.checksumSha256,
    reviewStatus: row.reviewStatus,
    downloadUrl: linkedArtifactDownloadUrl(row.intentId, row.id),
    evidenceLinks: classifyArtifactEvidence(row),
  };
}

function parseActivityMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hydrateActivity(row: ResponseWorkspaceActivityRow): ResponseWorkspaceActivity {
  return {
    id: row.id,
    intentId: row.intentId,
    itemId: row.itemId,
    actorUserId: row.actorUserId,
    actor: {
      userId: row.actorUserId,
      email: row.actorEmail,
      displayName: row.actorDisplayName,
    },
    eventType: row.eventType as ResponseWorkspaceActivityEventType,
    fromValue: row.fromValue,
    toValue: row.toValue,
    metadata: parseActivityMetadata(row.metadataJson),
    createdAt: row.createdAt,
  };
}

function hydrateComment(row: ResponseWorkspaceCommentRow): ResponseWorkspaceComment {
  return {
    id: row.id,
    intentId: row.intentId,
    itemId: row.itemId,
    authorUserId: row.authorUserId,
    author: {
      userId: row.authorUserId,
      email: row.authorEmail,
      displayName: row.authorDisplayName,
    },
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildSummary(items: ResponseWorkspaceItem[]) {
  const countKind = (kind: ResponseWorkspaceItemKind) => items.filter((item) => item.kind === kind).length;
  const countStatus = (status: ResponseWorkspaceItemStatus) => items.filter((item) => item.status === status).length;

  return {
    total: items.length,
    done: countStatus("done"),
    blocked: countStatus("blocked"),
    tasks: countKind("task"),
    checkpoints: countKind("checkpoint"),
    artifacts: countKind("artifact"),
    outlineSections: countKind("outline_section"),
  };
}

function buildPackageOutline(workspace: ResponseWorkspace): ResponsePackageOutlineSection[] {
  return workspace.items
    .filter((item) => item.kind === "outline_section")
    .map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      notes: item.notes,
      sortOrder: item.sortOrder,
      linkedArtifacts: item.linkedArtifacts,
    }));
}

function buildPackageReadiness(workspace: ResponseWorkspace): ResponsePackageReadinessSummary {
  const outline = buildPackageOutline(workspace);
  const artifactItems = workspace.items.filter((item) => item.kind === "artifact");
  const completedOutlineSections = outline.filter((section) => section.status === "done").length;
  const blockedItems = workspace.items.filter((item) => item.status === "blocked").length;
  const artifactPlaceholdersWithLinks = artifactItems.filter((item) => item.linkedArtifacts.length > 0).length;
  const missingArtifactLinks = artifactItems.length - artifactPlaceholdersWithLinks;
  const openItems = workspace.items.filter((item) => item.status !== "done").length;

  return {
    ready: outline.length > 0 &&
      completedOutlineSections === outline.length &&
      blockedItems === 0 &&
      missingArtifactLinks === 0,
    totalOutlineSections: outline.length,
    completedOutlineSections,
    blockedItems,
    artifactPlaceholders: artifactItems.length,
    artifactPlaceholdersWithLinks,
    missingArtifactLinks,
    openItems,
  };
}

function parsePackageOutline(value: string): ResponsePackageOutlineSection[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as ResponsePackageOutlineSection[] : [];
  } catch {
    return [];
  }
}

function parsePackageReadiness(value: string): ResponsePackageReadinessSummary {
  const fallback: ResponsePackageReadinessSummary = {
    ready: false,
    totalOutlineSections: 0,
    completedOutlineSections: 0,
    blockedItems: 0,
    artifactPlaceholders: 0,
    artifactPlaceholdersWithLinks: 0,
    missingArtifactLinks: 0,
    openItems: 0,
  };

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...fallback, ...parsed }
      : fallback;
  } catch {
    return fallback;
  }
}

function hydratePackageSnapshot(row: ResponsePackageSnapshotRow): ResponsePackageSnapshot {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    outline: parsePackageOutline(row.outlineJson),
    readiness: parsePackageReadiness(row.readinessJson),
    exports: [],
    version: buildFallbackSnapshotVersion(),
    createdAt: row.createdAt,
  };
}

function buildFallbackSnapshotVersion() {
  return {
    versionNumber: 1,
    previousSnapshotId: null,
    changeCount: 0,
    changes: [],
  };
}

function responsePackageExportDownloadUrl(intentId: string, exportId: string) {
  return `/api/intents/${encodeURIComponent(intentId)}/response-workspace/package/exports/${encodeURIComponent(exportId)}`;
}

function hydratePackageExport(row: ResponsePackageExportRow): ResponsePackageExport {
  if (row.status !== "ready") {
    throw new Error("Invalid response package export status.");
  }
  const reviewStatus = normalizeResponsePackageExportReviewStatus(row.reviewStatus);

  return {
    id: row.id,
    snapshotId: row.snapshotId,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    requestedByUserId: row.requestedByUserId,
    status: row.status,
    format: normalizeResponsePackageExportFormat(row.format),
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    readiness: parsePackageReadiness(row.readinessJson),
    downloadUrl: responsePackageExportDownloadUrl(row.intentId, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadedAt: row.downloadedAt,
    reviewStatus,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    reviewNotes: row.reviewNotes,
    reviewHistory: [],
  };
}

function hydratePackageExportReviewEvent(row: ResponsePackageExportReviewEventRow): ResponsePackageExportReviewEvent {
  return {
    id: row.id,
    exportId: row.exportId,
    snapshotId: row.snapshotId,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    actorUserId: row.actorUserId,
    fromReviewStatus: normalizeResponsePackageExportReviewStatus(row.fromReviewStatus),
    toReviewStatus: normalizeResponsePackageExportReviewStatus(row.toReviewStatus),
    reviewNotes: row.reviewNotes,
    createdAt: row.createdAt,
  };
}

function attachReviewHistoryToExports(
  exports: ResponsePackageExport[],
  reviewEvents: ResponsePackageExportReviewEvent[],
) {
  const historyByExportId = new Map<string, ResponsePackageExportReviewEvent[]>();

  for (const event of reviewEvents) {
    const records = historyByExportId.get(event.exportId) ?? [];
    records.push(event);
    historyByExportId.set(event.exportId, records);
  }

  return exports.map((exportRecord) => ({
    ...exportRecord,
    reviewHistory: historyByExportId.get(exportRecord.id) ?? [],
  }));
}

function attachExportsToSnapshots(
  snapshots: ResponsePackageSnapshot[],
  exports: ResponsePackageExport[],
) {
  const exportsBySnapshotId = new Map<string, ResponsePackageExport[]>();

  for (const exportRecord of exports) {
    const records = exportsBySnapshotId.get(exportRecord.snapshotId) ?? [];
    records.push(exportRecord);
    exportsBySnapshotId.set(exportRecord.snapshotId, records);
  }

  const snapshotsWithExports = snapshots.map((snapshot) => ({
    ...snapshot,
    exports: exportsBySnapshotId.get(snapshot.id) ?? [],
  }));

  return attachVersionsToSnapshots(snapshotsWithExports);
}

function summarizeReadiness(readiness: ResponsePackageReadinessSummary) {
  return [
    readiness.ready ? "ready" : "needs_work",
    `outline:${readiness.completedOutlineSections}/${readiness.totalOutlineSections}`,
    `missing_artifacts:${readiness.missingArtifactLinks}`,
    `blocked:${readiness.blockedItems}`,
    `open:${readiness.openItems}`,
  ].join(" ");
}

function summarizeLinkedArtifactIds(section: ResponsePackageOutlineSection) {
  return section.linkedArtifacts.map((artifact) => artifact.id).sort().join(",");
}

function buildSnapshotChanges(
  previous: ResponsePackageSnapshot | null,
  current: ResponsePackageSnapshot,
): ResponsePackageSnapshotVersionChange[] {
  if (!previous) {
    return [{
      kind: "created",
      label: "Snapshot created",
      fromValue: null,
      toValue: current.title,
    }];
  }

  const changes: ResponsePackageSnapshotVersionChange[] = [];
  const previousReadiness = summarizeReadiness(previous.readiness);
  const currentReadiness = summarizeReadiness(current.readiness);

  if (previousReadiness !== currentReadiness) {
    changes.push({
      kind: "readiness_changed",
      label: "Readiness",
      fromValue: previousReadiness,
      toValue: currentReadiness,
    });
  }

  const previousSections = new Map(previous.outline.map((section) => [section.id, section]));

  for (const section of current.outline) {
    const previousSection = previousSections.get(section.id);
    if (!previousSection) continue;

    if (previousSection.status !== section.status) {
      changes.push({
        kind: "outline_status_changed",
        label: section.title,
        fromValue: previousSection.status,
        toValue: section.status,
      });
    }

    const previousArtifactIds = summarizeLinkedArtifactIds(previousSection);
    const currentArtifactIds = summarizeLinkedArtifactIds(section);
    if (previousArtifactIds !== currentArtifactIds) {
      changes.push({
        kind: "linked_artifacts_changed",
        label: section.title,
        fromValue: previousArtifactIds,
        toValue: currentArtifactIds,
      });
    }
  }

  return changes;
}

function attachVersionsToSnapshots(snapshots: ResponsePackageSnapshot[]) {
  const chronological = snapshots.slice().reverse();
  const versionBySnapshotId = new Map<string, ResponsePackageSnapshot["version"]>();

  chronological.forEach((snapshot, index) => {
    const previous = index > 0 ? chronological[index - 1] : null;
    const changes = buildSnapshotChanges(previous, snapshot);
    versionBySnapshotId.set(snapshot.id, {
      versionNumber: index + 1,
      previousSnapshotId: previous?.id ?? null,
      changeCount: changes.length,
      changes,
    });
  });

  return snapshots.map((snapshot) => ({
    ...snapshot,
    version: versionBySnapshotId.get(snapshot.id) ?? buildFallbackSnapshotVersion(),
  }));
}

function buildPackageVersionHistory(snapshots: ResponsePackageSnapshot[]) {
  const entries = snapshots.map((snapshot) => ({
    snapshotId: snapshot.id,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    versionNumber: snapshot.version.versionNumber,
    previousSnapshotId: snapshot.version.previousSnapshotId,
    changeCount: snapshot.version.changeCount,
    changes: snapshot.version.changes,
  }));

  return {
    totalVersions: entries.length,
    latestVersionNumber: entries.reduce((latest, entry) => Math.max(latest, entry.versionNumber), 0),
    totalChanges: entries.reduce((total, entry) => total + entry.changeCount, 0),
    entries,
  };
}

function timestampMs(value: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function buildPackageGovernanceSummary(
  snapshots: ResponsePackageSnapshot[],
  now: Date = new Date(),
): ResponsePackageGovernanceSummary {
  const requiredApprovedExports = 1;
  const exports = snapshots.flatMap((snapshot) => snapshot.exports);
  const pendingExports = exports.filter((exportRecord) => exportRecord.reviewStatus === "pending_review");
  const approvedCount = exports.filter((exportRecord) => exportRecord.reviewStatus === "approved").length;
  const needsChangesCount = exports.filter((exportRecord) => exportRecord.reviewStatus === "needs_changes").length;
  const nowMs = now.getTime();
  let longestPendingAgeHours: number | null = null;
  let latestReviewerUserId: string | null = null;
  let latestReviewMs: number | null = null;
  const reviewTimeline = exports
    .flatMap((exportRecord) => exportRecord.reviewHistory)
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt);
      return left.id.localeCompare(right.id);
    });
  const reviewerStats = new Map<string, ResponsePackageReviewerSummaryEntry>();

  for (const exportRecord of pendingExports) {
    const createdMs = timestampMs(exportRecord.createdAt);
    if (createdMs === null) continue;
    const ageHours = Math.max(0, Math.floor((nowMs - createdMs) / (60 * 60 * 1000)));
    longestPendingAgeHours = Math.max(longestPendingAgeHours ?? 0, ageHours);
  }

  for (const event of reviewTimeline) {
    const eventMs = timestampMs(event.createdAt);
    if (eventMs !== null && (latestReviewMs === null || eventMs > latestReviewMs)) {
      latestReviewMs = eventMs;
      latestReviewerUserId = event.actorUserId;
    }

    const existing = reviewerStats.get(event.actorUserId) ?? {
      userId: event.actorUserId,
      reviewCount: 0,
      approvedCount: 0,
      needsChangesCount: 0,
      latestReviewedAt: event.createdAt,
    };
    existing.reviewCount += 1;
    if (event.toReviewStatus === "approved") existing.approvedCount += 1;
    if (event.toReviewStatus === "needs_changes") existing.needsChangesCount += 1;
    if (timestampMs(event.createdAt) !== null && timestampMs(existing.latestReviewedAt) !== null) {
      if (Date.parse(event.createdAt) > Date.parse(existing.latestReviewedAt)) {
        existing.latestReviewedAt = event.createdAt;
      }
    } else if (event.createdAt > existing.latestReviewedAt) {
      existing.latestReviewedAt = event.createdAt;
    }
    reviewerStats.set(event.actorUserId, existing);
  }

  for (const exportRecord of exports) {
    const reviewedMs = timestampMs(exportRecord.reviewedAt);
    if (reviewedMs !== null && exportRecord.reviewedByUserId && (latestReviewMs === null || reviewedMs > latestReviewMs)) {
      latestReviewMs = reviewedMs;
      latestReviewerUserId = exportRecord.reviewedByUserId;
    }
  }
  const reviewers = [...reviewerStats.values()].sort((left, right) => {
    if (right.latestReviewedAt !== left.latestReviewedAt) return right.latestReviewedAt.localeCompare(left.latestReviewedAt);
    return left.userId.localeCompare(right.userId);
  });
  const approvalThreshold = {
    requiredApprovedExports,
    approvedExports: approvedCount,
    met: approvedCount >= requiredApprovedExports,
  };

  return {
    pendingReviewCount: pendingExports.length,
    approvedCount,
    needsChangesCount,
    longestPendingAgeHours,
    latestReviewerUserId,
    canSubmitWithReviewedExport: approvalThreshold.met,
    reviewerSummary: {
      reviewerCount: reviewers.length,
      reviewers,
    },
    reviewTimeline,
    approvalThreshold,
    readinessReason: approvalThreshold.met
      ? "Approved export threshold met."
      : `At least ${requiredApprovedExports} approved response package export is required before submission.`,
  };
}

function addComparisonItemIfChanged(
  items: ResponsePackageComparisonItem[],
  item: ResponsePackageComparisonItem,
) {
  if (item.fromValue !== item.toValue) {
    items.push(item);
  }
}

function buildSnapshotComparison(
  fromSnapshot: ResponsePackageSnapshot,
  toSnapshot: ResponsePackageSnapshot,
): ResponsePackageSnapshotComparison {
  const items: ResponsePackageComparisonItem[] = [];
  addComparisonItemIfChanged(items, {
    kind: "readiness",
    label: "Readiness",
    fromValue: summarizeReadiness(fromSnapshot.readiness),
    toValue: summarizeReadiness(toSnapshot.readiness),
  });

  const fromSections = new Map(fromSnapshot.outline.map((section) => [section.id, section]));

  for (const toSection of toSnapshot.outline) {
    const fromSection = fromSections.get(toSection.id);
    if (!fromSection) continue;

    addComparisonItemIfChanged(items, {
      kind: "outline_status",
      label: toSection.title,
      fromValue: fromSection.status,
      toValue: toSection.status,
    });
    addComparisonItemIfChanged(items, {
      kind: "outline_notes",
      label: toSection.title,
      fromValue: fromSection.notes,
      toValue: toSection.notes,
    });
    addComparisonItemIfChanged(items, {
      kind: "linked_artifacts",
      label: toSection.title,
      fromValue: summarizeLinkedArtifactIds(fromSection),
      toValue: summarizeLinkedArtifactIds(toSection),
    });
  }

  return {
    comparisonKey: `${fromSnapshot.id}:${toSnapshot.id}`,
    fromSnapshotId: fromSnapshot.id,
    toSnapshotId: toSnapshot.id,
    fromTitle: fromSnapshot.title,
    toTitle: toSnapshot.title,
    fromCreatedAt: fromSnapshot.createdAt,
    toCreatedAt: toSnapshot.createdAt,
    fromVersionNumber: fromSnapshot.version.versionNumber,
    toVersionNumber: toSnapshot.version.versionNumber,
    changeCount: items.length,
    items,
  };
}

function buildPackageVersionComparisons(snapshots: ResponsePackageSnapshot[]) {
  const chronological = snapshots.slice().reverse();
  const comparisons: ResponsePackageSnapshotComparison[] = [];

  for (let fromIndex = 0; fromIndex < chronological.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < chronological.length; toIndex += 1) {
      comparisons.push(buildSnapshotComparison(chronological[fromIndex], chronological[toIndex]));
    }
  }

  return comparisons.sort((left, right) => {
    if (right.toVersionNumber !== left.toVersionNumber) return right.toVersionNumber - left.toVersionNumber;
    return right.fromVersionNumber - left.fromVersionNumber;
  });
}

function defaultPackageVersionComparison(
  snapshots: ResponsePackageSnapshot[],
  comparisons: ResponsePackageSnapshotComparison[],
) {
  if (snapshots.length < 2) return null;

  const latest = snapshots[0];
  const previous = snapshots[1];
  return comparisons.find((comparison) =>
    comparison.fromSnapshotId === previous.id && comparison.toSnapshotId === latest.id
  ) ?? null;
}

function normalizeSnapshotTitle(input: CreateResponsePackageSnapshotInput | undefined, timestamp: string) {
  const title = input?.title;
  if (title === undefined) {
    return `Response package snapshot ${timestamp.slice(0, 10)}`;
  }
  if (typeof title !== "string" || !title.trim()) {
    throw new ResponseWorkspaceValidationError("Response package snapshot title is required.");
  }

  return truncate(title.trim(), MAX_TITLE_LENGTH);
}

async function listPackageSnapshots(database: AppDatabase, userId: string, intentId: string) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listResponsePackageSnapshotRowsFromMysql(mysql, userId, intentId)
    : listResponsePackageSnapshotRows(database, userId, intentId);

  return rows.map(hydratePackageSnapshot);
}

async function listPackageExports(database: AppDatabase, userId: string, intentId: string) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listResponsePackageExportRowsFromMysql(mysql, userId, intentId)
    : listResponsePackageExportRows(database, userId, intentId);
  const reviewRows = mysql
    ? await listResponsePackageExportReviewEventRowsFromMysql(mysql, userId, intentId)
    : listResponsePackageExportReviewEventRows(database, userId, intentId);

  return attachReviewHistoryToExports(
    rows.map(hydratePackageExport),
    reviewRows.map(hydratePackageExportReviewEvent),
  );
}

async function getPackageSnapshotRow(
  database: AppDatabase,
  userId: string,
  intentId: string,
  snapshotId: string,
) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  return mysql
    ? await findResponsePackageSnapshotRowFromMysql(mysql, userId, intentId, snapshotId)
    : findResponsePackageSnapshotRow(database, userId, intentId, snapshotId);
}

function exportStorageRoot(options: ResponsePackageExportOptions = {}) {
  return options.storageRoot ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "response-package-exports");
}

function sanitizeExportName(value: string) {
  const safe = value.trim().replace(/[\\/]/g, "-").replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return safe || "response-package";
}

function renderResponsePackageMarkdown(snapshot: ResponsePackageSnapshot) {
  const readiness = snapshot.readiness;
  const artifacts = new Map<string, ResponseWorkspaceLinkedArtifact>();
  for (const section of snapshot.outline) {
    for (const artifact of section.linkedArtifacts) {
      artifacts.set(artifact.id, artifact);
    }
  }

  const lines = [
    `# ${snapshot.title}`,
    "",
    "## Package Manifest",
    "",
    `- Snapshot ID: ${snapshot.id}`,
    `- Intent ID: ${snapshot.intentId}`,
    `- Bid ID: ${snapshot.bidId}`,
    `- User ID: ${snapshot.userId}`,
    `- Created: ${snapshot.createdAt}`,
    "- Export format: markdown",
    `- Linked artifacts: ${artifacts.size}`,
    `- Readiness JSON: ${JSON.stringify(snapshot.readiness)}`,
    "",
    "## Artifact Manifest",
    "",
    ...(
      artifacts.size > 0
        ? [...artifacts.values()].flatMap((artifact) => [
          `- ${artifact.title}`,
          `  - Artifact ID: ${artifact.id}`,
          `  - File: ${artifact.fileName}`,
          `  - Type: ${artifact.artifactType}`,
          `  - Purpose: ${artifact.purpose}`,
          `  - Content type: ${artifact.contentType}`,
          `  - Byte size: ${artifact.byteSize}`,
          `  - Checksum SHA-256: ${artifact.checksumSha256}`,
          `  - Review status: ${artifact.reviewStatus}`,
          `  - Download URL: ${artifact.downloadUrl}`,
        ])
        : ["No linked artifacts were included in this snapshot."]
    ),
    "",
    "## Readiness",
    "",
    `- Ready: ${readiness.ready ? "yes" : "no"}`,
    `- Outline complete: ${readiness.completedOutlineSections}/${readiness.totalOutlineSections}`,
    `- Missing artifacts: ${readiness.missingArtifactLinks}`,
    `- Blocked items: ${readiness.blockedItems}`,
    `- Open items: ${readiness.openItems}`,
    "",
    "## Outline",
    "",
  ];

  for (const section of snapshot.outline) {
    lines.push(`### ${section.title}`);
    lines.push("");
    lines.push(`- Status: ${section.status}`);
    if (section.notes) lines.push(`- Notes: ${section.notes}`);
    if (section.linkedArtifacts.length > 0) {
      lines.push("- Linked artifacts:");
      for (const artifact of section.linkedArtifacts) {
        lines.push(`  - ${artifact.title} (${artifact.fileName})`);
      }
    }
    lines.push("");
  }

  if (snapshot.outline.length === 0) {
    lines.push("No outline sections were available when this snapshot was created.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderResponsePackageText(snapshot: ResponsePackageSnapshot, format: ResponsePackageExportFormat) {
  const lines = [
    snapshot.title,
    "",
    "Package Manifest",
    `Snapshot ID: ${snapshot.id}`,
    `Intent ID: ${snapshot.intentId}`,
    `Bid ID: ${snapshot.bidId}`,
    `User ID: ${snapshot.userId}`,
    `Created: ${snapshot.createdAt}`,
    `Export format: ${format}`,
    "",
    "Readiness",
    `Ready: ${snapshot.readiness.ready ? "yes" : "no"}`,
    `Outline complete: ${snapshot.readiness.completedOutlineSections}/${snapshot.readiness.totalOutlineSections}`,
    `Missing artifacts: ${snapshot.readiness.missingArtifactLinks}`,
    `Blocked items: ${snapshot.readiness.blockedItems}`,
    `Open items: ${snapshot.readiness.openItems}`,
    "",
    "Outline",
  ];

  for (const section of snapshot.outline) {
    lines.push("");
    lines.push(section.title);
    lines.push(`Status: ${section.status}`);
    if (section.notes) lines.push(`Notes: ${section.notes}`);
    if (section.linkedArtifacts.length > 0) {
      lines.push("Linked artifacts:");
      for (const artifact of section.linkedArtifacts) {
        lines.push(`- ${artifact.title} (${artifact.fileName})`);
      }
    }
  }

  if (snapshot.outline.length === 0) {
    lines.push("");
    lines.push("No outline sections were available when this snapshot was created.");
  }

  return lines;
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function renderResponsePackagePdf(snapshot: ResponsePackageSnapshot) {
  const lines = renderResponsePackageText(snapshot, "pdf").slice(0, 44);
  const content = [
    "BT",
    "/F1 12 Tf",
    "14 TL",
    "72 740 Td",
    ...lines.flatMap((line, index) => [
      index === 0 ? "/F1 16 Tf" : index === 1 ? "/F1 12 Tf" : null,
      `(${escapePdfText(line)}) Tj`,
      "T*",
    ]).filter((line): line is string => Boolean(line)),
    "ET",
  ].join("\n");
  const contentLength = Buffer.byteLength(content, "latin1");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${contentLength} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function docxParagraph(value: string) {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`;
}

function renderResponsePackageDocx(snapshot: ResponsePackageSnapshot, generatedAt: string) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${renderResponsePackageText(snapshot, "docx").map(docxParagraph).join("\n    ")}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>
`;

  return createStoredZip([
    {
      path: "[Content_Types].xml",
      bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
`,
    },
    {
      path: "_rels/.rels",
      bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
`,
    },
    {
      path: "docProps/core.xml",
      bytes: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:title>${escapeXmlText(snapshot.title)}</dc:title>
  <dcterms:created>${escapeXmlText(generatedAt)}</dcterms:created>
</cp:coreProperties>
`,
    },
    {
      path: "word/document.xml",
      bytes: documentXml,
    },
  ], new Date(generatedAt));
}

function sha256Hex(bytes: Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function collectSnapshotArtifacts(snapshot: ResponsePackageSnapshot) {
  const artifacts = new Map<string, ResponseWorkspaceLinkedArtifact>();

  for (const section of snapshot.outline) {
    for (const artifact of section.linkedArtifacts) {
      artifacts.set(artifact.id, artifact);
    }
  }

  return [...artifacts.values()];
}

function sanitizeZipFileName(value: string) {
  const safe = value.trim().replace(/[\\/]/g, "-").replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return safe || "artifact.bin";
}

function artifactZipPath(artifact: ResponseWorkspaceLinkedArtifact) {
  return `artifacts/${sanitizeExportName(artifact.id)}-${sanitizeZipFileName(artifact.fileName)}`;
}

async function listPackageArtifactFiles(
  database: AppDatabase,
  userId: string,
  intentId: string,
  artifactIds: string[],
) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listResponsePackageArtifactFileRowsFromMysql(mysql, userId, intentId, artifactIds)
    : listResponsePackageArtifactFileRows(database, userId, intentId, artifactIds);

  return new Map(rows.map((row) => [row.id, row]));
}

async function renderResponsePackageZip(
  database: AppDatabase,
  userId: string,
  intentId: string,
  snapshot: ResponsePackageSnapshot,
  generatedAt: string,
) {
  const markdownBytes = Buffer.from(renderResponsePackageMarkdown(snapshot), "utf8");
  const artifacts = collectSnapshotArtifacts(snapshot);
  const artifactFilesById = await listPackageArtifactFiles(
    database,
    userId,
    intentId,
    artifacts.map((artifact) => artifact.id),
  );
  const zipEntries: Array<{ path: string; bytes: Buffer }> = [
    { path: "README.md", bytes: markdownBytes },
  ];
  const manifestArtifacts: Array<Record<string, unknown>> = [];
  const objectStorage = createObjectStorageProvider();

  for (const artifact of artifacts) {
    const pathInZip = artifactZipPath(artifact);
    const artifactFile = artifactFilesById.get(artifact.id);
    const manifestArtifact = {
      id: artifact.id,
      title: artifact.title,
      fileName: artifact.fileName,
      path: pathInZip,
      artifactType: artifact.artifactType,
      purpose: artifact.purpose,
      contentType: artifact.contentType,
      byteSize: artifact.byteSize,
      checksumSha256: artifact.checksumSha256,
      reviewStatus: artifact.reviewStatus,
      missing: true,
    };

    if (!artifactFile) {
      manifestArtifacts.push(manifestArtifact);
      continue;
    }

    try {
      const artifactBytes = await objectStorage.getObject(artifactFile.storagePath, {
        expectedByteSize: artifactFile.byteSize,
        expectedChecksumSha256: artifactFile.checksumSha256,
      });
      zipEntries.push({ path: pathInZip, bytes: artifactBytes });
      manifestArtifacts.push({
        ...manifestArtifact,
        byteSize: artifactBytes.byteLength,
        checksumSha256: sha256Hex(artifactBytes),
        missing: false,
      });
    } catch {
      manifestArtifacts.push(manifestArtifact);
    }
  }

  const manifest = {
    version: 1,
    format: "zip",
    intentId: snapshot.intentId,
    bidId: snapshot.bidId,
    snapshotId: snapshot.id,
    title: snapshot.title,
    generatedAt,
    snapshotCreatedAt: snapshot.createdAt,
    readiness: snapshot.readiness,
    outline: snapshot.outline.map((section) => ({
      id: section.id,
      title: section.title,
      status: section.status,
      sortOrder: section.sortOrder,
      linkedArtifactIds: section.linkedArtifacts.map((artifact) => artifact.id),
    })),
    files: [
      {
        path: "README.md",
        role: "markdown",
        byteSize: markdownBytes.byteLength,
        checksumSha256: sha256Hex(markdownBytes),
      },
    ],
    artifacts: manifestArtifacts,
  };

  zipEntries.splice(1, 0, {
    path: "manifest.json",
    bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  });

  return createStoredZip(zipEntries, new Date(generatedAt));
}

function responsePackageExportExtension(format: ResponsePackageExportFormat) {
  switch (format) {
    case "markdown":
      return "md";
    case "zip":
      return "zip";
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
  }
}

function responsePackageExportContentType(format: ResponsePackageExportFormat) {
  switch (format) {
    case "markdown":
      return RESPONSE_PACKAGE_EXPORT_CONTENT_TYPE;
    case "zip":
      return RESPONSE_PACKAGE_ZIP_CONTENT_TYPE;
    case "pdf":
      return RESPONSE_PACKAGE_PDF_CONTENT_TYPE;
    case "docx":
      return RESPONSE_PACKAGE_DOCX_CONTENT_TYPE;
  }
}

async function renderResponsePackageExport(
  database: AppDatabase,
  userId: string,
  intentId: string,
  snapshot: ResponsePackageSnapshot,
  format: ResponsePackageExportFormat,
  generatedAt: string,
) {
  switch (format) {
    case "markdown":
      return Buffer.from(renderResponsePackageMarkdown(snapshot), "utf8");
    case "zip":
      return renderResponsePackageZip(database, userId, intentId, snapshot, generatedAt);
    case "pdf":
      return renderResponsePackagePdf(snapshot);
    case "docx":
      return renderResponsePackageDocx(snapshot, generatedAt);
  }
}

async function workspaceMembersByUserId(database: AppDatabase, userId: string) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  try {
    const workspace = mysql
      ? await getMysqlAccountWorkspace(mysql, userId)
      : getAccountWorkspace(database, userId);

    return new Map(workspace.members
      .filter((member) => member.status === "active")
      .map((member) => [member.userId, {
        userId: member.userId,
        email: member.email,
        displayName: member.displayName,
      } satisfies ResponseWorkspaceUserSummary]));
  } catch {
    const workspace = ensureUserWorkspace(database, userId);
    return new Map([[userId, {
      userId,
      email: null,
      displayName: workspace.organizationName === "Personal Workspace" ? null : workspace.organizationName,
    }]]);
  }
}

async function validateAssignedUser(database: AppDatabase, userId: string, assignedUserId: string | null | undefined) {
  if (assignedUserId === undefined || assignedUserId === null) return;
  const members = await workspaceMembersByUserId(database, userId);
  if (!members.has(assignedUserId)) {
    throw new ResponseWorkspaceValidationError("Assigned user must be an active workspace member.");
  }
}

async function validateLinkedArtifacts(
  database: AppDatabase,
  userId: string,
  intentId: string,
  linkedArtifactIds: string[] | undefined,
) {
  if (linkedArtifactIds === undefined || linkedArtifactIds.length === 0) return;
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listLinkableSupplierArtifactRowsFromMysql(mysql, userId, intentId, linkedArtifactIds)
    : listLinkableSupplierArtifactRows(database, userId, intentId, linkedArtifactIds);
  const availableIds = new Set(rows.map((row) => row.id));

  if (linkedArtifactIds.some((artifactId) => !availableIds.has(artifactId))) {
    throw new ResponseWorkspaceValidationError("Linked artifacts must belong to this response workspace.");
  }
}

function activityValue(value: string | null | undefined) {
  return value?.trim() || null;
}

function artifactActivityValue(ids: string[]) {
  return [...ids].sort().join(",");
}

function buildActivityRow(input: {
  intentId: string;
  itemId: string;
  actorUserId: string;
  eventType: ResponseWorkspaceActivityEventType;
  fromValue: string | null;
  toValue: string | null;
  metadata?: Record<string, unknown>;
  timestamp: string;
}): CreateResponseWorkspaceActivityRowInput {
  return {
    id: `response_workspace_activity_${crypto.randomUUID()}`,
    intentId: input.intentId,
    itemId: input.itemId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    fromValue: input.fromValue,
    toValue: input.toValue,
    metadataJson: JSON.stringify(input.metadata ?? {}),
    createdAt: input.timestamp,
  };
}

function updateActivityRows(input: {
  intentId: string;
  actorUserId: string;
  existing: ResponseWorkspaceItemRow;
  normalized: UpdateResponseWorkspaceItemInput;
  currentLinkedArtifactIds: string[];
  timestamp: string;
}) {
  const rows: CreateResponseWorkspaceActivityRowInput[] = [];
  const addIfChanged = (
    eventType: ResponseWorkspaceActivityEventType,
    fromValue: string | null,
    toValue: string | null,
    metadata?: Record<string, unknown>,
  ) => {
    if (fromValue === toValue) return;
    rows.push(buildActivityRow({
      intentId: input.intentId,
      itemId: input.existing.id,
      actorUserId: input.actorUserId,
      eventType,
      fromValue,
      toValue,
      metadata,
      timestamp: input.timestamp,
    }));
  };

  if (input.normalized.status !== undefined) {
    addIfChanged("status_changed", input.existing.status, input.normalized.status);
  }
  if (input.normalized.notes !== undefined) {
    addIfChanged("notes_updated", activityValue(input.existing.notes), activityValue(input.normalized.notes));
  }
  if (input.normalized.assignedUserId !== undefined) {
    addIfChanged(
      "assignee_changed",
      activityValue(input.existing.assignedUserId),
      activityValue(input.normalized.assignedUserId),
    );
  }
  if (input.normalized.dueAt !== undefined) {
    addIfChanged("due_date_changed", activityValue(input.existing.dueAt), activityValue(input.normalized.dueAt));
  }
  if (input.normalized.title !== undefined) {
    addIfChanged("title_updated", input.existing.title, input.normalized.title);
  }
  if (input.normalized.linkedArtifactIds !== undefined) {
    addIfChanged(
      "linked_artifacts_updated",
      artifactActivityValue(input.currentLinkedArtifactIds),
      artifactActivityValue(input.normalized.linkedArtifactIds),
      {
        fromIds: [...input.currentLinkedArtifactIds].sort(),
        toIds: [...input.normalized.linkedArtifactIds].sort(),
      },
    );
  }

  return rows;
}

async function loadWorkspace(database: AppDatabase, userId: string, intentId: string): Promise<ResponseWorkspace> {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listResponseWorkspaceItemRowsFromMysql(mysql, userId, intentId)
    : listResponseWorkspaceItemRows(database, userId, intentId);
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const membersByUserId = await workspaceMembersByUserId(database, userId);
  const linkedArtifactRows = mysql
    ? await listResponseWorkspaceLinkedArtifactRowsFromMysql(mysql, rows.map((row) => row.id))
    : listResponseWorkspaceLinkedArtifactRows(database, rows.map((row) => row.id));
  const activityRows = mysql
    ? await listResponseWorkspaceActivityRowsFromMysql(mysql, rows.map((row) => row.id))
    : listResponseWorkspaceActivityRows(database, rows.map((row) => row.id));
  const linkedArtifactsByItemId = new Map<string, ResponseWorkspaceLinkedArtifact[]>();
  const activityByItemId = new Map<string, ResponseWorkspaceActivity[]>();

  for (const row of linkedArtifactRows) {
    const linkedArtifacts = linkedArtifactsByItemId.get(row.itemId) ?? [];
    linkedArtifacts.push(hydrateLinkedArtifact(row));
    linkedArtifactsByItemId.set(row.itemId, linkedArtifacts);
  }

  for (const row of activityRows) {
    const activity = activityByItemId.get(row.itemId) ?? [];
    activity.push(hydrateActivity(row));
    activityByItemId.set(row.itemId, activity);
  }

  const items = rows.map((row) =>
    hydrateItem(
      row,
      membersByUserId,
      linkedArtifactsByItemId.get(row.id) ?? [],
      activityByItemId.get(row.id) ?? [],
    ),
  );

  return {
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    summary: buildSummary(items),
    items,
  };
}

export async function getOrCreateResponseWorkspace(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<ResponseWorkspace> {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const existing = mysql
    ? await listResponseWorkspaceItemRowsFromMysql(mysql, userId, intentId)
    : listResponseWorkspaceItemRows(database, userId, intentId);

  if (existing.length > 0) {
    return loadWorkspace(database, userId, intentId);
  }

  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const timestamp = nowIso();
  const items = generateResponseWorkspaceItems(intent).map((item) => ({
    ...item,
    id: `response_workspace_item_${crypto.randomUUID()}`,
  }));
  if (mysql) {
    await createResponseWorkspaceItemRowsFromMysql(mysql, {
      intentId: intent.id,
      bidId: intent.bid.id,
      userId,
      items,
      timestamp,
    });
  } else {
    createResponseWorkspaceItemRows(database, {
      intentId: intent.id,
      bidId: intent.bid.id,
      userId,
      items,
      timestamp,
    });
  }

  return loadWorkspace(database, userId, intentId);
}

export async function getResponsePackageWorkspace(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<ResponsePackageWorkspace> {
  const workspace = await getOrCreateResponseWorkspace(database, userId, intentId);
  const outline = buildPackageOutline(workspace);
  const readiness = buildPackageReadiness(workspace);
  const snapshots = attachExportsToSnapshots(
    await listPackageSnapshots(database, userId, intentId),
    await listPackageExports(database, userId, intentId),
  );
  const versionComparisons = buildPackageVersionComparisons(snapshots);

  return {
    workspace,
    outline,
    readiness,
    snapshots,
    governanceSummary: buildPackageGovernanceSummary(snapshots),
    versionHistory: buildPackageVersionHistory(snapshots),
    versionComparisons,
    defaultVersionComparison: defaultPackageVersionComparison(snapshots, versionComparisons),
  };
}

export async function createResponsePackageSnapshot(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreateResponsePackageSnapshotInput = {},
): Promise<{ snapshot: ResponsePackageSnapshot; packageWorkspace: ResponsePackageWorkspace }> {
  const workspace = await getOrCreateResponseWorkspace(database, userId, intentId);
  const outline = buildPackageOutline(workspace);
  const readiness = buildPackageReadiness(workspace);
  const timestamp = nowIso();
  const snapshot: ResponsePackageSnapshot = {
    id: `response_package_snapshot_${crypto.randomUUID()}`,
    intentId: workspace.intentId,
    bidId: workspace.bidId,
    userId: workspace.userId,
    createdByUserId: userId,
    title: normalizeSnapshotTitle(input, timestamp),
    outline,
    readiness,
    exports: [],
    version: buildFallbackSnapshotVersion(),
    createdAt: timestamp,
  };
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const row = {
    id: snapshot.id,
    intentId: snapshot.intentId,
    bidId: snapshot.bidId,
    userId: snapshot.userId,
    createdByUserId: snapshot.createdByUserId,
    title: snapshot.title,
    outlineJson: JSON.stringify(snapshot.outline),
    readinessJson: JSON.stringify(snapshot.readiness),
    createdAt: snapshot.createdAt,
  };

  if (mysql) {
    await createResponsePackageSnapshotRowFromMysql(mysql, row);
  } else {
    createResponsePackageSnapshotRow(database, row);
  }

  const snapshots = attachExportsToSnapshots(
    await listPackageSnapshots(database, userId, intentId),
    await listPackageExports(database, userId, intentId),
  );
  const createdSnapshot = snapshots.find((item) => item.id === snapshot.id) ?? snapshot;
  const versionComparisons = buildPackageVersionComparisons(snapshots);

  return {
    snapshot: createdSnapshot,
    packageWorkspace: {
      workspace,
      outline,
      readiness,
      snapshots,
      governanceSummary: buildPackageGovernanceSummary(snapshots),
      versionHistory: buildPackageVersionHistory(snapshots),
      versionComparisons,
      defaultVersionComparison: defaultPackageVersionComparison(snapshots, versionComparisons),
    },
  };
}

export async function createResponsePackageExport(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreateResponsePackageExportInput,
  options: ResponsePackageExportOptions = {},
): Promise<{ exportRecord: ResponsePackageExport }> {
  if (typeof input.snapshotId !== "string" || !input.snapshotId.trim()) {
    throw new ResponseWorkspaceValidationError("Response package snapshot is required.");
  }
  const format = normalizeResponsePackageExportFormat(input.format);

  await getOrCreateResponseWorkspace(database, userId, intentId);
  const row = await getPackageSnapshotRow(database, userId, intentId, input.snapshotId.trim());
  if (!row) {
    throw new ResponseWorkspaceValidationError("Response package snapshot is not available.");
  }

  const snapshots = attachExportsToSnapshots(await listPackageSnapshots(database, userId, intentId), []);
  const snapshot = snapshots.find((item) => item.id === row.id) ?? hydratePackageSnapshot(row);
  const id = `response_package_export_${crypto.randomUUID()}`;
  const timestamp = nowIsoWithOptions(options);
  const contentType = responsePackageExportContentType(format);
  const fileName = `${sanitizeExportName(snapshot.title)}-${id}.${responsePackageExportExtension(format)}`;
  const bytes = await renderResponsePackageExport(database, userId, intentId, snapshot, format, timestamp);
  const storage = createObjectStorageProvider({ localRoot: exportStorageRoot(options) });
  const stored = await storage.putObject({
    key: [userId, intentId, fileName],
    bytes,
    contentType,
  });
  const exportRow = {
    id,
    snapshotId: snapshot.id,
    intentId: snapshot.intentId,
    bidId: snapshot.bidId,
    userId: snapshot.userId,
    requestedByUserId: userId,
    status: "ready" as const,
    format,
    fileName,
    contentType,
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
    checksumSha256: stored.checksumSha256,
    readinessJson: JSON.stringify(snapshot.readiness),
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewStatus: "pending_review" as const,
    reviewedAt: null,
    reviewedByUserId: null,
    reviewNotes: "",
  };
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  if (mysql) {
    await createResponsePackageExportRowFromMysql(mysql, exportRow);
    await writeAuditEventFromMysql(mysql, {
      eventName: "response_package.export_created",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "response_package_export",
      targetId: id,
      outcome: "success",
      severity: "info",
      source: "response.workspace",
      occurredAt: timestamp,
      metadata: {
        intentId,
        snapshotId: snapshot.id,
        format,
        byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256,
      },
      idempotencyKey: `response_package_export:${id}:created`,
    });
  } else {
    createResponsePackageExportRow(database, exportRow);
    writeAuditEvent(database, {
      eventName: "response_package.export_created",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "response_package_export",
      targetId: id,
      outcome: "success",
      severity: "info",
      source: "response.workspace",
      occurredAt: timestamp,
      metadata: {
        intentId,
        snapshotId: snapshot.id,
        format,
        byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256,
      },
      idempotencyKey: `response_package_export:${id}:created`,
    });
  }

  return {
    exportRecord: hydratePackageExport({ ...exportRow, downloadedAt: null }),
  };
}

export async function getResponsePackageExportFile(
  database: AppDatabase,
  userId: string,
  intentId: string,
  exportId: string,
) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const row = mysql
    ? await findResponsePackageExportRowFromMysql(mysql, userId, intentId, exportId)
    : findResponsePackageExportRow(database, userId, intentId, exportId);

  if (!row) {
    throw new ResponseWorkspaceValidationError("Export is not available.");
  }

  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    storagePath: row.storagePath,
    checksumSha256: row.checksumSha256,
  };
}

export async function markResponsePackageExportDownloaded(
  database: AppDatabase,
  userId: string,
  intentId: string,
  exportId: string,
  options: ResponsePackageExportOptions = {},
) {
  const timestamp = nowIsoWithOptions(options);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  if (mysql) {
    await markResponsePackageExportDownloadedRowFromMysql(mysql, userId, intentId, exportId, timestamp);
    await writeAuditEventFromMysql(mysql, {
      eventName: "response_package.export_downloaded",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "response_package_export",
      targetId: exportId,
      outcome: "success",
      severity: "info",
      source: "response.workspace",
      occurredAt: timestamp,
      metadata: {
        intentId,
        downloadedAt: timestamp,
      },
      idempotencyKey: `response_package_export:${exportId}:${userId}:download`,
    });
  } else {
    markResponsePackageExportDownloadedRow(database, userId, intentId, exportId, timestamp);
    writeAuditEvent(database, {
      eventName: "response_package.export_downloaded",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "response_package_export",
      targetId: exportId,
      outcome: "success",
      severity: "info",
      source: "response.workspace",
      occurredAt: timestamp,
      metadata: {
        intentId,
        downloadedAt: timestamp,
      },
      idempotencyKey: `response_package_export:${exportId}:${userId}:download`,
    });
  }
}

export async function updateResponsePackageExportReview(
  database: AppDatabase,
  userId: string,
  intentId: string,
  exportId: string,
  input: UpdateResponsePackageExportReviewInput,
  options: ResponsePackageExportOptions = {},
): Promise<{ exportRecord: ResponsePackageExport }> {
  const normalized = normalizeResponsePackageExportReviewInput(input);
  const timestamp = nowIsoWithOptions(options);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const existing = mysql
    ? await findResponsePackageExportRowFromMysql(mysql, userId, intentId, exportId)
    : findResponsePackageExportRow(database, userId, intentId, exportId);

  if (!existing) {
    throw new ResponseWorkspaceValidationError("Export is not available.");
  }
  const previousReviewStatus = normalizeResponsePackageExportReviewStatus(existing.reviewStatus);

  const updated = mysql
    ? await updateResponsePackageExportReviewRowFromMysql(mysql, userId, intentId, exportId, {
      reviewStatus: normalized.reviewStatus,
      reviewedAt: timestamp,
      reviewedByUserId: userId,
      reviewNotes: normalized.reviewNotes,
    })
    : updateResponsePackageExportReviewRow(database, userId, intentId, exportId, {
      reviewStatus: normalized.reviewStatus,
      reviewedAt: timestamp,
      reviewedByUserId: userId,
      reviewNotes: normalized.reviewNotes,
    });

  if (!updated) {
    throw new ResponseWorkspaceValidationError("Export is not available.");
  }
  const reviewEvent = {
    id: `response_package_export_review_${crypto.randomUUID()}`,
    exportId,
    snapshotId: updated.snapshotId,
    intentId: updated.intentId,
    bidId: updated.bidId,
    userId: updated.userId,
    actorUserId: userId,
    fromReviewStatus: previousReviewStatus,
    toReviewStatus: normalized.reviewStatus,
    reviewNotes: normalized.reviewNotes,
    createdAt: timestamp,
  };

  const metadata = {
    intentId,
    previousReviewStatus,
    reviewStatus: normalized.reviewStatus,
    hasReviewNotes: Boolean(normalized.reviewNotes),
  };

  if (mysql) {
    await createResponsePackageExportReviewEventRowFromMysql(mysql, reviewEvent);
    await writeAuditEventFromMysql(mysql, {
      eventName: "response_package.review_updated",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "response_package_export",
      targetId: exportId,
      outcome: "success",
      severity: normalized.reviewStatus === "needs_changes" ? "warning" : "info",
      source: "response.workspace",
      occurredAt: timestamp,
      metadata,
      idempotencyKey: `response_package_export:${exportId}:${userId}:review:${timestamp}`,
    });
  } else {
    createResponsePackageExportReviewEventRow(database, reviewEvent);
    writeAuditEvent(database, {
      eventName: "response_package.review_updated",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "response_package_export",
      targetId: exportId,
      outcome: "success",
      severity: normalized.reviewStatus === "needs_changes" ? "warning" : "info",
      source: "response.workspace",
      occurredAt: timestamp,
      metadata,
      idempotencyKey: `response_package_export:${exportId}:${userId}:review:${timestamp}`,
    });
  }
  const reviewRows = mysql
    ? await listResponsePackageExportReviewEventRowsFromMysql(mysql, userId, intentId)
    : listResponsePackageExportReviewEventRows(database, userId, intentId);
  const [exportRecord] = attachReviewHistoryToExports(
    [hydratePackageExport(updated)],
    reviewRows.map(hydratePackageExportReviewEvent),
  );

  return {
    exportRecord,
  };
}

export async function updateResponseWorkspaceItem(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateResponseWorkspaceItemInput,
): Promise<ResponseWorkspace> {
  await getOrCreateResponseWorkspace(database, userId, intentId);
  const normalized = normalizeUpdateInput(input);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  const existing = mysql
    ? await findResponseWorkspaceItemRowFromMysql(mysql, userId, intentId, normalized.itemId)
    : findResponseWorkspaceItemRow(database, userId, intentId, normalized.itemId);

  if (!existing) {
    throw new ResponseWorkspaceValidationError("Response workspace item is not available.");
  }

  await validateAssignedUser(database, userId, normalized.assignedUserId);
  await validateLinkedArtifacts(database, userId, intentId, normalized.linkedArtifactIds);
  const timestamp = nowIso();
  const currentLinkedArtifactIds = normalized.linkedArtifactIds !== undefined
    ? (mysql
      ? await listResponseWorkspaceLinkedArtifactRowsFromMysql(mysql, [normalized.itemId])
      : listResponseWorkspaceLinkedArtifactRows(database, [normalized.itemId])
    ).map((row) => row.id)
    : [];
  const activityRows = updateActivityRows({
    intentId,
    actorUserId: userId,
    existing,
    normalized,
    currentLinkedArtifactIds,
    timestamp,
  });

  if (mysql) {
    await updateResponseWorkspaceItemRowFromMysql(mysql, userId, intentId, normalized, timestamp);
    if (normalized.linkedArtifactIds !== undefined) {
      await replaceResponseWorkspaceItemArtifactLinksFromMysql(mysql, {
        itemId: normalized.itemId,
        artifactIds: normalized.linkedArtifactIds,
        timestamp,
      });
    }
    await createResponseWorkspaceActivityRowsFromMysql(mysql, activityRows);
  } else {
    updateResponseWorkspaceItemRow(database, userId, intentId, normalized, timestamp);
    if (normalized.linkedArtifactIds !== undefined) {
      replaceResponseWorkspaceItemArtifactLinks(database, {
        itemId: normalized.itemId,
        artifactIds: normalized.linkedArtifactIds,
        timestamp,
      });
    }
    createResponseWorkspaceActivityRows(database, activityRows);
  }

  return loadWorkspace(database, userId, intentId);
}

async function requireWorkspaceItem(database: AppDatabase, userId: string, intentId: string, itemId: string) {
  await getOrCreateResponseWorkspace(database, userId, intentId);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const existing = mysql
    ? await findResponseWorkspaceItemRowFromMysql(mysql, userId, intentId, itemId)
    : findResponseWorkspaceItemRow(database, userId, intentId, itemId);

  if (!existing) {
    throw new ResponseWorkspaceValidationError("Response workspace item is not available.");
  }

  return existing;
}

export async function listResponseWorkspaceComments(
  database: AppDatabase,
  userId: string,
  intentId: string,
  itemId: string,
): Promise<ResponseWorkspaceComment[]> {
  const normalizedItemId = itemId.trim();
  if (!normalizedItemId) {
    throw new ResponseWorkspaceValidationError("Response workspace item is required.");
  }
  await requireWorkspaceItem(database, userId, intentId, normalizedItemId);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listResponseWorkspaceCommentRowsFromMysql(mysql, intentId, normalizedItemId)
    : listResponseWorkspaceCommentRows(database, intentId, normalizedItemId);

  return rows.map(hydrateComment);
}

export async function createResponseWorkspaceComment(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreateResponseWorkspaceCommentInput,
): Promise<ResponseWorkspaceComment> {
  const normalized = normalizeCommentInput(input);
  await requireWorkspaceItem(database, userId, intentId, normalized.itemId);

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const timestamp = nowIso();
  const id = `response_workspace_comment_${crypto.randomUUID()}`;
  if (mysql) {
    await createResponseWorkspaceCommentRowFromMysql(mysql, {
      ...normalized,
      id,
      intentId,
      authorUserId: userId,
      timestamp,
    });
    await createResponseWorkspaceActivityRowsFromMysql(mysql, [buildActivityRow({
      intentId,
      itemId: normalized.itemId,
      actorUserId: userId,
      eventType: "comment_created",
      fromValue: null,
      toValue: normalized.body,
      metadata: { commentId: id },
      timestamp,
    })]);
  } else {
    createResponseWorkspaceCommentRow(database, {
      ...normalized,
      id,
      intentId,
      authorUserId: userId,
      timestamp,
    });
    createResponseWorkspaceActivityRows(database, [buildActivityRow({
      intentId,
      itemId: normalized.itemId,
      actorUserId: userId,
      eventType: "comment_created",
      fromValue: null,
      toValue: normalized.body,
      metadata: { commentId: id },
      timestamp,
    })]);
  }

  const row = mysql
    ? await findResponseWorkspaceCommentRowFromMysql(mysql, intentId, id)
    : findResponseWorkspaceCommentRow(database, intentId, id);
  if (!row) {
    throw new ResponseWorkspaceValidationError("Response workspace comment was not created.");
  }

  return hydrateComment(row);
}
