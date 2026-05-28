import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as dunningService from "@/server/billing/dunning";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});
vi.mock("@/server/billing/dunning", () => ({
  scheduleDunningReminders: vi.fn(),
}));

describe("POST /api/admin/billing/dunning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows admins to schedule due dunning reminders", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({ kind: "admin", role: "admin", userId: "admin_1" });
    vi.mocked(dunningService.scheduleDunningReminders).mockReturnValueOnce({
      checkedInvoices: 3,
      queued: 2,
      skippedAlreadyQueued: 1,
      skippedNotDue: 2,
      skippedResolved: 0,
      skippedNoRecipient: 0,
    });

    const response = await POST(
      new Request("http://localhost/api/admin/billing/dunning", {
        method: "POST",
        body: JSON.stringify({ limit: 50 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      checkedInvoices: 3,
      queued: 2,
      skippedAlreadyQueued: 1,
      skippedNotDue: 2,
      skippedResolved: 0,
      skippedNoRecipient: 0,
    });
    expect(dunningService.scheduleDunningReminders).toHaveBeenCalledWith({}, { limit: 50 });
  });

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockRejectedValueOnce(new AdminAuthError());

    const response = await POST(new Request("http://localhost/api/admin/billing/dunning", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
