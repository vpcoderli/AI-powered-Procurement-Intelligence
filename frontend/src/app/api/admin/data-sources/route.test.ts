import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminDataSourcesGet } from "./route";

const NOW = "2026-05-19T00:00:00.000Z";
const URL_BASE = "http://localhost/api/admin/data-sources";

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

  function insertCaliforniaSource() {
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
  }

  it("denies requests without admin auth or local bypass", async () => {
    const GET = createAdminDataSourcesGet(testDb.db);

    const response = await GET(new Request(URL_BASE));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });

  it("returns one page of compact rows with facets for local bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    insertCaliforniaSource();

    const GET = createAdminDataSourcesGet(testDb.db);
    const response = await GET(new Request(URL_BASE));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      items: [expect.objectContaining({ id: "california_caleprocure", crawlerSourceId: "ca_caleprocure", level: "state" })],
      total: 1,
      page: 1,
      pageSize: 50,
      facets: expect.objectContaining({ level: [{ value: "state", count: 1 }] }),
    });
  });

  it.each([["pageSize=500"], ["sort=bogus"], ["page=3"]])("answers 400 INVALID_REQUEST for ?%s", async (query) => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    insertCaliforniaSource();

    const GET = createAdminDataSourcesGet(testDb.db);
    const response = await GET(new Request(`${URL_BASE}?${query}`));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("reads MySQL when a store is injected", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    // The SQLite row must not show up: the injected store serves the page.
    insertCaliforniaSource();
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT COUNT(*) AS total")) return [[{ total: "0" }]] as [unknown[]];
      return [[]] as [unknown[]];
    });

    const GET = createAdminDataSourcesGet(testDb.db, { query });
    const response = await GET(new Request(URL_BASE));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ items: [], total: 0, page: 1, pageSize: 50 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith("SELECT COUNT(*) AS total"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("LIMIT ? OFFSET ?"))).toBe(true);
  });
});
