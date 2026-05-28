import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { generateComplianceManifestItems } from "./generator";
import {
  createComplianceManifestItemRows,
  listComplianceManifestItemRows,
  updateComplianceManifestItemRow,
  type ComplianceManifestItemRow,
} from "./repository";
import type {
  ComplianceCategory,
  ComplianceEvidenceStatus,
  ComplianceItemStatus,
  ComplianceManifest,
  ComplianceManifestItem,
  UpdateComplianceManifestItemInput,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function hydrateItem(row: ComplianceManifestItemRow): ComplianceManifestItem {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    title: row.title,
    category: row.category as ComplianceCategory,
    status: row.status as ComplianceItemStatus,
    evidenceStatus: row.evidenceStatus as ComplianceEvidenceStatus,
    notes: row.notes,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hydrateManifest(rows: ComplianceManifestItemRow[]): ComplianceManifest {
  const items = rows.map(hydrateItem);
  const first = items[0];

  return {
    intentId: first?.intentId ?? "",
    bidId: first?.bidId ?? "",
    userId: first?.userId ?? "",
    items,
    summary: {
      total: items.length,
      completed: items.filter((item) => item.status === "complete").length,
      blocked: items.filter((item) => item.status === "blocked").length,
      evidenceAttached: items.filter((item) => item.evidenceStatus === "attached").length,
    },
  };
}

export async function getOrCreateComplianceManifest(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<ComplianceManifest> {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const existingRows = listComplianceManifestItemRows(database, intentId);

  if (existingRows.length > 0) {
    return hydrateManifest(existingRows);
  }

  const timestamp = nowIso();
  const generatedItems = generateComplianceManifestItems(intent).map((item, index) => ({
    ...item,
    id: `compliance_item_${crypto.randomUUID()}`,
    sortOrder: index,
  }));
  const rows = createComplianceManifestItemRows(database, {
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: intent.userId,
    items: generatedItems,
    timestamp,
  });

  return hydrateManifest(rows);
}

export async function updateComplianceManifestItem(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateComplianceManifestItemInput,
): Promise<ComplianceManifest> {
  await getOrCreateComplianceManifest(database, userId, intentId);

  const rows = updateComplianceManifestItemRow(database, intentId, {
    ...input,
    notes: input.notes?.trim(),
  }, nowIso());

  return hydrateManifest(rows);
}
