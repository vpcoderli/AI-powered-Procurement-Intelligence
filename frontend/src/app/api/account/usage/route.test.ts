import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as usageService from "@/server/account/usage";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});
vi.mock("@/server/account/usage", () => ({
  getAccountUsage: vi.fn(),
}));

describe("GET /api/account/usage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns current account usage for authenticated users", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(usageService.getAccountUsage).mockReturnValueOnce({
      tier: "free",
      workspaceUserIds: ["user_1"],
      creditSummary: {
        includedMonthlyCredits: 0,
        purchasedCredits: 0,
        availableCredits: 0,
        resetsAt: null,
      },
      items: [
        {
          feature: "saved_bids",
          used: 2,
          limit: 5,
          remaining: 3,
          isLimited: false,
          requiredTier: "pro",
        },
        {
          feature: "search_alerts",
          used: 1,
          limit: 2,
          remaining: 1,
          isLimited: false,
          requiredTier: "pro",
        },
        {
          feature: "team_members",
          used: 1,
          limit: 1,
          remaining: 0,
          isLimited: true,
          requiredTier: "business",
        },
      ],
    });

    const response = await GET(
      new Request("http://localhost/api/account/usage", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0].feature).toBe("saved_bids");
    expect(usageService.getAccountUsage).toHaveBeenCalledWith({}, "user_1");
  });

  it("requires authentication", async () => {
    const response = await GET(new Request("http://localhost/api/account/usage"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
