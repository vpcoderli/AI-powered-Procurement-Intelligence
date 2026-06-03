import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordLiveSourceHealthSnapshot } from "@/server/source-validity/health-snapshots";
import { createAdminDataSourcesGet } from "./route";

const NOW = "2026-05-19T00:00:00.000Z";

describe("GET /api/admin/data-sources", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
  });

  afterEach(async () => {
    await testDb.cleanup();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("denies requests without admin auth or local bypass", async () => {
    const GET = createAdminDataSourcesGet(testDb.db);

    const response = await GET(new Request("http://localhost/api/admin/data-sources"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });

  it("returns data source summaries with crawler metadata for local bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
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

    const GET = createAdminDataSourcesGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/data-sources"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ totalSources: 1 }),
        sources: [
          expect.objectContaining({
            id: "california_caleprocure",
            isEnabled: true,
            crawlerSourceId: "ca_caleprocure",
            crawlerAdapterKind: "dedicated",
            crawlerMaturity: "verified",
            crawlerCapabilities: expect.arrayContaining(["query", "pagination"]),
            crawlerBaseUrl: "https://caleprocure.ca.gov",
          }),
        ],
      }),
    );
  });

  it("projects latest source health snapshot fields for local bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
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

    const GET = createAdminDataSourcesGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/data-sources"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sources[0].latestLiveHealth).toMatchObject({
      checkedAt: "2026-06-01T03:00:00.000Z",
      status: "unhealthy",
      statusCode: 503,
      error: "HTTP 503 Service Unavailable",
      latencyMs: 842,
      operationalSeverity: "warning",
      recommendedAction: "browser_or_access_review",
    });
  });
});
