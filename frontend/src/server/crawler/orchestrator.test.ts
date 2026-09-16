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
    vi.useRealTimers();
    await testDb.cleanup();
  });

  it("provides the unique lease identity, cancellation signal and live clock to persistence", async () => {
    let at = new Date("2026-09-15T00:00:00.000Z");
    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "SAM.gov", owner: "worker", now: () => at,
      runner: async (_options, context) => {
        const fence = context?.lease;
        expect(fence).toBeDefined();
        expect(fence?.source).toBe("sam_gov");
        expect(fence?.owner).toBe(testDb.db.select().from(crawlerLocks).get()?.owner);
        expect(fence?.signal).toBe(context?.signal);
        at = new Date("2026-09-15T00:00:05.000Z");
        expect(fence?.now()).toBe(at.toISOString());
        return { ok: true, source: "SAM.gov", status: "success", stdout: "", stderr: "" };
      },
      matcher: async () => ({ evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }),
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
    });
    expect(result.ok).toBe(true);
  });

  it("does not let a stale attempt release a newer lease with the same configured owner", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
    let finishOld!: () => void;
    let finishNew!: () => void;
    const after = { matcher: async () => ({ evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }), notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }) };
    const oldRun = runCrawlerSourceOnce(testDb.db, { ...after, source: "same", owner: "same_worker", lockTtlMs: 90, runner: async (_options, context) => {
      await new Promise<void>((resolve) => { finishOld = resolve; });
      await context!.assertLease();
      return { ok: true, source: "same", status: "success", stdout: "", stderr: "" };
    } });
    const oldOwner = testDb.db.select().from(crawlerLocks).get()!.owner;
    vi.setSystemTime(new Date(Date.now() + 100));
    const newRun = runCrawlerSourceOnce(testDb.db, { ...after, source: "same", owner: "same_worker", lockTtlMs: 90, runner: async () => {
      await new Promise<void>((resolve) => { finishNew = resolve; });
      return { ok: true, source: "same", status: "success", stdout: "", stderr: "" };
    } });
    const newOwner = testDb.db.select().from(crawlerLocks).get()!.owner;
    expect(newOwner).not.toBe(oldOwner);
    finishOld();
    expect(await oldRun).toMatchObject({ ok: false, runner: { errorCode: "CrawlerLeaseLostError" } });
    expect(testDb.db.select().from(crawlerLocks).get()!.owner).toBe(newOwner);
    finishNew();
    expect((await newRun).ok).toBe(true);
  });

  it("contains runner exceptions and skips post-ingestion work", async () => {
    const matcher = vi.fn();
    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "new_source", owner: "owner", runner: async () => { throw new Error("boom"); },
      matcher, notifier: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, status: "failure", runner: { errorCode: "Error", stderr: "boom" } });
    expect(matcher).not.toHaveBeenCalled();
    expect(testDb.db.select().from(crawlerLocks).all()).toEqual([]);
  });

  it.each(["matcher", "notifier"])("keeps ingestion successful when %s fails", async (stage) => {
    const result = await runCrawlerSourceOnce(testDb.db, {
      source: "new_source", owner: "owner",
      runner: async () => ({ ok: true, source: "new_source", status: "success", stdout: "", stderr: "" }),
      matcher: async () => { if (stage === "matcher") throw new Error("match failed"); return { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }; },
      notifier: async () => { throw new Error("send failed"); },
    });
    expect(result).toMatchObject({ ok: true, status: "success", postProcessingErrors: [{ stage }] });
  });

  it.each(["county", "city", "special_district"])("requires explicit approval for a manual %s run", async (jurisdictionLevel) => {
    testDb.db.insert(dataSources).values({ id: "local_source", label: "Local", issuerType: jurisdictionLevel, stateCode: "CA", jurisdictionLevel, isEnabled: 1, approvalStatus: null, createdAt: "2026-09-15", updatedAt: "2026-09-15" }).run();
    const runner = vi.fn();
    const result = await runCrawlerSourceOnce(testDb.db, { source: "local_source", owner: "owner", runner, matcher: vi.fn(), notifier: vi.fn() });
    expect(result.status).toBe("blocked");
    expect(runner).not.toHaveBeenCalled();
  });

  it("renews its lease while a long runner is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
    let finish!: () => void;
    const running = runCrawlerSourceOnce(testDb.db, {
      source: "long", owner: "owner", lockTtlMs: 90,
      runner: async () => { await new Promise<void>((resolve) => { finish = resolve; }); return { ok: true, source: "long", status: "success", stdout: "", stderr: "" }; },
      matcher: async () => ({ evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }),
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
    });
    await vi.advanceTimersByTimeAsync(240);
    expect(acquireCrawlerLock(testDb.db, { source: "long", owner: "competitor", acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90).toISOString() }).acquired).toBe(false);
    finish();
    expect((await running).ok).toBe(true);
  });

  it("cancels lost ownership before the runner can import and leaves the replacement lock intact", async () => {
    vi.useFakeTimers();
    let ready!: () => void;
    const imported = vi.fn();
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const running = runCrawlerSourceOnce(testDb.db, {
      source: "lost", owner: "owner", lockTtlMs: 90,
      runner: async (_options, context) => {
        ready();
        await new Promise<void>((resolve) => context!.signal.addEventListener("abort", () => resolve(), { once: true }));
        await context!.assertLease();
        imported();
        return { ok: true, source: "lost", status: "success", stdout: "", stderr: "" };
      }, matcher: vi.fn(), notifier: vi.fn(),
    });
    await started;
    testDb.db.update(crawlerLocks).set({ owner: "replacement" }).run();
    await vi.advanceTimersByTimeAsync(31);
    expect(await running).toMatchObject({ ok: false, runner: { errorCode: "CrawlerLeaseLostError" } });
    expect(imported).not.toHaveBeenCalled();
    expect(testDb.db.select().from(crawlerLocks).all()[0].owner).toBe("replacement");
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
    if (result.status !== "success") throw new Error("Expected successful crawler run");
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
      source: "sam_gov",
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
    query: async (sql: string, values: unknown[] = []): Promise<[unknown[], unknown?]> => {
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
