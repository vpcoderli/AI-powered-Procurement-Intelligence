import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminDataSourcePatch } from "./route";

const NOW = "2026-05-19T00:00:00.000Z";

describe("PATCH /api/admin/data-sources/[id]", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase();
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
  });

  afterEach(async () => {
    await testDb.cleanup();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("updates data source enablement", async () => {
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: false }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ source: expect.objectContaining({ id: "sam_gov", isEnabled: false }) });
  });

  it("rejects malformed patch bodies", async () => {
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: "nope" }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );

    expect(response.status).toBe(400);
  });
});
