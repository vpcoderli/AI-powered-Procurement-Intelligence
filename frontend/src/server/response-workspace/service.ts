import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMysqlAccountWorkspace } from "@/server/account/mysql-workspace";
import { getAccountWorkspace, ensureUserWorkspace } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { generateResponseWorkspaceItems } from "./generator";
import {
  createResponseWorkspaceActivityRows,
  createResponseWorkspaceActivityRowsFromMysql,
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
  replaceResponseWorkspaceItemArtifactLinks,
  replaceResponseWorkspaceItemArtifactLinksFromMysql,
  updateResponseWorkspaceItemRow,
  updateResponseWorkspaceItemRowFromMysql,
  type CreateResponseWorkspaceActivityRowInput,
  type ResponseWorkspaceActivityRow,
  type ResponseWorkspaceCommentRow,
  type ResponseWorkspaceItemRow,
  type ResponseWorkspaceLinkedArtifactRow,
  type ResponsePackageExportRow,
  type ResponsePackageSnapshotRow,
} from "./repository";
import {
  type CreateResponsePackageExportInput,
  type CreateResponsePackageSnapshotInput,
  type CreateResponseWorkspaceCommentInput,
  type ResponsePackageExport,
  type ResponsePackageOutlineSection,
  type ResponsePackageReadinessSummary,
  type ResponsePackageSnapshot,
  type ResponsePackageWorkspace,
  type ResponseWorkspaceActivity,
  type ResponseWorkspaceActivityEventType,
  isResponseWorkspaceItemKind,
  isResponseWorkspaceItemStatus,
  type ResponseWorkspaceComment,
  type ResponseWorkspaceLinkedArtifact,
  type ResponseWorkspace,
  type ResponseWorkspaceItem,
  type ResponseWorkspaceItemKind,
  type ResponseWorkspaceItemStatus,
  type ResponseWorkspaceUserSummary,
  type UpdateResponseWorkspaceItemInput,
} from "./types";

const MAX_TITLE_LENGTH = 180;
const MAX_NOTES_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 2000;
const RESPONSE_PACKAGE_EXPORT_CONTENT_TYPE = "text/markdown; charset=utf-8";

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

function hydrateLinkedArtifact(row: ResponseWorkspaceLinkedArtifactRow): ResponseWorkspaceLinkedArtifact {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    artifactType: row.artifactType,
    purpose: row.purpose,
    downloadUrl: linkedArtifactDownloadUrl(row.intentId, row.id),
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
    createdAt: row.createdAt,
  };
}

function responsePackageExportDownloadUrl(intentId: string, exportId: string) {
  return `/api/intents/${encodeURIComponent(intentId)}/response-workspace/package/exports/${encodeURIComponent(exportId)}`;
}

function hydratePackageExport(row: ResponsePackageExportRow): ResponsePackageExport {
  if (row.status !== "ready") {
    throw new Error("Invalid response package export status.");
  }

  return {
    id: row.id,
    snapshotId: row.snapshotId,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    requestedByUserId: row.requestedByUserId,
    status: row.status,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    readiness: parsePackageReadiness(row.readinessJson),
    downloadUrl: responsePackageExportDownloadUrl(row.intentId, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadedAt: row.downloadedAt,
  };
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

  return snapshots.map((snapshot) => ({
    ...snapshot,
    exports: exportsBySnapshotId.get(snapshot.id) ?? [],
  }));
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

  return rows.map(hydratePackageExport);
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
  return options.storageRoot ?? path.join("data", "response-package-exports");
}

function sanitizeExportName(value: string) {
  const safe = value.trim().replace(/[\\/]/g, "-").replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return safe || "response-package";
}

function renderResponsePackageMarkdown(snapshot: ResponsePackageSnapshot) {
  const readiness = snapshot.readiness;
  const lines = [
    `# ${snapshot.title}`,
    "",
    `Snapshot ID: ${snapshot.id}`,
    `Created: ${snapshot.createdAt}`,
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

  return {
    workspace,
    outline,
    readiness,
    snapshots,
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

  return {
    snapshot,
    packageWorkspace: {
      workspace,
      outline,
      readiness,
      snapshots: [snapshot, ...attachExportsToSnapshots(
        await listPackageSnapshots(database, userId, intentId),
        await listPackageExports(database, userId, intentId),
      ).filter((item) => item.id !== snapshot.id)],
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

  await getOrCreateResponseWorkspace(database, userId, intentId);
  const row = await getPackageSnapshotRow(database, userId, intentId, input.snapshotId.trim());
  if (!row) {
    throw new ResponseWorkspaceValidationError("Response package snapshot is not available.");
  }

  const snapshot = hydratePackageSnapshot(row);
  const id = `response_package_export_${crypto.randomUUID()}`;
  const timestamp = nowIsoWithOptions(options);
  const fileName = `${sanitizeExportName(snapshot.title)}-${id}.md`;
  const markdown = renderResponsePackageMarkdown(snapshot);
  const bytes = Buffer.from(markdown, "utf8");
  const checksumSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const storageDirectory = path.join(exportStorageRoot(options), userId, intentId);
  const storagePath = path.join(storageDirectory, fileName);
  const exportRow = {
    id,
    snapshotId: snapshot.id,
    intentId: snapshot.intentId,
    bidId: snapshot.bidId,
    userId: snapshot.userId,
    requestedByUserId: userId,
    status: "ready" as const,
    fileName,
    contentType: RESPONSE_PACKAGE_EXPORT_CONTENT_TYPE,
    byteSize: bytes.byteLength,
    storagePath,
    checksumSha256,
    readinessJson: JSON.stringify(snapshot.readiness),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  await mkdir(storageDirectory, { recursive: true });
  await writeFile(storagePath, bytes);

  if (mysql) {
    await createResponsePackageExportRowFromMysql(mysql, exportRow);
  } else {
    createResponsePackageExportRow(database, exportRow);
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
