import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as deliveryService from "@/server/notifications/delivery";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});
vi.mock("@/server/notifications/delivery", () => ({
  deliverPendingNotifications: vi.fn(),
}));

describe("POST /api/admin/notifications/deliver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows admins to deliver pending notifications", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({ kind: "admin", role: "admin", userId: "admin_1" });
    vi.mocked(deliveryService.deliverPendingNotifications).mockResolvedValueOnce({
      attempted: 2,
      sent: 1,
      failed: 1,
      skipped: 0,
    });

    const response = await POST(
      new Request("http://localhost/api/admin/notifications/deliver", {
        method: "POST",
        body: JSON.stringify({ limit: 10, maxAttempts: 4 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ attempted: 2, sent: 1, failed: 1, skipped: 0 });
    expect(deliveryService.deliverPendingNotifications).toHaveBeenCalledWith({}, undefined, {
      limit: 10,
      maxAttempts: 4,
    });
  });

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new AdminAuthError());

    const response = await POST(new Request("http://localhost/api/admin/notifications/deliver", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
