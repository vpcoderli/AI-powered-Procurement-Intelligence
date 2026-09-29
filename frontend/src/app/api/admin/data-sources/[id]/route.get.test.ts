import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME, hashSessionToken } from "@/server/auth/session";
import { dataSources, sessions, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminDataSourceGet } from "./route";

// The PATCH tests in route.test.ts mock @/server/admin/auth for the whole file, so the GET, whose auth we want real, lives here.
const NOW = "2026-09-29T12:00:00.000Z";
const DETAIL_URL = "http://localhost/api/admin/data-sources/bidnet_co_denver";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function requestWithSession(token: string) {
  return new Request(DETAIL_URL, { headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` } });
}

describe("GET /api/admin/data-sources/[id]", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: "bidnet_co_denver",
        label: "Denver",
        issuerType: "county",
        stateCode: "CO",
        jurisdictionLevel: "county",
        providerFamily: "bidnet",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  });

  afterEach(async () => {
    // `process.env.X = undefined` would store the string "undefined", so restore an unset value by deleting it.
    if (originalBypass === undefined) delete process.env.ADMIN_UI_LOCAL_BYPASS;
    else process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    await testDb.cleanup();
  });

  function createSession(role: string) {
    const token = `${role}_session_token`;
    testDb.db.insert(users).values({ id: `user_${role}`, email: `${role}@example.com`, role, createdAt: NOW, updatedAt: NOW }).run();
    testDb.db
      .insert(sessions)
      .values({
        id: `session_${role}`,
        userId: `user_${role}`,
        tokenHash: hashSessionToken(token),
        expiresAt: "2099-05-20T00:00:00.000Z",
        createdAt: NOW,
        lastSeenAt: NOW,
      })
      .run();
    return token;
  }

  it("denies requests without admin auth or the local bypass", async () => {
    delete process.env.ADMIN_UI_LOCAL_BYPASS;

    const response = await createAdminDataSourceGet(testDb.db)(new Request(DETAIL_URL), context("bidnet_co_denver"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });

  it("serves the detail of a county source under the local bypass", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";

    const response = await createAdminDataSourceGet(testDb.db)(new Request(DETAIL_URL), context("bidnet_co_denver"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source.id).toBe("bidnet_co_denver");
    expect(body.logSourceKeys).toEqual(["Denver", "bidnet_co_denver"]);
    expect(body.states.level).toBe("county");
    expect(body.readiness).toMatchObject({ bucket: "missing_platform_review", platformReview: { status: "missing", review: null } });
    expect(body.bids.counts.total).toBe(0);
    expect(body.bids.latest).toEqual([]);
  });

  it("answers 404 DATA_SOURCE_NOT_FOUND for an unknown id", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";

    const response = await createAdminDataSourceGet(testDb.db)(new Request(DETAIL_URL), context("missing"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "DATA_SOURCE_NOT_FOUND", message: "Data source was not found." } });
  });

  it("is a console read: support may open it, a plain user may not", async () => {
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
    const GET = createAdminDataSourceGet(testDb.db);

    const support = await GET(requestWithSession(createSession("support")), context("bidnet_co_denver"));
    const plainUser = await GET(requestWithSession(createSession("user")), context("bidnet_co_denver"));

    expect(support.status).toBe(200);
    expect((await support.json()).source.id).toBe("bidnet_co_denver");
    expect(plainUser.status).toBe(403);
  });

  it("reads MySQL when a store is injected", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const row = { id: "bidnet_co_denver", label: "Denver", issuerType: "county", stateCode: "CO", isEnabled: 1, cadence: "daily", jurisdictionLevel: "county", providerFamily: "bidnet", consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW };
    const query = vi.fn(async (sql: string) => {
      if (sql.trimStart().startsWith("SELECT (CASE")) return [[{ coverage_level: "county", platform: "bidnet", approval_state: "awaiting", health_state: "never_run" }]] as [unknown[]];
      return [sql.includes("FROM data_sources") ? [row] : []] as [unknown[]];
    });

    const response = await createAdminDataSourceGet(testDb.db, { query, execute: vi.fn() } as never)(new Request(DETAIL_URL), context("bidnet_co_denver"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ source: { id: "bidnet_co_denver" }, states: { level: "county", approval: "awaiting" } });
    expect(query).toHaveBeenCalled();
  });
});
