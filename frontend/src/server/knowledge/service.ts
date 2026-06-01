import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import {
  createKnowledgeItemRow,
  findActiveKnowledgeOrganizationMembership,
  findKnowledgeBid,
  findKnowledgeIntentForActiveOrganizationMember,
  findKnowledgeOrganization,
  findKnowledgeUser,
  listKnowledgeItemRows,
  type KnowledgeItemRow,
} from "./repository";
import {
  KNOWLEDGE_ITEM_TYPES,
  KNOWLEDGE_SOURCE_KINDS,
  type CreateKnowledgeItemInput,
  type KnowledgeItem,
  type KnowledgeItemType,
  type KnowledgeListResponse,
  type KnowledgeSourceKind,
  type ListKnowledgeItemsInput,
} from "./types";

const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 5000;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

export class KnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeValidationError";
  }
}

export function isKnowledgeItemType(value: unknown): value is KnowledgeItemType {
  return typeof value === "string" && KNOWLEDGE_ITEM_TYPES.includes(value as KnowledgeItemType);
}

export function isKnowledgeSourceKind(value: unknown): value is KnowledgeSourceKind {
  return typeof value === "string" && KNOWLEDGE_SOURCE_KINDS.includes(value as KnowledgeSourceKind);
}

function nowIso() {
  return new Date().toISOString();
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function normalizeRequiredText(value: unknown, message: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new KnowledgeValidationError(message);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new KnowledgeValidationError(message);
  }

  return truncate(normalized, maxLength);
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) return [];

  const tags: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") continue;

    const tag = truncate(entry.trim(), MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;

    seen.add(tag);
    tags.push(tag);

    if (tags.length >= MAX_TAGS) break;
  }

  return tags;
}

function normalizeLimit(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIST_LIMIT;

  return Math.min(Math.max(1, Math.floor(value)), MAX_LIST_LIMIT);
}

function parseJsonField<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid knowledge JSON field: ${field}`);
  }
}

function normalizeMetadata(value: Record<string, unknown> | undefined) {
  return value ?? {};
}

function normalizeOptionalText(value: unknown, message: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new KnowledgeValidationError(message);
  }

  const normalized = value?.trim() ?? "";

  return normalized || null;
}

function normalizeOptionalId(value: unknown, message: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new KnowledgeValidationError(message);
  }

  const normalized = value.trim();

  return normalized || null;
}

function hydrateKnowledgeItem(row: KnowledgeItemRow): KnowledgeItem {
  if (!isKnowledgeItemType(row.type)) {
    throw new Error("Invalid knowledge item field: type");
  }

  if (!isKnowledgeSourceKind(row.sourceKind)) {
    throw new Error("Invalid knowledge item field: sourceKind");
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    body: row.body,
    type: row.type,
    tags: parseJsonField<string[]>(row.tagsJson, "tagsJson"),
    sourceKind: row.sourceKind,
    sourceIntentId: row.sourceIntentId,
    sourceBidId: row.sourceBidId,
    sourceUrl: row.sourceUrl,
    metadata: parseJsonField<Record<string, unknown>>(row.metadataJson, "metadataJson"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createKnowledgeItem(
  database: AppDatabase,
  input: CreateKnowledgeItemInput,
): Promise<KnowledgeItem> {
  const title = normalizeRequiredText(input.title, "Knowledge title is required.", MAX_TITLE_LENGTH);
  const body = normalizeRequiredText(input.body, "Knowledge body is required.", MAX_BODY_LENGTH);
  const sourceIntentId = normalizeOptionalId(input.sourceIntentId, "Linked intent is not available.");
  const sourceBidId = normalizeOptionalId(input.sourceBidId, "Linked bid is not available.");
  const sourceUrl = normalizeOptionalText(input.sourceUrl, "Knowledge source URL must be a string.");

  if (!isKnowledgeItemType(input.type)) {
    throw new KnowledgeValidationError("Unsupported knowledge item type.");
  }

  if (!isKnowledgeSourceKind(input.sourceKind)) {
    throw new KnowledgeValidationError("Unsupported knowledge source kind.");
  }

  const timestamp = nowIso();

  if (!findKnowledgeUser(database, input.userId) || !findKnowledgeOrganization(database, input.organizationId)) {
    throw new KnowledgeValidationError("Knowledge principal is not available.");
  }

  if (!findActiveKnowledgeOrganizationMembership(database, input.userId, input.organizationId)) {
    throw new KnowledgeValidationError("Knowledge organization membership is not available.");
  }

  if (sourceIntentId) {
    const intent = findKnowledgeIntentForActiveOrganizationMember(database, input.organizationId, sourceIntentId);

    if (!intent) {
      throw new KnowledgeValidationError("Linked intent is not available.");
    }

    if (sourceBidId && sourceBidId !== intent.bidId) {
      throw new KnowledgeValidationError("Linked bid does not match intent.");
    }
  } else if (sourceBidId && !findKnowledgeBid(database, sourceBidId)) {
    throw new KnowledgeValidationError("Linked bid is not available.");
  }

  const row = createKnowledgeItemRow(database, {
    id: `knowledge_${crypto.randomUUID()}`,
    organizationId: input.organizationId,
    createdByUserId: input.userId,
    title,
    body,
    type: input.type,
    tags: normalizeTags(input.tags),
    sourceKind: input.sourceKind,
    sourceIntentId,
    sourceBidId,
    sourceUrl,
    metadata: normalizeMetadata(input.metadata),
    timestamp,
  });

  if (!row) {
    throw new Error("Failed to create knowledge item");
  }

  return hydrateKnowledgeItem(row);
}

export async function listKnowledgeItems(
  database: AppDatabase,
  input: ListKnowledgeItemsInput,
): Promise<KnowledgeListResponse> {
  let type: KnowledgeItemType | null = null;

  if (input.type) {
    if (!isKnowledgeItemType(input.type)) {
      throw new KnowledgeValidationError("Unsupported knowledge item type.");
    }

    type = input.type;
  }

  return {
    items: listKnowledgeItemRows(database, {
      ...input,
      type,
      limit: normalizeLimit(input.limit),
    }).map(hydrateKnowledgeItem),
  };
}
