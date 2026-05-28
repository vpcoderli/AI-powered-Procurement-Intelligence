import { afterEach, describe, expect, it, vi } from "vitest";
import * as passwordResetService from "@/server/auth/password-reset";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/password-reset", () => ({
  requestPasswordReset: vi.fn(),
}));

describe("POST /api/auth/password-reset/request", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
});
