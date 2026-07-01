import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { listWorkspaceMemberUserIds } from "@/server/account/workspace";
import { listMysqlWorkspaceMemberUserIds } from "@/server/account/mysql-workspace";
import { ensureUser, ensureUserFromMysql, getBidByIdFromMysql, getBidByIdFromRepository } from "@/server/bids/repository";
import { createDeterministicAiRunMetadata } from "@/server/ai/run-metadata";
import { calculateBidMatch } from "@/server/match/service";
import type { BidMatchResult } from "@/server/match/types";
import { getSupplierProfile } from "@/server/profile/service";
import { getMysqlSupplierProfile } from "@/server/profile/mysql-service";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { generateIntentBrief } from "./brief-generator";
import {
  createIntentRow,
  findIntentByUsersAndBid,
  findIntentByUsersAndId,
  listIntentRowsForUsers,
  type IntentRow,
  updateIntentRowStatusForUsers,
} from "./repository";
import {
  InvalidIntentStatusError,
  IntentBidNotFoundError,
  IntentNotFoundError,
  isIntentStatus,
  type GeneratedIntentContent,
  type IntentDetail,
  type IntentStatus,
  type IntentSummary,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

interface WorkspaceScopeOptions {
  scopeUserIds?: string[];
}

function scopedUserIds(database: AppDatabase, userId: string, options: WorkspaceScopeOptions = {}) {
  return options.scopeUserIds && options.scopeUserIds.length > 0
    ? options.scopeUserIds
    : listWorkspaceMemberUserIds(database, userId);
}

function parseJsonField<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid intent JSON field: ${field}`);
  }
}

function createHydratedIntentAiRun(match: BidMatchResult) {
  return createDeterministicAiRunMetadata({
    action: "intent_brief",
    promptVersion: "intent-brief-lite@2026-06-10",
    confidence: match.confidence,
    fallbackReason: "no_llm_provider_configured",
  });
}

interface MysqlIntentRow {
  id: string;
  userId: string;
  bidId: string;
  status: string;
  aiBidBrief: string;
  keyDatesJson: string;
  initialChecklistJson: string;
  riskFlagsJson: string;
  matchScoreSnapshotJson: string;
  createdAt: string;
  updatedAt: string;
}

async function hydrateIntent(db: AppDatabase, row: IntentRow): Promise<IntentDetail> {
  const bid = await getBidByIdFromRepository(db, row.bidId);

  if (!bid) {
    throw new IntentBidNotFoundError();
  }

  const match = parseJsonField<BidMatchResult>(row.matchScoreSnapshotJson, "matchScoreSnapshotJson");

  return {
    id: row.id,
    userId: row.userId,
    bid,
    status: row.status as IntentStatus,
    generated: {
      aiBidBrief: row.aiBidBrief,
      keyDates: parseJsonField<GeneratedIntentContent["keyDates"]>(
        row.keyDatesJson,
        "keyDatesJson",
      ),
      initialChecklist: parseJsonField<string[]>(
        row.initialChecklistJson,
        "initialChecklistJson",
      ),
      riskFlags: parseJsonField<string[]>(row.riskFlagsJson, "riskFlagsJson"),
      aiRun: createHydratedIntentAiRun(match),
    },
    match,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function hydrateMysqlIntent(mysql: ReturnType<typeof resolveMysqlPool>, row: MysqlIntentRow): Promise<IntentDetail> {
  const bid = await getBidByIdFromMysql(mysql, row.bidId);

  if (!bid) {
    throw new IntentBidNotFoundError();
  }

  const match = parseJsonField<BidMatchResult>(row.matchScoreSnapshotJson, "matchScoreSnapshotJson");

  return {
    id: row.id,
    userId: row.userId,
    bid,
    status: row.status as IntentStatus,
    generated: {
      aiBidBrief: row.aiBidBrief,
      keyDates: parseJsonField<GeneratedIntentContent["keyDates"]>(row.keyDatesJson, "keyDatesJson"),
      initialChecklist: parseJsonField<string[]>(row.initialChecklistJson, "initialChecklistJson"),
      riskFlags: parseJsonField<string[]>(row.riskFlagsJson, "riskFlagsJson"),
      aiRun: createHydratedIntentAiRun(match),
    },
    match,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mysqlIntentSelectSql(whereClause: string) {
  return `
    SELECT
      id,
      user_id AS userId,
      bid_id AS bidId,
      status,
      ai_bid_brief AS aiBidBrief,
      key_dates_json AS keyDatesJson,
      initial_checklist_json AS initialChecklistJson,
      risk_flags_json AS riskFlagsJson,
      match_score_snapshot_json AS matchScoreSnapshotJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM intent_to_bid
    ${whereClause}
  `;
}

async function mysqlScopeUserIds(userId: string, options: WorkspaceScopeOptions = {}) {
  if (options.scopeUserIds && options.scopeUserIds.length > 0) return options.scopeUserIds;
  return listMysqlWorkspaceMemberUserIds(resolveMysqlPool(), userId);
}

function mysqlInClause(values: string[]) {
  return values.map(() => "?").join(", ");
}

async function findMysqlIntentByUsersAndBid(userIds: string[], bidId: string) {
  const mysql = resolveMysqlPool();
  return mysqlSelectOne<MysqlIntentRow>(
    mysql,
    `${mysqlIntentSelectSql(`WHERE user_id IN (${mysqlInClause(userIds)}) AND bid_id = ?`)}
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [...userIds, bidId],
  );
}

async function findMysqlIntentByUsersAndId(userIds: string[], intentId: string) {
  const mysql = resolveMysqlPool();
  return mysqlSelectOne<MysqlIntentRow>(
    mysql,
    `${mysqlIntentSelectSql(`WHERE user_id IN (${mysqlInClause(userIds)}) AND id = ?`)}
     LIMIT 1`,
    [...userIds, intentId],
  );
}

async function createMysqlIntentForBid(
  userId: string,
  bidId: string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentDetail> {
  const mysql = resolveMysqlPool();
  const scopeUserIds = await mysqlScopeUserIds(userId, options);
  const existing = await findMysqlIntentByUsersAndBid(scopeUserIds, bidId);

  if (existing) {
    return hydrateMysqlIntent(mysql, existing);
  }

  const bid = await getBidByIdFromMysql(mysql, bidId);
  if (!bid) {
    throw new IntentBidNotFoundError();
  }

  await ensureUserFromMysql(mysql, userId);

  const profile = await getMysqlSupplierProfile(mysql, userId);
  const match = calculateBidMatch(bid, profile);
  const generated = generateIntentBrief({ bid, match });
  const timestamp = nowIso();
  const intentId = `intent_${crypto.randomUUID()}`;

  await mysqlExecute(
    mysql,
    `
      INSERT INTO intent_to_bid (
        id,
        user_id,
        bid_id,
        status,
        ai_bid_brief,
        key_dates_json,
        initial_checklist_json,
        risk_flags_json,
        match_score_snapshot_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE id = id
    `,
    [
      intentId,
      userId,
      bidId,
      "intent_added",
      generated.aiBidBrief,
      JSON.stringify(generated.keyDates),
      JSON.stringify(generated.initialChecklist),
      JSON.stringify(generated.riskFlags),
      JSON.stringify(match),
      timestamp,
      timestamp,
    ],
  );

  const row = await findMysqlIntentByUsersAndBid([userId], bidId);
  if (!row) {
    throw new Error("Failed to create intent");
  }

  return hydrateMysqlIntent(mysql, row);
}

async function listMysqlUserIntents(
  userId: string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentSummary[]> {
  const mysql = resolveMysqlPool();
  const scopeUserIds = await mysqlScopeUserIds(userId, options);
  const rows = await mysqlSelectMany<MysqlIntentRow>(
    mysql,
    `${mysqlIntentSelectSql(`WHERE user_id IN (${mysqlInClause(scopeUserIds)})`)}
     ORDER BY created_at ASC, id ASC`,
    scopeUserIds,
  );

  return Promise.all(rows.map((row) => hydrateMysqlIntent(mysql, row)));
}

async function getMysqlUserIntent(
  userId: string,
  intentId: string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentDetail | undefined> {
  const mysql = resolveMysqlPool();
  const scopeUserIds = await mysqlScopeUserIds(userId, options);
  const row = await findMysqlIntentByUsersAndId(scopeUserIds, intentId);

  return row ? hydrateMysqlIntent(mysql, row) : undefined;
}

async function updateMysqlIntentStatus(
  userId: string,
  intentId: string,
  status: IntentStatus | string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentDetail> {
  if (!isIntentStatus(status)) {
    throw new InvalidIntentStatusError();
  }

  const mysql = resolveMysqlPool();
  const scopeUserIds = await mysqlScopeUserIds(userId, options);
  await mysqlExecute(
    mysql,
    `UPDATE intent_to_bid SET status = ?, updated_at = ? WHERE user_id IN (${mysqlInClause(scopeUserIds)}) AND id = ?`,
    [status, nowIso(), ...scopeUserIds, intentId],
  );
  const row = await findMysqlIntentByUsersAndId(scopeUserIds, intentId);

  if (!row) {
    throw new IntentNotFoundError();
  }

  return hydrateMysqlIntent(mysql, row);
}

export async function createIntentForBid(
  database: AppDatabase,
  userId: string,
  bidId: string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentDetail> {
  if (isMysqlDatabaseUrlConfigured()) {
    return createMysqlIntentForBid(userId, bidId, options);
  }

  const scopeUserIds = scopedUserIds(database, userId, options);
  const existing = findIntentByUsersAndBid(database, scopeUserIds, bidId);

  if (existing) {
    return hydrateIntent(database, existing);
  }

  const bid = await getBidByIdFromRepository(database, bidId);

  if (!bid) {
    throw new IntentBidNotFoundError();
  }

  await ensureUser(database, userId);

  const profile = await getSupplierProfile(database, userId);
  const match = calculateBidMatch(bid, profile);
  const generated = generateIntentBrief({ bid, match });
  const timestamp = nowIso();
  const row = createIntentRow(database, {
    id: `intent_${crypto.randomUUID()}`,
    userId,
    bidId,
    status: "intent_added",
    generated,
    match,
    timestamp,
  });

  if (!row) {
    throw new Error("Failed to create intent");
  }

  return hydrateIntent(database, row);
}

export async function listUserIntents(
  database: AppDatabase,
  userId: string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentSummary[]> {
  if (isMysqlDatabaseUrlConfigured()) {
    return listMysqlUserIntents(userId, options);
  }

  const scopeUserIds = scopedUserIds(database, userId, options);

  return Promise.all(listIntentRowsForUsers(database, scopeUserIds).map((row) => hydrateIntent(database, row)));
}

export async function getUserIntent(
  database: AppDatabase,
  userId: string,
  intentId: string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentDetail | undefined> {
  if (isMysqlDatabaseUrlConfigured()) {
    return getMysqlUserIntent(userId, intentId, options);
  }

  const scopeUserIds = scopedUserIds(database, userId, options);
  const row = findIntentByUsersAndId(database, scopeUserIds, intentId);

  return row ? hydrateIntent(database, row) : undefined;
}

export async function updateIntentStatus(
  database: AppDatabase,
  userId: string,
  intentId: string,
  status: IntentStatus | string,
  options: WorkspaceScopeOptions = {},
): Promise<IntentDetail> {
  if (isMysqlDatabaseUrlConfigured()) {
    return updateMysqlIntentStatus(userId, intentId, status, options);
  }

  if (!isIntentStatus(status)) {
    throw new InvalidIntentStatusError();
  }

  const scopeUserIds = scopedUserIds(database, userId, options);
  const row = updateIntentRowStatusForUsers(database, scopeUserIds, intentId, status, nowIso());

  if (!row) {
    throw new IntentNotFoundError();
  }

  return hydrateIntent(database, row);
}
