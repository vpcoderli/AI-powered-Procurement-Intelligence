import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVERAGE_SQL } from "@/server/admin/overview";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminOverviewGet } from "./route";

const URL_BASE = "http://localhost/api/admin/overview";

describe("GET /api/admin/overview", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    // `process.env.X = undefined` would store the string "undefined", so restore an unset value by deleting it.
    if (originalBypass === undefined) delete process.env.ADMIN_UI_LOCAL_BYPASS;
    else process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    await testDb.cleanup();
  });

  it("requires an admin console session", async () => {
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
    const response = await createAdminOverviewGet(testDb.db)(new Request(URL_BASE));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });

  it("answers the four sections for an empty database", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const response = await createAdminOverviewGet(testDb.db)(new Request(URL_BASE));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.generatedAt).toBe("string");
    expect(body.coverage.totals.sources).toBe(0);
    expect(body.pipeline).toEqual([]);
    expect(body.crawlHealth).toMatchObject({ failingSources: 0, worstFailing: [], throttleEvents24h: 0, lastRunAt: null });
    expect(body.bids).toMatchObject({ open: 0, closed: 0, awarded: 0, pendingQa: 0 });
    expect(body.errors).toEqual({});
  });

  it("reads MySQL when a store is injected", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const query = vi.fn(async () => [[]] as [unknown[]]);
    const response = await createAdminOverviewGet(testDb.db, { query, execute: vi.fn() } as never)(new Request(URL_BASE));
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalled();
    expect(query.mock.calls.map((call) => (call as unknown as [string])[0])).toContain(COVERAGE_SQL);
    expect((await response.json()).errors).toEqual({});
  });
});
