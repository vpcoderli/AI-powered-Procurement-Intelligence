import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as usersRepository from "@/server/admin/users-repository";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock("@/server/admin/users-repository", () => ({
  createAdminUserInvite: vi.fn(),
  listAdminUsers: vi.fn(),
}));

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns users for admins", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(usersRepository.listAdminUsers).mockReturnValueOnce({
      users: [{
        id: "user_1",
        email: "buyer@example.com",
        displayName: "Buyer",
        role: "user",
        tier: "free",
        isDisabled: false,
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
        lastLoginAt: null,
      }],
    });

    const response = await GET(new Request("http://localhost/api/admin/users?q=buyer&role=user&tier=free&status=enabled"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users[0]).toEqual(expect.objectContaining({
      email: "buyer@example.com",
      tier: "free",
      role: "user",
    }));
    expect(usersRepository.listAdminUsers).toHaveBeenCalledWith(expect.anything(), {
      q: "buyer",
      role: "user",
      tier: "free",
      status: "enabled",
    });
  });

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdmin).mockRejectedValueOnce(new AdminAuthError());

    const response = await GET(new Request("http://localhost/api/admin/users"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates invited users for admins", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(usersRepository.createAdminUserInvite).mockResolvedValueOnce({
      temporaryPassword: "temp-password-123",
      user: {
        id: "user_2",
        email: "newbuyer@example.com",
        displayName: "New Buyer",
        role: "user",
        tier: "pro",
        isDisabled: false,
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
        lastLoginAt: null,
      },
    });

    const response = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "newbuyer@example.com",
          displayName: "New Buyer",
          role: "user",
          tier: "pro",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      temporaryPassword: "temp-password-123",
      user: expect.objectContaining({
        email: "newbuyer@example.com",
        tier: "pro",
      }),
    });
    expect(usersRepository.createAdminUserInvite).toHaveBeenCalledWith(
      expect.anything(),
      {
        email: "newbuyer@example.com",
        displayName: "New Buyer",
        role: "user",
        tier: "pro",
      },
      { actorKind: "admin", actorUserId: "admin_1" },
    );
  });

  it("rejects invalid invited user input", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });

    const response = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: "", role: "owner", tier: "pro" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(usersRepository.createAdminUserInvite).not.toHaveBeenCalled();
  });
});
