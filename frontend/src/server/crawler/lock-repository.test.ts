import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { crawlerLocks } from "@/server/db/schema";
import { acquireCrawlerLock, releaseCrawlerLock } from "./lock-repository";

describe("crawler lock repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
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
});
