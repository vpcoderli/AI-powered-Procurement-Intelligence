import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { pursuitDecisions } from "@/server/db/schema";
import type { CreatePursuitDecisionInput } from "./types";

export type PursuitDecisionRow = typeof pursuitDecisions.$inferSelect;

interface MysqlPursuitRepository {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlPursuitDecisionRow {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  decision: string;
  reasonsJson: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface CreatePursuitDecisionRowInput extends Required<CreatePursuitDecisionInput> {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  timestamp: string;
}

export function listPursuitDecisionRows(db: AppDatabase, intentId: string) {
  return db
    .select()
    .from(pursuitDecisions)
    .where(eq(pursuitDecisions.intentId, intentId))
    .orderBy(asc(pursuitDecisions.createdAt), asc(pursuitDecisions.id))
    .all();
}

function toPursuitDecisionRow(row: MysqlPursuitDecisionRow): PursuitDecisionRow {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    decision: row.decision,
    reasonsJson: row.reasonsJson,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPursuitDecisionRowsFromMysql(mysql: MysqlPursuitRepository, intentId: string) {
  const rows = await mysqlSelectMany<MysqlPursuitDecisionRow>(
    mysql,
    `
      SELECT
        id,
        intent_id AS intentId,
        bid_id AS bidId,
        user_id AS userId,
        decision,
        reasons_json AS reasonsJson,
        notes,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM pursuit_decisions
      WHERE intent_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [intentId],
  );

  return rows.map(toPursuitDecisionRow);
}

export function createPursuitDecisionRow(db: AppDatabase, input: CreatePursuitDecisionRowInput) {
  db.insert(pursuitDecisions)
    .values({
      id: input.id,
      intentId: input.intentId,
      bidId: input.bidId,
      userId: input.userId,
      decision: input.decision,
      reasonsJson: JSON.stringify(input.reasons),
      notes: input.notes,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    })
    .run();

  return listPursuitDecisionRows(db, input.intentId);
}

export async function createPursuitDecisionRowFromMysql(
  mysql: MysqlPursuitRepository,
  input: CreatePursuitDecisionRowInput,
) {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO pursuit_decisions (
        id,
        intent_id,
        bid_id,
        user_id,
        decision,
        reasons_json,
        notes,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.intentId,
      input.bidId,
      input.userId,
      input.decision,
      JSON.stringify(input.reasons),
      input.notes,
      input.timestamp,
      input.timestamp,
    ],
  );

  return listPursuitDecisionRowsFromMysql(mysql, input.intentId);
}
