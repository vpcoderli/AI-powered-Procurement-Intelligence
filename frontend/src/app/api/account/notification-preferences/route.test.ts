import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as preferencesService from "@/server/account/notification-preferences";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});
vi.mock("@/server/account/notification-preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/account/notification-preferences")>();

  return {
    ...actual,
    getAccountNotificationPreferences: vi.fn(),
    updateAccountNotificationPreferences: vi.fn(),
  };
});

const sessionUser: authService.PublicUser = {
  id: "user_1",
  email: "buyer@example.com",
  displayName: "Buyer",
  role: "user",
  tier: "pro",
  features: ["bid_search"],
};

const preferences: preferencesService.AccountNotificationPreferences = {
  userId: "user_1",
  savedSearchAlertsEnabled: true,
  defaultAlertFrequency: "daily",
  marketingUpdatesEnabled: false,
  createdAt: "2026-05-28T00:00:00.000Z",
  updatedAt: "2026-05-28T00:00:00.000Z",
};

describe("GET /api/account/notification-preferences", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current user's notification preferences", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(sessionUser);
    vi.mocked(preferencesService.getAccountNotificationPreferences).mockReturnValueOnce(preferences);

    const response = await GET(
      new Request("http://localhost/api/account/notification-preferences", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(preferences);
    expect(preferencesService.getAccountNotificationPreferences).toHaveBeenCalledWith({}, "user_1");
  });

  it("requires authentication", async () => {
    const response = await GET(new Request("http://localhost/api/account/notification-preferences"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});

describe("PATCH /api/account/notification-preferences", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates the current user's notification preferences", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(sessionUser);
    vi.mocked(preferencesService.updateAccountNotificationPreferences).mockReturnValueOnce({
      ...preferences,
      savedSearchAlertsEnabled: false,
      defaultAlertFrequency: "weekly",
      updatedAt: "2026-05-28T01:00:00.000Z",
    });

    const response = await PATCH(
      new Request("http://localhost/api/account/notification-preferences", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({
          savedSearchAlertsEnabled: false,
          defaultAlertFrequency: "weekly",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedSearchAlertsEnabled).toBe(false);
    expect(body.defaultAlertFrequency).toBe("weekly");
    expect(preferencesService.updateAccountNotificationPreferences).toHaveBeenCalledWith({}, "user_1", {
      savedSearchAlertsEnabled: false,
      defaultAlertFrequency: "weekly",
    });
  });
});
