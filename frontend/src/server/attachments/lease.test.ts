import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { crawlerLocks } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { attachmentLockSource, withAttachmentLease } from "./lease";

let testDb: TestDatabase;

beforeEach(async () => {
  testDb = await createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

function lockRow(sourceId: string) {
  return testDb.db.select().from(crawlerLocks).where(eq(crawlerLocks.source, attachmentLockSource(sourceId))).get();
}

describe("withAttachmentLease (sqlite)", () => {
  it("namespaces the lock, runs the work and releases it", async () => {
    const outcome = await withAttachmentLease(
      { database: testDb.db, sourceId: "il_bidbuy", owner: "worker-1" },
      async () => {
        expect(lockRow("il_bidbuy")?.owner).toMatch(/^worker-1:/);
        return "done";
      },
    );

    expect(outcome).toEqual({ status: "ran", value: "done" });
    expect(lockRow("il_bidbuy")).toBeUndefined();
  });

  it("releases the lease even when the work throws", async () => {
    await expect(
      withAttachmentLease({ database: testDb.db, sourceId: "il_bidbuy", owner: "worker-1" }, async () => {
        throw new Error("downloader crashed");
      }),
    ).rejects.toThrow("downloader crashed");

    expect(lockRow("il_bidbuy")).toBeUndefined();
  });

  it("reports `locked` without running the work when another owner holds the lease", async () => {
    const now = new Date("2026-09-16T00:00:00.000Z");
    testDb.db
      .insert(crawlerLocks)
      .values({
        source: attachmentLockSource("il_bidbuy"),
        owner: "worker-other:abc",
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 600_000).toISOString(),
      })
      .run();

    const work = vi.fn(async () => "never");
    const outcome = await withAttachmentLease(
      { database: testDb.db, sourceId: "il_bidbuy", owner: "worker-1", now: () => now },
      work,
    );

    expect(outcome).toEqual({ status: "locked", lockedBy: "worker-other:abc", lockExpiresAt: expect.any(String) });
    expect(work).not.toHaveBeenCalled();
    // The other worker's lease is untouched.
    expect(lockRow("il_bidbuy")?.owner).toBe("worker-other:abc");
  });

  it("renews the lease while long work is in flight", async () => {
    vi.useFakeTimers();
    try {
      let release: (() => void) | undefined;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let clock = new Date("2026-09-16T00:00:00.000Z");

      const run = withAttachmentLease(
        {
          database: testDb.db,
          sourceId: "il_bidbuy",
          owner: "worker-1",
          ttlMs: 900,
          now: () => clock,
        },
        async () => {
          await pending;
          return "done";
        },
      );

      const firstExpiry = lockRow("il_bidbuy")?.expiresAt;
      clock = new Date("2026-09-16T00:00:00.400Z");
      await vi.advanceTimersByTimeAsync(400);

      expect(lockRow("il_bidbuy")?.expiresAt).not.toBe(firstExpiry);

      release?.();
      await expect(run).resolves.toEqual({ status: "ran", value: "done" });
      expect(lockRow("il_bidbuy")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withAttachmentLease (mysql)", () => {
  it("acquires, renews and releases through the MySQL lock statements", async () => {
    const statements: string[] = [];
    const held = { owner: "", expiresAt: "" };
    const mysql = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        statements.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
        if (sql.includes("SELECT")) {
          return [[{ source: values[0], owner: held.owner, expiresAt: held.expiresAt }]] as [unknown[]];
        }
        return [[]] as [unknown[]];
      }),
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        statements.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
        if (sql.includes("INSERT INTO crawler_locks")) {
          held.owner = String(values[1]);
          held.expiresAt = String(values[3]);
        }
        return [{ affectedRows: 1 }] as [unknown];
      }),
    };

    const outcome = await withAttachmentLease(
      { database: testDb.db, mysql: mysql as never, sourceId: "il_bidbuy", owner: "worker-1" },
      async () => "done",
    );

    expect(outcome.status).toBe("ran");
    expect(statements).toContain("INSERT INTO");
    expect(statements).toContain("DELETE FROM");
    const releaseCall = mysql.execute.mock.calls.find(([sql]) => String(sql).includes("DELETE FROM crawler_locks"));
    expect(releaseCall?.[1]).toEqual([attachmentLockSource("il_bidbuy"), expect.stringMatching(/^worker-1:/)]);
  });

  it("skips the source when MySQL reports the lease is held elsewhere", async () => {
    const mysql = {
      query: vi.fn(async () => [[{ owner: "worker-other:xyz", expiresAt: "2026-09-16T00:10:00.000Z" }]] as [unknown[]]),
      execute: vi.fn(async () => [{ affectedRows: 0 }] as [unknown]),
    };
    const work = vi.fn(async () => "never");

    const outcome = await withAttachmentLease(
      { database: testDb.db, mysql: mysql as never, sourceId: "il_bidbuy", owner: "worker-1" },
      work,
    );

    expect(outcome).toEqual({
      status: "locked",
      lockedBy: "worker-other:xyz",
      lockExpiresAt: "2026-09-16T00:10:00.000Z",
    });
    expect(work).not.toHaveBeenCalled();
  });
});
