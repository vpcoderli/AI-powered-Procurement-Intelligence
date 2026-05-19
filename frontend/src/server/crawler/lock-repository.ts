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
  const acquired = db.$client
    .prepare(
      `
      INSERT INTO crawler_locks (source, owner, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        owner = excluded.owner,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at
      WHERE crawler_locks.expires_at <= excluded.acquired_at
      RETURNING source, owner, expires_at AS expiresAt
      `,
    )
    .get(input.source, input.owner, input.acquiredAt, input.expiresAt) as
    | { source: string; owner: string; expiresAt: string }
    | undefined;

  if (acquired) {
    return {
      acquired: true,
      source: acquired.source,
      owner: acquired.owner,
      expiresAt: acquired.expiresAt,
    };
  }

  const existing = db.select().from(crawlerLocks).where(eq(crawlerLocks.source, input.source)).get();

  return {
    acquired: false,
    source: input.source,
    owner: existing?.owner,
    expiresAt: existing?.expiresAt,
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
