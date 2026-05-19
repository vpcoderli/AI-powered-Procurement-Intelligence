import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawlerLogs, dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  listAdminCrawlerLogs,
  listAdminDataSources,
  updateAdminDataSource,
} from "./data-sources-repository";

const NOW = "2026-05-19T00:00:00.000Z";

describe("admin data sources repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("lists data sources with summary and latest log health", async () => {
    testDb.db
      .insert(dataSources)
      .values([
        {
          id: "sam_gov",
          label: "SAM.gov",
          issuerType: "federal",
          stateCode: "US",
          baseUrl: "https://sam.gov",
          isEnabled: 1,
          cadence: "daily",
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "ca_caleprocure",
          label: "California Cal eProcure",
          issuerType: "state",
          stateCode: "CA",
          isEnabled: 0,
          cadence: "weekly",
          consecutiveFailures: 2,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ])
      .run();
    testDb.db
      .insert(crawlerLogs)
      .values([
        {
          id: "log_old",
          source: "SAM.gov",
          runId: "run_old",
          status: "failed",
          startedAt: "2026-05-18T00:00:00.000Z",
          fetchedCount: 1,
          insertedCount: 0,
          updatedCount: 0,
          errorMessage: "Old failure",
          errorStack: "do not leak",
        },
        {
          id: "log_latest",
          source: "SAM.gov",
          runId: "run_latest",
          status: "success",
          startedAt: "2026-05-19T00:00:00.000Z",
          finishedAt: "2026-05-19T00:01:00.000Z",
          durationMs: 60000,
          fetchedCount: 5,
          insertedCount: 3,
          updatedCount: 2,
        },
      ])
      .run();

    await expect(listAdminDataSources(testDb.db)).resolves.toEqual({
      summary: {
        totalSources: 2,
        enabledSources: 1,
        healthySources: 1,
        failingSources: 1,
      },
      sources: [
        expect.objectContaining({
          id: "ca_caleprocure",
          isEnabled: false,
          latestLog: null,
        }),
        expect.objectContaining({
          id: "sam_gov",
          isEnabled: true,
          latestLog: expect.objectContaining({
            id: "log_latest",
            status: "success",
            errorMessage: null,
          }),
        }),
      ],
    });
  });

  it("updates source enablement", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "sam_gov",
        label: "SAM.gov",
        issuerType: "federal",
        stateCode: "US",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    await expect(updateAdminDataSource(testDb.db, "sam_gov", { isEnabled: false })).resolves.toMatchObject({
      id: "sam_gov",
      isEnabled: false,
    });
  });

  it("lists recent crawler logs without raw stack traces", async () => {
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
        errorStack: "secret raw stack",
      })
      .run();

    const logs = await listAdminCrawlerLogs(testDb.db, { limit: 10 });

    expect(logs).toEqual([
      expect.objectContaining({
        id: "log_1",
        errorMessage: "Crawler failed",
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("secret raw stack");
  });
});
