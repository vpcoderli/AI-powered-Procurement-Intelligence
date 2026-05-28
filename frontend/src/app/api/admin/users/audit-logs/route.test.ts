import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as usersRepository from "@/server/admin/users-repository";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock("@/server/admin/users-repository", () => ({
  listAdminUserAuditLogs: vi.fn(),
}));

describe("GET /api/admin/users/audit-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent user audit logs for admins", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(usersRepository.listAdminUserAuditLogs).mockReturnValueOnce({
      logs: [
        {
          id: "audit_1",
          actorKind: "admin",
          actorUserId: "admin_1",
          targetUserId: "user_1",
          targetEmail: "buyer@example.com",
          action: "user_access_updated",
          changes: [{ field: "tier", before: "free", after: "pro" }],
          createdAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    });

    const response = await GET(new Request("http://localhost/api/admin/users/audit-logs?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs[0]).toEqual(expect.objectContaining({ id: "audit_1", targetEmail: "buyer@example.com" }));
    expect(usersRepository.listAdminUserAuditLogs).toHaveBeenCalledWith(expect.anything(), { limit: 10 });
  });

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdmin).mockRejectedValueOnce(new AdminAuthError());

    const response = await GET(new Request("http://localhost/api/admin/users/audit-logs"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
