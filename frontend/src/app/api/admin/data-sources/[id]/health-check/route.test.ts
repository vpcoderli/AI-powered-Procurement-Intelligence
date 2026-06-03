import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminDataSourceHealthCheckPost } from "./route";

const NOW = "2026-06-02T00:00:00.000Z";

describe("POST /api/admin/data-sources/[id]/health-check", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase();
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
  });

  afterEach(async () => {
    await testDb.cleanup();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("checks one source and persists the latest health snapshot", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        status: 200,
        statusText: "OK",
      }),
    );
    const POST = createAdminDataSourceHealthCheckPost(testDb.db, { fetchImpl, now: new Date(NOW) });

    const response = await POST(
      new Request("http://localhost/api/admin/data-sources/california_caleprocure/health-check", {
        method: "POST",
        body: JSON.stringify({ timeoutMs: 5000 }),
      }),
      { params: Promise.resolve({ id: "california_caleprocure" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith("https://caleprocure.ca.gov", expect.objectContaining({ method: "HEAD" }));
    expect(body.report).toEqual(expect.objectContaining({
      ok: true,
      summary: { total: 1, healthy: 1, unhealthy: 0, skipped: 0 },
    }));
    expect(body.source).toEqual(expect.objectContaining({
      id: "california_caleprocure",
      latestLiveHealth: expect.objectContaining({
        checkedAt: NOW,
        status: "healthy",
        statusCode: 200,
      }),
    }));
  });
});
