import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawlerLogs } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createScraperHealthGet } from "./route";

describe("GET /api/health/scrapers", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("returns scraper source health from crawler logs", async () => {
    testDb.db
      .insert(crawlerLogs)
      .values({
        id: "log_1",
        source: "SAM.gov",
        runId: "run_1",
        status: "success",
        startedAt: "2026-05-19T00:00:00.000Z",
        finishedAt: "2026-05-19T00:01:00.000Z",
        fetchedCount: 2,
        insertedCount: 2,
        updatedCount: 0,
      })
      .run();

    const GET = createScraperHealthGet(testDb.db);
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      sources: [
        {
          source: "SAM.gov",
          lastStatus: "success",
          lastRunAt: "2026-05-19T00:01:00.000Z",
          fetchedCount: 2,
          insertedCount: 2,
          updatedCount: 0,
        },
      ],
    });
  });

  it("can return scraper source health through a MySQL pool dependency", async () => {
    const mysql = {
      async query() {
        return [
          [
            {
              source: "SAM.gov",
              lastStatus: "success",
              lastRunAt: "2026-05-19T00:02:00.000Z",
              fetchedCount: 2,
              insertedCount: 1,
              updatedCount: 1,
            },
          ],
        ];
      },
    };

    const GET = createScraperHealthGet({ mysql });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      sources: [
        {
          source: "SAM.gov",
          lastStatus: "success",
          lastRunAt: "2026-05-19T00:02:00.000Z",
          fetchedCount: 2,
          insertedCount: 1,
          updatedCount: 1,
        },
      ],
    });
  });
});
