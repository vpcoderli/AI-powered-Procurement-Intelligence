import { describe, expect, it, vi, afterEach } from "vitest";
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
    registerUser: vi.fn(),
  };
});

describe("POST /api/auth/register", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets the session cookie", async () => {
    vi.mocked(authService.registerUser).mockResolvedValueOnce({
      user: { id: "user_1", email: "buyer@example.com", displayName: "Buyer One" },
      sessionToken: "sess_register",
    });

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: "buyer@example.com",
          password: "strong-password",
          displayName: "Buyer One",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.user.email).toBe("buyer@example.com");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=sess_register`);
  });

  it("merges anonymous saved bids and clears the anonymous cookie", async () => {
    vi.mocked(authService.registerUser).mockResolvedValueOnce({
      user: { id: "user_1", email: "buyer@example.com", displayName: "Buyer One" },
      sessionToken: "sess_register",
    });
    vi.mocked(bidRepository.mergeSavedBidIds).mockResolvedValueOnce(["1", "2"]);

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_old` },
        body: JSON.stringify({
          email: "buyer@example.com",
          password: "strong-password",
          displayName: "Buyer One",
        }),
      }),
    );
    const setCookie = response.headers.get("set-cookie");

    expect(response.status).toBe(201);
    expect(bidRepository.mergeSavedBidIds).toHaveBeenCalledWith({}, "anon_old", "user_1");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=sess_register`);
    expect(setCookie).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=`);
    expect(setCookie).toContain("Max-Age=0");
  });

  it("returns 409 for duplicate email", async () => {
    vi.mocked(authService.registerUser).mockRejectedValueOnce(new authService.DuplicateEmailError());

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com", password: "strong-password" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("returns 400 for weak passwords", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com", password: "short" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("WEAK_PASSWORD");
    expect(authService.registerUser).not.toHaveBeenCalled();
  });

  it("does not expose internal error details", async () => {
    vi.mocked(authService.registerUser).mockRejectedValueOnce(new Error("SQLITE_CONSTRAINT users.email"));

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
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
