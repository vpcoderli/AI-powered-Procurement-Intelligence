import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { crawlerLocks } from "@/server/db/schema";
import {
  renewCrawlerLock,
  renewCrawlerLockFromMysql,
  acquireCrawlerLock,
  acquireCrawlerLockFromMysql,
  releaseCrawlerLock,
  releaseCrawlerLockFromMysql,
} from "./lock-repository";

describe("crawler lock repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("renews only live owned leases in both databases", async () => {
    const mysql = createFakeMysqlLockStore();
    const input = { source: "source", owner: "owner", acquiredAt: "2026-09-15T00:00:00.000Z", expiresAt: "2026-09-15T00:10:00.000Z" };
    acquireCrawlerLock(testDb.db, input);
    await acquireCrawlerLockFromMysql(mysql, input);
    const live = { source: "source", owner: "owner", now: "2026-09-15T00:05:00.000Z", expiresAt: "2026-09-15T00:15:00.000Z" };
    expect(renewCrawlerLock(testDb.db, { ...live, owner: "other" })).toBe(false);
    expect(await renewCrawlerLockFromMysql(mysql, { ...live, owner: "other" })).toBe(false);
    expect(renewCrawlerLock(testDb.db, live)).toBe(true);
    expect(await renewCrawlerLockFromMysql(mysql, live)).toBe(true);
    const expired = { ...live, now: "2026-09-15T00:15:00.000Z", expiresAt: "2026-09-15T00:25:00.000Z" };
    expect(renewCrawlerLock(testDb.db, expired)).toBe(false);
    expect(await renewCrawlerLockFromMysql(mysql, expired)).toBe(false);
  });

  it("does not acquire a lock held by another owner", () => {
    const first = acquireCrawlerLock(testDb.db, {
      source: "SAM.gov",
      owner: "owner_1",
      acquiredAt: "2026-05-19T00:00:00.000Z",
      expiresAt: "2026-05-19T00:10:00.000Z",
    });
    const second = acquireCrawlerLock(testDb.db, {
      source: "SAM.gov",
      owner: "owner_2",
      acquiredAt: "2026-05-19T00:01:00.000Z",
      expiresAt: "2026-05-19T00:11:00.000Z",
    });

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.owner).toBe("owner_1");
  });

  it("replaces stale locks when the previous lock has expired", () => {
    acquireCrawlerLock(testDb.db, {
      source: "SAM.gov",
      owner: "owner_1",
      acquiredAt: "2026-05-19T00:00:00.000Z",
      expiresAt: "2026-05-19T00:10:00.000Z",
    });

    const replacement = acquireCrawlerLock(testDb.db, {
      source: "SAM.gov",
      owner: "owner_2",
      acquiredAt: "2026-05-19T00:10:00.000Z",
      expiresAt: "2026-05-19T00:20:00.000Z",
    });

    expect(replacement.acquired).toBe(true);
    expect(testDb.db.select().from(crawlerLocks).all()).toEqual([
      {
        source: "SAM.gov",
        owner: "owner_2",
        acquiredAt: "2026-05-19T00:10:00.000Z",
        expiresAt: "2026-05-19T00:20:00.000Z",
      },
    ]);
  });

  it("only releases locks for the owning worker", () => {
    acquireCrawlerLock(testDb.db, {
      source: "SAM.gov",
      owner: "owner_1",
      acquiredAt: "2026-05-19T00:00:00.000Z",
      expiresAt: "2026-05-19T00:10:00.000Z",
    });

    expect(
      releaseCrawlerLock(testDb.db, {
        source: "SAM.gov",
        owner: "owner_2",
      }).released,
    ).toBe(false);
    expect(testDb.db.select().from(crawlerLocks).where(eq(crawlerLocks.source, "SAM.gov")).all()).toHaveLength(1);

    expect(
      releaseCrawlerLock(testDb.db, {
        source: "SAM.gov",
        owner: "owner_1",
      }).released,
    ).toBe(true);
    expect(testDb.db.select().from(crawlerLocks).where(eq(crawlerLocks.source, "SAM.gov")).all()).toHaveLength(0);
  });

  it("acquires, refuses, replaces, and releases locks through MySQL", async () => {
    const mysql = createFakeMysqlLockStore();

    const first = await acquireCrawlerLockFromMysql(mysql, {
      source: "SAM.gov",
      owner: "owner_1",
      acquiredAt: "2026-05-19T00:00:00.000Z",
      expiresAt: "2026-05-19T00:10:00.000Z",
    });
    const blocked = await acquireCrawlerLockFromMysql(mysql, {
      source: "SAM.gov",
      owner: "owner_2",
      acquiredAt: "2026-05-19T00:01:00.000Z",
      expiresAt: "2026-05-19T00:11:00.000Z",
    });
    const replacement = await acquireCrawlerLockFromMysql(mysql, {
      source: "SAM.gov",
      owner: "owner_2",
      acquiredAt: "2026-05-19T00:10:00.000Z",
      expiresAt: "2026-05-19T00:20:00.000Z",
    });

    expect(first).toMatchObject({ acquired: true, owner: "owner_1" });
    expect(blocked).toMatchObject({
      acquired: false,
      owner: "owner_1",
      expiresAt: "2026-05-19T00:10:00.000Z",
    });
    expect(replacement).toMatchObject({ acquired: true, owner: "owner_2" });
    expect(await releaseCrawlerLockFromMysql(mysql, { source: "SAM.gov", owner: "owner_1" })).toEqual({
      released: false,
    });
    expect(await releaseCrawlerLockFromMysql(mysql, { source: "SAM.gov", owner: "owner_2" })).toEqual({
      released: true,
    });
    expect(mysql.locks.size).toBe(0);
  });
});

function createFakeMysqlLockStore() {
  const locks = new Map<string, { source: string; owner: string; expires_at: string }>();

  return {
    locks,
    query: async (sql: string, values: unknown[] = []): Promise<[unknown[], unknown?]> => {
      if (sql.includes("SELECT source, owner, expires_at AS expiresAt")) {
        const row = locks.get(String(values[0]));
        return [[row ? { source: row.source, owner: row.owner, expiresAt: row.expires_at } : undefined].filter(Boolean)];
      }

      return [[]];
    },
    execute: async (sql: string, values: unknown[] = []): Promise<[unknown, unknown?]> => {
      if (sql.includes("INSERT INTO crawler_locks")) {
        const [source, owner, acquiredAt, expiresAt] = values.map(String);
        const existing = locks.get(source);
        if (!existing || existing.expires_at <= acquiredAt) {
          locks.set(source, { source, owner, expires_at: expiresAt });
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }

      if (sql.includes("UPDATE crawler_locks SET expires_at")) {
        const [expiresAt, source, owner, now] = values.map(String);
        const current = locks.get(source);
        if (current?.owner !== owner || current.expires_at <= now) return [{ affectedRows: 0 }];
        current.expires_at = expiresAt;
        return [{ affectedRows: 1 }];
      }

      if (sql.includes("DELETE FROM crawler_locks")) {
        const [source, owner] = values.map(String);
        const existing = locks.get(source);
        if (existing?.owner === owner) {
          locks.delete(source);
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }

      return [{ affectedRows: 0 }];
    },
  };
}
