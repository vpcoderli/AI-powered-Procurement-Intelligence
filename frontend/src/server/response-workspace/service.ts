import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { generateResponseWorkspaceItems } from "./generator";
import {
  createResponseWorkspaceItemRows,
  findResponseWorkspaceItemRow,
  listResponseWorkspaceItemRows,
  updateResponseWorkspaceItemRow,
  type ResponseWorkspaceItemRow,
} from "./repository";
import {
  isResponseWorkspaceItemKind,
  isResponseWorkspaceItemStatus,
  type ResponseWorkspace,
  type ResponseWorkspaceItem,
  type ResponseWorkspaceItemKind,
  type ResponseWorkspaceItemStatus,
  type UpdateResponseWorkspaceItemInput,
} from "./types";

const MAX_TITLE_LENGTH = 180;
const MAX_NOTES_LENGTH = 2000;

export class ResponseWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseWorkspaceValidationError";
  }
}

function nowIso() {
  return new Date().toISOString();
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

  return normalized;
}

function hydrateItem(row: ResponseWorkspaceItemRow): ResponseWorkspaceItem {
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
    kind: row.kind,
    title: row.title,
    status: row.status,
    notes: row.notes,
    dueAt: row.dueAt,
    sortOrder: row.sortOrder,
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

async function loadWorkspace(database: AppDatabase, userId: string, intentId: string): Promise<ResponseWorkspace> {
  const rows = listResponseWorkspaceItemRows(database, userId, intentId);
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const items = rows.map(hydrateItem);

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
  const existing = listResponseWorkspaceItemRows(database, userId, intentId);

  if (existing.length > 0) {
    return loadWorkspace(database, userId, intentId);
  }

  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const timestamp = nowIso();
  createResponseWorkspaceItemRows(database, {
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    items: generateResponseWorkspaceItems(intent).map((item) => ({
      ...item,
      id: `response_workspace_item_${crypto.randomUUID()}`,
    })),
    timestamp,
  });

  return loadWorkspace(database, userId, intentId);
}

export async function updateResponseWorkspaceItem(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateResponseWorkspaceItemInput,
): Promise<ResponseWorkspace> {
  await getOrCreateResponseWorkspace(database, userId, intentId);
  const normalized = normalizeUpdateInput(input);

  if (!findResponseWorkspaceItemRow(database, userId, intentId, normalized.itemId)) {
    throw new ResponseWorkspaceValidationError("Response workspace item is not available.");
  }

  updateResponseWorkspaceItemRow(database, userId, intentId, normalized, nowIso());

  return loadWorkspace(database, userId, intentId);
}
