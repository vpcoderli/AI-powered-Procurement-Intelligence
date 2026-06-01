import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawlerLogs } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { listScraperHealthSources, listScraperHealthSourcesFromMysql } from "./logs-repository";

describe("crawler logs repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("returns the latest run status for each crawler source", async () => {
    testDb.db
      .insert(crawlerLogs)
      .values([
        {
          id: "log_1",
          source: "SAM.gov",
          runId: "run_1",
          status: "failed",
          startedAt: "2026-05-18T00:00:00.000Z",
          finishedAt: "2026-05-18T00:01:00.000Z",
          fetchedCount: 1,
          insertedCount: 1,
          updatedCount: 0,
        },
        {
          id: "log_2",
          source: "SAM.gov",
          runId: "run_2",
          status: "success",
          startedAt: "2026-05-19T00:00:00.000Z",
          finishedAt: "2026-05-19T00:02:00.000Z",
          fetchedCount: 2,
          insertedCount: 1,
          updatedCount: 1,
        },
        {
          id: "log_3",
          source: "State Portal",
          runId: "run_3",
          status: "success",
          startedAt: "2026-05-17T00:00:00.000Z",
          fetchedCount: 4,
          insertedCount: 4,
          updatedCount: 0,
        },
      ])
      .run();

    await expect(listScraperHealthSources(testDb.db)).resolves.toEqual([
      {
        source: "SAM.gov",
        lastStatus: "success",
        lastRunAt: "2026-05-19T00:02:00.000Z",
        fetchedCount: 2,
        insertedCount: 1,
        updatedCount: 1,
      },
      {
        source: "State Portal",
        lastStatus: "success",
        lastRunAt: "2026-05-17T00:00:00.000Z",
        fetchedCount: 4,
        insertedCount: 4,
        updatedCount: 0,
      },
    ]);
  });

  it("maps MySQL crawler log rows into scraper health sources", async () => {
    const queryCalls: string[] = [];
    const mysql = {
      async query(sql: string) {
        queryCalls.push(sql);

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
            {
              source: "State Portal",
              lastStatus: "failed",
              lastRunAt: "2026-05-18T00:02:00.000Z",
              fetchedCount: 0,
              insertedCount: 0,
              updatedCount: 0,
            },
          ],
        ];
      },
    };

    await expect(listScraperHealthSourcesFromMysql(mysql)).resolves.toEqual([
      {
        source: "SAM.gov",
        lastStatus: "success",
        lastRunAt: "2026-05-19T00:02:00.000Z",
        fetchedCount: 2,
        insertedCount: 1,
        updatedCount: 1,
      },
      {
        source: "State Portal",
        lastStatus: "failed",
        lastRunAt: "2026-05-18T00:02:00.000Z",
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
      },
    ]);
    expect(queryCalls[0]).toContain("ROW_NUMBER() OVER");
  });
});
