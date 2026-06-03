import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { complianceManifestItems } from "@/server/db/schema";
import type {
  ComplianceEvidenceStatus,
  ComplianceItemStatus,
  GeneratedComplianceItem,
  UpdateComplianceManifestItemInput,
} from "./types";

export type ComplianceManifestItemRow = typeof complianceManifestItems.$inferSelect;

interface MysqlComplianceRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlComplianceManifestItemRow {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  title: string;
  category: string;
  status: string;
  evidenceStatus: string;
  notes: string;
  sortOrder: number | string;
  createdAt: string;
  updatedAt: string;
}

interface CreateComplianceManifestItemsInput {
  intentId: string;
  bidId: string;
  userId: string;
  items: Array<GeneratedComplianceItem & { id: string; sortOrder: number }>;
  timestamp: string;
}

export function listComplianceManifestItemRows(db: AppDatabase, intentId: string) {
  return db
    .select()
    .from(complianceManifestItems)
    .where(eq(complianceManifestItems.intentId, intentId))
    .orderBy(asc(complianceManifestItems.sortOrder), asc(complianceManifestItems.id))
    .all();
}

function toComplianceManifestItemRow(row: MysqlComplianceManifestItemRow): ComplianceManifestItemRow {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    title: row.title,
    category: row.category,
    status: row.status,
    evidenceStatus: row.evidenceStatus,
    notes: row.notes,
    sortOrder: Number(row.sortOrder),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listComplianceManifestItemRowsFromMysql(
  mysql: MysqlComplianceRepository,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlComplianceManifestItemRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        title,
        category,
        status,
        evidence_status AS evidenceStatus,
        notes,
        sort_order AS sortOrder,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM compliance_manifest_items
      WHERE intent_id = ?
      ORDER BY sort_order ASC, id ASC
    `,
    [intentId],
  );

  return rows.map(toComplianceManifestItemRow);
}

export function createComplianceManifestItemRows(db: AppDatabase, input: CreateComplianceManifestItemsInput) {
  if (input.items.length === 0) return [];

  db.insert(complianceManifestItems)
    .values(input.items.map((item) => ({
      id: item.id,
      intentId: input.intentId,
      bidId: input.bidId,
      userId: input.userId,
      title: item.title,
      category: item.category,
      status: "not_started" satisfies ComplianceItemStatus,
      evidenceStatus: item.evidenceStatus,
      notes: "",
      sortOrder: item.sortOrder,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })))
    .run();

  return listComplianceManifestItemRows(db, input.intentId);
}

export async function createComplianceManifestItemRowsFromMysql(
  mysql: MysqlComplianceRepository,
  input: CreateComplianceManifestItemsInput,
) {
  if (input.items.length === 0) return [];

  for (const item of input.items) {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO compliance_manifest_items (
          id,
          intent_id,
          bid_id,
          user_id,
          title,
          category,
          status,
          evidence_status,
          notes,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        item.id,
        input.intentId,
        input.bidId,
        input.userId,
        item.title,
        item.category,
        "not_started" satisfies ComplianceItemStatus,
        item.evidenceStatus,
        "",
        item.sortOrder,
        input.timestamp,
        input.timestamp,
      ],
    );
  }

  return listComplianceManifestItemRowsFromMysql(mysql, input.intentId);
}

export function updateComplianceManifestItemRow(
  db: AppDatabase,
  intentId: string,
  input: UpdateComplianceManifestItemInput,
  timestamp: string,
) {
  const values: Partial<typeof complianceManifestItems.$inferInsert> = { updatedAt: timestamp };

  if (input.status !== undefined) {
    values.status = input.status satisfies ComplianceItemStatus;
  }

  if (input.evidenceStatus !== undefined) {
    values.evidenceStatus = input.evidenceStatus satisfies ComplianceEvidenceStatus;
  }

  if (input.notes !== undefined) {
    values.notes = input.notes;
  }

  db.update(complianceManifestItems)
    .set(values)
    .where(and(
      eq(complianceManifestItems.intentId, intentId),
      eq(complianceManifestItems.id, input.itemId),
    ))
    .run();

  return listComplianceManifestItemRows(db, intentId);
}

export async function updateComplianceManifestItemRowFromMysql(
  mysql: MysqlComplianceRepository,
  intentId: string,
  input: UpdateComplianceManifestItemInput,
  timestamp: string,
) {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (input.status !== undefined) {
    assignments.push("status = ?");
    values.push(input.status satisfies ComplianceItemStatus);
  }

  if (input.evidenceStatus !== undefined) {
    assignments.push("evidence_status = ?");
    values.push(input.evidenceStatus satisfies ComplianceEvidenceStatus);
  }

  if (input.notes !== undefined) {
    assignments.push("notes = ?");
    values.push(input.notes);
  }

  assignments.push("updated_at = ?");
  values.push(timestamp, intentId, input.itemId);

  await mysqlExecute(
    mysql,
    `
      UPDATE compliance_manifest_items
      SET ${assignments.join(", ")}
      WHERE intent_id = ? AND id = ?
    `,
    values,
  );

  return listComplianceManifestItemRowsFromMysql(mysql, intentId);
}
