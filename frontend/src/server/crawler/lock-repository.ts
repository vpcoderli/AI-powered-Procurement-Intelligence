import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { crawlerLocks } from "@/server/db/schema";

export interface AcquireCrawlerLockInput {
  source: string;
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface AcquireCrawlerLockResult {
  acquired: boolean;
  source: string;
  owner?: string;
  expiresAt?: string;
}

export interface ReleaseCrawlerLockInput {
  source: string;
  owner: string;
}

export interface ReleaseCrawlerLockResult {
  released: boolean;
}

export function acquireCrawlerLock(
  db: AppDatabase,
  input: AcquireCrawlerLockInput,
): AcquireCrawlerLockResult {
  const existing = db.select().from(crawlerLocks).where(eq(crawlerLocks.source, input.source)).get();

  if (existing && existing.expiresAt > input.acquiredAt) {
    return {
      acquired: false,
      source: input.source,
      owner: existing.owner,
      expiresAt: existing.expiresAt,
    };
  }

  db.insert(crawlerLocks)
    .values(input)
    .onConflictDoUpdate({
      target: crawlerLocks.source,
      set: {
        owner: input.owner,
        acquiredAt: input.acquiredAt,
        expiresAt: input.expiresAt,
      },
    })
    .run();

  return {
    acquired: true,
    source: input.source,
    owner: input.owner,
    expiresAt: input.expiresAt,
  };
}

export function releaseCrawlerLock(
  db: AppDatabase,
  input: ReleaseCrawlerLockInput,
): ReleaseCrawlerLockResult {
  const result = db
    .delete(crawlerLocks)
    .where(and(eq(crawlerLocks.source, input.source), eq(crawlerLocks.owner, input.owner)))
    .run();

  return {
    released: result.changes > 0,
  };
}
