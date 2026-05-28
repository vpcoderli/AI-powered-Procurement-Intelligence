import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import { PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
    updateUserProfile: vi.fn(),
  };
});

describe("PATCH /api/account/profile", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates the current authenticated user's display name", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer One",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(authService.updateUserProfile).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer Two",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });

    const response = await PATCH(
      new Request("http://localhost/api/account/profile", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ displayName: "Buyer Two" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.displayName).toBe("Buyer Two");
    expect(authService.updateUserProfile).toHaveBeenCalledWith(expect.anything(), "user_1", {
      displayName: "Buyer Two",
    });
  });

  it("requires an authenticated session", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/account/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Buyer Two" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(authService.updateUserProfile).not.toHaveBeenCalled();
  });

  it("returns INVALID_REQUEST for unsupported profile fields", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer One",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });

    const response = await PATCH(
      new Request("http://localhost/api/account/profile", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ displayName: 123 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});
