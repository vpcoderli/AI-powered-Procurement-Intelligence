import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
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

interface MysqlKnowledgeStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlKnowledgeItemRow {
  id: string;
  organizationId: string;
  createdByUserId: string;
  title: string;
  body: string;
  type: string;
  tagsJson: string;
  sourceKind: string;
  sourceIntentId: string | null;
  sourceBidId: string | null;
  sourceUrl: string | null;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}

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

function mysqlKnowledgeSelectSql(whereClause: string, suffix = "") {
  return `
    SELECT
      id,
      organization_id AS organizationId,
      created_by_user_id AS createdByUserId,
      title,
      body,
      type,
      tags_json AS tagsJson,
      source_kind AS sourceKind,
      source_intent_id AS sourceIntentId,
      source_bid_id AS sourceBidId,
      source_url AS sourceUrl,
      metadata_json AS metadataJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM knowledge_items
    ${whereClause}
    ${suffix}
  `;
}

function hydrateMysqlKnowledgeItem(row: MysqlKnowledgeItemRow): KnowledgeItem {
  return hydrateKnowledgeItem(row as KnowledgeItemRow);
}

async function findMysqlUser(mysql: MysqlKnowledgeStore, userId: string) {
  return mysqlSelectOne<{ id: string }>(mysql, "SELECT id FROM users WHERE id = ? LIMIT 1", [userId]);
}

async function findMysqlOrganization(mysql: MysqlKnowledgeStore, organizationId: string) {
  return mysqlSelectOne<{ id: string }>(
    mysql,
    "SELECT id FROM organizations WHERE id = ? LIMIT 1",
    [organizationId],
  );
}

async function findMysqlActiveOrganizationMembership(
  mysql: MysqlKnowledgeStore,
  userId: string,
  organizationId: string,
) {
  return mysqlSelectOne<{ organizationId: string; userId: string; status: string }>(
    mysql,
    `
      SELECT organization_id AS organizationId, user_id AS userId, status
      FROM organization_memberships
      WHERE user_id = ? AND organization_id = ? AND status = 'active'
      LIMIT 1
    `,
    [userId, organizationId],
  );
}

async function findMysqlKnowledgeBid(mysql: MysqlKnowledgeStore, bidId: string) {
  return mysqlSelectOne<{ id: string }>(mysql, "SELECT id FROM bids WHERE id = ? LIMIT 1", [bidId]);
}

async function findMysqlKnowledgeIntentForActiveOrganizationMember(
  mysql: MysqlKnowledgeStore,
  organizationId: string,
  intentId: string,
) {
  return mysqlSelectOne<{ id: string; bidId: string }>(
    mysql,
    `
      SELECT intent_to_bid.id, intent_to_bid.bid_id AS bidId
      FROM intent_to_bid
      INNER JOIN organization_memberships
        ON organization_memberships.user_id = intent_to_bid.user_id
      WHERE intent_to_bid.id = ?
        AND organization_memberships.organization_id = ?
        AND organization_memberships.status = 'active'
      LIMIT 1
    `,
    [intentId, organizationId],
  );
}

async function findMysqlKnowledgeItemById(mysql: MysqlKnowledgeStore, id: string) {
  return mysqlSelectOne<MysqlKnowledgeItemRow>(
    mysql,
    mysqlKnowledgeSelectSql("WHERE id = ?", "LIMIT 1"),
    [id],
  );
}

export async function createKnowledgeItemFromMysql(
  mysql: MysqlKnowledgeStore,
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

  if (
    !(await findMysqlUser(mysql, input.userId)) ||
    !(await findMysqlOrganization(mysql, input.organizationId))
  ) {
    throw new KnowledgeValidationError("Knowledge principal is not available.");
  }

  if (!(await findMysqlActiveOrganizationMembership(mysql, input.userId, input.organizationId))) {
    throw new KnowledgeValidationError("Knowledge organization membership is not available.");
  }

  if (sourceIntentId) {
    const intent = await findMysqlKnowledgeIntentForActiveOrganizationMember(
      mysql,
      input.organizationId,
      sourceIntentId,
    );

    if (!intent) {
      throw new KnowledgeValidationError("Linked intent is not available.");
    }

    if (sourceBidId && sourceBidId !== intent.bidId) {
      throw new KnowledgeValidationError("Linked bid does not match intent.");
    }
  } else if (sourceBidId && !(await findMysqlKnowledgeBid(mysql, sourceBidId))) {
    throw new KnowledgeValidationError("Linked bid is not available.");
  }

  const id = `knowledge_${crypto.randomUUID()}`;

  await mysqlExecute(
    mysql,
    `
      INSERT INTO knowledge_items (
        id,
        organization_id,
        created_by_user_id,
        title,
        body,
        type,
        tags_json,
        source_kind,
        source_intent_id,
        source_bid_id,
        source_url,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      input.organizationId,
      input.userId,
      title,
      body,
      input.type,
      JSON.stringify(normalizeTags(input.tags)),
      input.sourceKind,
      sourceIntentId,
      sourceBidId,
      sourceUrl,
      JSON.stringify(normalizeMetadata(input.metadata)),
      timestamp,
      timestamp,
    ],
  );

  const row = await findMysqlKnowledgeItemById(mysql, id);
  if (!row) {
    throw new Error("Failed to create knowledge item");
  }

  return hydrateMysqlKnowledgeItem(row);
}

export async function listKnowledgeItemsFromMysql(
  mysql: MysqlKnowledgeStore,
  input: ListKnowledgeItemsInput,
): Promise<KnowledgeListResponse> {
  let type: KnowledgeItemType | null = null;

  if (input.type) {
    if (!isKnowledgeItemType(input.type)) {
      throw new KnowledgeValidationError("Unsupported knowledge item type.");
    }

    type = input.type;
  }

  const conditions = ["organization_id = ?"];
  const values: unknown[] = [input.organizationId];
  const query = input.q?.trim();

  if (input.intentId) {
    conditions.push("source_intent_id = ?");
    values.push(input.intentId);
  }

  if (input.bidId) {
    conditions.push("source_bid_id = ?");
    values.push(input.bidId);
  }

  if (type) {
    conditions.push("type = ?");
    values.push(type);
  }

  if (query) {
    const pattern = `%${query}%`;
    conditions.push("(title LIKE ? OR body LIKE ? OR tags_json LIKE ?)");
    values.push(pattern, pattern, pattern);
  }

  values.push(normalizeLimit(input.limit));
  const rows = await mysqlSelectMany<MysqlKnowledgeItemRow>(
    mysql,
    mysqlKnowledgeSelectSql(
      `WHERE ${conditions.join(" AND ")}`,
      "ORDER BY created_at DESC, id ASC LIMIT ?",
    ),
    values,
  );

  return {
    items: rows.map(hydrateMysqlKnowledgeItem),
  };
}

export async function createKnowledgeItem(
  database: AppDatabase,
  input: CreateKnowledgeItemInput,
): Promise<KnowledgeItem> {
  if (isMysqlDatabaseUrlConfigured()) {
    return createKnowledgeItemFromMysql(resolveMysqlPool(), input);
  }

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
  if (isMysqlDatabaseUrlConfigured()) {
    return listKnowledgeItemsFromMysql(resolveMysqlPool(), input);
  }

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
