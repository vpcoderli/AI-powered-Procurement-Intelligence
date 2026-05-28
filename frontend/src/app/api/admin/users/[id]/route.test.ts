import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import * as usersRepository from "@/server/admin/users-repository";
import { PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock("@/server/admin/users-repository", () => ({
  updateAdminUser: vi.fn(),
}));

describe("PATCH /api/admin/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminAuth.requireAdmin).mockResolvedValue({ kind: "admin", userId: "admin_1" });
  });

  it("updates role, tier, and disabled state", async () => {
    vi.mocked(usersRepository.updateAdminUser).mockReturnValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "admin",
      tier: "business",
      isDisabled: true,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
      lastLoginAt: null,
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/users/user_1", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin", tier: "business", isDisabled: true }),
      }),
      { params: Promise.resolve({ id: "user_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toEqual(expect.objectContaining({
      id: "user_1",
      role: "admin",
      tier: "business",
      isDisabled: true,
    }));
    expect(usersRepository.updateAdminUser).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      { role: "admin", tier: "business", isDisabled: true },
      { actorKind: "admin", actorUserId: "admin_1" },
    );
  });

  it("returns INVALID_REQUEST for unsupported roles", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/users/user_1", {
        method: "PATCH",
        body: JSON.stringify({ role: "owner" }),
      }),
      { params: Promise.resolve({ id: "user_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(usersRepository.updateAdminUser).not.toHaveBeenCalled();
  });
});
