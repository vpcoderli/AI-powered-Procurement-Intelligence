import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { bids, savedBids, users } from "../src/server/db/schema";

interface LegacySavedBidsData {
  users: Record<string, string[]>;
}

export interface LegacySavedBidsMigrationResult {
  users: number;
  savedBids: number;
  skippedBidIds: number;
}

const DEFAULT_LEGACY_SAVED_BIDS_PATH = path.join("data", "saved-bids.json");

function nowIso() {
  return new Date().toISOString();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isLegacySavedBidsData(value: unknown): value is LegacySavedBidsData {
  if (typeof value !== "object" || value === null || !("users" in value)) return false;

  const legacyUsers = (value as { users: unknown }).users;
  return (
    typeof legacyUsers === "object" &&
    legacyUsers !== null &&
    !Array.isArray(legacyUsers) &&
    Object.values(legacyUsers).every(isStringArray)
  );
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

async function readLegacySavedBids(filePath: string) {
  let raw: string;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { users: {} };
    }

    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isLegacySavedBidsData(parsed)) {
    throw new Error("Legacy saved bids file is invalid");
  }

  return parsed;
}

function ensureUser(db: AppDatabase, userId: string) {
  const timestamp = nowIso();
  db.insert(users)
    .values({ id: userId, createdAt: timestamp, updatedAt: timestamp })
    .onConflictDoNothing()
    .run();
}

function hasBid(db: AppDatabase, bidId: string) {
  return Boolean(db.select({ id: bids.id }).from(bids).where(eq(bids.id, bidId)).limit(1).get());
}

function hasSavedBid(db: AppDatabase, userId: string, bidId: string) {
  return Boolean(
    db
      .select({ bidId: savedBids.bidId })
      .from(savedBids)
      .where(and(eq(savedBids.userId, userId), eq(savedBids.bidId, bidId)))
      .limit(1)
      .get(),
  );
}

export async function migrateLegacySavedBids(
  db: AppDatabase,
  filePath = DEFAULT_LEGACY_SAVED_BIDS_PATH,
): Promise<LegacySavedBidsMigrationResult> {
  const legacy = await readLegacySavedBids(filePath);
  const result: LegacySavedBidsMigrationResult = {
    users: 0,
    savedBids: 0,
    skippedBidIds: 0,
  };

  for (const [userId, bidIds] of Object.entries(legacy.users)) {
    ensureUser(db, userId);
    result.users += 1;

    for (const bidId of uniqueIds(bidIds)) {
      if (!hasBid(db, bidId)) {
        result.skippedBidIds += 1;
        continue;
      }

      if (hasSavedBid(db, userId, bidId)) {
        continue;
      }

      db.insert(savedBids)
        .values({ userId, bidId, createdAt: nowIso() })
        .run();
      result.savedBids += 1;
    }
  }

  return result;
}

async function main() {
  const db = createDatabase();
  runMigrations(db);
  const result = await migrateLegacySavedBids(db, process.argv[2] ?? DEFAULT_LEGACY_SAVED_BIDS_PATH);
  db.$client.close();
  console.log(`Migrated ${result.savedBids} saved bids for ${result.users} users`);
  if (result.skippedBidIds > 0) {
    console.log(`Skipped ${result.skippedBidIds} unknown bid ids`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
