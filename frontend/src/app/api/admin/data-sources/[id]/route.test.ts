import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import * as adminAuth from "@/server/admin/auth";
import { createAdminDataSourcePatch } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});

const NOW = "2026-05-19T00:00:00.000Z";

describe("PATCH /api/admin/data-sources/[id]", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({
      kind: "admin",
      role: "admin",
      userId: "admin_1",
    });
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
    vi.clearAllMocks();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("updates data source enablement", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({
      kind: "admin",
      role: "operator",
      userId: "operator_1",
    });
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
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.anything(), {
      roles: ["admin", "operator"],
    });
    expect(body).toEqual({ source: expect.objectContaining({ id: "sam_gov", isEnabled: false }) });
  });

  it("updates data source approval governance", async () => {
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({
          approvedForIngestion: true,
          approvalStatus: "approved",
          legalReviewStatus: "approved_public",
          approvalNotes: "Approved after live health and source review.",
        }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.anything(), { roles: ["admin"] });
    expect(body).toEqual({
      source: expect.objectContaining({
        id: "sam_gov",
        approvedForIngestion: true,
        approvalStatus: "approved",
        legalReviewStatus: "approved_public",
        approvalNotes: "Approved after live health and source review.",
        lastApprovalReviewedAt: expect.any(String),
        approvalHistory: [
          expect.objectContaining({
            actorUserId: "admin_1",
            action: "approved",
            previousApprovalStatus: "approved",
            nextApprovalStatus: "approved",
            reason: "Approved after live health and source review.",
          }),
        ],
      }),
    });
  });

  it("allows operators to update live source health triage fields", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({
      kind: "admin",
      role: "operator",
      userId: "operator_1",
    });
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({
          liveHealthOwner: "operator_1",
          liveHealthDisposition: "needs_manual_triage",
          liveHealthNextReviewAt: "2026-06-15T00:00:00.000Z",
          liveHealthNotes: "Credential-like password=secret should be redacted.",
        }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledTimes(1);
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.anything(), {
      roles: ["admin", "operator"],
    });
    expect(body).toEqual({
      source: expect.objectContaining({
        id: "sam_gov",
        liveHealthOwner: "operator_1",
        liveHealthDisposition: "needs_manual_triage",
        liveHealthNextReviewAt: "2026-06-15T00:00:00.000Z",
        liveHealthNotes: "Credential-like password=[REDACTED] should be redacted.",
        liveHealthReviewedAt: expect.any(String),
      }),
    });
  });

  it("rejects ordinary users before live source health triage updates", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError("Admin access is required."));
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({ liveHealthDisposition: "needs_manual_triage" }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.anything(), {
      roles: ["admin", "operator"],
    });
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

  it("rejects operator attempts to update source approval governance fields", async () => {
    vi.mocked(adminAuth.requireAdminAccess)
      .mockResolvedValueOnce({
        kind: "admin",
        role: "operator",
        userId: "operator_1",
      })
      .mockRejectedValueOnce(new adminAuth.AdminAuthError("Admin access is required."));
    const PATCH = createAdminDataSourcePatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/data-sources/sam_gov", {
        method: "PATCH",
        body: JSON.stringify({ approvalStatus: "approved" }),
      }),
      { params: Promise.resolve({ id: "sam_gov" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
    expect(adminAuth.requireAdminAccess).toHaveBeenNthCalledWith(1, testDb.db, expect.anything(), {
      roles: ["admin", "operator"],
    });
    expect(adminAuth.requireAdminAccess).toHaveBeenNthCalledWith(2, testDb.db, expect.anything(), {
      roles: ["admin"],
    });
  });
});
