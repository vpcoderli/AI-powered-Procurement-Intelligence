import crypto from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { ensureUser, getBidByIdFromRepository } from "@/server/bids/repository";
import { calculateBidMatch } from "@/server/match/service";
import type { BidMatchResult } from "@/server/match/types";
import { getSupplierProfile } from "@/server/profile/service";
import { generateIntentBrief } from "./brief-generator";
import {
  createIntentRow,
  findIntentByUserAndBid,
  findIntentByUserAndId,
  listIntentRowsForUser,
  type IntentRow,
  updateIntentRowStatus,
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

function parseJsonField<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Invalid intent JSON field: ${field}`);
  }
}

async function hydrateIntent(db: AppDatabase, row: IntentRow): Promise<IntentDetail> {
  const bid = await getBidByIdFromRepository(db, row.bidId);

  if (!bid) {
    throw new IntentBidNotFoundError();
  }

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
    },
    match: parseJsonField<BidMatchResult>(row.matchScoreSnapshotJson, "matchScoreSnapshotJson"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createIntentForBid(
  database: AppDatabase,
  userId: string,
  bidId: string,
): Promise<IntentDetail> {
  const existing = findIntentByUserAndBid(database, userId, bidId);

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
): Promise<IntentSummary[]> {
  return Promise.all(listIntentRowsForUser(database, userId).map((row) => hydrateIntent(database, row)));
}

export async function getUserIntent(
  database: AppDatabase,
  userId: string,
  intentId: string,
): Promise<IntentDetail | undefined> {
  const row = findIntentByUserAndId(database, userId, intentId);

  return row ? hydrateIntent(database, row) : undefined;
}

export async function updateIntentStatus(
  database: AppDatabase,
  userId: string,
  intentId: string,
  status: IntentStatus | string,
): Promise<IntentDetail> {
  if (!isIntentStatus(status)) {
    throw new InvalidIntentStatusError();
  }

  const row = updateIntentRowStatus(database, userId, intentId, status, nowIso());

  if (!row) {
    throw new IntentNotFoundError();
  }

  return hydrateIntent(database, row);
}
