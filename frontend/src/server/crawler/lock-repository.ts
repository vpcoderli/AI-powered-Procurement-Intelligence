import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectOne } from "@/server/db/mysql-runtime";
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

export interface MysqlCrawlerLockStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
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

export async function acquireCrawlerLockFromMysql(
  mysql: MysqlCrawlerLockStore,
  input: AcquireCrawlerLockInput,
): Promise<AcquireCrawlerLockResult> {
  await mysqlExecute(
    mysql,
    `
      INSERT INTO crawler_locks (source, owner, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        owner = IF(expires_at <= VALUES(acquired_at), VALUES(owner), owner),
        acquired_at = IF(expires_at <= VALUES(acquired_at), VALUES(acquired_at), acquired_at),
        expires_at = IF(expires_at <= VALUES(acquired_at), VALUES(expires_at), expires_at)
    `,
    [input.source, input.owner, input.acquiredAt, input.expiresAt],
  );

  const existing = await mysqlSelectOne<{ owner: string; expiresAt: string }>(
    mysql,
    "SELECT source, owner, expires_at AS expiresAt FROM crawler_locks WHERE source = ? LIMIT 1",
    [input.source],
  );

  if (existing?.owner === input.owner && existing.expiresAt === input.expiresAt) {
    return {
      acquired: true,
      source: input.source,
      owner: input.owner,
      expiresAt: input.expiresAt,
    };
  }

  return {
    acquired: false,
    source: input.source,
    owner: existing?.owner,
    expiresAt: existing?.expiresAt,
  };
}

export async function releaseCrawlerLockFromMysql(
  mysql: MysqlCrawlerLockStore,
  input: ReleaseCrawlerLockInput,
): Promise<ReleaseCrawlerLockResult> {
  const result = await mysqlExecute(
    mysql,
    "DELETE FROM crawler_locks WHERE source = ? AND owner = ?",
    [input.source, input.owner],
  );

  return {
    released: result.affectedRows > 0,
  };
}
