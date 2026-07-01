import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { artifactVersions, supplierArtifacts } from "@/server/db/schema";

export type SupplierArtifactRow = typeof supplierArtifacts.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersions.$inferSelect;

export interface MysqlArtifactRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlSupplierArtifactRow {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  title: string;
  artifactType: string;
  purpose: string;
  fileName: string;
  contentType: string;
  byteSize: number | string;
  storagePath: string;
  checksumSha256: string;
  expiresAt: string | null;
  reviewStatus: string;
  notes: string;
  deletedAt: string | null;
  deletedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MysqlArtifactVersionRow {
  id: string;
  artifactId: string;
  intentId: string;
  bidId: string;
  userId: string;
  versionNumber: number | string;
  title: string;
  fileName: string;
  contentType: string;
  byteSize: number | string;
  storagePath: string;
  storageProvider: string;
  checksumSha256: string;
  securityScanStatus: string;
  retentionPolicy: string;
  replacementReason: string;
  createdByUserId: string;
  createdAt: string;
}

function toSupplierArtifactRow(row: MysqlSupplierArtifactRow): SupplierArtifactRow {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    title: row.title,
    artifactType: row.artifactType,
    purpose: row.purpose,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: Number(row.byteSize),
    storagePath: row.storagePath,
    checksumSha256: row.checksumSha256,
    expiresAt: row.expiresAt,
    reviewStatus: row.reviewStatus,
    notes: row.notes,
    deletedAt: row.deletedAt,
    deletedByUserId: row.deletedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toArtifactVersionRow(row: MysqlArtifactVersionRow): ArtifactVersionRow {
  return {
    id: row.id,
    artifactId: row.artifactId,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    versionNumber: Number(row.versionNumber),
    title: row.title,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: Number(row.byteSize),
    storagePath: row.storagePath,
    storageProvider: row.storageProvider,
    checksumSha256: row.checksumSha256,
    securityScanStatus: row.securityScanStatus,
    retentionPolicy: row.retentionPolicy,
    replacementReason: row.replacementReason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function mysqlArtifactSelect(whereClause: string) {
  return `
    SELECT
      id,
      intent_id AS intentId,
      bid_id AS bidId,
      user_id AS userId,
      title,
      artifact_type AS artifactType,
      purpose,
      file_name AS fileName,
      content_type AS contentType,
      byte_size AS byteSize,
      storage_path AS storagePath,
      checksum_sha256 AS checksumSha256,
      expires_at AS expiresAt,
      review_status AS reviewStatus,
      notes,
      deleted_at AS deletedAt,
      deleted_by_user_id AS deletedByUserId,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM supplier_artifacts
    ${whereClause}
  `;
}

function mysqlArtifactVersionSelect(whereClause: string) {
  return `
    SELECT
      id,
      artifact_id AS artifactId,
      intent_id AS intentId,
      bid_id AS bidId,
      user_id AS userId,
      version_number AS versionNumber,
      title,
      file_name AS fileName,
      content_type AS contentType,
      byte_size AS byteSize,
      storage_path AS storagePath,
      storage_provider AS storageProvider,
      checksum_sha256 AS checksumSha256,
      security_scan_status AS securityScanStatus,
      retention_policy AS retentionPolicy,
      replacement_reason AS replacementReason,
      created_by_user_id AS createdByUserId,
      created_at AS createdAt
    FROM artifact_versions
    ${whereClause}
  `;
}

export function listSupplierArtifactRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(supplierArtifacts)
    .where(and(
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      isNull(supplierArtifacts.deletedAt),
    ))
    .orderBy(asc(supplierArtifacts.createdAt), asc(supplierArtifacts.id))
    .all();
}

export async function listSupplierArtifactRowsFromMysql(
  mysql: MysqlArtifactRepository,
  userId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlSupplierArtifactRow>(
    mysql,
    `${mysqlArtifactSelect("WHERE user_id = ? AND intent_id = ? AND deleted_at IS NULL")}
     ORDER BY created_at ASC, id ASC`,
    [userId, intentId],
  );

  return rows.map(toSupplierArtifactRow);
}

export function findSupplierArtifactRow(db: AppDatabase, userId: string, intentId: string, artifactId: string) {
  return db
    .select()
    .from(supplierArtifacts)
    .where(and(
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      eq(supplierArtifacts.id, artifactId),
      isNull(supplierArtifacts.deletedAt),
    ))
    .limit(1)
    .get();
}

export async function findSupplierArtifactRowFromMysql(
  mysql: MysqlArtifactRepository,
  userId: string,
  intentId: string,
  artifactId: string,
) {
  const row = await mysqlSelectOne<MysqlSupplierArtifactRow>(
    mysql,
    `${mysqlArtifactSelect("WHERE user_id = ? AND intent_id = ? AND id = ? AND deleted_at IS NULL")}
     LIMIT 1`,
    [userId, intentId, artifactId],
  );

  return row ? toSupplierArtifactRow(row) : null;
}

export function listArtifactVersionRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(artifactVersions)
    .where(and(eq(artifactVersions.userId, userId), eq(artifactVersions.intentId, intentId)))
    .orderBy(asc(artifactVersions.artifactId), asc(artifactVersions.versionNumber), asc(artifactVersions.id))
    .all();
}

export async function listArtifactVersionRowsFromMysql(
  mysql: MysqlArtifactRepository,
  userId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlArtifactVersionRow>(
    mysql,
    `${mysqlArtifactVersionSelect("WHERE user_id = ? AND intent_id = ?")}
     ORDER BY artifact_id ASC, version_number ASC, id ASC`,
    [userId, intentId],
  );

  return rows.map(toArtifactVersionRow);
}

export function maxArtifactVersionNumber(db: AppDatabase, userId: string, intentId: string, artifactId: string) {
  const rows = db
    .select({ versionNumber: artifactVersions.versionNumber })
    .from(artifactVersions)
    .where(and(
      eq(artifactVersions.userId, userId),
      eq(artifactVersions.intentId, intentId),
      eq(artifactVersions.artifactId, artifactId),
    ))
    .all();

  return rows.reduce((max, row) => Math.max(max, row.versionNumber), 0);
}

export async function maxArtifactVersionNumberFromMysql(
  mysql: MysqlArtifactRepository,
  userId: string,
  intentId: string,
  artifactId: string,
) {
  const row = await mysqlSelectOne<{ versionNumber: number | string | null }>(
    mysql,
    `
      SELECT COALESCE(MAX(version_number), 0) AS versionNumber
      FROM artifact_versions
      WHERE user_id = ? AND intent_id = ? AND artifact_id = ?
      LIMIT 1
    `,
    [userId, intentId, artifactId],
  );

  return Number(row?.versionNumber ?? 0);
}

export function createSupplierArtifactRow(db: AppDatabase, row: typeof supplierArtifacts.$inferInsert) {
  db.insert(supplierArtifacts).values(row).run();
}

export function createArtifactVersionRow(db: AppDatabase, row: typeof artifactVersions.$inferInsert) {
  db.insert(artifactVersions).values(row).run();
}

export async function createSupplierArtifactRowFromMysql(
  mysql: MysqlArtifactRepository,
  row: typeof supplierArtifacts.$inferInsert,
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO supplier_artifacts (
        id,
        intent_id,
        bid_id,
        user_id,
        title,
        artifact_type,
        purpose,
        file_name,
        content_type,
        byte_size,
        storage_path,
        checksum_sha256,
        expires_at,
        review_status,
        notes,
        deleted_at,
        deleted_by_user_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.intentId,
      row.bidId,
      row.userId,
      row.title,
      row.artifactType,
      row.purpose,
      row.fileName,
      row.contentType,
      row.byteSize,
      row.storagePath,
      row.checksumSha256,
      row.expiresAt,
      row.reviewStatus,
      row.notes,
      row.deletedAt,
      row.deletedByUserId,
      row.createdAt,
      row.updatedAt,
    ],
  );
}

export async function createArtifactVersionRowFromMysql(
  mysql: MysqlArtifactRepository,
  row: typeof artifactVersions.$inferInsert,
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO artifact_versions (
        id,
        artifact_id,
        intent_id,
        bid_id,
        user_id,
        version_number,
        title,
        file_name,
        content_type,
        byte_size,
        storage_path,
        storage_provider,
        checksum_sha256,
        security_scan_status,
        retention_policy,
        replacement_reason,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.artifactId,
      row.intentId,
      row.bidId,
      row.userId,
      row.versionNumber,
      row.title,
      row.fileName,
      row.contentType,
      row.byteSize,
      row.storagePath,
      row.storageProvider,
      row.checksumSha256,
      row.securityScanStatus,
      row.retentionPolicy,
      row.replacementReason,
      row.createdByUserId,
      row.createdAt,
    ],
  );
}

export function updateSupplierArtifactManifestRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  artifactId: string,
  patch: Pick<typeof supplierArtifacts.$inferInsert,
    "title" | "fileName" | "contentType" | "byteSize" | "storagePath" | "checksumSha256" | "expiresAt" | "notes" | "updatedAt"
  >,
) {
  db.update(supplierArtifacts)
    .set(patch)
    .where(and(
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      eq(supplierArtifacts.id, artifactId),
      isNull(supplierArtifacts.deletedAt),
    ))
    .run();
}

export async function updateSupplierArtifactManifestRowFromMysql(
  mysql: MysqlArtifactRepository,
  userId: string,
  intentId: string,
  artifactId: string,
  patch: Pick<typeof supplierArtifacts.$inferInsert,
    "title" | "fileName" | "contentType" | "byteSize" | "storagePath" | "checksumSha256" | "expiresAt" | "notes" | "updatedAt"
  >,
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE supplier_artifacts
      SET title = ?,
          file_name = ?,
          content_type = ?,
          byte_size = ?,
          storage_path = ?,
          checksum_sha256 = ?,
          expires_at = ?,
          notes = ?,
          updated_at = ?
      WHERE user_id = ?
        AND intent_id = ?
        AND id = ?
        AND deleted_at IS NULL
    `,
    [
      patch.title,
      patch.fileName,
      patch.contentType,
      patch.byteSize,
      patch.storagePath,
      patch.checksumSha256,
      patch.expiresAt,
      patch.notes,
      patch.updatedAt,
      userId,
      intentId,
      artifactId,
    ],
  );
}

export function softDeleteSupplierArtifactRow(
  db: AppDatabase,
  userId: string,
  intentId: string,
  artifactId: string,
  timestamp: string,
) {
  db.update(supplierArtifacts)
    .set({
      deletedAt: timestamp,
      deletedByUserId: userId,
      updatedAt: timestamp,
    })
    .where(and(
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      eq(supplierArtifacts.id, artifactId),
      isNull(supplierArtifacts.deletedAt),
    ))
    .run();
}

export async function softDeleteSupplierArtifactRowFromMysql(
  mysql: MysqlArtifactRepository,
  userId: string,
  intentId: string,
  artifactId: string,
  timestamp: string,
) {
  await mysqlExecute(
    mysql,
    `
      UPDATE supplier_artifacts
      SET deleted_at = ?,
          deleted_by_user_id = ?,
          updated_at = ?
      WHERE user_id = ?
        AND intent_id = ?
        AND id = ?
        AND deleted_at IS NULL
    `,
    [timestamp, userId, timestamp, userId, intentId, artifactId],
  );
}
