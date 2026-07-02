import { afterEach, describe, expect, it, vi } from "vitest";
import * as passwordResetService from "@/server/auth/password-reset";
import { loginGuard } from "@/server/security/login-guard";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/password-reset", () => ({
  requestPasswordReset: vi.fn(),
}));
vi.mock("@/server/security/login-guard", () => ({
  loginGuard: {
    checkPasswordResetRequestAllowed: vi.fn(() => ({ blocked: false })),
  },
}));

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

describe("POST /api/auth/password-reset/request", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(loginGuard.checkPasswordResetRequestAllowed).mockReturnValue({ blocked: false });
    setNodeEnv(ORIGINAL_NODE_ENV);
  });

  it("returns a generic ok response with a local reset token when one is generated", async () => {
    vi.mocked(passwordResetService.requestPasswordReset).mockResolvedValueOnce({
      ok: true,
      resetToken: "reset_local",
      expiresAt: "2026-05-28T12:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      resetToken: "reset_local",
      expiresAt: "2026-05-28T12:00:00.000Z",
    });
    expect(passwordResetService.requestPasswordReset).toHaveBeenCalledWith({}, "buyer@example.com");
  });

  it("returns the same generic ok response for unknown email addresses", async () => {
    vi.mocked(passwordResetService.requestPasswordReset).mockResolvedValueOnce({ ok: true });

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: "missing@example.com" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("rejects malformed requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: "" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 429 with a Retry-After header when the login guard blocks the request", async () => {
    vi.mocked(loginGuard.checkPasswordResetRequestAllowed).mockReturnValueOnce({
      blocked: true,
      reason: "rate_limited",
      retryAfterSeconds: 120,
    });

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(passwordResetService.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("never includes resetToken or expiresAt in the response body in production", async () => {
    setNodeEnv("production");
    vi.mocked(passwordResetService.requestPasswordReset).mockResolvedValueOnce({
      ok: true,
      resetToken: "reset_should_not_leak",
      expiresAt: "2026-05-28T12:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(JSON.stringify(body)).not.toContain("reset_should_not_leak");
  });
});
