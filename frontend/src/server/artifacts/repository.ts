import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { supplierArtifacts } from "@/server/db/schema";

export type SupplierArtifactRow = typeof supplierArtifacts.$inferSelect;

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
  createdAt: string;
  updatedAt: string;
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM supplier_artifacts
    ${whereClause}
  `;
}

export function listSupplierArtifactRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(supplierArtifacts)
    .where(and(eq(supplierArtifacts.userId, userId), eq(supplierArtifacts.intentId, intentId)))
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
    `${mysqlArtifactSelect("WHERE user_id = ? AND intent_id = ?")}
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
    `${mysqlArtifactSelect("WHERE user_id = ? AND intent_id = ? AND id = ?")}
     LIMIT 1`,
    [userId, intentId, artifactId],
  );

  return row ? toSupplierArtifactRow(row) : null;
}

export function createSupplierArtifactRow(db: AppDatabase, row: typeof supplierArtifacts.$inferInsert) {
  db.insert(supplierArtifacts).values(row).run();
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
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      row.createdAt,
      row.updatedAt,
    ],
  );
}
