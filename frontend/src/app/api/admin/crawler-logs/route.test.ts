import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crawlerLogs } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminCrawlerLogsGet } from "./route";

describe("GET /api/admin/crawler-logs", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
  });

  afterEach(async () => {
    await testDb.cleanup();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("returns recent crawler logs without stacks", async () => {
    testDb.db
      .insert(crawlerLogs)
      .values({
        id: "log_1",
        source: "SAM.gov",
        runId: "run_1",
        status: "failed",
        startedAt: "2026-05-19T00:00:00.000Z",
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        errorMessage: "Crawler failed",
        errorStack: "do not leak",
      })
      .run();

    const GET = createAdminCrawlerLogsGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/crawler-logs"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs).toEqual([expect.objectContaining({ id: "log_1", errorMessage: "Crawler failed" })]);
    // One row is fewer than the default page of 25, so there is nothing after it.
    expect(body.nextCursor).toBeNull();
    expect(JSON.stringify(body)).not.toContain("do not leak");
  });

  it("can return crawler logs through a MySQL pool dependency", async () => {
    const mysql = {
      async query() {
        return [
          [
            {
              id: "log_mysql",
              source: "SAM.gov",
              runId: "run_mysql",
              status: "success",
              startedAt: "2026-05-19T00:00:00.000Z",
              finishedAt: "2026-05-19T00:01:00.000Z",
              durationMs: 60000,
              fetchedCount: 2,
              insertedCount: 1,
              updatedCount: 1,
              skippedCount: 0,
              failedCount: 0,
              errorCode: null,
              errorMessage: null,
              metadata: null,
            },
          ],
        ];
      },
    };

    const GET = createAdminCrawlerLogsGet({ database: testDb.db, mysql });
    const response = await GET(new Request("http://localhost/api/admin/crawler-logs?limit=50"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs).toEqual([
      expect.objectContaining({
        id: "log_mysql",
        source: "SAM.gov",
        status: "success",
      }),
    ]);
    expect(body.nextCursor).toBeNull();
  });

  describe("filtering and paging", () => {
    const T1 = "2026-05-18T00:00:00.000Z";
    const T2 = "2026-05-19T00:00:00.000Z";
    const T3 = "2026-05-20T00:00:00.000Z";
    const T4 = "2026-05-21T00:00:00.000Z";

    function insertLog(id: string, source: string, startedAt: string) {
      testDb.db
        .insert(crawlerLogs)
        .values({ id, source, runId: `${id}_run`, status: "success", startedAt, fetchedCount: 0, insertedCount: 0, updatedCount: 0 })
        .run();
    }

    function get(query: string) {
      return createAdminCrawlerLogsGet(testDb.db)(new Request(`http://localhost/api/admin/crawler-logs${query}`));
    }

    function sourceParams(count: number) {
      return Array.from({ length: count }, (_, index) => `source=s${index}`).join("&");
    }

    it("keeps only the requested sources and hands back a cursor to page through them", async () => {
      insertLog("log_a1", "a", T1);
      insertLog("log_b1", "b", T2);
      insertLog("log_c1", "c", T3);
      insertLog("log_a2", "a", T4);

      const first = await (await get("?source=a&source=b&limit=1")).json();
      expect(first.logs.map((log: { id: string }) => log.id)).toEqual(["log_a2"]);
      expect(first.nextCursor).toEqual({ before: T4, beforeId: "log_a2" });

      const second = await (await get(`?source=a&source=b&limit=1&before=${first.nextCursor.before}&beforeId=${first.nextCursor.beforeId}`)).json();
      expect(second.logs.map((log: { id: string }) => log.id)).toEqual(["log_b1"]);
      expect(second.nextCursor).toEqual({ before: T2, beforeId: "log_b1" });

      const third = await (await get(`?source=a&source=b&limit=1&before=${second.nextCursor.before}&beforeId=${second.nextCursor.beforeId}`)).json();
      expect(third.logs.map((log: { id: string }) => log.id)).toEqual(["log_a1"]);

      // A full page always carries a cursor; the empty page after the last row ends the walk.
      const end = await (await get(`?source=a&source=b&limit=1&before=${third.nextCursor.before}&beforeId=${third.nextCursor.beforeId}`)).json();
      expect(end).toEqual({ logs: [], nextCursor: null });
    });

    it("ignores blank and repeated source values and clamps a page of 500 to 100", async () => {
      insertLog("log_a1", "a", T1);
      insertLog("log_c1", "c", T3);

      const body = await (await get("?source=&source=a&source=a&limit=500")).json();

      expect(body.logs.map((log: { id: string }) => log.id)).toEqual(["log_a1"]);
      expect(body.nextCursor).toBeNull();
    });

    it("accepts ten source values and refuses eleven", async () => {
      expect((await get(`?${sourceParams(10)}`)).status).toBe(200);

      const response = await get(`?${sourceParams(11)}`);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "at most 10 source values" } });
    });

    it("refuses a tie-breaker without a timestamp and over-long cursors", async () => {
      const beforeIdOnly = await get("?beforeId=log_1");
      expect(beforeIdOnly.status).toBe(400);
      expect(await beforeIdOnly.json()).toEqual({ error: { code: "INVALID_REQUEST", message: "beforeId requires before" } });

      const longBefore = await get(`?before=${"1".repeat(65)}`);
      expect(longBefore.status).toBe(400);
      expect((await longBefore.json()).error).toEqual({ code: "INVALID_REQUEST", message: "cursor is too long" });

      expect((await get(`?before=${T1}&beforeId=${"x".repeat(192)}`)).status).toBe(400);
      expect((await get(`?before=${"1".repeat(64)}&beforeId=${"x".repeat(191)}`)).status).toBe(200);
    });

    it("checks the caller before it looks at the query", async () => {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;

      const response = await get("?beforeId=log_1");

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
    });

    it("passes the filter and cursor to a MySQL pool and derives the next cursor from its last row", async () => {
      const mysqlLog = (id: string, startedAt: string) => ({
        id, source: "a", runId: `${id}_run`, status: "success", startedAt, finishedAt: null, durationMs: null,
        fetchedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0, errorCode: null, errorMessage: null, metadata: null,
      });
      const query = vi.fn(async () => [[mysqlLog("log_9", T4), mysqlLog("log_8", T3)]] as [unknown[]]);

      const response = await createAdminCrawlerLogsGet({ database: testDb.db, mysql: { query } })(
        new Request(`http://localhost/api/admin/crawler-logs?source=a&source=b&before=${T4}&beforeId=log_10&limit=2`),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
      expect(sql).toContain("WHERE source IN (?, ?) AND (started_at < ? OR (started_at = ? AND id < ?))");
      expect(values).toEqual(["a", "b", T4, T4, "log_10", 2]);
      expect(body.nextCursor).toEqual({ before: T3, beforeId: "log_8" });
    });
  });
});
