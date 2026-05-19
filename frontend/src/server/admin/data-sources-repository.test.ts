import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawlerLogs, dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  listAdminCrawlerLogs,
  listAdminDataSources,
  updateAdminDataSource,
} from "./data-sources-repository";

const NOW = "2026-05-19T00:00:00.000Z";

function insertCrawlerLog(
  testDb: TestDatabase,
  input: {
    id: string;
    source: string;
    status: string;
    startedAt: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  testDb.db
    .insert(crawlerLogs)
    .values({
      id: input.id,
      source: input.source,
      runId: `${input.id}_run`,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.startedAt,
      durationMs: 10,
      fetchedCount: input.status === "success" ? 1 : 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: input.status === "failure" ? 1 : 0,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      errorStack: null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    })
    .run();
}

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

  it("maps state data source rows to crawler log source ids", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "texas_smartbuy",
        label: "Texas SmartBuy",
        issuerType: "state",
        stateCode: "TX",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    insertCrawlerLog(testDb, {
      id: "log_tx_failure",
      source: "tx_esbd",
      status: "failure",
      startedAt: "2026-05-19T01:00:00.000Z",
      errorCode: "TxEsbdError",
      errorMessage: "Texas ESBD response was not valid JSON",
    });

    const result = await listAdminDataSources(testDb.db);
    const source = result.sources.find((item) => item.id === "texas_smartbuy");

    expect(source?.latestLog).toMatchObject({
      source: "tx_esbd",
      status: "failure",
      errorMessage: "Texas ESBD response was not valid JSON",
    });
    expect(result.summary.failingSources).toBe(1);
  });

  it("keeps direct SAM.gov log matching", async () => {
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
    insertCrawlerLog(testDb, {
      id: "log_sam_success",
      source: "SAM.gov",
      status: "success",
      startedAt: "2026-05-19T01:00:00.000Z",
    });

    const result = await listAdminDataSources(testDb.db);
    const source = result.sources.find((item) => item.id === "sam_gov");

    expect(source?.latestLog).toMatchObject({
      source: "SAM.gov",
      status: "success",
    });
    expect(result.summary.healthySources).toBe(1);
  });

  it("exposes parsed fallback metadata on latest source logs", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "california_caleprocure",
        label: "California Cal eProcure",
        issuerType: "state",
        stateCode: "CA",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    insertCrawlerLog(testDb, {
      id: "log_ca_fallback",
      source: "ca_caleprocure",
      status: "success",
      startedAt: "2026-05-19T01:00:00.000Z",
      metadata: {
        fallback_source: "bundled_demo_fixture",
        fallback_reason: "Cal eProcure request failed with status 403",
        fallback_fixture: "/fixtures/ca_caleprocure_live_response.json",
      },
    });

    const result = await listAdminDataSources(testDb.db);
    const source = result.sources.find((item) => item.id === "california_caleprocure");

    expect(source?.latestLog).toMatchObject({
      source: "ca_caleprocure",
      status: "success",
      fallbackSource: "bundled_demo_fixture",
      fallbackReason: "Cal eProcure request failed with status 403",
      fallbackFixture: "/fixtures/ca_caleprocure_live_response.json",
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
