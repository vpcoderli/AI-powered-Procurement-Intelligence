import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    changeUserPassword: vi.fn(),
    getSessionUser: vi.fn(),
  };
});

describe("POST /api/account/password", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("changes the current authenticated user's password", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer One",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(authService.changeUserPassword).mockResolvedValueOnce({ ok: true });

    const response = await POST(
      new Request("http://localhost/api/account/password", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({
          currentPassword: "strong-password",
          newPassword: "new-strong-password",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(authService.changeUserPassword).toHaveBeenCalledWith(expect.anything(), "user_1", {
      currentPassword: "strong-password",
      newPassword: "new-strong-password",
    });
  });

  it("returns INVALID_CREDENTIALS for the wrong current password", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: null,
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(authService.changeUserPassword).mockRejectedValueOnce(new authService.InvalidCredentialsError());

    const response = await POST(
      new Request("http://localhost/api/account/password", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({
          currentPassword: "wrong-password",
          newPassword: "new-strong-password",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns WEAK_PASSWORD for weak new passwords", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: null,
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(authService.changeUserPassword).mockRejectedValueOnce(new authService.WeakPasswordError());

    const response = await POST(
      new Request("http://localhost/api/account/password", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({
          currentPassword: "strong-password",
          newPassword: "short",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("WEAK_PASSWORD");
  });

  it("requires an authenticated session", async () => {
    const response = await POST(
      new Request("http://localhost/api/account/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: "strong-password",
          newPassword: "new-strong-password",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
