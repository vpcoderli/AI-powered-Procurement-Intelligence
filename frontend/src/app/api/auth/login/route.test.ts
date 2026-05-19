import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    loginUser: vi.fn(),
  };
});

describe("POST /api/auth/login", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets the session cookie", async () => {
    vi.mocked(authService.loginUser).mockResolvedValueOnce({
      user: { id: "user_1", email: "buyer@example.com", displayName: null },
      sessionToken: "sess_login",
    });

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com", password: "strong-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.email).toBe("buyer@example.com");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=sess_login`);
  });

  it("returns 401 for the wrong password", async () => {
    vi.mocked(authService.loginUser).mockRejectedValueOnce(new authService.InvalidCredentialsError());

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com", password: "wrong-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });
});
