import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { complianceManifestItems } from "@/server/db/schema";
import type {
  ComplianceEvidenceStatus,
  ComplianceItemStatus,
  GeneratedComplianceItem,
  UpdateComplianceManifestItemInput,
} from "./types";

export type ComplianceManifestItemRow = typeof complianceManifestItems.$inferSelect;

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
