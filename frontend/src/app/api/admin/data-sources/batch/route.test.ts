import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import { dataSources, sourceApprovalEvents } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminDataSourcesBatchPost } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});

const NOW = "2026-05-19T00:00:00.000Z";

describe("POST /api/admin/data-sources/batch", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({
      kind: "admin",
      role: "admin",
      userId: "admin_1",
    });
    testDb.db
      .insert(dataSources)
      .values([
        {
          id: "ca_caleprocure",
          label: "California Cal eProcure",
          issuerType: "state",
          stateCode: "CA",
          isEnabled: 1,
          cadence: "daily",
          approvedForIngestion: 0,
          approvalStatus: "needs_review",
          legalReviewStatus: "not_reviewed",
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "tx_esbd",
          label: "Texas ESBD",
          issuerType: "state",
          stateCode: "TX",
          isEnabled: 1,
          cadence: "daily",
          approvedForIngestion: 0,
          approvalStatus: "needs_review",
          legalReviewStatus: "not_reviewed",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ])
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.clearAllMocks();
  });

  it("approves selected data sources and records approval history", async () => {
    const POST = createAdminDataSourcesBatchPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/admin/data-sources/batch", {
        method: "POST",
        body: JSON.stringify({
          sourceIds: ["ca_caleprocure", "tx_esbd"],
          action: "approve",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.any(Request), { roles: ["admin"] });
    expect(body).toEqual({
      updatedCount: 2,
      sources: [
        expect.objectContaining({
          id: "ca_caleprocure",
          approvedForIngestion: true,
          approvalStatus: "approved",
          legalReviewStatus: "approved_public",
          approvalHistory: [expect.objectContaining({ actorUserId: "admin_1", action: "approved" })],
        }),
        expect.objectContaining({
          id: "tx_esbd",
          approvedForIngestion: true,
          approvalStatus: "approved",
          legalReviewStatus: "approved_public",
          approvalHistory: [expect.objectContaining({ actorUserId: "admin_1", action: "approved" })],
        }),
      ],
    });
    expect(testDb.db.select().from(sourceApprovalEvents).all()).toHaveLength(2);
  });

  it("rejects malformed batch requests before requiring admin access", async () => {
    const POST = createAdminDataSourcesBatchPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/admin/data-sources/batch", {
        method: "POST",
        body: JSON.stringify({ sourceIds: [], action: "approve" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(adminAuth.requireAdminAccess).not.toHaveBeenCalled();
  });

  it("requires full admin access for batch approval actions", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError("Admin access is required."));
    const POST = createAdminDataSourcesBatchPost(testDb.db);
    const response = await POST(
      new Request("http://localhost/api/admin/data-sources/batch", {
        method: "POST",
        body: JSON.stringify({ sourceIds: ["ca_caleprocure"], action: "hold" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });
});
