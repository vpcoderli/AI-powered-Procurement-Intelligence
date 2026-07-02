import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExpiredPasswordResetTokenError,
  InvalidPasswordResetTokenError,
} from "@/server/auth/password-reset";
import * as passwordResetService from "@/server/auth/password-reset";
import { WeakPasswordError } from "@/server/auth/service";
import { loginGuard } from "@/server/security/login-guard";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/password-reset", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/password-reset")>();

  return {
    ...actual,
    resetPasswordWithToken: vi.fn(),
  };
});
vi.mock("@/server/security/login-guard", () => ({
  loginGuard: {
    checkPasswordResetConfirmAllowed: vi.fn(() => ({ blocked: false })),
  },
}));

describe("POST /api/auth/password-reset/confirm", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(loginGuard.checkPasswordResetConfirmAllowed).mockReturnValue({ blocked: false });
  });

  it("confirms a password reset token", async () => {
    vi.mocked(passwordResetService.resetPasswordWithToken).mockResolvedValueOnce({ ok: true });

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token: "reset_valid", password: "new-strong-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(passwordResetService.resetPasswordWithToken).toHaveBeenCalledWith(
      {},
      "reset_valid",
      "new-strong-password",
    );
  });

  it("maps invalid and expired tokens to INVALID_RESET_TOKEN", async () => {
    vi.mocked(passwordResetService.resetPasswordWithToken)
      .mockRejectedValueOnce(new InvalidPasswordResetTokenError())
      .mockRejectedValueOnce(new ExpiredPasswordResetTokenError());

    const invalid = await POST(
      new Request("http://localhost/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token: "reset_invalid", password: "new-strong-password" }),
      }),
    );
    const expired = await POST(
      new Request("http://localhost/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token: "reset_expired", password: "new-strong-password" }),
      }),
    );

    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("INVALID_RESET_TOKEN");
    expect(expired.status).toBe(400);
    expect((await expired.json()).error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("returns WEAK_PASSWORD for weak new passwords", async () => {
    vi.mocked(passwordResetService.resetPasswordWithToken).mockRejectedValueOnce(
      new WeakPasswordError(),
    );

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token: "reset_valid", password: "short" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("WEAK_PASSWORD");
  });

  it("returns 429 with a Retry-After header when the login guard blocks the request", async () => {
    vi.mocked(loginGuard.checkPasswordResetConfirmAllowed).mockReturnValueOnce({
      blocked: true,
      reason: "rate_limited",
      retryAfterSeconds: 45,
    });

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token: "reset_valid", password: "new-strong-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("45");
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(passwordResetService.resetPasswordWithToken).not.toHaveBeenCalled();
  });
});
