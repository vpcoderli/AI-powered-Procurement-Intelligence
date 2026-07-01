import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { awardOutcomes, supplierArtifacts } from "@/server/db/schema";

export type AwardOutcomeRow = typeof awardOutcomes.$inferSelect;
export type NewAwardOutcomeRow = typeof awardOutcomes.$inferInsert;
export type AwardArtifactRow = typeof supplierArtifacts.$inferSelect;

interface MysqlAwardRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlAwardOutcomeRow {
  id: string;
  organizationId: string;
  intentId: string;
  bidId: string;
  userId: string;
  status: string;
  awardNoticeUrl: string;
  tabulationArtifactId: string | null;
  tabulationArtifactUrl: string;
  winnerName: string;
  awardAmountCents: number | string | null;
  currency: string;
  lossReason: string;
  lossReasonNotes: string;
  nextAction: string;
  nextActionDueAt: string | null;
  notes: string;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MysqlAwardArtifactRow {
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
  deletedAt: string | null;
  deletedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toAwardOutcomeRow(row: MysqlAwardOutcomeRow): AwardOutcomeRow {
  return {
    ...row,
    awardAmountCents: row.awardAmountCents === null ? null : Number(row.awardAmountCents),
  };
}

function toAwardArtifactRow(row: MysqlAwardArtifactRow): AwardArtifactRow {
  return {
    ...row,
    byteSize: Number(row.byteSize),
  };
}

export function findAwardOutcomeRow(
  db: AppDatabase,
  organizationId: string,
  intentId: string,
): AwardOutcomeRow | undefined {
  return db
    .select()
    .from(awardOutcomes)
    .where(and(eq(awardOutcomes.organizationId, organizationId), eq(awardOutcomes.intentId, intentId)))
    .limit(1)
    .get();
}

export async function findAwardOutcomeRowFromMysql(
  mysql: MysqlAwardRepository,
  organizationId: string,
  intentId: string,
): Promise<AwardOutcomeRow | null> {
  const row = await mysqlSelectOne<MysqlAwardOutcomeRow>(
    mysql,
    `
      SELECT
        id,
        organization_id AS organizationId,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        status,
        award_notice_url AS awardNoticeUrl,
        tabulation_artifact_id AS tabulationArtifactId,
        tabulation_artifact_url AS tabulationArtifactUrl,
        winner_name AS winnerName,
        award_amount_cents AS awardAmountCents,
        currency,
        loss_reason AS lossReason,
        loss_reason_notes AS lossReasonNotes,
        next_action AS nextAction,
        next_action_due_at AS nextActionDueAt,
        notes,
        decided_at AS decidedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM award_outcomes
      WHERE organization_id = ? AND intent_id = ?
      LIMIT 1
    `,
    [organizationId, intentId],
  );

  return row ? toAwardOutcomeRow(row) : null;
}

export function upsertAwardOutcomeRow(db: AppDatabase, row: AwardOutcomeRow): AwardOutcomeRow {
  db.insert(awardOutcomes)
    .values(row)
    .onConflictDoUpdate({
      target: awardOutcomes.intentId,
      set: {
        organizationId: row.organizationId,
        bidId: row.bidId,
        userId: row.userId,
        status: row.status,
        awardNoticeUrl: row.awardNoticeUrl,
        tabulationArtifactId: row.tabulationArtifactId,
        tabulationArtifactUrl: row.tabulationArtifactUrl,
        winnerName: row.winnerName,
        awardAmountCents: row.awardAmountCents,
        currency: row.currency,
        lossReason: row.lossReason,
        lossReasonNotes: row.lossReasonNotes,
        nextAction: row.nextAction,
        nextActionDueAt: row.nextActionDueAt,
        notes: row.notes,
        decidedAt: row.decidedAt,
        updatedAt: row.updatedAt,
      },
    })
    .run();

  const result = findAwardOutcomeRow(db, row.organizationId, row.intentId);
  if (!result) throw new Error("Failed to upsert award outcome");
  return result;
}

export async function upsertAwardOutcomeRowFromMysql(
  mysql: MysqlAwardRepository,
  row: AwardOutcomeRow,
): Promise<AwardOutcomeRow> {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO award_outcomes (
        id,
        organization_id,
        intent_id,
        bid_id,
        user_id,
        status,
        award_notice_url,
        tabulation_artifact_id,
        tabulation_artifact_url,
        winner_name,
        award_amount_cents,
        currency,
        loss_reason,
        loss_reason_notes,
        next_action,
        next_action_due_at,
        notes,
        decided_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        bid_id = VALUES(bid_id),
        user_id = VALUES(user_id),
        status = VALUES(status),
        award_notice_url = VALUES(award_notice_url),
        tabulation_artifact_id = VALUES(tabulation_artifact_id),
        tabulation_artifact_url = VALUES(tabulation_artifact_url),
        winner_name = VALUES(winner_name),
        award_amount_cents = VALUES(award_amount_cents),
        currency = VALUES(currency),
        loss_reason = VALUES(loss_reason),
        loss_reason_notes = VALUES(loss_reason_notes),
        next_action = VALUES(next_action),
        next_action_due_at = VALUES(next_action_due_at),
        notes = VALUES(notes),
        decided_at = VALUES(decided_at),
        updated_at = VALUES(updated_at)
    `,
    [
      row.id,
      row.organizationId,
      row.intentId,
      row.bidId,
      row.userId,
      row.status,
      row.awardNoticeUrl,
      row.tabulationArtifactId,
      row.tabulationArtifactUrl,
      row.winnerName,
      row.awardAmountCents,
      row.currency,
      row.lossReason,
      row.lossReasonNotes,
      row.nextAction,
      row.nextActionDueAt,
      row.notes,
      row.decidedAt,
      row.createdAt,
      row.updatedAt,
    ],
  );

  const result = await findAwardOutcomeRowFromMysql(mysql, row.organizationId, row.intentId);
  if (!result) throw new Error("Failed to upsert award outcome");
  return result;
}

export function findAwardArtifactRow(
  db: AppDatabase,
  intentId: string,
  artifactId: string,
): AwardArtifactRow | undefined {
  return db
    .select()
    .from(supplierArtifacts)
    .where(and(
      eq(supplierArtifacts.intentId, intentId),
      eq(supplierArtifacts.id, artifactId),
      isNull(supplierArtifacts.deletedAt),
    ))
    .limit(1)
    .get();
}

export async function findAwardArtifactRowFromMysql(
  mysql: MysqlAwardRepository,
  intentId: string,
  artifactId: string,
): Promise<AwardArtifactRow | null> {
  const row = await mysqlSelectOne<MysqlAwardArtifactRow>(
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
        deleted_at AS deletedAt,
        deleted_by_user_id AS deletedByUserId,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM supplier_artifacts
      WHERE intent_id = ? AND id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
    [intentId, artifactId],
  );

  return row ? toAwardArtifactRow(row) : null;
}
