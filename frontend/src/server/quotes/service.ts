import crypto from "node:crypto";
import { ensureMysqlUserWorkspace } from "@/server/account/mysql-workspace";
import { ensureUserWorkspace } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createQuoteRequestRow,
  createQuoteRequestRowFromMysql,
  createSourcingPartnerRow,
  createSourcingPartnerRowFromMysql,
  findQuoteRequestRow,
  findQuoteRequestRowFromMysql,
  findSourcingPartnerRow,
  findSourcingPartnerRowFromMysql,
  listArtifactRowsByIds,
  listArtifactRowsByIdsFromMysql,
  listQuoteArtifactsForRequests,
  listQuoteArtifactsForRequestsFromMysql,
  listQuoteRequestRows,
  listQuoteRequestRowsFromMysql,
  listSourcingPartnerRows,
  listSourcingPartnerRowsFromMysql,
  updateQuoteRequestRow,
  updateQuoteRequestRowFromMysql,
  type QuoteArtifactRow,
  type QuoteRequestRow,
  type SourcingPartnerRow,
} from "./repository";
import {
  isQuoteRequestStatus,
  isSourcingPartnerStatus,
  type CreateQuoteRequestInput,
  type QuoteRequest,
  type QuoteRequestArtifact,
  type QuoteRequestStatus,
  type QuoteWorkspace,
  type SourcingPartner,
  type UpdateQuoteRequestInput,
} from "./types";

const MAX_NAME_LENGTH = 160;
const MAX_TITLE_LENGTH = 180;
const MAX_TEXT_LENGTH = 2000;
const MAX_LIST_ITEMS = 40;

export class QuoteWorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteWorkflowValidationError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRequiredString(value: unknown, message: string, maxLength: number) {
  if (typeof value !== "string") throw new QuoteWorkflowValidationError(message);
  const normalized = value.trim();
  if (!normalized) throw new QuoteWorkflowValidationError(message);
  return normalized.slice(0, maxLength);
}

function normalizeOptionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new QuoteWorkflowValidationError("Quote field must be a string.");
  return value.trim().slice(0, maxLength);
}

function normalizeOptionalDate(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new QuoteWorkflowValidationError("Quote due date must be a string.");
  return value.trim() || null;
}

function normalizeStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n|,/) : null;
  if (!raw) throw new QuoteWorkflowValidationError("Quote list field is invalid.");

  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function parseJsonList(value: string, field: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    throw new Error(`Invalid quote JSON field: ${field}`);
  }
}

function quoteArtifactDownloadUrl(intentId: string, artifactId: string) {
  return `/api/intents/${encodeURIComponent(intentId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function hydratePartner(row: SourcingPartnerRow): SourcingPartner {
  if (!isSourcingPartnerStatus(row.status)) {
    throw new Error("Invalid sourcing partner status.");
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    name: row.name,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    phone: row.phone,
    category: row.category,
    regions: parseJsonList(row.regionsJson, "regionsJson"),
    capabilityTags: parseJsonList(row.capabilityTagsJson, "capabilityTagsJson"),
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function hydrateArtifact(row: QuoteArtifactRow): QuoteRequestArtifact {
  return {
    id: row.id,
    title: row.title,
    fileName: row.fileName,
    artifactType: row.artifactType,
    purpose: row.purpose,
    downloadUrl: quoteArtifactDownloadUrl(row.intentId, row.id),
  };
}

function hydrateRequest(
  row: QuoteRequestRow,
  partnerById: Map<string, SourcingPartner>,
  artifactsByRequest: Map<string, QuoteRequestArtifact[]>,
): QuoteRequest {
  if (!isQuoteRequestStatus(row.status)) {
    throw new Error("Invalid quote request status.");
  }

  return {
    id: row.id,
    organizationId: row.organizationId,
    intentId: row.intentId,
    bidId: row.bidId,
    partnerId: row.partnerId,
    partnerName: partnerById.get(row.partnerId)?.name ?? "Unknown partner",
    createdByUserId: row.createdByUserId,
    title: row.title,
    description: row.description,
    status: row.status,
    requestedDueAt: row.requestedDueAt,
    lineItems: parseJsonList(row.lineItemsJson, "lineItemsJson"),
    quotedAmountCents: row.quotedAmountCents,
    currency: row.currency,
    responseNotes: row.responseNotes,
    respondedAt: row.respondedAt,
    artifacts: artifactsByRequest.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildSummary(partners: SourcingPartner[], requests: QuoteRequest[]) {
  const count = (status: QuoteRequestStatus) => requests.filter((request) => request.status === status).length;

  return {
    partners: partners.length,
    requests: requests.length,
    draft: count("draft"),
    sent: count("sent"),
    received: count("received"),
    accepted: count("accepted"),
  };
}

async function workspaceForUser(database: AppDatabase, userId: string) {
  if (isMysqlDatabaseUrlConfigured()) {
    return ensureMysqlUserWorkspace(resolveMysqlPool(), userId);
  }

  return ensureUserWorkspace(database, userId);
}

async function loadQuoteWorkspace(database: AppDatabase, userId: string, intentId: string): Promise<QuoteWorkspace> {
  const workspace = await workspaceForUser(database, userId);
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const partnerRows = mysql
    ? await listSourcingPartnerRowsFromMysql(mysql, workspace.organizationId)
    : listSourcingPartnerRows(database, workspace.organizationId);
  const requestRows = mysql
    ? await listQuoteRequestRowsFromMysql(mysql, workspace.organizationId, intent.id)
    : listQuoteRequestRows(database, workspace.organizationId, intent.id);
  const artifactJoins = mysql
    ? await listQuoteArtifactsForRequestsFromMysql(mysql, requestRows.map((request) => request.id))
    : listQuoteArtifactsForRequests(database, requestRows.map((request) => request.id));

  const partners = partnerRows.map(hydratePartner);
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const artifactsByRequest = new Map<string, QuoteRequestArtifact[]>();
  for (const join of artifactJoins) {
    const artifacts = artifactsByRequest.get(join.quoteRequestId) ?? [];
    artifacts.push(hydrateArtifact(join.artifact));
    artifactsByRequest.set(join.quoteRequestId, artifacts);
  }
  const requests = requestRows.map((row) => hydrateRequest(row, partnerById, artifactsByRequest));

  return {
    intentId: intent.id,
    bidId: intent.bid.id,
    organizationId: workspace.organizationId,
    summary: buildSummary(partners, requests),
    partners,
    requests,
  };
}

async function resolvePartner(
  database: AppDatabase,
  userId: string,
  organizationId: string,
  input: CreateQuoteRequestInput,
  timestamp: string,
) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  if (input.partnerId) {
    const existing = mysql
      ? await findSourcingPartnerRowFromMysql(mysql, organizationId, input.partnerId)
      : findSourcingPartnerRow(database, organizationId, input.partnerId);
    if (!existing) throw new QuoteWorkflowValidationError("Sourcing partner is not available.");
    return existing;
  }

  const name = normalizeRequiredString(input.partnerName, "Partner name is required.", MAX_NAME_LENGTH);
  const partner: SourcingPartnerRow = {
    id: `partner_${crypto.randomUUID()}`,
    organizationId,
    createdByUserId: userId,
    name,
    contactName: normalizeOptionalString(input.contactName, MAX_NAME_LENGTH),
    contactEmail: normalizeOptionalString(input.contactEmail, MAX_NAME_LENGTH),
    phone: normalizeOptionalString(input.phone, 80),
    category: normalizeOptionalString(input.category, MAX_NAME_LENGTH),
    regionsJson: JSON.stringify(normalizeStringList(input.regions)),
    capabilityTagsJson: JSON.stringify(normalizeStringList(input.capabilityTags)),
    status: "active",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (mysql) {
    await createSourcingPartnerRowFromMysql(mysql, partner);
  } else {
    createSourcingPartnerRow(database, partner);
  }

  return partner;
}

async function validateArtifacts(
  database: AppDatabase,
  userId: string,
  intentId: string,
  artifactIds: string[] | undefined,
) {
  const ids = [...new Set((artifactIds ?? []).filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
  if (ids.length === 0) return [];

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const rows = mysql
    ? await listArtifactRowsByIdsFromMysql(mysql, userId, intentId, ids)
    : listArtifactRowsByIds(database, userId, intentId, ids);

  if (rows.length !== ids.length) {
    throw new QuoteWorkflowValidationError("Quote artifacts must belong to this intent.");
  }

  return ids;
}

export async function getQuoteWorkspace(database: AppDatabase, userId: string, intentId: string) {
  return loadQuoteWorkspace(database, userId, intentId);
}

export async function createQuoteRequest(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreateQuoteRequestInput,
) {
  const workspace = await workspaceForUser(database, userId);
  const intent = await getUserIntent(database, userId, intentId);
  if (!intent) throw new IntentNotFoundError();

  const timestamp = nowIso();
  const partner = await resolvePartner(database, userId, workspace.organizationId, input, timestamp);
  const artifactIds = await validateArtifacts(database, userId, intent.id, input.artifactIds);
  const title = normalizeRequiredString(input.title, "Quote request title is required.", MAX_TITLE_LENGTH);
  const request: QuoteRequestRow = {
    id: `quote_request_${crypto.randomUUID()}`,
    organizationId: workspace.organizationId,
    intentId: intent.id,
    bidId: intent.bid.id,
    partnerId: partner.id,
    createdByUserId: userId,
    title,
    description: normalizeOptionalString(input.description, MAX_TEXT_LENGTH),
    status: "draft",
    requestedDueAt: normalizeOptionalDate(input.requestedDueAt),
    lineItemsJson: JSON.stringify(normalizeStringList(input.lineItems)),
    quotedAmountCents: null,
    currency: "USD",
    responseNotes: "",
    respondedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  if (mysql) {
    await createQuoteRequestRowFromMysql(mysql, request, artifactIds, timestamp);
  } else {
    createQuoteRequestRow(database, request, artifactIds, timestamp);
  }

  return loadQuoteWorkspace(database, userId, intent.id);
}

function normalizeUpdate(input: UpdateQuoteRequestInput): UpdateQuoteRequestInput {
  if (typeof input.requestId !== "string" || !input.requestId.trim()) {
    throw new QuoteWorkflowValidationError("Quote request is required.");
  }

  const normalized: UpdateQuoteRequestInput = { requestId: input.requestId.trim() };
  if (input.status !== undefined) {
    if (!isQuoteRequestStatus(input.status)) throw new QuoteWorkflowValidationError("Unsupported quote status.");
    normalized.status = input.status;
  }
  if (input.requestedDueAt !== undefined) normalized.requestedDueAt = normalizeOptionalDate(input.requestedDueAt);
  if (input.quotedAmountCents !== undefined) {
    if (input.quotedAmountCents !== null && (!Number.isFinite(input.quotedAmountCents) || input.quotedAmountCents < 0)) {
      throw new QuoteWorkflowValidationError("Quote amount must be a positive number.");
    }
    normalized.quotedAmountCents = input.quotedAmountCents === null ? null : Math.round(input.quotedAmountCents);
  }
  if (input.currency !== undefined) normalized.currency = normalizeOptionalString(input.currency, 12) || "USD";
  if (input.responseNotes !== undefined) normalized.responseNotes = normalizeOptionalString(input.responseNotes, MAX_TEXT_LENGTH);

  return normalized;
}

export async function updateQuoteRequest(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: UpdateQuoteRequestInput,
) {
  const workspace = await workspaceForUser(database, userId);
  const intent = await getUserIntent(database, userId, intentId);
  if (!intent) throw new IntentNotFoundError();

  const normalized = normalizeUpdate(input);
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const existing = mysql
    ? await findQuoteRequestRowFromMysql(mysql, workspace.organizationId, intent.id, normalized.requestId)
    : findQuoteRequestRow(database, workspace.organizationId, intent.id, normalized.requestId);
  if (!existing) throw new QuoteWorkflowValidationError("Quote request is not available.");

  const timestamp = nowIso();
  if (mysql) {
    await updateQuoteRequestRowFromMysql(mysql, workspace.organizationId, intent.id, normalized, timestamp);
  } else {
    updateQuoteRequestRow(database, workspace.organizationId, intent.id, normalized, timestamp);
  }

  return loadQuoteWorkspace(database, userId, intent.id);
}
