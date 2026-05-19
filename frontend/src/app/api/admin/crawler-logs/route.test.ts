import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(JSON.stringify(body)).not.toContain("do not leak");
  });
});
