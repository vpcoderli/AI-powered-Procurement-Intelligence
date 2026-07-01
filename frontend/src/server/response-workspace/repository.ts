import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import {
  responseWorkspaceComments,
  responseWorkspaceActivity,
  responseWorkspaceItemArtifacts,
  responseWorkspaceItems,
  responsePackageExportReviewEvents,
  responsePackageExports,
  responsePackageSnapshots,
  supplierArtifacts,
  users,
} from "@/server/db/schema";
import type { GeneratedResponseWorkspaceItem } from "./generator";
import type {
  CreateResponseWorkspaceCommentInput,
  ResponseWorkspaceActivityEventType,
  UpdateResponseWorkspaceItemInput,
} from "./types";

export type ResponseWorkspaceItemRow = typeof responseWorkspaceItems.$inferSelect;
export type ResponseWorkspaceLinkedArtifactRow = Pick<
  typeof supplierArtifacts.$inferSelect,
  | "id"
  | "title"
  | "fileName"
  | "artifactType"
  | "purpose"
  | "intentId"
  | "contentType"
  | "byteSize"
  | "checksumSha256"
  | "reviewStatus"
> & {
  itemId: string;
};
export type ResponsePackageArtifactFileRow = Pick<
  typeof supplierArtifacts.$inferSelect,
  "id" | "storagePath" | "byteSize" | "checksumSha256"
>;
export type ResponseWorkspaceCommentRow = typeof responseWorkspaceComments.$inferSelect & {
  authorEmail: string | null;
  authorDisplayName: string | null;
};
export type ResponseWorkspaceActivityRow = typeof responseWorkspaceActivity.$inferSelect & {
  actorEmail: string | null;
  actorDisplayName: string | null;
};
export type ResponsePackageSnapshotRow = typeof responsePackageSnapshots.$inferSelect;
export type ResponsePackageExportRow = typeof responsePackageExports.$inferSelect;
export type ResponsePackageExportReviewEventRow = typeof responsePackageExportReviewEvents.$inferSelect;

export interface CreateResponseWorkspaceActivityRowInput {
  id: string;
  intentId: string;
  itemId: string;
  actorUserId: string;
  eventType: ResponseWorkspaceActivityEventType;
  fromValue: string | null;
  toValue: string | null;
  metadataJson: string;
  createdAt: string;
}

interface MysqlResponseWorkspaceRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlResponseWorkspaceItemRow {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  assignedUserId: string | null;
  kind: string;
  title: string;
  status: string;
  notes: string;
  dueAt: string | null;
  sortOrder: number | string;
  createdAt: string;
  updatedAt: string;
}

interface MysqlResponseWorkspaceCommentRow {
  id: string;
  intentId: string;
  itemId: string;
  authorUserId: string;
  authorEmail: string | null;
  authorDisplayName: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface MysqlResponseWorkspaceActivityRow {
  id: string;
  intentId: string;
  itemId: string;
  actorUserId: string;
  actorEmail: string | null;
  actorDisplayName: string | null;
  eventType: string;
  fromValue: string | null;
  toValue: string | null;
  metadataJson: string;
  createdAt: string;
}

interface MysqlResponseWorkspaceLinkedArtifactRow {
  itemId: string;
  id: string;
  intentId: string;
  title: string;
  fileName: string;
  artifactType: string;
  purpose: string;
  contentType: string;
  byteSize: number | string;
  checksumSha256: string;
  reviewStatus: string;
}

interface MysqlResponsePackageArtifactFileRow {
  id: string;
  storagePath: string;
  byteSize: number | string;
  checksumSha256: string;
}

interface MysqlResponsePackageSnapshotRow {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  createdByUserId: string;
  title: string;
  outlineJson: string;
  readinessJson: string;
  createdAt: string;
}

interface MysqlResponsePackageExportRow {
  id: string;
  snapshotId: string;
  intentId: string;
  bidId: string;
  userId: string;
  requestedByUserId: string;
  status: string;
  format: string | null;
  fileName: string;
  contentType: string;
  byteSize: number | string;
  storagePath: string;
  checksumSha256: string;
  readinessJson: string;
  createdAt: string;
  updatedAt: string;
  downloadedAt: string | null;
  reviewStatus: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNotes: string;
}

interface MysqlResponsePackageExportReviewEventRow {
  id: string;
  exportId: string;
  snapshotId: string;
  intentId: string;
  bidId: string;
  userId: string;
  actorUserId: string;
  fromReviewStatus: string;
  toReviewStatus: string;
  reviewNotes: string;
  createdAt: string;
}

function toActivityRow(row: ResponseWorkspaceActivityRow): ResponseWorkspaceActivityRow {
  return row;
}

function toActivityRowFromMysql(row: MysqlResponseWorkspaceActivityRow): ResponseWorkspaceActivityRow {
  return {
    id: row.id,
    intentId: row.intentId,
    itemId: row.itemId,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actorDisplayName: row.actorDisplayName,
    eventType: row.eventType,
    fromValue: row.fromValue,
    toValue: row.toValue,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
  };
}

export function listResponseWorkspaceItemRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(responseWorkspaceItems)
    .where(and(eq(responseWorkspaceItems.userId, userId), eq(responseWorkspaceItems.intentId, intentId)))
    .orderBy(asc(responseWorkspaceItems.sortOrder), asc(responseWorkspaceItems.id))
    .all();
}

function toResponseWorkspaceItemRow(row: MysqlResponseWorkspaceItemRow): ResponseWorkspaceItemRow {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    assignedUserId: row.assignedUserId,
    kind: row.kind,
    title: row.title,
    status: row.status,
    notes: row.notes,
    dueAt: row.dueAt,
    sortOrder: Number(row.sortOrder),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listResponseWorkspaceItemRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlResponseWorkspaceItemRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        assigned_user_id AS assignedUserId,
        kind,
        title,
        status,
        notes,
        due_at AS dueAt,
        sort_order AS sortOrder,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM response_workspace_items
      WHERE user_id = ? AND intent_id = ?
      ORDER BY sort_order ASC, id ASC
    `,
    [userId, intentId],
  );

  return rows.map(toResponseWorkspaceItemRow);
}

export function createResponseWorkspaceItemRows(
  db: AppDatabase,
  input: {
    intentId: string;
    bidId: string;
    userId: string;
    items: Array<GeneratedResponseWorkspaceItem & { id: string }>;
    timestamp: string;
  },
) {
  if (input.items.length === 0) return;

  db.insert(responseWorkspaceItems)
    .values(input.items.map((item) => ({
      id: item.id,
      intentId: input.intentId,
      bidId: input.bidId,
      userId: input.userId,
      assignedUserId: null,
      kind: item.kind,
      title: item.title,
      status: item.status,
      notes: item.notes,
      dueAt: item.dueAt,
      sortOrder: item.sortOrder,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })))
    .run();
}

export async function createResponseWorkspaceItemRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  input: {
    intentId: string;
    bidId: string;
    userId: string;
    items: Array<GeneratedResponseWorkspaceItem & { id: string }>;
    timestamp: string;
  },
) {
  if (input.items.length === 0) return;

  for (const item of input.items) {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO response_workspace_items (
          id,
          intent_id,
          bid_id,
          user_id,
          assigned_user_id,
          kind,
          title,
          status,
          notes,
          due_at,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        item.id,
        input.intentId,
        input.bidId,
        input.userId,
        null,
        item.kind,
        item.title,
        item.status,
        item.notes,
        item.dueAt,
        item.sortOrder,
        input.timestamp,
        input.timestamp,
      ],
    );
  }
}

export function findResponseWorkspaceItemRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  itemId: string,
) {
  return db
    .select()
    .from(responseWorkspaceItems)
    .where(and(
      eq(responseWorkspaceItems.userId, userId),
      eq(responseWorkspaceItems.intentId, intentId),
      eq(responseWorkspaceItems.id, itemId),
    ))
    .limit(1)
    .get();
}

export async function findResponseWorkspaceItemRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  itemId: string,
) {
  const row = await mysqlSelectOne<MysqlResponseWorkspaceItemRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        assigned_user_id AS assignedUserId,
        kind,
        title,
        status,
        notes,
        due_at AS dueAt,
        sort_order AS sortOrder,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM response_workspace_items
      WHERE user_id = ? AND intent_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, intentId, itemId],
  );

  return row ? toResponseWorkspaceItemRow(row) : null;
}

export function updateResponseWorkspaceItemRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateResponseWorkspaceItemInput,
  timestamp: string,
) {
  const values: Partial<typeof responseWorkspaceItems.$inferInsert> = { updatedAt: timestamp };

  if (input.title !== undefined) values.title = input.title;
  if (input.status !== undefined) values.status = input.status;
  if (input.notes !== undefined) values.notes = input.notes;
  if (input.dueAt !== undefined) values.dueAt = input.dueAt;
  if (input.assignedUserId !== undefined) values.assignedUserId = input.assignedUserId;

  db.update(responseWorkspaceItems)
    .set(values)
    .where(and(
      eq(responseWorkspaceItems.userId, userId),
      eq(responseWorkspaceItems.intentId, intentId),
      eq(responseWorkspaceItems.id, input.itemId),
    ))
    .run();
}

export async function updateResponseWorkspaceItemRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  input: UpdateResponseWorkspaceItemInput,
  timestamp: string,
) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    assignments.push("title = ?");
    values.push(input.title);
  }
  if (input.status !== undefined) {
    assignments.push("status = ?");
    values.push(input.status);
  }
  if (input.notes !== undefined) {
    assignments.push("notes = ?");
    values.push(input.notes);
  }
  if (input.dueAt !== undefined) {
    assignments.push("due_at = ?");
    values.push(input.dueAt);
  }
  if (input.assignedUserId !== undefined) {
    assignments.push("assigned_user_id = ?");
    values.push(input.assignedUserId);
  }

  assignments.push("updated_at = ?");
  values.push(timestamp, userId, intentId, input.itemId);

  await mysqlExecute(
    mysql,
    `
      UPDATE response_workspace_items
      SET ${assignments.join(", ")}
      WHERE user_id = ? AND intent_id = ? AND id = ?
    `,
    values,
  );
}

export function listLinkableSupplierArtifactRows(
  db: AppDatabase,
  userId: string,
  intentId: string,
  artifactIds: string[],
) {
  if (artifactIds.length === 0) return [];

  return db
    .select()
    .from(supplierArtifacts)
    .where(and(
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      inArray(supplierArtifacts.id, artifactIds),
      isNull(supplierArtifacts.deletedAt),
    ))
    .all();
}

export async function listLinkableSupplierArtifactRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  artifactIds: string[],
) {
  if (artifactIds.length === 0) return [];
  const placeholders = artifactIds.map(() => "?").join(", ");

  return mysqlSelectMany<{ id: string }>(
    mysql,
    `
      SELECT id
      FROM supplier_artifacts
      WHERE user_id = ? AND intent_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL
    `,
    [userId, intentId, ...artifactIds],
  );
}

export function replaceResponseWorkspaceItemArtifactLinks(
  db: AppDatabase,
  input: {
    itemId: string;
    artifactIds: string[];
    timestamp: string;
  },
) {
  db.delete(responseWorkspaceItemArtifacts)
    .where(eq(responseWorkspaceItemArtifacts.itemId, input.itemId))
    .run();

  if (input.artifactIds.length === 0) return;

  db.insert(responseWorkspaceItemArtifacts)
    .values(input.artifactIds.map((artifactId) => ({
      itemId: input.itemId,
      artifactId,
      createdAt: input.timestamp,
    })))
    .run();
}

export async function replaceResponseWorkspaceItemArtifactLinksFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  input: {
    itemId: string;
    artifactIds: string[];
    timestamp: string;
  },
) {
  await mysqlExecute(
    mysql,
    "DELETE FROM response_workspace_item_artifacts WHERE item_id = ?",
    [input.itemId],
  );

  for (const artifactId of input.artifactIds) {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO response_workspace_item_artifacts (
          item_id,
          artifact_id,
          created_at
        )
        VALUES (?, ?, ?)
      `,
      [input.itemId, artifactId, input.timestamp],
    );
  }
}

export function listResponseWorkspaceLinkedArtifactRows(db: AppDatabase, itemIds: string[]) {
  if (itemIds.length === 0) return [];

  return db
    .select({
      itemId: responseWorkspaceItemArtifacts.itemId,
      id: supplierArtifacts.id,
      intentId: supplierArtifacts.intentId,
      title: supplierArtifacts.title,
      fileName: supplierArtifacts.fileName,
      artifactType: supplierArtifacts.artifactType,
      purpose: supplierArtifacts.purpose,
      contentType: supplierArtifacts.contentType,
      byteSize: supplierArtifacts.byteSize,
      checksumSha256: supplierArtifacts.checksumSha256,
      reviewStatus: supplierArtifacts.reviewStatus,
    })
    .from(responseWorkspaceItemArtifacts)
    .innerJoin(supplierArtifacts, eq(responseWorkspaceItemArtifacts.artifactId, supplierArtifacts.id))
    .where(and(
      inArray(responseWorkspaceItemArtifacts.itemId, itemIds),
      isNull(supplierArtifacts.deletedAt),
    ))
    .orderBy(asc(responseWorkspaceItemArtifacts.itemId), asc(supplierArtifacts.title), asc(supplierArtifacts.id))
    .all();
}

export async function listResponseWorkspaceLinkedArtifactRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  itemIds: string[],
): Promise<ResponseWorkspaceLinkedArtifactRow[]> {
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => "?").join(", ");

  const rows = await mysqlSelectMany<MysqlResponseWorkspaceLinkedArtifactRow>(
    mysql,
    `
      SELECT
        response_workspace_item_artifacts.item_id AS itemId,
        supplier_artifacts.id,
        supplier_artifacts.intent_id AS intentId,
        supplier_artifacts.title,
        supplier_artifacts.file_name AS fileName,
        supplier_artifacts.artifact_type AS artifactType,
        supplier_artifacts.purpose,
        supplier_artifacts.content_type AS contentType,
        supplier_artifacts.byte_size AS byteSize,
        supplier_artifacts.checksum_sha256 AS checksumSha256,
        supplier_artifacts.review_status AS reviewStatus
      FROM response_workspace_item_artifacts
      INNER JOIN supplier_artifacts
        ON supplier_artifacts.id = response_workspace_item_artifacts.artifact_id
      WHERE response_workspace_item_artifacts.item_id IN (${placeholders})
        AND supplier_artifacts.deleted_at IS NULL
      ORDER BY response_workspace_item_artifacts.item_id ASC, supplier_artifacts.title ASC, supplier_artifacts.id ASC
    `,
    itemIds,
  );

  return rows.map((row) => ({
    ...row,
    byteSize: Number(row.byteSize),
  }));
}

export function listResponsePackageArtifactFileRows(
  db: AppDatabase,
  userId: string,
  intentId: string,
  artifactIds: string[],
): ResponsePackageArtifactFileRow[] {
  if (artifactIds.length === 0) return [];

  return db
    .select({
      id: supplierArtifacts.id,
      storagePath: supplierArtifacts.storagePath,
      byteSize: supplierArtifacts.byteSize,
      checksumSha256: supplierArtifacts.checksumSha256,
    })
    .from(supplierArtifacts)
    .where(and(
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      inArray(supplierArtifacts.id, artifactIds),
      isNull(supplierArtifacts.deletedAt),
    ))
    .all();
}

export async function listResponsePackageArtifactFileRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  artifactIds: string[],
): Promise<ResponsePackageArtifactFileRow[]> {
  if (artifactIds.length === 0) return [];
  const placeholders = artifactIds.map(() => "?").join(", ");

  const rows = await mysqlSelectMany<MysqlResponsePackageArtifactFileRow>(
    mysql,
    `
      SELECT
        id,
        storage_path AS storagePath,
        byte_size AS byteSize,
        checksum_sha256 AS checksumSha256
      FROM supplier_artifacts
      WHERE user_id = ?
        AND intent_id = ?
        AND id IN (${placeholders})
        AND deleted_at IS NULL
    `,
    [userId, intentId, ...artifactIds],
  );

  return rows.map((row) => ({
    ...row,
    byteSize: Number(row.byteSize),
  }));
}

export function createResponseWorkspaceActivityRows(
  db: AppDatabase,
  rows: CreateResponseWorkspaceActivityRowInput[],
) {
  if (rows.length === 0) return;

  db.insert(responseWorkspaceActivity)
    .values(rows)
    .run();
}

export async function createResponseWorkspaceActivityRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  rows: CreateResponseWorkspaceActivityRowInput[],
) {
  for (const row of rows) {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO response_workspace_activity (
          id,
          intent_id,
          item_id,
          actor_user_id,
          event_type,
          from_value,
          to_value,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        row.id,
        row.intentId,
        row.itemId,
        row.actorUserId,
        row.eventType,
        row.fromValue,
        row.toValue,
        row.metadataJson,
        row.createdAt,
      ],
    );
  }
}

export function listResponseWorkspaceActivityRows(db: AppDatabase, itemIds: string[]) {
  if (itemIds.length === 0) return [];

  return db
    .select({
      id: responseWorkspaceActivity.id,
      intentId: responseWorkspaceActivity.intentId,
      itemId: responseWorkspaceActivity.itemId,
      actorUserId: responseWorkspaceActivity.actorUserId,
      actorEmail: users.email,
      actorDisplayName: users.displayName,
      eventType: responseWorkspaceActivity.eventType,
      fromValue: responseWorkspaceActivity.fromValue,
      toValue: responseWorkspaceActivity.toValue,
      metadataJson: responseWorkspaceActivity.metadataJson,
      createdAt: responseWorkspaceActivity.createdAt,
    })
    .from(responseWorkspaceActivity)
    .leftJoin(users, eq(responseWorkspaceActivity.actorUserId, users.id))
    .where(inArray(responseWorkspaceActivity.itemId, itemIds))
    .orderBy(desc(responseWorkspaceActivity.createdAt), desc(responseWorkspaceActivity.id))
    .all()
    .map(toActivityRow);
}

export async function listResponseWorkspaceActivityRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  itemIds: string[],
) {
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => "?").join(", ");

  const rows = await mysqlSelectMany<MysqlResponseWorkspaceActivityRow>(
    mysql,
    `
      SELECT
        response_workspace_activity.id,
        response_workspace_activity.intent_id AS intentId,
        response_workspace_activity.item_id AS itemId,
        response_workspace_activity.actor_user_id AS actorUserId,
        users.email AS actorEmail,
        users.display_name AS actorDisplayName,
        response_workspace_activity.event_type AS eventType,
        response_workspace_activity.from_value AS fromValue,
        response_workspace_activity.to_value AS toValue,
        response_workspace_activity.metadata_json AS metadataJson,
        response_workspace_activity.created_at AS createdAt
      FROM response_workspace_activity
      LEFT JOIN users ON response_workspace_activity.actor_user_id = users.id
      WHERE response_workspace_activity.item_id IN (${placeholders})
      ORDER BY response_workspace_activity.created_at DESC, response_workspace_activity.id DESC
    `,
    itemIds,
  );

  return rows.map(toActivityRowFromMysql);
}

export function createResponseWorkspaceCommentRow(
  db: AppDatabase,
  input: CreateResponseWorkspaceCommentInput & {
    id: string;
    intentId: string;
    authorUserId: string;
    timestamp: string;
  },
) {
  db.insert(responseWorkspaceComments)
    .values({
      id: input.id,
      intentId: input.intentId,
      itemId: input.itemId,
      authorUserId: input.authorUserId,
      body: input.body,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .run();
}

function toCommentRow(row: ResponseWorkspaceCommentRow): ResponseWorkspaceCommentRow {
  return row;
}

export function listResponseWorkspaceCommentRows(db: AppDatabase, intentId: string, itemId: string) {
  return db
    .select({
      id: responseWorkspaceComments.id,
      intentId: responseWorkspaceComments.intentId,
      itemId: responseWorkspaceComments.itemId,
      authorUserId: responseWorkspaceComments.authorUserId,
      authorEmail: users.email,
      authorDisplayName: users.displayName,
      body: responseWorkspaceComments.body,
      createdAt: responseWorkspaceComments.createdAt,
      updatedAt: responseWorkspaceComments.updatedAt,
    })
    .from(responseWorkspaceComments)
    .leftJoin(users, eq(responseWorkspaceComments.authorUserId, users.id))
    .where(and(eq(responseWorkspaceComments.intentId, intentId), eq(responseWorkspaceComments.itemId, itemId)))
    .orderBy(asc(responseWorkspaceComments.createdAt), asc(responseWorkspaceComments.id))
    .all()
    .map(toCommentRow);
}

export function findResponseWorkspaceCommentRow(db: AppDatabase, intentId: string, commentId: string) {
  return db
    .select({
      id: responseWorkspaceComments.id,
      intentId: responseWorkspaceComments.intentId,
      itemId: responseWorkspaceComments.itemId,
      authorUserId: responseWorkspaceComments.authorUserId,
      authorEmail: users.email,
      authorDisplayName: users.displayName,
      body: responseWorkspaceComments.body,
      createdAt: responseWorkspaceComments.createdAt,
      updatedAt: responseWorkspaceComments.updatedAt,
    })
    .from(responseWorkspaceComments)
    .leftJoin(users, eq(responseWorkspaceComments.authorUserId, users.id))
    .where(and(eq(responseWorkspaceComments.intentId, intentId), eq(responseWorkspaceComments.id, commentId)))
    .limit(1)
    .get();
}

export async function createResponseWorkspaceCommentRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  input: CreateResponseWorkspaceCommentInput & {
    id: string;
    intentId: string;
    authorUserId: string;
    timestamp: string;
  },
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO response_workspace_comments (
        id,
        intent_id,
        item_id,
        author_user_id,
        body,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.intentId,
      input.itemId,
      input.authorUserId,
      input.body,
      input.timestamp,
      input.timestamp,
    ],
  );
}

export async function listResponseWorkspaceCommentRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  intentId: string,
  itemId: string,
) {
  return mysqlSelectMany<MysqlResponseWorkspaceCommentRow>(
    mysql,
    `
      SELECT
        response_workspace_comments.id,
        response_workspace_comments.intent_id AS intentId,
        response_workspace_comments.item_id AS itemId,
        response_workspace_comments.author_user_id AS authorUserId,
        users.email AS authorEmail,
        users.display_name AS authorDisplayName,
        response_workspace_comments.body,
        response_workspace_comments.created_at AS createdAt,
        response_workspace_comments.updated_at AS updatedAt
      FROM response_workspace_comments
      LEFT JOIN users ON users.id = response_workspace_comments.author_user_id
      WHERE response_workspace_comments.intent_id = ? AND response_workspace_comments.item_id = ?
      ORDER BY response_workspace_comments.created_at ASC, response_workspace_comments.id ASC
    `,
    [intentId, itemId],
  );
}

export async function findResponseWorkspaceCommentRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  intentId: string,
  commentId: string,
) {
  return mysqlSelectOne<MysqlResponseWorkspaceCommentRow>(
    mysql,
    `
      SELECT
        response_workspace_comments.id,
        response_workspace_comments.intent_id AS intentId,
        response_workspace_comments.item_id AS itemId,
        response_workspace_comments.author_user_id AS authorUserId,
        users.email AS authorEmail,
        users.display_name AS authorDisplayName,
        response_workspace_comments.body,
        response_workspace_comments.created_at AS createdAt,
        response_workspace_comments.updated_at AS updatedAt
      FROM response_workspace_comments
      LEFT JOIN users ON users.id = response_workspace_comments.author_user_id
      WHERE response_workspace_comments.intent_id = ? AND response_workspace_comments.id = ?
      LIMIT 1
    `,
    [intentId, commentId],
  );
}

export function createResponsePackageSnapshotRow(
  db: AppDatabase,
  input: {
    id: string;
    intentId: string;
    bidId: string;
    userId: string;
    createdByUserId: string;
    title: string;
    outlineJson: string;
    readinessJson: string;
    createdAt: string;
  },
) {
  db.insert(responsePackageSnapshots)
    .values(input)
    .run();
}

export async function createResponsePackageSnapshotRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  input: {
    id: string;
    intentId: string;
    bidId: string;
    userId: string;
    createdByUserId: string;
    title: string;
    outlineJson: string;
    readinessJson: string;
    createdAt: string;
  },
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO response_package_snapshots (
        id,
        intent_id,
        bid_id,
        user_id,
        created_by_user_id,
        title,
        outline_json,
        readiness_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.intentId,
      input.bidId,
      input.userId,
      input.createdByUserId,
      input.title,
      input.outlineJson,
      input.readinessJson,
      input.createdAt,
    ],
  );
}

export function listResponsePackageSnapshotRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(responsePackageSnapshots)
    .where(and(eq(responsePackageSnapshots.userId, userId), eq(responsePackageSnapshots.intentId, intentId)))
    .orderBy(desc(responsePackageSnapshots.createdAt), desc(responsePackageSnapshots.id))
    .all();
}

export function findResponsePackageSnapshotRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  snapshotId: string,
) {
  return db
    .select()
    .from(responsePackageSnapshots)
    .where(and(
      eq(responsePackageSnapshots.userId, userId),
      eq(responsePackageSnapshots.intentId, intentId),
      eq(responsePackageSnapshots.id, snapshotId),
    ))
    .limit(1)
    .get();
}

export async function listResponsePackageSnapshotRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
) {
  return mysqlSelectMany<MysqlResponsePackageSnapshotRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        created_by_user_id AS createdByUserId,
        title,
        outline_json AS outlineJson,
        readiness_json AS readinessJson,
        created_at AS createdAt
      FROM response_package_snapshots
      WHERE user_id = ? AND intent_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    [userId, intentId],
  );
}

export async function findResponsePackageSnapshotRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  snapshotId: string,
) {
  return mysqlSelectOne<MysqlResponsePackageSnapshotRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        created_by_user_id AS createdByUserId,
        title,
        outline_json AS outlineJson,
        readiness_json AS readinessJson,
        created_at AS createdAt
      FROM response_package_snapshots
      WHERE user_id = ? AND intent_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, intentId, snapshotId],
  );
}

export function createResponsePackageExportRow(
  db: AppDatabase,
  input: {
    id: string;
    snapshotId: string;
    intentId: string;
    bidId: string;
    userId: string;
    requestedByUserId: string;
    status: "ready";
    format?: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    storagePath: string;
    checksumSha256: string;
    readinessJson: string;
    createdAt: string;
    updatedAt: string;
    reviewStatus?: "pending_review" | "approved" | "needs_changes";
    reviewedAt?: string | null;
    reviewedByUserId?: string | null;
    reviewNotes?: string;
  },
) {
  db.insert(responsePackageExports)
    .values(input)
    .run();
}

export async function createResponsePackageExportRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  input: {
    id: string;
    snapshotId: string;
    intentId: string;
    bidId: string;
    userId: string;
    requestedByUserId: string;
    status: "ready";
    format?: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    storagePath: string;
    checksumSha256: string;
    readinessJson: string;
    createdAt: string;
    updatedAt: string;
    reviewStatus?: "pending_review" | "approved" | "needs_changes";
    reviewedAt?: string | null;
    reviewedByUserId?: string | null;
    reviewNotes?: string;
  },
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO response_package_exports (
        id,
        snapshot_id,
        intent_id,
        bid_id,
        user_id,
        requested_by_user_id,
        status,
        format,
        file_name,
        content_type,
        byte_size,
        storage_path,
        checksum_sha256,
        readiness_json,
        created_at,
        updated_at,
        review_status,
        reviewed_at,
        reviewed_by_user_id,
        review_notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.snapshotId,
      input.intentId,
      input.bidId,
      input.userId,
      input.requestedByUserId,
      input.status,
      input.format ?? "markdown",
      input.fileName,
      input.contentType,
      input.byteSize,
      input.storagePath,
      input.checksumSha256,
      input.readinessJson,
      input.createdAt,
      input.updatedAt,
      input.reviewStatus ?? "pending_review",
      input.reviewedAt ?? null,
      input.reviewedByUserId ?? null,
      input.reviewNotes ?? "",
    ],
  );
}

function toResponsePackageExportRow(row: MysqlResponsePackageExportRow): ResponsePackageExportRow {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    requestedByUserId: row.requestedByUserId,
    status: row.status,
    format: row.format || "markdown",
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: Number(row.byteSize),
    storagePath: row.storagePath,
    checksumSha256: row.checksumSha256,
    readinessJson: row.readinessJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadedAt: row.downloadedAt,
    reviewStatus: row.reviewStatus,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId,
    reviewNotes: row.reviewNotes,
  };
}

export function listResponsePackageExportRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(responsePackageExports)
    .where(and(eq(responsePackageExports.userId, userId), eq(responsePackageExports.intentId, intentId)))
    .orderBy(desc(responsePackageExports.createdAt), desc(responsePackageExports.id))
    .all();
}

export async function listResponsePackageExportRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlResponsePackageExportRow>(
    mysql,
    `
      SELECT
        id,
        snapshot_id AS snapshotId,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        requested_by_user_id AS requestedByUserId,
        status,
        format,
        file_name AS fileName,
        content_type AS contentType,
        byte_size AS byteSize,
        storage_path AS storagePath,
        checksum_sha256 AS checksumSha256,
        readiness_json AS readinessJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        downloaded_at AS downloadedAt,
        review_status AS reviewStatus,
        reviewed_at AS reviewedAt,
        reviewed_by_user_id AS reviewedByUserId,
        review_notes AS reviewNotes
      FROM response_package_exports
      WHERE user_id = ? AND intent_id = ?
      ORDER BY created_at DESC, id DESC
    `,
    [userId, intentId],
  );

  return rows.map(toResponsePackageExportRow);
}

export function findResponsePackageExportRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  exportId: string,
) {
  return db
    .select()
    .from(responsePackageExports)
    .where(and(
      eq(responsePackageExports.userId, userId),
      eq(responsePackageExports.intentId, intentId),
      eq(responsePackageExports.id, exportId),
    ))
    .limit(1)
    .get();
}

export function markResponsePackageExportDownloadedRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  exportId: string,
  timestamp: string,
) {
  db.update(responsePackageExports)
    .set({
      downloadedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(and(
      eq(responsePackageExports.userId, userId),
      eq(responsePackageExports.intentId, intentId),
      eq(responsePackageExports.id, exportId),
    ))
    .run();
}

export function updateResponsePackageExportReviewRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  exportId: string,
  input: {
    reviewStatus: "pending_review" | "approved" | "needs_changes";
    reviewedAt: string;
    reviewedByUserId: string;
    reviewNotes: string;
  },
) {
  db.update(responsePackageExports)
    .set({
      reviewStatus: input.reviewStatus,
      reviewedAt: input.reviewedAt,
      reviewedByUserId: input.reviewedByUserId,
      reviewNotes: input.reviewNotes,
      updatedAt: input.reviewedAt,
    })
    .where(and(
      eq(responsePackageExports.userId, userId),
      eq(responsePackageExports.intentId, intentId),
      eq(responsePackageExports.id, exportId),
    ))
    .run();

  return findResponsePackageExportRow(db, userId, intentId, exportId) ?? null;
}

export function createResponsePackageExportReviewEventRow(
  db: AppDatabase,
  input: {
    id: string;
    exportId: string;
    snapshotId: string;
    intentId: string;
    bidId: string;
    userId: string;
    actorUserId: string;
    fromReviewStatus: string;
    toReviewStatus: string;
    reviewNotes: string;
    createdAt: string;
  },
) {
  db.insert(responsePackageExportReviewEvents)
    .values(input)
    .run();
}

export function listResponsePackageExportReviewEventRows(
  db: AppDatabase,
  userId: string,
  intentId: string,
) {
  return db
    .select()
    .from(responsePackageExportReviewEvents)
    .where(and(
      eq(responsePackageExportReviewEvents.userId, userId),
      eq(responsePackageExportReviewEvents.intentId, intentId),
    ))
    .orderBy(asc(responsePackageExportReviewEvents.createdAt), asc(responsePackageExportReviewEvents.id))
    .all();
}

export async function findResponsePackageExportRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  exportId: string,
) {
  const row = await mysqlSelectOne<MysqlResponsePackageExportRow>(
    mysql,
    `
      SELECT
        id,
        snapshot_id AS snapshotId,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        requested_by_user_id AS requestedByUserId,
        status,
        format,
        file_name AS fileName,
        content_type AS contentType,
        byte_size AS byteSize,
        storage_path AS storagePath,
        checksum_sha256 AS checksumSha256,
        readiness_json AS readinessJson,
        created_at AS createdAt,
        updated_at AS updatedAt,
        downloaded_at AS downloadedAt,
        review_status AS reviewStatus,
        reviewed_at AS reviewedAt,
        reviewed_by_user_id AS reviewedByUserId,
        review_notes AS reviewNotes
      FROM response_package_exports
      WHERE user_id = ? AND intent_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, intentId, exportId],
  );

  return row ? toResponsePackageExportRow(row) : null;
}

export async function markResponsePackageExportDownloadedRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  exportId: string,
  timestamp: string,
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE response_package_exports
      SET downloaded_at = ?, updated_at = ?
      WHERE user_id = ? AND intent_id = ? AND id = ?
    `,
    [timestamp, timestamp, userId, intentId, exportId],
  );
}

export async function updateResponsePackageExportReviewRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
  exportId: string,
  input: {
    reviewStatus: "pending_review" | "approved" | "needs_changes";
    reviewedAt: string;
    reviewedByUserId: string;
    reviewNotes: string;
  },
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE response_package_exports
      SET review_status = ?, reviewed_at = ?, reviewed_by_user_id = ?, review_notes = ?, updated_at = ?
      WHERE user_id = ? AND intent_id = ? AND id = ?
    `,
    [
      input.reviewStatus,
      input.reviewedAt,
      input.reviewedByUserId,
      input.reviewNotes,
      input.reviewedAt,
      userId,
      intentId,
      exportId,
    ],
  );

  return findResponsePackageExportRowFromMysql(mysql, userId, intentId, exportId);
}

export async function createResponsePackageExportReviewEventRowFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  input: {
    id: string;
    exportId: string;
    snapshotId: string;
    intentId: string;
    bidId: string;
    userId: string;
    actorUserId: string;
    fromReviewStatus: string;
    toReviewStatus: string;
    reviewNotes: string;
    createdAt: string;
  },
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO response_package_export_review_events (
        id,
        export_id,
        snapshot_id,
        intent_id,
        bid_id,
        user_id,
        actor_user_id,
        from_review_status,
        to_review_status,
        review_notes,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.exportId,
      input.snapshotId,
      input.intentId,
      input.bidId,
      input.userId,
      input.actorUserId,
      input.fromReviewStatus,
      input.toReviewStatus,
      input.reviewNotes,
      input.createdAt,
    ],
  );
}

function toResponsePackageExportReviewEventRow(
  row: MysqlResponsePackageExportReviewEventRow,
): ResponsePackageExportReviewEventRow {
  return {
    id: row.id,
    exportId: row.exportId,
    snapshotId: row.snapshotId,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    actorUserId: row.actorUserId,
    fromReviewStatus: row.fromReviewStatus,
    toReviewStatus: row.toReviewStatus,
    reviewNotes: row.reviewNotes,
    createdAt: row.createdAt,
  };
}

export async function listResponsePackageExportReviewEventRowsFromMysql(
  mysql: MysqlResponseWorkspaceRepository,
  userId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlResponsePackageExportReviewEventRow>(
    mysql,
    `
      SELECT
        id,
        export_id AS exportId,
        snapshot_id AS snapshotId,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        actor_user_id AS actorUserId,
        from_review_status AS fromReviewStatus,
        to_review_status AS toReviewStatus,
        review_notes AS reviewNotes,
        created_at AS createdAt
      FROM response_package_export_review_events
      WHERE user_id = ? AND intent_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [userId, intentId],
  );

  return rows.map(toResponsePackageExportReviewEventRow);
}
