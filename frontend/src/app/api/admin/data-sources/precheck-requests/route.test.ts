import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminPrecheckRequestsPost } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});

const NOW = "2026-09-29T08:00:00.000Z";

function sourceRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    issuerType: "county",
    stateCode: "MI",
    baseUrl: `https://www.bidnetdirect.com/mitn/${id}/solicitations/open-bids`,
    providerFamily: "bidnet",
    jurisdictionLevel: "county",
    isEnabled: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function request(body?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/data-sources/precheck-requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("POST /api/admin/data-sources/precheck-requests", () => {
  let testDb: TestDatabase;

  function queuedIds() {
    return testDb.db
      .select({ id: dataSources.id, precheckRequestedAt: dataSources.precheckRequestedAt })
      .from(dataSources)
      .all()
      .filter((row) => row.precheckRequestedAt !== null)
      .map((row) => row.id)
      .sort();
  }

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({ kind: "admin", role: "operator", userId: "op_1" });
    testDb.db
      .insert(dataSources)
      .values([
        sourceRow("bidnet_mi_a"),
        sourceRow("bidnet_mi_b"),
        sourceRow("bidnet_mi_c", { approvalStatus: "approved" }),
        sourceRow("bonfire_oh_d", { providerFamily: "bonfire" }),
      ])
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.clearAllMocks();
  });

  it("marks the pending sources of a family for the worker", async () => {
    const POST = createAdminPrecheckRequestsPost(testDb.db);

    const response = await POST(request({ providerFamily: "bidnet", pending: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requestedCount: 2, sourceIds: ["bidnet_mi_a", "bidnet_mi_b"] });
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.any(Request), {
      roles: ["admin", "operator"],
    });
    expect(queuedIds()).toEqual(["bidnet_mi_a", "bidnet_mi_b"]);

    // Idempotent: a second click queues nothing new.
    const again = await POST(request({ providerFamily: "bidnet", pending: true }));
    expect(await again.json()).toEqual({ requestedCount: 0, sourceIds: [] });
  });

  it("answers an empty result for ids that do not exist", async () => {
    const POST = createAdminPrecheckRequestsPost(testDb.db);

    const response = await POST(request({ sourceIds: ["x"] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requestedCount: 0, sourceIds: [] });
    expect(queuedIds()).toEqual([]);
  });

  it("rejects a body that names neither ids nor a pending family", async () => {
    const POST = createAdminPrecheckRequestsPost(testDb.db);

    for (const body of [{}, { providerFamily: "bidnet" }, { sourceIds: [] }, undefined]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    }
    expect(queuedIds()).toEqual([]);
  });

  it("rejects cross-origin requests before touching the queue", async () => {
    const POST = createAdminPrecheckRequestsPost(testDb.db);

    const response = await POST(request({ sourceIds: ["bidnet_mi_a"] }, { origin: "https://evil.example" }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CSRF_VALIDATION_FAILED");
    expect(adminAuth.requireAdminAccess).not.toHaveBeenCalled();
    expect(queuedIds()).toEqual([]);
  });

  it("refuses the support role through the shared admin guard", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError());
    const POST = createAdminPrecheckRequestsPost(testDb.db);

    const response = await POST(request({ providerFamily: "bidnet", pending: true }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toEqual({ code: "FORBIDDEN", message: "Admin access is required." });
    // The guard is asked for admin/operator only, so a support session can never pass it.
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.any(Request), {
      roles: ["admin", "operator"],
    });
    expect(queuedIds()).toEqual([]);
  });

  it("uses the MySQL twin when a MySQL store is supplied", async () => {
    const query = vi.fn<(sql: string, values?: unknown[]) => Promise<unknown[][]>>(async () => [
      [
        {
          id: "bidnet_mi_a",
          provider_family: "bidnet",
          jurisdiction_level: "county",
          approval_status: null,
          is_enabled: 1,
          live_health_reviewed_at: null,
          precheck_requested_at: null,
        },
      ],
    ]);
    const execute = vi.fn<(sql: string, values?: never[]) => Promise<Array<{ affectedRows: number }>>>(async () => [{ affectedRows: 1 }]);
    const POST = createAdminPrecheckRequestsPost(testDb.db, { query, execute } as never);

    const response = await POST(request({ providerFamily: "bidnet", pending: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requestedCount: 1, sourceIds: ["bidnet_mi_a"] });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0][0])).toContain("UPDATE data_sources SET precheck_requested_at = ?");
    // The SQLite rows are untouched: MySQL mode never falls back to Drizzle.
    expect(queuedIds()).toEqual([]);
  });
});
