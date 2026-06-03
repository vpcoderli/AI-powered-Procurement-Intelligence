import { describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import type { RiskChecklistReport } from "@/server/risk/checklist";
import { createTestDatabase } from "@/server/db/test-utils";
import { createAdminRiskCheckGet } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();

  return {
    ...actual,
    requireAdminAccess: vi.fn(),
  };
});

const report: RiskChecklistReport = {
  ok: true,
  checkedAt: "2026-06-01T00:00:00.000Z",
  checks: [
    {
      id: "state-coverage",
      label: "50 state data coverage",
      ok: true,
      summary: "50/50 required states have at least one active bid",
    },
  ],
};

describe("GET /api/admin/risk-check", () => {
  it("denies requests without admin console access", async () => {
    const testDb = await createTestDatabase();

    try {
      vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new adminAuth.AdminAuthError());
      const GET = createAdminRiskCheckGet(testDb.db, async () => report);

      const response = await GET(new Request("http://localhost/api/admin/risk-check"));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns the risk checklist report for admin console readers", async () => {
    const testDb = await createTestDatabase();
    const createReport = vi.fn().mockResolvedValue(report);

    try {
      vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({
        kind: "admin",
        role: "support",
        userId: "support_1",
      });
      const GET = createAdminRiskCheckGet(testDb.db, createReport);

      const response = await GET(new Request("http://localhost/api/admin/risk-check"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.report).toEqual(report);
      expect(body.history).toEqual([
        expect.objectContaining({
          ok: true,
          checkedAt: report.checkedAt,
          report,
        }),
      ]);
      expect(body.trend).toEqual(expect.objectContaining({
        snapshotCount: 1,
      }));
      expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(testDb.db, expect.anything(), {
        roles: ["admin", "operator", "support"],
      });
      expect(createReport).toHaveBeenCalledWith(testDb.db);
    } finally {
      await testDb.cleanup();
    }
  });
});
