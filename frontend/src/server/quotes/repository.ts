import { and, asc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { quoteRequestArtifacts, quoteRequests, sourcingPartners, supplierArtifacts } from "@/server/db/schema";
import type { UpdateQuoteRequestInput } from "./types";

export type SourcingPartnerRow = typeof sourcingPartners.$inferSelect;
export type QuoteRequestRow = typeof quoteRequests.$inferSelect;
export type QuoteRequestArtifactRow = typeof quoteRequestArtifacts.$inferSelect;
export type QuoteArtifactRow = typeof supplierArtifacts.$inferSelect;

interface MysqlQuoteRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlSourcingPartnerRow {
  id: string;
  organizationId: string;
  createdByUserId: string;
  name: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  category: string;
  regionsJson: string;
  capabilityTagsJson: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface MysqlQuoteRequestRow {
  id: string;
  organizationId: string;
  intentId: string;
  bidId: string;
  partnerId: string;
  createdByUserId: string;
  title: string;
  description: string;
  status: string;
  requestedDueAt: string | null;
  lineItemsJson: string;
  quotedAmountCents: number | string | null;
  currency: string;
  responseNotes: string;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MysqlQuoteArtifactRow {
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

function toPartnerRow(row: MysqlSourcingPartnerRow): SourcingPartnerRow {
  return row;
}

function toQuoteRequestRow(row: MysqlQuoteRequestRow): QuoteRequestRow {
  return {
    ...row,
    quotedAmountCents: row.quotedAmountCents === null ? null : Number(row.quotedAmountCents),
  };
}

function toQuoteArtifactRow(row: MysqlQuoteArtifactRow): QuoteArtifactRow {
  return {
    ...row,
    byteSize: Number(row.byteSize),
  };
}

export function listSourcingPartnerRows(db: AppDatabase, organizationId: string) {
  return db
    .select()
    .from(sourcingPartners)
    .where(eq(sourcingPartners.organizationId, organizationId))
    .orderBy(asc(sourcingPartners.name), asc(sourcingPartners.id))
    .all();
}

export async function listSourcingPartnerRowsFromMysql(mysql: MysqlQuoteRepository, organizationId: string) {
  const rows = await mysqlSelectMany<MysqlSourcingPartnerRow>(
    mysql,
    `
      SELECT
        id,
        organization_id AS organizationId,
        created_by_user_id AS createdByUserId,
        name,
        contact_name AS contactName,
        contact_email AS contactEmail,
        phone,
        category,
        regions_json AS regionsJson,
        capability_tags_json AS capabilityTagsJson,
        status,
        notes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM sourcing_partners
      WHERE organization_id = ?
      ORDER BY name ASC, id ASC
    `,
    [organizationId],
  );

  return rows.map(toPartnerRow);
}

export function findSourcingPartnerRow(db: AppDatabase, organizationId: string, partnerId: string) {
  return db
    .select()
    .from(sourcingPartners)
    .where(and(eq(sourcingPartners.organizationId, organizationId), eq(sourcingPartners.id, partnerId)))
    .limit(1)
    .get();
}

export async function findSourcingPartnerRowFromMysql(
  mysql: MysqlQuoteRepository,
  organizationId: string,
  partnerId: string,
) {
  const row = await mysqlSelectOne<MysqlSourcingPartnerRow>(
    mysql,
    `
      SELECT
        id,
        organization_id AS organizationId,
        created_by_user_id AS createdByUserId,
        name,
        contact_name AS contactName,
        contact_email AS contactEmail,
        phone,
        category,
        regions_json AS regionsJson,
        capability_tags_json AS capabilityTagsJson,
        status,
        notes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM sourcing_partners
      WHERE organization_id = ? AND id = ?
      LIMIT 1
    `,
    [organizationId, partnerId],
  );

  return row ? toPartnerRow(row) : null;
}

export function createSourcingPartnerRow(
  db: AppDatabase,
  row: SourcingPartnerRow,
) {
  db.insert(sourcingPartners).values(row).run();
}

export async function createSourcingPartnerRowFromMysql(
  mysql: MysqlQuoteRepository,
  row: SourcingPartnerRow,
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO sourcing_partners (
        id,
        organization_id,
        created_by_user_id,
        name,
        contact_name,
        contact_email,
        phone,
        category,
        regions_json,
        capability_tags_json,
        status,
        notes,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.organizationId,
      row.createdByUserId,
      row.name,
      row.contactName,
      row.contactEmail,
      row.phone,
      row.category,
      row.regionsJson,
      row.capabilityTagsJson,
      row.status,
      row.notes,
      row.createdAt,
      row.updatedAt,
    ],
  );
}

export function listQuoteRequestRows(db: AppDatabase, organizationId: string, intentId: string) {
  return db
    .select()
    .from(quoteRequests)
    .where(and(eq(quoteRequests.organizationId, organizationId), eq(quoteRequests.intentId, intentId)))
    .orderBy(asc(quoteRequests.createdAt), asc(quoteRequests.id))
    .all();
}

export async function listQuoteRequestRowsFromMysql(
  mysql: MysqlQuoteRepository,
  organizationId: string,
  intentId: string,
) {
  const rows = await mysqlSelectMany<MysqlQuoteRequestRow>(
    mysql,
    `
      SELECT
        id,
        organization_id AS organizationId,
        intent_id AS intentId,
        bid_id AS bidId,
        partner_id AS partnerId,
        created_by_user_id AS createdByUserId,
        title,
        description,
        status,
        requested_due_at AS requestedDueAt,
        line_items_json AS lineItemsJson,
        quoted_amount_cents AS quotedAmountCents,
        currency,
        response_notes AS responseNotes,
        responded_at AS respondedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM quote_requests
      WHERE organization_id = ? AND intent_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [organizationId, intentId],
  );

  return rows.map(toQuoteRequestRow);
}

export function findQuoteRequestRow(
  db: AppDatabase,
  organizationId: string,
  intentId: string,
  requestId: string,
) {
  return db
    .select()
    .from(quoteRequests)
    .where(and(
      eq(quoteRequests.organizationId, organizationId),
      eq(quoteRequests.intentId, intentId),
      eq(quoteRequests.id, requestId),
    ))
    .limit(1)
    .get();
}

export async function findQuoteRequestRowFromMysql(
  mysql: MysqlQuoteRepository,
  organizationId: string,
  intentId: string,
  requestId: string,
) {
  const row = await mysqlSelectOne<MysqlQuoteRequestRow>(
    mysql,
    `
      SELECT
        id,
        organization_id AS organizationId,
        intent_id AS intentId,
        bid_id AS bidId,
        partner_id AS partnerId,
        created_by_user_id AS createdByUserId,
        title,
        description,
        status,
        requested_due_at AS requestedDueAt,
        line_items_json AS lineItemsJson,
        quoted_amount_cents AS quotedAmountCents,
        currency,
        response_notes AS responseNotes,
        responded_at AS respondedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM quote_requests
      WHERE organization_id = ? AND intent_id = ? AND id = ?
      LIMIT 1
    `,
    [organizationId, intentId, requestId],
  );

  return row ? toQuoteRequestRow(row) : null;
}

export function createQuoteRequestRow(
  db: AppDatabase,
  row: QuoteRequestRow,
  artifactIds: string[],
  timestamp: string,
) {
  db.insert(quoteRequests).values(row).run();
  if (artifactIds.length > 0) {
    db.insert(quoteRequestArtifacts)
      .values(artifactIds.map((artifactId) => ({
        quoteRequestId: row.id,
        artifactId,
        createdAt: timestamp,
      })))
      .run();
  }
}

export async function createQuoteRequestRowFromMysql(
  mysql: MysqlQuoteRepository,
  row: QuoteRequestRow,
  artifactIds: string[],
  timestamp: string,
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO quote_requests (
        id,
        organization_id,
        intent_id,
        bid_id,
        partner_id,
        created_by_user_id,
        title,
        description,
        status,
        requested_due_at,
        line_items_json,
        quoted_amount_cents,
        currency,
        response_notes,
        responded_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      row.id,
      row.organizationId,
      row.intentId,
      row.bidId,
      row.partnerId,
      row.createdByUserId,
      row.title,
      row.description,
      row.status,
      row.requestedDueAt,
      row.lineItemsJson,
      row.quotedAmountCents,
      row.currency,
      row.responseNotes,
      row.respondedAt,
      row.createdAt,
      row.updatedAt,
    ],
  );

  for (const artifactId of artifactIds) {
    await mysqlExecute(
      mysql,
      "INSERT INTO quote_request_artifacts (quote_request_id, artifact_id, created_at) VALUES (?, ?, ?)",
      [row.id, artifactId, timestamp],
    );
  }
}

export function updateQuoteRequestRow(
  db: AppDatabase,
  organizationId: string,
  intentId: string,
  input: UpdateQuoteRequestInput,
  timestamp: string,
) {
  const values: Partial<typeof quoteRequests.$inferInsert> = { updatedAt: timestamp };

  if (input.status !== undefined) values.status = input.status;
  if (input.requestedDueAt !== undefined) values.requestedDueAt = input.requestedDueAt;
  if (input.quotedAmountCents !== undefined) values.quotedAmountCents = input.quotedAmountCents;
  if (input.currency !== undefined) values.currency = input.currency;
  if (input.responseNotes !== undefined) values.responseNotes = input.responseNotes;
  if (input.status === "received" || input.status === "accepted") values.respondedAt = timestamp;

  db.update(quoteRequests)
    .set(values)
    .where(and(
      eq(quoteRequests.organizationId, organizationId),
      eq(quoteRequests.intentId, intentId),
      eq(quoteRequests.id, input.requestId),
    ))
    .run();
}

export async function updateQuoteRequestRowFromMysql(
  mysql: MysqlQuoteRepository,
  organizationId: string,
  intentId: string,
  input: UpdateQuoteRequestInput,
  timestamp: string,
) {
  const assignments: string[] = ["updated_at = ?"];
  const values: unknown[] = [timestamp];

  if (input.status !== undefined) {
    assignments.push("status = ?");
    values.push(input.status);
  }
  if (input.requestedDueAt !== undefined) {
    assignments.push("requested_due_at = ?");
    values.push(input.requestedDueAt);
  }
  if (input.quotedAmountCents !== undefined) {
    assignments.push("quoted_amount_cents = ?");
    values.push(input.quotedAmountCents);
  }
  if (input.currency !== undefined) {
    assignments.push("currency = ?");
    values.push(input.currency);
  }
  if (input.responseNotes !== undefined) {
    assignments.push("response_notes = ?");
    values.push(input.responseNotes);
  }
  if (input.status === "received" || input.status === "accepted") {
    assignments.push("responded_at = ?");
    values.push(timestamp);
  }

  values.push(organizationId, intentId, input.requestId);

  await mysqlExecute(
    mysql,
    `UPDATE quote_requests SET ${assignments.join(", ")} WHERE organization_id = ? AND intent_id = ? AND id = ?`,
    values,
  );
}

export function listQuoteArtifactsForRequests(db: AppDatabase, requestIds: string[]) {
  if (requestIds.length === 0) return [];

  return db
    .select({
      quoteRequestId: quoteRequestArtifacts.quoteRequestId,
      artifact: supplierArtifacts,
    })
    .from(quoteRequestArtifacts)
    .innerJoin(supplierArtifacts, eq(quoteRequestArtifacts.artifactId, supplierArtifacts.id))
    .where(inArray(quoteRequestArtifacts.quoteRequestId, requestIds))
    .all();
}

export async function listQuoteArtifactsForRequestsFromMysql(
  mysql: MysqlQuoteRepository,
  requestIds: string[],
) {
  if (requestIds.length === 0) return [];
  const placeholders = requestIds.map(() => "?").join(", ");
  const rows = await mysqlSelectMany<{ quoteRequestId: string } & MysqlQuoteArtifactRow>(
    mysql,
    `
      SELECT
        quote_request_artifacts.quote_request_id AS quoteRequestId,
        supplier_artifacts.id,
        supplier_artifacts.intent_id AS intentId,
        supplier_artifacts.bid_id AS bidId,
        supplier_artifacts.user_id AS userId,
        supplier_artifacts.title,
        supplier_artifacts.artifact_type AS artifactType,
        supplier_artifacts.purpose,
        supplier_artifacts.file_name AS fileName,
        supplier_artifacts.content_type AS contentType,
        supplier_artifacts.byte_size AS byteSize,
        supplier_artifacts.storage_path AS storagePath,
        supplier_artifacts.checksum_sha256 AS checksumSha256,
        supplier_artifacts.expires_at AS expiresAt,
        supplier_artifacts.review_status AS reviewStatus,
        supplier_artifacts.notes,
        supplier_artifacts.created_at AS createdAt,
        supplier_artifacts.updated_at AS updatedAt
      FROM quote_request_artifacts
      INNER JOIN supplier_artifacts ON supplier_artifacts.id = quote_request_artifacts.artifact_id
      WHERE quote_request_artifacts.quote_request_id IN (${placeholders})
    `,
    requestIds,
  );

  return rows.map((row) => ({
    quoteRequestId: row.quoteRequestId,
    artifact: toQuoteArtifactRow(row),
  }));
}

export function listArtifactRowsByIds(
  db: AppDatabase,
  userId: string,
  intentId: string,
  artifactIds: string[],
) {
  if (artifactIds.length === 0) return [];

  return db
    .select()
    .from(supplierArtifacts)
    .where(and(
      eq(supplierArtifacts.userId, userId),
      eq(supplierArtifacts.intentId, intentId),
      inArray(supplierArtifacts.id, artifactIds),
    ))
    .all();
}

export async function listArtifactRowsByIdsFromMysql(
  mysql: MysqlQuoteRepository,
  userId: string,
  intentId: string,
  artifactIds: string[],
) {
  if (artifactIds.length === 0) return [];
  const placeholders = artifactIds.map(() => "?").join(", ");
  const rows = await mysqlSelectMany<MysqlQuoteArtifactRow>(
    mysql,
    `
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
      WHERE user_id = ? AND intent_id = ? AND id IN (${placeholders})
    `,
    [userId, intentId, ...artifactIds],
  );

  return rows.map(toQuoteArtifactRow);
}
