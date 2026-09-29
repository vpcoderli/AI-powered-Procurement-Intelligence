import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { createAdminDataSourceIndexGet } from "./route";

const NOW = "2026-09-29T08:00:00.000Z";
const URL_BASE = "http://localhost/api/admin/data-sources/index";

describe("GET /api/admin/data-sources/index", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values([
        { id: "bidnet_co_aurora", label: "City of Aurora", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", providerFamily: "bidnet", isEnabled: 1, cadence: "daily", createdAt: NOW, updatedAt: NOW },
        { id: "bidnet_co_denver", label: "Denver", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", providerFamily: "bidnet", approvalStatus: "approved", isEnabled: 1, cadence: "daily", createdAt: NOW, updatedAt: NOW },
      ])
      .run();
  });

  afterEach(async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    await testDb.cleanup();
  });

  it("requires an admin or operator session", async () => {
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
    const response = await createAdminDataSourceIndexGet(testDb.db)(new Request(URL_BASE));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });

  it("returns the filtered index", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const response = await createAdminDataSourceIndexGet(testDb.db)(new Request(`${URL_BASE}?level=city`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ id: "bidnet_co_aurora", level: "city", approvalState: "awaiting" })],
      total: 1,
      truncated: false,
    });
  });

  it("answers 400 INVALID_REQUEST for an unknown filter value", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const response = await createAdminDataSourceIndexGet(testDb.db)(new Request(`${URL_BASE}?approval=maybe`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("reads MySQL when a store is injected", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const query = vi.fn(async () => [[]] as [unknown[]]);
    const response = await createAdminDataSourceIndexGet(testDb.db, { query })(new Request(URL_BASE));
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
