import { and, asc, desc, eq, like, or, type SQL } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { knowledgeItems, organizations, users } from "@/server/db/schema";
import type { KnowledgeItemType, KnowledgeSourceKind, ListKnowledgeItemsInput } from "./types";

export type KnowledgeItemRow = typeof knowledgeItems.$inferSelect;

interface CreateKnowledgeItemRowInput {
  id: string;
  organizationId: string;
  createdByUserId: string;
  title: string;
  body: string;
  type: KnowledgeItemType;
  tags: string[];
  sourceKind: KnowledgeSourceKind;
  sourceIntentId: string | null;
  sourceBidId: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export function ensureKnowledgeScope(db: AppDatabase, organizationId: string, userId: string, timestamp: string) {
  db.insert(users)
    .values({
      id: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();

  db.insert(organizations)
    .values({
      id: organizationId,
      name: organizationId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();
}

export function createKnowledgeItemRow(db: AppDatabase, input: CreateKnowledgeItemRowInput) {
  db.insert(knowledgeItems)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      title: input.title,
      body: input.body,
      type: input.type,
      tagsJson: JSON.stringify(input.tags),
      sourceKind: input.sourceKind,
      sourceIntentId: input.sourceIntentId,
      sourceBidId: input.sourceBidId,
      sourceUrl: input.sourceUrl,
      metadataJson: JSON.stringify(input.metadata),
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .run();

  return db
    .select()
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, input.id))
    .limit(1)
    .get();
}

export function listKnowledgeItemRows(
  db: AppDatabase,
  input: ListKnowledgeItemsInput & { type?: KnowledgeItemType | null; limit: number },
) {
  const conditions: SQL[] = [eq(knowledgeItems.organizationId, input.organizationId)];
  const query = input.q?.trim();

  if (input.intentId) conditions.push(eq(knowledgeItems.sourceIntentId, input.intentId));
  if (input.bidId) conditions.push(eq(knowledgeItems.sourceBidId, input.bidId));
  if (input.type) conditions.push(eq(knowledgeItems.type, input.type));

  if (query) {
    const pattern = `%${query}%`;
    const searchCondition = or(
      like(knowledgeItems.title, pattern),
      like(knowledgeItems.body, pattern),
      like(knowledgeItems.tagsJson, pattern),
    );

    if (searchCondition) conditions.push(searchCondition);
  }

  return db
    .select()
    .from(knowledgeItems)
    .where(and(...conditions))
    .orderBy(desc(knowledgeItems.createdAt), asc(knowledgeItems.id))
    .limit(input.limit)
    .all();
}
