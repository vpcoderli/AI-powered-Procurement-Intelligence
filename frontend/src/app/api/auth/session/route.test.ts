import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});

describe("GET /api/auth/session", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a null user without a valid session", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_missing` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ user: null });
  });

  it("returns the authenticated user's role, tier, and features", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "pro",
      features: ["bid_search", "submission_guidance"],
      workspace: {
        organizationId: "org_1",
        organizationName: "Acme Federal Team",
        role: "owner",
      },
    });

    const response = await GET(
      new Request("http://localhost/api/auth/session", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: {
        id: "user_1",
        email: "buyer@example.com",
        displayName: "Buyer",
        role: "user",
        tier: "pro",
        features: ["bid_search", "submission_guidance"],
        workspace: {
          organizationId: "org_1",
          organizationName: "Acme Federal Team",
          role: "owner",
        },
      },
    });
  });
});
