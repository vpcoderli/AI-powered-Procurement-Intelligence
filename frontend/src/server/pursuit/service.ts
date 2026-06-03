import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { generatePursuitRecommendation } from "./generator";
import {
  createPursuitDecisionRow,
  createPursuitDecisionRowFromMysql,
  listPursuitDecisionRows,
  listPursuitDecisionRowsFromMysql,
  type PursuitDecisionRow,
} from "./repository";
import type {
  CreatePursuitDecisionInput,
  PursuitDecisionBoard,
  PursuitDecisionRecord,
  PursuitDecisionValue,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function parseReasons(value: string) {
  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hydrateDecision(row: PursuitDecisionRow): PursuitDecisionRecord {
  return {
    id: row.id,
    intentId: row.intentId,
    bidId: row.bidId,
    userId: row.userId,
    decision: row.decision as PursuitDecisionValue,
    reasons: parseReasons(row.reasonsJson),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeReasons(reasons: string[] | undefined) {
  return (reasons ?? [])
    .map((reason) => reason.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function getPursuitDecisionBoard(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<PursuitDecisionBoard> {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const historyRows = mysql
    ? await listPursuitDecisionRowsFromMysql(mysql, intentId)
    : listPursuitDecisionRows(database, intentId);
  const history = historyRows.map(hydrateDecision);

  return {
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: intent.userId,
    recommendation: generatePursuitRecommendation(intent),
    currentDecision: history.at(-1) ?? null,
    history,
  };
}

export async function createPursuitDecision(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreatePursuitDecisionInput,
): Promise<PursuitDecisionBoard> {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const timestamp = nowIso();
  const decisionInput = {
    id: `pursuit_decision_${crypto.randomUUID()}`,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    decision: input.decision,
    reasons: normalizeReasons(input.reasons),
    notes: input.notes?.trim() ?? "",
    timestamp,
  };
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  if (mysql) {
    await createPursuitDecisionRowFromMysql(mysql, decisionInput);
  } else {
    createPursuitDecisionRow(database, decisionInput);
  }

  return getPursuitDecisionBoard(database, userId, intentId);
}
