import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
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

  it("returns data source summaries for local bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
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

    const GET = createAdminDataSourcesGet(testDb.db);
    const response = await GET(new Request("http://localhost/api/admin/data-sources"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({ totalSources: 1 }),
        sources: [expect.objectContaining({ id: "sam_gov", isEnabled: true })],
      }),
    );
  });
});
