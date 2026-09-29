import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crawlerLogs, dataSources, eventLog, sourceApprovalEvents } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordLiveSourceHealthSnapshot } from "@/server/source-validity/health-snapshots";
import {
  AdminDataSourceNotFoundError,
  SourceApprovalRequirementsError,
  crawlerLogKeysForSource,
  getAdminDataSource,
  getAdminDataSourceFromMysql,
  isGatedLocalJurisdictionLevel,
  listAdminCrawlerLogs,
  listAdminCrawlerLogsFromMysql,
  listAdminDataSources,
  listAdminDataSourcesFromMysql,
  listLocalLedgerSources,
  listLocalLedgerSourcesFromMysql,
  missingApprovalRequirements,
  normalizeCrawlerLogLimit,
  recordSourcePrecheck,
  recordSourcePrecheckFromMysql,
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
          classification: "http_error",
          reason: "HTTP 503 Service Unavailable",
          evidenceSnippets: ["HTTP 503 Service Unavailable"],
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
            classification: "http_error",
            reason: "HTTP 503 Service Unavailable",
            error: "HTTP 503 Service Unavailable",
            errorMessage: "HTTP 503 Service Unavailable",
            evidenceSnippets: ["HTTP 503 Service Unavailable"],
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

  it("exposes the precheck queue flag on the admin DTO (SQLite)", async () => {
    testDb.db
      .insert(dataSources)
      .values([
        {
          id: "queued_source",
          label: "Queued source",
          issuerType: "county",
          stateCode: "MI",
          isEnabled: 1,
          cadence: "daily",
          precheckRequestedAt: "2026-09-29T08:00:00.000Z",
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "idle_source",
          label: "Idle source",
          issuerType: "county",
          stateCode: "MI",
          isEnabled: 1,
          cadence: "daily",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ])
      .run();

    const listed = await listAdminDataSources(testDb.db);

    expect(listed.sources.find((item) => item.id === "queued_source")?.precheckRequestedAt).toBe("2026-09-29T08:00:00.000Z");
    expect(listed.sources.find((item) => item.id === "idle_source")?.precheckRequestedAt).toBeNull();
    // A PATCH response carries the flag too, so the console never shows a stale queue state.
    await expect(updateAdminDataSource(testDb.db, "queued_source", { isEnabled: false })).resolves.toMatchObject({
      precheckRequestedAt: "2026-09-29T08:00:00.000Z",
    });
  });

  it("records live source health triage fields and redacts credential-like notes", async () => {
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

    await expect(
      updateAdminDataSource(testDb.db, "sam_gov", {
        liveHealthOwner: "ops@example.com",
        liveHealthDisposition: "needs_manual_triage",
        liveHealthNextReviewAt: "2026-06-15T00:00:00.000Z",
        liveHealthNotes: "Portal returns 403; password=super-secret token: abc123 should not persist.",
      }),
    ).resolves.toMatchObject({
      id: "sam_gov",
      liveHealthOwner: "ops@example.com",
      liveHealthDisposition: "needs_manual_triage",
      liveHealthNextReviewAt: "2026-06-15T00:00:00.000Z",
      liveHealthNotes: expect.stringContaining("password=[REDACTED]"),
      liveHealthReviewedAt: expect.any(String),
    });

    const listed = await listAdminDataSources(testDb.db);
    const source = listed.sources.find((item) => item.id === "sam_gov");
    expect(source).toMatchObject({
      liveHealthOwner: "ops@example.com",
      liveHealthDisposition: "needs_manual_triage",
      liveHealthNextReviewAt: "2026-06-15T00:00:00.000Z",
      liveHealthReviewedAt: expect.any(String),
    });
    expect(source?.liveHealthNotes).not.toContain("super-secret");
    expect(source?.liveHealthNotes).not.toContain("abc123");
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
          liveHealthOwner: "ca-ops@example.com",
          liveHealthDisposition: "blocked_by_403",
          liveHealthNextReviewAt: "2026-06-20T00:00:00.000Z",
          liveHealthNotes: "Needs proxy review.",
          liveHealthReviewedAt: "2026-06-10T00:00:00.000Z",
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

    await expect(
      updateAdminDataSourceFromMysql(mysql, "sam_gov", {
        liveHealthOwner: "mysql-ops@example.com",
        liveHealthDisposition: "reviewed_healthy",
        liveHealthNotes: "Checked manually with api_token=live-secret.",
        liveHealthReviewedAt: "2026-06-11T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      id: "sam_gov",
      liveHealthOwner: "mysql-ops@example.com",
      liveHealthDisposition: "reviewed_healthy",
      liveHealthNotes: "Checked manually with api_token=[REDACTED]",
      liveHealthReviewedAt: "2026-06-11T00:00:00.000Z",
    });
  });

  it("selects precheck_requested_at on every MySQL data source read and maps it onto the DTO", async () => {
    const mysql = createFakeMysqlDataSourcesStore();
    Object.assign(mysql.sources[0], { precheckRequestedAt: "2026-09-29T08:00:00.000Z" });
    const selects: string[] = [];
    const fakeQuery = mysql.query.bind(mysql);
    mysql.query = async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM data_sources")) selects.push(sql);
      return fakeQuery(sql, values);
    };

    const listed = await listAdminDataSourcesFromMysql(mysql as never);
    await updateAdminDataSourceFromMysql(mysql as never, "sam_gov", { isEnabled: true });

    expect(listed.sources.find((source) => source.id === "california_caleprocure")?.precheckRequestedAt).toBe(
      "2026-09-29T08:00:00.000Z",
    );
    expect(listed.sources.find((source) => source.id === "sam_gov")?.precheckRequestedAt).toBeNull();
    // The list read and both reads of the update path all go through the one select list.
    expect(selects).toHaveLength(3);
    for (const sql of selects) expect(sql).toContain("precheck_requested_at AS precheckRequestedAt");
  });

  it("exposes fetchConfig on admin sources and updates crawler config with an audit event (SQLite)", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "il_bidbuy",
        label: "Illinois BidBuy",
        issuerType: "state",
        stateCode: "IL",
        baseUrl: "https://old.example.gov",
        isEnabled: 1,
        cadence: "daily",
        fetchConfig: JSON.stringify({ base_url: "https://old.example.gov" }),
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    const updated = await updateAdminDataSource(
      testDb.db,
      "il_bidbuy",
      {
        fetchConfig: { base_url: "https://old.example.gov", enrichment: { enabled: true, fields: ["description"] } },
        cadence: "weekly",
        baseUrl: "https://new.example.gov",
      },
      { actorUserId: "admin_1" },
    );

    expect(updated.cadence).toBe("weekly");
    expect(updated.baseUrl).toBe("https://new.example.gov");
    expect(updated.fetchConfig).toEqual({
      base_url: "https://new.example.gov",
      enrichment: { enabled: true, fields: ["description"] },
    });

    const stored = testDb.db.select().from(dataSources).where(eq(dataSources.id, "il_bidbuy")).get();
    expect(stored?.fetchConfig).toBe(
      JSON.stringify({ base_url: "https://new.example.gov", enrichment: { enabled: true, fields: ["description"] } }),
    );

    const events = testDb.db
      .select()
      .from(eventLog)
      .all()
      .filter((event) => event.eventName === "data_source.crawler_config_updated");
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe("admin_1");
    expect(events[0].targetId).toBe("il_bidbuy");
    expect(JSON.parse(events[0].beforeAfterJson)).toEqual({
      before: { fetchConfig: { base_url: "https://old.example.gov" }, cadence: "daily", baseUrl: "https://old.example.gov" },
      after: {
        fetchConfig: { base_url: "https://new.example.gov", enrichment: { enabled: true, fields: ["description"] } },
        cadence: "weekly",
        baseUrl: "https://new.example.gov",
      },
    });
  });

  it("leaves crawler config untouched when the update carries no crawler fields (SQLite)", async () => {
    testDb.db
      .insert(dataSources)
      .values({
        id: "il_bidbuy",
        label: "Illinois BidBuy",
        issuerType: "state",
        stateCode: "IL",
        baseUrl: "https://old.example.gov",
        isEnabled: 1,
        cadence: "daily",
        fetchConfig: JSON.stringify({ base_url: "https://old.example.gov" }),
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    const updated = await updateAdminDataSource(testDb.db, "il_bidbuy", { isEnabled: false });

    expect(updated.cadence).toBe("daily");
    expect(updated.fetchConfig).toEqual({ base_url: "https://old.example.gov" });
    expect(
      testDb.db
        .select()
        .from(eventLog)
        .all()
        .filter((event) => event.eventName === "data_source.crawler_config_updated"),
    ).toHaveLength(0);
  });

  it("updates crawler config through the MySQL twin with the same SQL shape", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const row = {
      id: "il_bidbuy",
      label: "Illinois BidBuy",
      issuerType: "state",
      stateCode: "IL",
      baseUrl: "https://old.example.gov",
      isEnabled: 1,
      cadence: "daily",
      fetchConfig: JSON.stringify({ base_url: "https://old.example.gov" }),
      jurisdictionLevel: "state",
      jurisdictionName: null,
      approvedForIngestion: 1,
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const mysql = {
      query: async (sql: string) => {
        if (sql.includes("FROM data_sources")) return [[row]];
        if (sql.includes("FROM event_log")) return [[fakeEventLogRow(executed)]];
        return [[]];
      },
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1 }];
      },
    };

    await updateAdminDataSourceFromMysql(
      mysql as never,
      "il_bidbuy",
      { fetchConfig: { enrichment: { enabled: true } }, cadence: "hourly", baseUrl: null },
      { actorUserId: "admin_1" },
    );

    const update = executed.find((call) => call.sql.startsWith("UPDATE data_sources SET"));
    expect(update?.sql).toContain("fetch_config = ?");
    expect(update?.sql).toContain("cadence = ?");
    expect(update?.sql).toContain("base_url = ?");
    expect(update?.values).toContain(JSON.stringify({ enrichment: { enabled: true } }));
    expect(update?.values).toContain("hourly");
    expect(update?.values).toContain(null);
    expect(
      executed.some(
        (call) => call.sql.includes("INSERT INTO event_log") && call.values.includes("data_source.crawler_config_updated"),
      ),
    ).toBe(true);
  });
});

describe("compliance ledger and approval requirements", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: "bidnet_ny_erie",
        label: "Erie County, NY (BidNet)",
        issuerType: "county",
        stateCode: "NY",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("writes every C6 ledger field and stamps the approval review date (SQLite)", async () => {
    const source = await updateAdminDataSource(testDb.db, "bidnet_ny_erie", {
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
      approvedForIngestion: true,
      isEnabled: true,
      tosReviewed: true,
      tosUrl: "https://www.bidnetdirect.com/terms",
      complianceReviewer: "apsi.lily@gmail.com",
      legalOpinionReference: "LEGAL-2026-014",
      complianceReviewDueAt: "2027-09-16T00:00:00.000Z",
      complianceNotes: "Public county listing.",
      approvalNotes: "Approved after pre-check.",
    });

    expect(source).toMatchObject({
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
      approvedForIngestion: true,
      tosReviewed: true,
      tosUrl: "https://www.bidnetdirect.com/terms",
      complianceReviewer: "apsi.lily@gmail.com",
      legalOpinionReference: "LEGAL-2026-014",
      complianceReviewDueAt: "2027-09-16T00:00:00.000Z",
      complianceNotes: "Public county listing.",
    });
    expect(source.lastApprovalReviewedAt).not.toBeNull();
    expect(testDb.db.select().from(sourceApprovalEvents).all()).toHaveLength(1);
  });

  it("writes every C6 ledger column and the approval event (MySQL)", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const row = {
      id: "bidnet_ny_erie",
      label: "Erie County, NY (BidNet)",
      issuerType: "county",
      stateCode: "NY",
      isEnabled: 1,
      cadence: "daily",
      requiresLogin: 0,
      approvalStatus: null,
      legalReviewStatus: null,
      approvedForIngestion: null,
      tosReviewed: null,
      complianceReviewer: null,
      legalOpinionReference: null,
      consecutiveFailures: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const mysql = {
      query: async (sql: string) => sql.includes("FROM data_sources") ? [[row]] : [[]],
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1 }];
      },
    };

    await updateAdminDataSourceFromMysql(
      mysql as never,
      "bidnet_ny_erie",
      {
        approvalStatus: "approved",
        legalReviewStatus: "approved_public",
        approvedForIngestion: true,
        isEnabled: true,
        tosReviewed: true,
        tosUrl: "https://www.bidnetdirect.com/terms",
        complianceReviewer: "apsi.lily@gmail.com",
        legalOpinionReference: "LEGAL-2026-014",
        complianceReviewDueAt: "2027-09-16T00:00:00.000Z",
        complianceNotes: "Public county listing.",
        approvalNotes: "Approved after pre-check.",
      },
      { actorUserId: "admin_1" },
    );

    const update = executed.find((call) => call.sql.startsWith("UPDATE data_sources SET"));
    for (const column of [
      "approval_status = ?",
      "legal_review_status = ?",
      "approved_for_ingestion = ?",
      "tos_reviewed = ?",
      "tos_reviewed_at = ?",
      "tos_url = ?",
      "compliance_reviewer = ?",
      "legal_opinion_reference = ?",
      "compliance_review_due_at = ?",
      "compliance_notes = ?",
      "last_approval_reviewed_at = ?",
    ]) {
      expect(update?.sql).toContain(column);
    }
    expect(update?.values).toContain("apsi.lily@gmail.com");
    expect(update?.values).toContain("LEGAL-2026-014");
    expect(
      executed.some((call) => call.sql.includes("INSERT INTO source_approval_events") && call.values.includes("approved")),
    ).toBe(true);
  });

  it("refuses approval of a login-gated source with missing ledger fields on both dialects", async () => {
    testDb.db.update(dataSources).set({ requiresLogin: 1 }).where(eq(dataSources.id, "bidnet_ny_erie")).run();

    await expect(
      updateAdminDataSource(testDb.db, "bidnet_ny_erie", { approvalStatus: "approved" }),
    ).rejects.toBeInstanceOf(SourceApprovalRequirementsError);
    expect(
      testDb.db.select().from(dataSources).where(eq(dataSources.id, "bidnet_ny_erie")).get()?.approvalStatus,
    ).toBeNull();

    const mysql = createFakeMysqlDataSourcesStore();
    const loginSource = mysql.sources.find((item) => item.id === "sam_gov")!;
    (loginSource as { requiresLogin: number | null }).requiresLogin = 1;
    await expect(
      updateAdminDataSourceFromMysql(mysql as never, "sam_gov", { approvalStatus: "approved" }),
    ).rejects.toBeInstanceOf(SourceApprovalRequirementsError);
  });

  it("names exactly the missing ledger fields", () => {
    const row = { requiresLogin: 1, complianceReviewer: null, legalOpinionReference: "LEGAL-1", tosReviewed: 1 };

    expect(missingApprovalRequirements(row, { approvalStatus: "approved" })).toEqual(["complianceReviewer"]);
    expect(missingApprovalRequirements(row, { approvalStatus: "approved", complianceReviewer: "  " })).toEqual([
      "complianceReviewer",
    ]);
    expect(missingApprovalRequirements(row, { approvalStatus: "approved", complianceReviewer: "a@b.c" })).toEqual([]);
    expect(missingApprovalRequirements(row, { approvalStatus: "approved", tosReviewed: false })).toEqual([
      "complianceReviewer",
      "tosReviewed",
    ]);
    // Not an approval, or not login-gated: never checked.
    expect(missingApprovalRequirements(row, { approvalStatus: "blocked" })).toEqual([]);
    expect(missingApprovalRequirements({ ...row, requiresLogin: 0 }, { approvalStatus: "approved" })).toEqual([]);
  });

  it("records a pre-check's robots and live-health evidence (SQLite)", () => {
    recordSourcePrecheck(testDb.db, "bidnet_ny_erie", {
      robots: {
        status: "clear",
        checkedAt: "2026-09-16T10:00:00.000Z",
        hash: "hash-1",
        disallowsCrawledPaths: false,
        flagReason: null,
      },
      liveHealth: {
        disposition: "ready",
        notes: "precheck token=secret",
        reviewedAt: "2026-09-16T10:00:00.000Z",
      },
    });

    expect(testDb.db.select().from(dataSources).where(eq(dataSources.id, "bidnet_ny_erie")).get()).toMatchObject({
      robotsTxtStatus: "clear",
      robotsTxtCheckedAt: "2026-09-16T10:00:00.000Z",
      robotsTxtHash: "hash-1",
      robotsTxtDisallowsCrawledPaths: 0,
      liveHealthDisposition: "ready",
      liveHealthNotes: "precheck token=[REDACTED]",
      liveHealthReviewedAt: "2026-09-16T10:00:00.000Z",
      approvalStatus: null,
    });
    expect(testDb.db.select().from(sourceApprovalEvents).all()).toHaveLength(0);
  });

  it("rejects a pre-check write-back for an unknown source on both dialects", async () => {
    expect(() =>
      recordSourcePrecheck(testDb.db, "nope", {
        robots: { status: "clear", checkedAt: NOW, hash: null, disallowsCrawledPaths: false, flagReason: null },
      }),
    ).toThrow(AdminDataSourceNotFoundError);

    const mysql = { query: async () => [[]], execute: async () => [{}] };
    await expect(
      recordSourcePrecheckFromMysql(mysql as never, "nope", {
        robots: { status: "clear", checkedAt: NOW, hash: null, disallowsCrawledPaths: false, flagReason: null },
      }),
    ).rejects.toBeInstanceOf(AdminDataSourceNotFoundError);
  });

  it("writes only the requested pre-check columns (MySQL)", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const mysql = {
      query: async () => [[{ id: "bidnet_ny_erie" }]],
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1 }];
      },
    };

    await recordSourcePrecheckFromMysql(mysql as never, "bidnet_ny_erie", {
      robots: {
        status: "disallow_all",
        checkedAt: "2026-09-16T10:00:00.000Z",
        hash: "hash-2",
        disallowsCrawledPaths: true,
        flagReason: "Disallow: /",
      },
    });

    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toContain("robots_txt_disallows_crawled_paths = ?");
    expect(executed[0].sql).not.toContain("live_health_disposition");
    expect(executed[0].values.slice(0, 5)).toEqual([
      "disallow_all",
      "2026-09-16T10:00:00.000Z",
      "hash-2",
      1,
      "Disallow: /",
    ]);
    expect(executed[0].values.at(-1)).toBe("bidnet_ny_erie");
  });
});

describe("governance defaults of held local sources", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function insertLocal(id: string, level: string | null, overrides: Partial<typeof dataSources.$inferInsert> = {}) {
    testDb.db
      .insert(dataSources)
      .values({
        id,
        label: id,
        issuerType: level ?? "county",
        stateCode: "MI",
        jurisdictionLevel: level,
        providerFamily: "bidnet",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .run();
  }

  it.each(["county", "city", "township", "special_district"])(
    "reports a registered %s source with NULL governance columns as awaiting approval, like the gate does",
    async (level) => {
      insertLocal("registered", level);

      const listed = await listAdminDataSources(testDb.db);

      expect(listed.sources.find((item) => item.id === "registered")).toMatchObject({
        approvalStatus: "needs_review",
        approvedForIngestion: false,
        legalReviewStatus: "not_reviewed",
        approvalNotes: null,
      });
    },
  );

  it("still reports what an explicit approval wrote on a local source", async () => {
    insertLocal("approved_county", "county", {
      approvalStatus: "approved",
      approvedForIngestion: 1,
      legalReviewStatus: "approved_public",
      approvalNotes: "Approved after pre-check.",
    });
    insertLocal("blocked_county", "county", { approvalStatus: "blocked", approvedForIngestion: 0, legalReviewStatus: "restricted" });

    const listed = await listAdminDataSources(testDb.db);

    expect(listed.sources.find((item) => item.id === "approved_county")).toMatchObject({
      approvalStatus: "approved",
      approvedForIngestion: true,
      legalReviewStatus: "approved_public",
      approvalNotes: "Approved after pre-check.",
    });
    expect(listed.sources.find((item) => item.id === "blocked_county")).toMatchObject({
      approvalStatus: "blocked",
      approvedForIngestion: false,
      legalReviewStatus: "restricted",
    });
  });

  it("keeps the crawlable defaults of an explicitly approved local row whose other governance columns are NULL", async () => {
    // Approved by hand with only approval_status set: the gate lets it run (NULL is "not denied"), so must the DTO.
    insertLocal("hand_approved", "county", { approvalStatus: "approved" });

    const listed = await listAdminDataSources(testDb.db);

    expect(listed.sources.find((item) => item.id === "hand_approved")).toMatchObject({
      approvalStatus: "approved",
      approvedForIngestion: true,
      legalReviewStatus: "approved_public",
    });
  });

  it("holds a local row that was explicitly moved to needs_review, whatever its other columns say", async () => {
    insertLocal("held_county", "county", { approvalStatus: "needs_review" });

    const listed = await listAdminDataSources(testDb.db);

    expect(listed.sources.find((item) => item.id === "held_county")).toMatchObject({
      approvalStatus: "needs_review",
      approvedForIngestion: false,
      legalReviewStatus: "not_reviewed",
    });
  });

  it("keeps the default public-source approval for federal rows and for legacy rows without a level", async () => {
    insertLocal("sam_gov", "federal", { issuerType: "federal", stateCode: "US" });
    insertLocal("legacy_county", null);

    const listed = await listAdminDataSources(testDb.db);

    for (const id of ["sam_gov", "legacy_county"]) {
      expect(listed.sources.find((item) => item.id === id)).toMatchObject({
        approvalStatus: "approved",
        approvedForIngestion: true,
        legalReviewStatus: "approved_public",
        approvalNotes: "Default public non-state source governance.",
      });
    }
  });

  it("logs the first approval of a registered local source as needs_review -> approved (SQLite)", async () => {
    insertLocal("registered", "county");

    await updateAdminDataSource(
      testDb.db,
      "registered",
      { approvalStatus: "approved", approvedForIngestion: true, legalReviewStatus: "approved_public", approvalNotes: "ledger" },
      { actorUserId: "admin_1" },
    );

    expect(testDb.db.select().from(sourceApprovalEvents).all()).toEqual([
      expect.objectContaining({
        sourceId: "registered",
        action: "approved",
        previousApprovalStatus: "needs_review",
        nextApprovalStatus: "approved",
        previousLegalReviewStatus: "not_reviewed",
        nextLegalReviewStatus: "approved_public",
        previousApprovedForIngestion: 0,
        nextApprovedForIngestion: 1,
      }),
    ]);
  });

  it("applies the same defaults on the MySQL path, list and approval event", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const row = {
      id: "registered", label: "registered", issuerType: "county", stateCode: "MI", isEnabled: 1, cadence: "daily",
      jurisdictionLevel: "county", providerFamily: "bidnet", requiresLogin: null, approvalStatus: null, legalReviewStatus: null,
      approvedForIngestion: null, tosReviewed: null, complianceReviewer: null, legalOpinionReference: null,
      consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW,
    };
    const mysql = {
      query: async (sql: string) => (sql.includes("FROM data_sources") ? [[row]] : [[]]),
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1 }];
      },
    };

    const listed = await listAdminDataSourcesFromMysql(mysql as never);
    await updateAdminDataSourceFromMysql(mysql as never, "registered", { approvalStatus: "approved", approvedForIngestion: true, legalReviewStatus: "approved_public" });

    expect(listed.sources[0]).toMatchObject({ approvalStatus: "needs_review", approvedForIngestion: false, legalReviewStatus: "not_reviewed" });
    const event = executed.find((call) => call.sql.includes("INSERT INTO source_approval_events"));
    // Values are (id, source_id, actor, action, previous_approval_status, next_approval_status, previous_legal_review_status,
    // next_legal_review_status, previous_approved_for_ingestion, ...). The fake keeps returning the pre-update row, so only
    // the "previous" side is meaningful here: it must be the held state, never the old "approved" default.
    expect([event?.values[3], event?.values[4], event?.values[6], event?.values[8]]).toEqual(["approved", "needs_review", "not_reviewed", 0]);
  });

  it("names the levels the gate holds: any set level other than federal or state", () => {
    expect(["county", "city", "township", "special_district", "school_board"].map(isGatedLocalJurisdictionLevel)).toEqual([true, true, true, true, true]);
    expect(["federal", "state", "", null, undefined].map(isGatedLocalJurisdictionLevel)).toEqual([false, false, false, false, false]);
  });
});

describe("local ledger source loader", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function insertSource(id: string, overrides: Partial<typeof dataSources.$inferInsert>) {
    testDb.db
      .insert(dataSources)
      .values({
        id,
        label: id,
        issuerType: "county",
        stateCode: "CO",
        providerFamily: "bidnet",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .run();
  }

  it("returns the local rows only, as DTOs without logs, live health or approval history (SQLite)", async () => {
    insertSource("ca_state", { issuerType: "state", stateCode: "CA", jurisdictionLevel: "state", providerFamily: null });
    insertSource("legacy_no_level", { jurisdictionLevel: null });
    insertSource("bidnet_co_denver", { jurisdictionLevel: "county", approvalStatus: null });
    insertSource("bidnet_co_aurora", { issuerType: "city", jurisdictionLevel: "city", approvalStatus: "approved" });
    // Both feed the log/health/history lookups that the light loader must skip.
    testDb.db
      .insert(crawlerLogs)
      .values({ id: "log_1", source: "bidnet_co_denver", runId: "run_1", status: "success", startedAt: NOW })
      .run();
    testDb.db
      .insert(sourceApprovalEvents)
      .values({ id: "event_1", sourceId: "bidnet_co_aurora", action: "approved", createdAt: NOW })
      .run();

    const sources = await listLocalLedgerSources(testDb.db);

    // Ordered by label; a state row and a legacy row without a level are not local.
    expect(sources.map((source) => source.id)).toEqual(["bidnet_co_aurora", "bidnet_co_denver"]);
    const denver = sources.find((source) => source.id === "bidnet_co_denver");
    expect(denver).toMatchObject({ approvalStatus: "needs_review", approvedForIngestion: false, approvalHistory: [], latestLog: null, latestLiveHealth: null });
    expect(sources.find((source) => source.id === "bidnet_co_aurora")).toMatchObject({ approvalStatus: "approved", approvalHistory: [], latestLog: null });
  });

  it("reads local rows through one governance-scoped MySQL select (MySQL)", async () => {
    const row = {
      id: "bidnet_co_denver", label: "Denver", issuerType: "county", stateCode: "CO", isEnabled: 1, cadence: "daily",
      jurisdictionLevel: "county", providerFamily: "bidnet", requiresLogin: null, approvalStatus: null, legalReviewStatus: null,
      approvedForIngestion: null, tosReviewed: null, complianceReviewer: null, legalOpinionReference: null,
      precheckRequestedAt: "2026-09-29T01:00:00.000Z", consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW,
    };
    const query = vi.fn(async () => [[row]] as [unknown[]]);

    const sources = await listLocalLedgerSourcesFromMysql({ query, execute: vi.fn() } as never);

    // One select: no crawler-log, health-snapshot or approval-event reads.
    expect(query).toHaveBeenCalledTimes(1);
    const sql = (query.mock.calls[0] as unknown as [string])[0];
    expect(sql).toContain("FROM data_sources");
    expect(sql).toContain("jurisdiction_level NOT IN ('federal', 'state')");
    expect(sql).toContain("precheck_requested_at AS precheckRequestedAt");
    expect(sql).toMatch(/ORDER BY label ASC\s*$/);
    expect(sources).toEqual([
      expect.objectContaining({
        id: "bidnet_co_denver",
        approvalStatus: "needs_review",
        precheckRequestedAt: "2026-09-29T01:00:00.000Z",
        approvalHistory: [],
        latestLog: null,
      }),
    ]);
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
      liveHealthOwner: "ca-ops@example.com",
      liveHealthDisposition: "blocked_by_403",
      liveHealthNextReviewAt: "2026-06-20T00:00:00.000Z",
      liveHealthNotes: "Needs proxy review.",
      liveHealthReviewedAt: "2026-06-10T00:00:00.000Z",
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
      liveHealthOwner: null,
      liveHealthDisposition: null,
      liveHealthNextReviewAt: null,
      liveHealthNotes: null,
      liveHealthReviewedAt: null,
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
        const sourceId = String(values.at(-1));
        const source = sources.find((item) => item.id === sourceId);
        if (!source) return [{ affectedRows: 0 }];
        const assignments = sql.match(/SET ([\s\S]*?) WHERE id = \?/i)?.[1].split(",").map((item) => item.trim()) ?? [];
        assignments.forEach((assignment, index) => {
          const column = assignment.split("=")[0].trim();
          const value = values[index];
          if (column === "is_enabled") source.isEnabled = value === 1 ? 1 : 0;
          if (column === "live_health_owner") source.liveHealthOwner = value as string | null;
          if (column === "live_health_disposition") source.liveHealthDisposition = value as string | null;
          if (column === "live_health_next_review_at") source.liveHealthNextReviewAt = value as string | null;
          if (column === "live_health_notes") source.liveHealthNotes = value as string | null;
          if (column === "live_health_reviewed_at") source.liveHealthReviewedAt = value as string | null;
          if (column === "updated_at") source.updatedAt = String(value);
        });
        return [{ affectedRows: 1 }];
      }

      return [{ affectedRows: 0 }];
    },
  };
}

const EVENT_LOG_INSERT_COLUMNS = [
  "id",
  "event_name",
  "occurred_at",
  "environment",
  "organization_id",
  "actor_type",
  "actor_id",
  "actor_role",
  "target_type",
  "target_id",
  "source",
  "outcome",
  "severity",
  "request_id",
  "correlation_id",
  "idempotency_key",
  "metadata_json",
  "before_after_json",
  "retention_class",
  "created_at",
] as const;

/** Replays the last `INSERT INTO event_log` a fake pool recorded as the row a read-back would return. */
function fakeEventLogRow(executed: Array<{ sql: string; values: unknown[] }>) {
  const insert = [...executed].reverse().find((call) => call.sql.includes("INSERT INTO event_log"));
  if (!insert) throw new Error("No event_log insert was recorded.");

  return Object.fromEntries(EVENT_LOG_INSERT_COLUMNS.map((column, index) => [column, insert.values[index]]));
}

describe("run and live-health ownership of a source (plan decision 10)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function insertSource(id: string, overrides: Partial<typeof dataSources.$inferInsert> = {}) {
    testDb.db
      .insert(dataSources)
      .values({
        id,
        label: id,
        issuerType: "county",
        stateCode: "CA",
        jurisdictionLevel: "county",
        providerFamily: "bidnet",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
      })
      .run();
  }

  function insertStateAndCounty() {
    insertSource("ca_state", { label: "California", issuerType: "state", jurisdictionLevel: null, providerFamily: null });
    insertSource("bidnet_ca_county", { label: "Alameda County", fipsCode: "08031" });
  }

  /** The same CA snapshot the `latestLiveHealth` test above records. */
  function recordCaliforniaLiveHealth() {
    recordLiveSourceHealthSnapshot(
      testDb.db,
      {
        ok: true,
        checkedAt: "2026-06-01T02:00:00.000Z",
        summary: { total: 1, healthy: 1, unhealthy: 0, skipped: 0 },
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
      },
      "2026-06-01T02:00:01.000Z",
    );
  }

  it("does not hand a local row its state's latest run or live health", async () => {
    insertStateAndCounty();
    insertCrawlerLog(testDb, { id: "log_ca", source: "ca_caleprocure", status: "success", startedAt: "2026-05-19T01:00:00.000Z" });
    recordCaliforniaLiveHealth();

    const { sources } = await listAdminDataSources(testDb.db);
    const state = sources.find((item) => item.id === "ca_state");
    const county = sources.find((item) => item.id === "bidnet_ca_county");

    expect(state?.latestLog?.source).toBe("ca_caleprocure");
    expect(state?.latestLiveHealth).not.toBeNull();
    expect(state?.sourceHealthTrend).not.toBeNull();
    expect(county?.latestLog).toBeNull();
    expect(county?.latestLiveHealth).toBeNull();
    expect(county?.sourceHealthTrend).toBeNull();
  });

  it("names the crawler_logs.source values a row owns, most specific first", () => {
    expect(crawlerLogKeysForSource({ issuerType: "state", stateCode: "CA", label: "California", id: "ca_state" })).toEqual([
      "ca_caleprocure",
      "California",
      "ca_state",
    ]);
    expect(crawlerLogKeysForSource({ issuerType: "county", stateCode: "CA", label: "Alameda County", id: "bidnet_ca_county" })).toEqual([
      "Alameda County",
      "bidnet_ca_county",
    ]);
    // A label that repeats the id, and a state without a crawler id, add nothing twice.
    expect(crawlerLogKeysForSource({ issuerType: "county", stateCode: "CA", label: "bidnet_ca_county", id: "bidnet_ca_county" })).toEqual([
      "bidnet_ca_county",
    ]);
    expect(crawlerLogKeysForSource({ issuerType: "federal", stateCode: "US", label: "SAM.gov", id: "sam_gov" })).toEqual([
      "SAM.gov",
      "sam_gov",
    ]);
  });

  it("loads one source with its own latest run, its log keys and its approval history (SQLite)", async () => {
    insertStateAndCounty();
    insertCrawlerLog(testDb, { id: "log_old", source: "bidnet_ca_county", status: "failure", startedAt: "2026-05-18T00:00:00.000Z" });
    insertCrawlerLog(testDb, { id: "log_new", source: "bidnet_ca_county", status: "success", startedAt: "2026-05-19T00:00:00.000Z" });
    // Newer than both, but the state's: the county must not pick it up.
    insertCrawlerLog(testDb, { id: "log_state", source: "ca_caleprocure", status: "success", startedAt: "2026-05-20T00:00:00.000Z" });
    testDb.db
      .insert(sourceApprovalEvents)
      .values([
        { id: "event_held", sourceId: "bidnet_ca_county", action: "held", createdAt: "2026-05-10T00:00:00.000Z" },
        { id: "event_approved", sourceId: "bidnet_ca_county", action: "approved", createdAt: "2026-05-11T00:00:00.000Z" },
        { id: "event_other", sourceId: "ca_state", action: "approved", createdAt: "2026-05-12T00:00:00.000Z" },
      ])
      .run();
    recordCaliforniaLiveHealth();

    const record = await getAdminDataSource(testDb.db, "bidnet_ca_county");

    expect(record.logSourceKeys).toEqual(["Alameda County", "bidnet_ca_county"]);
    expect(record.source).toMatchObject({
      id: "bidnet_ca_county",
      fipsCode: "08031",
      latestLog: expect.objectContaining({ id: "log_new", source: "bidnet_ca_county", status: "success" }),
      latestLiveHealth: null,
      sourceHealthTrend: null,
    });
    expect(record.source.approvalHistory.map((event) => event.action)).toEqual(["approved", "held"]);
    // The state-portal row owns that state-keyed log and live health; with no fips_code its field reads null, not undefined.
    await expect(getAdminDataSource(testDb.db, "ca_state")).resolves.toMatchObject({
      source: {
        fipsCode: null,
        latestLog: expect.objectContaining({ id: "log_state", source: "ca_caleprocure" }),
        latestLiveHealth: expect.objectContaining({ status: "healthy" }),
      },
      logSourceKeys: ["ca_caleprocure", "California", "ca_state"],
    });
    await expect(getAdminDataSource(testDb.db, "missing")).rejects.toBeInstanceOf(AdminDataSourceNotFoundError);
  });

  it("loads one source through the MySQL twin with a single owned-run query (MySQL)", async () => {
    const row = {
      id: "bidnet_ca_county",
      label: "Alameda County",
      issuerType: "county",
      stateCode: "CA",
      isEnabled: 1,
      cadence: "daily",
      jurisdictionLevel: "county",
      jurisdictionName: "Alameda County",
      fipsCode: "06001",
      providerFamily: "bidnet",
      consecutiveFailures: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const logRow = {
      id: "log_mysql",
      source: "bidnet_ca_county",
      runId: "run_mysql",
      status: "success",
      startedAt: "2026-05-19T00:00:00.000Z",
      finishedAt: "2026-05-19T00:01:00.000Z",
      durationMs: "60000",
      fetchedCount: "2",
      insertedCount: "1",
      updatedCount: "1",
      skippedCount: "0",
      failedCount: "0",
      errorCode: null,
      errorMessage: null,
      metadata: null,
    };
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes("FROM data_sources")) return [values[0] === "bidnet_ca_county" ? [row] : []] as [unknown[]];
      if (sql.includes("FROM crawler_logs")) return [[logRow]] as [unknown[]];
      return [[]] as [unknown[]];
    });
    const store = { query, execute: vi.fn() } as never;

    const record = await getAdminDataSourceFromMysql(store, "bidnet_ca_county");

    const sourceCall = calls.find((call) => call.sql.includes("FROM data_sources"));
    expect(sourceCall?.sql).toContain("fips_code AS fipsCode");
    expect(sourceCall?.sql).toContain("WHERE id = ?");
    expect(sourceCall?.values).toEqual(["bidnet_ca_county"]);
    const logCalls = calls.filter((call) => call.sql.includes("FROM crawler_logs"));
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0].sql).toContain("FROM crawler_logs WHERE source IN (?, ?)");
    expect(logCalls[0].sql.trim()).toMatch(/ORDER BY started_at DESC, id DESC LIMIT 1$/);
    expect(logCalls[0].values).toEqual(["Alameda County", "bidnet_ca_county"]);
    expect(record.logSourceKeys).toEqual(["Alameda County", "bidnet_ca_county"]);
    expect(record.source).toMatchObject({
      id: "bidnet_ca_county",
      fipsCode: "06001",
      latestLog: expect.objectContaining({ id: "log_mysql", fetchedCount: 2, durationMs: 60000 }),
      latestLiveHealth: null,
      approvalHistory: [],
    });

    // An unknown id stops at the first read: no log, approval or health query follows.
    calls.length = 0;
    await expect(getAdminDataSourceFromMysql(store, "missing")).rejects.toBeInstanceOf(AdminDataSourceNotFoundError);
    expect(calls).toHaveLength(1);
  });
});

describe("crawler log filters and cursor", () => {
  const T1 = "2026-05-18T00:00:00.000Z";
  const T2 = "2026-05-19T00:00:00.000Z";
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    // b and c share T2, so only the id breaks the tie; b is the other source.
    insertCrawlerLog(testDb, { id: "a", source: "x", status: "success", startedAt: T1 });
    insertCrawlerLog(testDb, { id: "b", source: "y", status: "success", startedAt: T2 });
    insertCrawlerLog(testDb, { id: "c", source: "x", status: "success", startedAt: T2 });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  const ids = async (options?: Parameters<typeof listAdminCrawlerLogs>[1]) =>
    (await listAdminCrawlerLogs(testDb.db, options)).map((log) => log.id);

  it("orders by started_at then id, newest first", async () => {
    await expect(ids()).resolves.toEqual(["c", "b", "a"]);
    await expect(ids({ limit: 1 })).resolves.toEqual(["c"]);
  });

  it("keeps only the requested sources", async () => {
    await expect(ids({ sources: ["x"] })).resolves.toEqual(["c", "a"]);
    await expect(ids({ sources: ["x", "y"] })).resolves.toEqual(["c", "b", "a"]);
    await expect(ids({ sources: ["nobody"] })).resolves.toEqual([]);
    // An empty list is "no filter", not "match nothing".
    await expect(ids({ sources: [] })).resolves.toEqual(["c", "b", "a"]);
  });

  it("pages after a (started_at, id) cursor", async () => {
    await expect(ids({ before: T2, beforeId: "c" })).resolves.toEqual(["b", "a"]);
    await expect(ids({ before: T2, beforeId: "b" })).resolves.toEqual(["a"]);
    // Without a tie-breaker the cursor is strictly before the timestamp.
    await expect(ids({ before: T2 })).resolves.toEqual(["a"]);
    await expect(ids({ sources: ["x"], before: T2, beforeId: "c" })).resolves.toEqual(["a"]);
    await expect(ids({ before: T2, beforeId: "c", limit: 1 })).resolves.toEqual(["b"]);
  });

  it("clamps the page size to 1..100 and defaults to 25", () => {
    expect([undefined, 0, -5, 1, 25, 100, 101, 5000].map(normalizeCrawlerLogLimit)).toEqual([25, 1, 1, 1, 25, 100, 100, 100]);
  });

  it("truncates a fractional page size before clamping it", () => {
    // SQLite refuses a fractional LIMIT, so 2.5 has to leave here as 2; a fraction below 1 still clamps up to 1.
    expect([2.5, 99.9, 100.5, 1.999, 0.5, -0.5].map(normalizeCrawlerLogLimit)).toEqual([2, 99, 100, 1, 1, 1]);
  });

  it("lists a page of the truncated size when the limit is fractional", async () => {
    await expect(ids({ limit: 2.5 })).resolves.toEqual(["c", "b"]);
  });

  it("builds the MySQL filter, cursor and limit as bound values (MySQL)", async () => {
    const query = vi.fn(async () => [[]] as [unknown[]]);

    await listAdminCrawlerLogsFromMysql({ query }, { sources: ["x"], before: T2, beforeId: "c", limit: 2 });
    await listAdminCrawlerLogsFromMysql({ query }, { sources: ["x", "y"], before: T2 });
    await listAdminCrawlerLogsFromMysql({ query });

    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls[0][0]).toContain("WHERE source IN (?) AND (started_at < ? OR (started_at = ? AND id < ?))");
    expect(calls[0][0]).toMatch(/ORDER BY started_at DESC, id DESC LIMIT \?\s*$/);
    expect(calls[0][1]).toEqual(["x", T2, T2, "c", 2]);
    expect(calls[1][0]).toContain("WHERE source IN (?, ?) AND started_at < ? ORDER BY");
    expect(calls[1][1]).toEqual(["x", "y", T2, 25]);
    expect(calls[2][0]).not.toContain("WHERE");
    expect(calls[2][1]).toEqual([25]);
  });

  it("binds a truncated, clamped page size as the MySQL LIMIT value", async () => {
    const query = vi.fn(async () => [[]] as [unknown[]]);

    await listAdminCrawlerLogsFromMysql({ query }, { limit: 2.5 });
    await listAdminCrawlerLogsFromMysql({ query }, { limit: 500 });

    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls[0][1]).toEqual([2]);
    expect(calls[1][1]).toEqual([100]);
  });
});
