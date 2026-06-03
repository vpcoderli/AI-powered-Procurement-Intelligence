import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { crawlerLocks, dataSources } from "@/server/db/schema";
import { acquireCrawlerLock } from "./lock-repository";
import { runCrawlerSourceOnce } from "./orchestrator";

describe("crawler orchestrator", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("runs matcher and notifier after a successful crawler run", async () => {
    const runner = vi.fn(async () => ({
      ok: true,
      source: "SAM.gov" as const,
      status: "success" as const,
      stdout: "done",
      stderr: "",
    }));
    const matcher = vi.fn(async () => ({
      evaluatedAlerts: 0,
      matchedAlerts: 0,
      updatedAlerts: 0,
      matches: [],
    }));
    const notifier = vi.fn(async () => ({
      queued: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    }));

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      runner,
      matcher,
      notifier,
    });

    expect(result.status).toBe("success");
    expect(result.runner).toEqual({
      ok: true,
      source: "SAM.gov",
      status: "success",
      stdout: "done",
      stderr: "",
    });
    expect(result.alertMatching).toEqual({
      evaluatedAlerts: 0,
      matchedAlerts: 0,
      updatedAlerts: 0,
      matches: [],
    });
    expect(result.notification).toEqual({
      queued: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
    expect(runner).toHaveBeenCalledBefore(matcher);
    expect(matcher).toHaveBeenCalledBefore(notifier);
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);
  });

  it("releases the lock and skips matcher and notifier when the runner fails", async () => {
    const matcher = vi.fn();
    const notifier = vi.fn();

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:00:00.000Z"),
      runner: async () => ({
        ok: false,
        source: "SAM.gov" as const,
        status: "failure" as const,
        stdout: "",
        stderr: "failed",
      }),
      matcher,
      notifier,
    });

    expect(result.status).toBe("failure");
    expect(matcher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);
  });

  it("returns locked and skips work when another owner holds the lock", async () => {
    acquireCrawlerLock(testDb.db, {
      source: "SAM.gov",
      owner: "other_owner",
      acquiredAt: "2026-05-19T00:00:00.000Z",
      expiresAt: "2026-05-19T00:10:00.000Z",
    });
    const runner = vi.fn();
    const matcher = vi.fn();
    const notifier = vi.fn();

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:01:00.000Z"),
      runner,
      matcher,
      notifier,
    });

    expect(result).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "locked",
      lockedBy: "other_owner",
      lockExpiresAt: "2026-05-19T00:10:00.000Z",
    });
    expect(runner).not.toHaveBeenCalled();
    expect(matcher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
  });

  it("returns disabled and skips work when the data source is turned off", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "sam_gov",
        label: "SAM.gov",
        issuerType: "federal",
        stateCode: "US",
        isEnabled: 0,
        cadence: "daily",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .run();
    const runner = vi.fn();
    const matcher = vi.fn();
    const notifier = vi.fn();

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:01:00.000Z"),
      runner,
      matcher,
      notifier,
    });

    expect(result).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "disabled",
    });
    expect(runner).not.toHaveBeenCalled();
    expect(matcher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);
  });

  it("returns blocked and skips work when source governance does not allow ingestion", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "sam_gov",
        label: "SAM.gov",
        issuerType: "federal",
        stateCode: "US",
        isEnabled: 1,
        cadence: "daily",
        approvedForIngestion: 0,
        approvalStatus: "blocked",
        legalReviewStatus: "requires_reapproval",
        approvalNotes: "Terms changed; hold ingestion.",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .run();
    const runner = vi.fn();
    const matcher = vi.fn();
    const notifier = vi.fn();

    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:01:00.000Z"),
      runner,
      matcher,
      notifier,
    });

    expect(result).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "blocked",
      reason: "Source governance has not approved ingestion.",
      approvalStatus: "blocked",
      legalReviewStatus: "requires_reapproval",
      approvedForIngestion: false,
    });
    expect(runner).not.toHaveBeenCalled();
    expect(matcher).not.toHaveBeenCalled();
    expect(notifier).not.toHaveBeenCalled();
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);
  });

  it("uses MySQL source status and locks when a MySQL store is provided", async () => {
    const mysql = createFakeMysqlCrawlerStore({
      dataSources: [{ id: "sam_gov", label: "SAM.gov", is_enabled: 0 }],
    });
    const runner = vi.fn();

    const disabled = await runCrawlerSourceOnce(testDb.db, {
      mysql,
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:01:00.000Z"),
      runner,
      matcher: vi.fn(),
      notifier: vi.fn(),
    });

    expect(disabled).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "disabled",
    });
    expect(runner).not.toHaveBeenCalled();
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);

    mysql.dataSources[0].is_enabled = 1;
    const success = await runCrawlerSourceOnce(testDb.db, {
      mysql,
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:01:00.000Z"),
      runner: vi.fn(async () => ({
        ok: true,
        source: "SAM.gov" as const,
        status: "success" as const,
        stdout: "done",
        stderr: "",
      })),
      matcher: vi.fn(async () => ({
        evaluatedAlerts: 0,
        matchedAlerts: 0,
        updatedAlerts: 0,
        matches: [],
      })),
      notifier: vi.fn(async () => ({
        queued: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
      })),
    });

    expect(success.status).toBe("success");
    expect(mysql.locks.size).toBe(0);
    expect(testDb.db.select().from(crawlerLocks).all()).toHaveLength(0);
  });

  it("uses MySQL source governance before acquiring locks", async () => {
    const mysql = createFakeMysqlCrawlerStore({
      dataSources: [
        {
          id: "sam_gov",
          label: "SAM.gov",
          is_enabled: 1,
          approved_for_ingestion: 0,
          approval_status: "needs_review",
          legal_review_status: "not_reviewed",
        },
      ],
    });
    const runner = vi.fn();

    const result = await runCrawlerSourceOnce(testDb.db, {
      mysql,
      source: "SAM.gov",
      owner: "test_owner",
      now: () => new Date("2026-05-19T00:01:00.000Z"),
      runner,
      matcher: vi.fn(),
      notifier: vi.fn(),
    });

    expect(result).toEqual({
      ok: false,
      source: "SAM.gov",
      status: "blocked",
      reason: "Source governance has not approved ingestion.",
      approvalStatus: "needs_review",
      legalReviewStatus: "not_reviewed",
      approvedForIngestion: false,
    });
    expect(runner).not.toHaveBeenCalled();
    expect(mysql.locks.size).toBe(0);
  });
});

function createFakeMysqlCrawlerStore(input: {
  dataSources: Array<{
    id: string;
    label: string;
    is_enabled: number;
    approved_for_ingestion?: number | null;
    approval_status?: string | null;
    legal_review_status?: string | null;
  }>;
}) {
  const locks = new Map<string, { source: string; owner: string; expires_at: string }>();

  return {
    dataSources: input.dataSources,
    locks,
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM data_sources")) {
        const ids = values.map(String);
        const row = input.dataSources.find((source) => ids.includes(source.label) || ids.includes(source.id));
        return [row ? [row] : []];
      }

      if (sql.includes("FROM crawler_locks")) {
        const row = locks.get(String(values[0]));
        return [row ? [{ source: row.source, owner: row.owner, expiresAt: row.expires_at }] : []];
      }

      return [[]];
    },
    execute: async (sql: string, values: unknown[] = []) => {
      if (sql.includes("INSERT INTO crawler_locks")) {
        const [source, owner, acquiredAt, expiresAt] = values.map(String);
        const existing = locks.get(source);
        if (!existing || existing.expires_at <= acquiredAt) {
          locks.set(source, { source, owner, expires_at: expiresAt });
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
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
