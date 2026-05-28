import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as bidRepository from "@/server/bids/repository";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/bids/repository", () => ({
  mergeSavedBidIds: vi.fn(),
}));
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
      user: {
        id: "user_1",
        email: "buyer@example.com",
        displayName: null,
        role: "user",
        tier: "free",
        features: ["bid_search"],
      },
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

  it("merges anonymous saved bids and clears the anonymous cookie", async () => {
    vi.mocked(authService.loginUser).mockResolvedValueOnce({
      user: {
        id: "user_1",
        email: "buyer@example.com",
        displayName: null,
        role: "user",
        tier: "free",
        features: ["bid_search"],
      },
      sessionToken: "sess_login",
    });
    vi.mocked(bidRepository.mergeSavedBidIds).mockResolvedValueOnce(["1", "2"]);

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_old` },
        body: JSON.stringify({ email: "buyer@example.com", password: "strong-password" }),
      }),
    );
    const setCookie = response.headers.get("set-cookie");

    expect(response.status).toBe(200);
    expect(bidRepository.mergeSavedBidIds).toHaveBeenCalledWith({}, "anon_old", "user_1");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=sess_login`);
    expect(setCookie).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
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

  it("returns 403 for disabled accounts", async () => {
    vi.mocked(authService.loginUser).mockRejectedValueOnce(new authService.AccountDisabledError());

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com", password: "strong-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("ACCOUNT_DISABLED");
  });

  it("does not expose internal error details", async () => {
    vi.mocked(authService.loginUser).mockRejectedValueOnce(new Error("SQLITE_CONSTRAINT users.email"));

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com", password: "strong-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });
});
