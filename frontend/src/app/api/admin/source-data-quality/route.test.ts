import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import * as quality from "@/server/source-validity/source-data-quality";
import { createAdminSourceDataQualityGet } from "./route";

vi.mock("@/server/admin/auth", async (original) => ({ ...await original<typeof import("@/server/admin/auth")>(), requireAdminAccess: vi.fn() }));
vi.mock("@/server/source-validity/source-data-quality", () => ({ createSourceDataQualityReport: vi.fn(), createSourceDataQualityReportFromMysql: vi.fn() }));
const database = {} as AppDatabase;
const report = { checkedAt: "2026-10-01T00:00:00.000Z", summary: { totalSources: 0, usableSources: 0, degradedSources: 0, unknownSources: 0, verifiedEmptySources: 0 }, segments: [], rows: [], unattributedBidCount: 0 };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireAdminAccess).mockResolvedValue({} as never); });

describe("GET /api/admin/source-data-quality", () => {
  it("returns the read-only all-source report to console readers", async () => {
    vi.mocked(quality.createSourceDataQualityReport).mockResolvedValue(report);
    const request = new Request("http://localhost/api/admin/source-data-quality");
    const response = await createAdminSourceDataQualityGet({ database })(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report });
    expect(requireAdminAccess).toHaveBeenCalledWith(database, request, { roles: ["admin", "operator", "support"] });
  });
  it("uses the MySQL report when supplied without opening a SQLite business database", async () => {
    const mysql = { query: vi.fn() };
    vi.mocked(quality.createSourceDataQualityReportFromMysql).mockResolvedValue(report);
    const response = await createAdminSourceDataQualityGet({ database, mysql })(new Request("http://localhost/api/admin/source-data-quality"));
    expect(response.status).toBe(200);
    expect(quality.createSourceDataQualityReportFromMysql).toHaveBeenCalledWith(mysql);
    expect(quality.createSourceDataQualityReport).not.toHaveBeenCalled();
  });
  it("rejects unauthorized readers", async () => {
    vi.mocked(requireAdminAccess).mockRejectedValue(new AdminAuthError("Forbidden"));
    const response = await createAdminSourceDataQualityGet({ database })(new Request("http://localhost/api/admin/source-data-quality"));
    expect(response.status).toBe(403);
    expect(quality.createSourceDataQualityReport).not.toHaveBeenCalled();
  });
});
