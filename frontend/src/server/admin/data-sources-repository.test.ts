import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crawlerLogs, dataSources, sourceApprovalEvents } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordLiveSourceHealthSnapshot } from "@/server/source-validity/health-snapshots";
import {
  listAdminCrawlerLogs,
  listAdminCrawlerLogsFromMysql,
  listAdminDataSources,
  listAdminDataSourcesFromMysql,
  updateAdminDataSource,
  updateAdminDataSourceFromMysql,
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
    recordLiveSourceHealthSnapshot(testDb.db, {
      ok: true,
      checkedAt: "2026-06-01T02:00:00.000Z",
      summary: {
        total: 1,
        healthy: 1,
        unhealthy: 0,
        skipped: 0,
      },
      results: [
        {
          stateCode: "CA",
          sourceId: "ca_caleprocure",
          label: "California Cal eProcure",
          url: "https://caleprocure.ca.gov",
          sourceAuthority: "official",
          trustStatus: "verified",
          status: "healthy",
          method: "HEAD",
          httpStatus: 200,
          statusText: "OK",
          errorCode: null,
          errorMessage: null,
          latencyMs: 311,
          operationalSeverity: "none",
          recommendedAction: "none",
        },
      ],
    }, "2026-06-01T02:00:01.000Z");
    recordLiveSourceHealthSnapshot(testDb.db, {
      ok: false,
      checkedAt: "2026-06-01T03:00:00.000Z",
      summary: {
        total: 1,
        healthy: 0,
        unhealthy: 1,
        skipped: 0,
      },
      results: [
        {
          stateCode: "CA",
          sourceId: "ca_caleprocure",
          label: "California Cal eProcure",
          url: "https://caleprocure.ca.gov",
          sourceAuthority: "official",
          trustStatus: "verified",
          status: "unhealthy",
          method: "GET",
          httpStatus: 503,
          statusText: "Service Unavailable",
          errorCode: "http_error",
          errorMessage: "HTTP 503 Service Unavailable",
          latencyMs: 842,
          operationalSeverity: "warning",
          recommendedAction: "browser_or_access_review",
        },
      ],
    }, "2026-06-01T03:00:01.000Z");

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
          latestLiveHealth: expect.objectContaining({
            checkedAt: "2026-06-01T03:00:00.000Z",
            status: "unhealthy",
            httpStatus: 503,
            statusCode: 503,
            error: "HTTP 503 Service Unavailable",
            errorMessage: "HTTP 503 Service Unavailable",
            latencyMs: 842,
            operationalSeverity: "warning",
            recommendedAction: "browser_or_access_review",
          }),
          sourceHealthTrend: {
            sampleSize: 2,
            healthyChecks: 1,
            unhealthyChecks: 1,
            skippedChecks: 0,
            healthyPercent: 50,
            currentStatus: "unhealthy",
            currentStreak: 1,
            lastUnhealthyAt: "2026-06-01T03:00:00.000Z",
          },
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
        providerFamily: "state_portal",
        accessMode: "http",
        sourceType: "primary",
        sourceConfidence: "high",
        activationStatus: "active",
        requiresBrowser: 0,
        requiresManual: 0,
        requiresLogin: 0,
        supportsQuery: 1,
        supportsPagination: 1,
        supportsAttachmentMetadata: 1,
        supportsDetailPageFetch: 1,
        fallbackNotes: "Uses fixture fallback when ESBD blocks live fetch.",
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
    expect(source).toMatchObject({
      crawlerSourceId: "tx_esbd",
      crawlerAdapterKind: "dedicated",
      crawlerMaturity: "verified",
      crawlerCapabilities: expect.arrayContaining(["query", "detail_pages"]),
      crawlerBaseUrl: "https://www.txsmartbuy.gov/esbd",
      providerFamily: "state_portal",
      accessMode: "http",
      sourceType: "primary",
      sourceConfidence: "high",
      activationStatus: "active",
      requiresBrowser: false,
      requiresManual: false,
      requiresLogin: false,
      supportsQuery: true,
      supportsPagination: true,
      supportsAttachmentMetadata: true,
      supportsDetailPageFetch: true,
      fallbackNotes: "Uses fixture fallback when ESBD blocks live fetch.",
    });
    expect(result.summary.failingSources).toBe(1);
  });

  it("derives default registry metadata for state crawler sources", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "illinois_bidbuy",
        label: "Illinois BidBuy",
        issuerType: "state",
        stateCode: "IL",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    const result = await listAdminDataSources(testDb.db);
    const source = result.sources.find((item) => item.id === "illinois_bidbuy");

    expect(source).toMatchObject({
      providerFamily: "state_portal",
      accessMode: "http",
      sourceType: "primary",
      sourceConfidence: "high",
      activationStatus: "active",
      requiresBrowser: false,
      requiresManual: false,
      requiresLogin: false,
      supportsQuery: true,
      supportsPagination: true,
      supportsAttachmentMetadata: true,
      supportsDetailPageFetch: true,
      fallbackNotes: null,
      approvedForIngestion: true,
      approvalStatus: "approved",
      accessPattern: "public_http",
      legalReviewStatus: "approved_public",
      sourceOwner: "APSI Data Ops",
      sourceAuthority: "official",
      trustStatus: "verified",
      evidenceMode: "direct_portal",
      validityNotes: expect.stringContaining("Verified"),
    });
  });

  it("uses data source governance overrides before registry defaults", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "oregon_buys",
        label: "OregonBuys",
        issuerType: "state",
        stateCode: "OR",
        isEnabled: 1,
        cadence: "daily",
        approvedForIngestion: 1,
        approvalStatus: "approved",
        accessPattern: "public_http",
        legalReviewStatus: "approved_public",
        sourceOwner: "APSI Legal",
        approvalNotes: "Approved after manual legal review.",
        lastApprovalReviewedAt: "2026-06-01T00:00:00.000Z",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    const result = await listAdminDataSources(testDb.db);
    const source = result.sources.find((item) => item.id === "oregon_buys");

    expect(source).toMatchObject({
      crawlerMaturity: "beta",
      approvedForIngestion: true,
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
      sourceOwner: "APSI Legal",
      approvalNotes: "Approved after manual legal review.",
      lastApprovalReviewedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("records approval governance history when source approval changes", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "oregon_buys",
        label: "OregonBuys",
        issuerType: "state",
        stateCode: "OR",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    await expect(
      updateAdminDataSource(
        testDb.db,
        "oregon_buys",
        {
          approvedForIngestion: true,
          approvalStatus: "approved",
          legalReviewStatus: "approved_public",
          approvalNotes: "Approved after source health review.",
        },
        { actorUserId: "admin_1" },
      ),
    ).resolves.toMatchObject({
      approvalStatus: "approved",
      approvalHistory: [
        expect.objectContaining({
          sourceId: "oregon_buys",
          actorUserId: "admin_1",
          action: "approved",
          previousApprovalStatus: "needs_review",
          nextApprovalStatus: "approved",
          previousLegalReviewStatus: "not_reviewed",
          nextLegalReviewStatus: "approved_public",
          previousApprovedForIngestion: false,
          nextApprovedForIngestion: true,
          reason: "Approved after source health review.",
        }),
      ],
    });

    const events = testDb.db.select().from(sourceApprovalEvents).all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceId: "oregon_buys",
      actorUserId: "admin_1",
      action: "approved",
      previousApprovalStatus: "needs_review",
      nextApprovalStatus: "approved",
      reason: "Approved after source health review.",
    });

    const listed = await listAdminDataSources(testDb.db);
    expect(listed.sources.find((source) => source.id === "oregon_buys")?.approvalHistory).toEqual([
      expect.objectContaining({
        action: "approved",
        actorUserId: "admin_1",
      }),
    ]);
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
    expect(source).toMatchObject({
      crawlerSourceId: null,
      crawlerAdapterKind: "none",
      crawlerMaturity: "none",
      crawlerCapabilities: [],
      crawlerBaseUrl: null,
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

  it("maps recent MySQL crawler logs without raw stack traces", async () => {
    const queryCalls: string[] = [];
    const mysql = {
      async query(sql: string, values?: unknown[]) {
        queryCalls.push(`${sql} ${JSON.stringify(values ?? [])}`);

        return [
          [
            {
              id: "log_mysql",
              source: "SAM.gov",
              runId: "run_mysql",
              status: "failed",
              startedAt: "2026-05-19T00:00:00.000Z",
              finishedAt: "2026-05-19T00:01:00.000Z",
              durationMs: 60000,
              fetchedCount: 0,
              insertedCount: 0,
              updatedCount: 0,
              skippedCount: 0,
              failedCount: 1,
              errorCode: "CrawlerFailed",
              errorMessage: "Crawler failed",
              metadata: JSON.stringify({
                fallback_source: "bundled_demo_fixture",
                fallback_reason: "Live source rejected request",
                fallback_fixture: "/fixtures/sam.json",
              }),
              errorStack: "do not leak",
            },
          ],
        ];
      },
    };

    await expect(listAdminCrawlerLogsFromMysql(mysql, { limit: 500 })).resolves.toEqual([
      {
        id: "log_mysql",
        source: "SAM.gov",
        runId: "run_mysql",
        status: "failed",
        startedAt: "2026-05-19T00:00:00.000Z",
        finishedAt: "2026-05-19T00:01:00.000Z",
        durationMs: 60000,
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 1,
        errorCode: "CrawlerFailed",
        errorMessage: "Crawler failed",
        metadata: JSON.stringify({
          fallback_source: "bundled_demo_fixture",
          fallback_reason: "Live source rejected request",
          fallback_fixture: "/fixtures/sam.json",
        }),
        fallbackSource: "bundled_demo_fixture",
        fallbackReason: "Live source rejected request",
        fallbackFixture: "/fixtures/sam.json",
      },
    ]);
    expect(JSON.stringify(await listAdminCrawlerLogsFromMysql(mysql, { limit: 500 }))).not.toContain("do not leak");
    expect(queryCalls[0]).toContain("LIMIT ?");
    expect(queryCalls[0]).toContain("[100]");
  });

  it("lists and updates MySQL data sources with latest log health", async () => {
    const mysql = createFakeMysqlDataSourcesStore();

    await expect(listAdminDataSourcesFromMysql(mysql)).resolves.toMatchObject({
      summary: {
        totalSources: 2,
        enabledSources: 1,
        healthySources: 1,
        failingSources: 1,
      },
      sources: [
        expect.objectContaining({
          id: "california_caleprocure",
          isEnabled: false,
          latestLog: null,
          crawlerSourceId: "ca_caleprocure",
          sourceAuthority: "official",
          trustStatus: "verified",
          evidenceMode: "direct_portal",
        }),
        expect.objectContaining({
          id: "sam_gov",
          isEnabled: true,
          latestLog: expect.objectContaining({
            id: "mysql_log_latest",
            status: "success",
          }),
        }),
      ],
    });

    await expect(updateAdminDataSourceFromMysql(mysql, "sam_gov", { isEnabled: false })).resolves.toMatchObject({
      id: "sam_gov",
      isEnabled: false,
    });
    expect(mysql.sources.find((source) => source.id === "sam_gov")?.isEnabled).toBe(0);
  });
});

function createFakeMysqlDataSourcesStore() {
  const sources = [
    {
      id: "california_caleprocure",
      label: "California Cal eProcure",
      issuerType: "state",
      stateCode: "CA",
      baseUrl: null,
      isEnabled: 0,
      cadence: "weekly",
      providerFamily: null,
      accessMode: null,
      sourceType: null,
      sourceConfidence: null,
      activationStatus: null,
      requiresBrowser: null,
      requiresManual: null,
      requiresLogin: null,
      supportsQuery: null,
      supportsPagination: null,
      supportsAttachmentMetadata: null,
      supportsDetailPageFetch: null,
      fallbackNotes: null,
      approvedForIngestion: null,
      approvalStatus: null,
      accessPattern: null,
      legalReviewStatus: null,
      sourceOwner: null,
      approvalNotes: null,
      lastApprovalReviewedAt: null,
      lastSuccessAt: null,
      lastFailureAt: "2026-05-19T00:00:00.000Z",
      consecutiveFailures: 2,
      createdAt: NOW,
      updatedAt: NOW,
    },
    {
      id: "sam_gov",
      label: "SAM.gov",
      issuerType: "federal",
      stateCode: "US",
      baseUrl: "https://sam.gov",
      isEnabled: 1,
      cadence: "daily",
      providerFamily: null,
      accessMode: null,
      sourceType: null,
      sourceConfidence: null,
      activationStatus: null,
      requiresBrowser: null,
      requiresManual: null,
      requiresLogin: null,
      supportsQuery: null,
      supportsPagination: null,
      supportsAttachmentMetadata: null,
      supportsDetailPageFetch: null,
      fallbackNotes: null,
      approvedForIngestion: null,
      approvalStatus: null,
      accessPattern: null,
      legalReviewStatus: null,
      sourceOwner: null,
      approvalNotes: null,
      lastApprovalReviewedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  const logs = [
    {
      id: "mysql_log_latest",
      source: "SAM.gov",
      runId: "mysql_run_latest",
      status: "success",
      startedAt: "2026-05-19T00:00:00.000Z",
      finishedAt: "2026-05-19T00:01:00.000Z",
      durationMs: 60000,
      fetchedCount: 1,
      insertedCount: 1,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errorCode: null,
      errorMessage: null,
      metadata: null,
    },
  ];

  return {
    sources,
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("FROM data_sources") && sql.includes("ORDER BY label ASC")) {
        return [[...sources].sort((a, b) => a.label.localeCompare(b.label))];
      }

      if (sql.includes("FROM data_sources") && sql.includes("WHERE id = ?")) {
        return [sources.filter((source) => source.id === values[0])];
      }

      if (sql.includes("FROM crawler_logs")) {
        return [logs];
      }

      return [[]];
    },
    async execute(sql: string, values: unknown[] = []) {
      if (sql.includes("UPDATE data_sources")) {
        const source = sources.find((item) => item.id === values[2]);
        if (!source) return [{ affectedRows: 0 }];
        source.isEnabled = values[0] === 1 ? 1 : 0;
        source.updatedAt = String(values[1]);
        return [{ affectedRows: 1 }];
      }

      return [{ affectedRows: 0 }];
    },
  };
}
