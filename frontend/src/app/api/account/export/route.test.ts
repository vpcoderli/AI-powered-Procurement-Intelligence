import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as lifecycleService from "@/server/account/lifecycle";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});
vi.mock("@/server/account/lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/account/lifecycle")>();

  return {
    ...actual,
    exportAccountData: vi.fn(),
  };
});

describe("GET /api/account/export", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exports the authenticated user's account data", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(lifecycleService.exportAccountData).mockReturnValueOnce({
      generatedAt: "2026-05-28T00:00:00.000Z",
      account: {
        id: "user_1",
        email: "buyer@example.com",
        displayName: "Buyer",
        role: "user",
        tier: "free",
        isDisabled: false,
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
        lastLoginAt: null,
      },
      workspace: null,
      subscription: null,
      billingCheckoutSessions: [],
      billingInvoices: [],
      subscriptionEvents: [],
      savedBids: [],
      supplierProfile: null,
      intents: [],
      submissionPaths: [],
      submissionConfirmations: [],
      complianceManifestItems: [],
      pursuitDecisions: [],
      searchAlerts: [],
    });

    const response = await GET(
      new Request("http://localhost/api/account/export", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("winbids-account-export-user_1.json");
    expect(body.account.email).toBe("buyer@example.com");
    expect(lifecycleService.exportAccountData).toHaveBeenCalledWith({}, "user_1");
  });

  it("requires authentication", async () => {
    const response = await GET(new Request("http://localhost/api/account/export"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
