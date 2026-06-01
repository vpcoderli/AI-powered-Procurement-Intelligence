import { and, asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { responseWorkspaceItems } from "@/server/db/schema";
import type { GeneratedResponseWorkspaceItem } from "./generator";
import type { UpdateResponseWorkspaceItemInput } from "./types";

export type ResponseWorkspaceItemRow = typeof responseWorkspaceItems.$inferSelect;

export function listResponseWorkspaceItemRows(db: AppDatabase, userId: string, intentId: string) {
  return db
    .select()
    .from(responseWorkspaceItems)
    .where(and(eq(responseWorkspaceItems.userId, userId), eq(responseWorkspaceItems.intentId, intentId)))
    .orderBy(asc(responseWorkspaceItems.sortOrder), asc(responseWorkspaceItems.id))
    .all();
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

  db.update(responseWorkspaceItems)
    .set(values)
    .where(and(
      eq(responseWorkspaceItems.userId, userId),
      eq(responseWorkspaceItems.intentId, intentId),
      eq(responseWorkspaceItems.id, input.itemId),
    ))
    .run();
}
