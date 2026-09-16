import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import { AdminDataSourceNotFoundError } from "@/server/admin/data-sources-repository";
import { SourcePrecheckFailedError, type SourcePrecheckResult } from "@/server/admin/source-precheck";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { createAdminDataSourcePrecheckPost } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});

const NOW = new Date("2026-09-16T10:00:00.000Z");
const SOURCE_ID = "bidnet_ny_erie";

const PRECHECK_RESULT: SourcePrecheckResult = {
  sourceId: SOURCE_ID,
  checkedAt: NOW.toISOString(),
  verdict: "ready",
  reasons: ["Dry run parsed 4 solicitation(s)."],
  robots: { status: "clear", flagged: false, flagReason: null },
  fetch: {
    status: "ok",
    items: 4,
    sample: [{ title: "Bid 0", url: "https://example.gov/bid/0" }],
    listMethod: "scrapling",
    errorCode: null,
    errorMessage: null,
    httpStatus: 200,
    wafChallenge: false,
  },
  suggestedBaseUrl: null,
};

function request(body?: unknown) {
  return new Request(`http://localhost/api/admin/data-sources/${SOURCE_ID}/precheck`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const context = { params: Promise.resolve({ id: SOURCE_ID }) };

describe("POST /api/admin/data-sources/[id]/precheck", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: SOURCE_ID,
        label: "Erie County, NY (BidNet)",
        issuerType: "county",
        stateCode: "NY",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      })
      .run();
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({ kind: "admin", role: "admin", userId: "admin_1" });
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.clearAllMocks();
  });

  it("returns the C5 pre-check document for admins and operators", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({ kind: "admin", role: "operator", userId: "op_1" });
    const runSourcePrecheck = vi.fn(async () => PRECHECK_RESULT);
    const POST = createAdminDataSourcePrecheckPost(testDb.db, { runSourcePrecheck });

    const response = await POST(request({ limit: 5 }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PRECHECK_RESULT);
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.anything(), {
      roles: ["admin", "operator"],
    });
    expect(runSourcePrecheck).toHaveBeenCalledWith(
      expect.objectContaining({ database: testDb.db, sourceId: SOURCE_ID, limit: 5, mysql: undefined }),
    );
  });

  it("defaults the limit to 5 when the body omits it", async () => {
    const runSourcePrecheck = vi.fn(async () => PRECHECK_RESULT);
    const POST = createAdminDataSourcePrecheckPost(testDb.db, { runSourcePrecheck });

    await POST(request(), context);
    await POST(request({}), context);

    expect(runSourcePrecheck).toHaveBeenCalledTimes(2);
    expect(runSourcePrecheck).toHaveBeenNthCalledWith(1, expect.objectContaining({ limit: 5 }));
    expect(runSourcePrecheck).toHaveBeenNthCalledWith(2, expect.objectContaining({ limit: 5 }));
  });

  it("rejects an out-of-range limit", async () => {
    const runSourcePrecheck = vi.fn(async () => PRECHECK_RESULT);
    const POST = createAdminDataSourcePrecheckPost(testDb.db, { runSourcePrecheck });

    for (const limit of [0, 26, 2.5, "5"]) {
      const response = await POST(request({ limit }), context);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    }
    expect(runSourcePrecheck).not.toHaveBeenCalled();
  });

  it("maps an unknown source to SOURCE_NOT_FOUND 404", async () => {
    const POST = createAdminDataSourcePrecheckPost(testDb.db, {
      runSourcePrecheck: async () => {
        throw new AdminDataSourceNotFoundError(SOURCE_ID);
      },
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toEqual({ code: "SOURCE_NOT_FOUND", message: "Data source was not found." });
  });

  it("maps an unavailable crawler to PRECHECK_FAILED 502", async () => {
    const POST = createAdminDataSourcePrecheckPost(testDb.db, {
      runSourcePrecheck: async () => {
        throw new SourcePrecheckFailedError("Pre-check could not run the crawler: spawn python3 ENOENT");
      },
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("PRECHECK_FAILED");
  });

  it("rejects ordinary users through the shared admin guard", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError());
    const runSourcePrecheck = vi.fn(async () => PRECHECK_RESULT);
    const POST = createAdminDataSourcePrecheckPost(testDb.db, { runSourcePrecheck });

    const response = await POST(request(), context);

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(runSourcePrecheck).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before running anything", async () => {
    const runSourcePrecheck = vi.fn(async () => PRECHECK_RESULT);
    const POST = createAdminDataSourcePrecheckPost(testDb.db, { runSourcePrecheck });

    const response = await POST(
      new Request(`http://localhost/api/admin/data-sources/${SOURCE_ID}/precheck`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({}),
      }),
      context,
    );

    expect(response.status).toBe(403);
    expect(runSourcePrecheck).not.toHaveBeenCalled();
  });

  it("passes the MySQL store through when one is supplied", async () => {
    const runSourcePrecheck = vi.fn(async () => PRECHECK_RESULT);
    const mysql = { query: vi.fn(), execute: vi.fn() };
    const POST = createAdminDataSourcePrecheckPost(testDb.db, { runSourcePrecheck }, mysql as never);

    await POST(request(), context);

    expect(runSourcePrecheck).toHaveBeenCalledWith(expect.objectContaining({ mysql }));
  });
});
