import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as usageLimits from "@/server/auth/usage-limits";
import { UsageLimitError } from "@/server/auth/usage-limits";
import * as searchAlertService from "@/server/search-alerts/service";
import type { SearchAlert, SearchAlertDigestRun } from "@/server/search-alerts/types";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/auth/usage-limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/usage-limits")>();
  return {
    ...actual,
    enforceUsageLimit: vi.fn(),
  };
});
vi.mock("@/server/search-alerts/service", () => ({
  listSearchAlerts: vi.fn(),
  createSearchAlert: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const enforceUsageLimit = vi.mocked(usageLimits.enforceUsageLimit);
const listSearchAlerts = vi.mocked(searchAlertService.listSearchAlerts);
const createSearchAlert = vi.mocked(searchAlertService.createSearchAlert);

const alert: SearchAlert & { digestHistory: SearchAlertDigestRun[] } = {
  id: "alert_1",
  userId: "user_1",
  name: "Cloud bids",
  query: {
    q: "cloud",
    states: [],
    issuerType: "all",
    deadline: "any",
    published: "any",
    sort: "relevance",
  },
  frequency: "daily",
  isEnabled: true,
  lastMatchedAt: null,
  lastNotifiedAt: null,
  digestHistory: [
    {
      id: "digest_run_1",
      alertId: "alert_1",
      userId: "anon_new",
      frequency: "daily",
      status: "sent",
      matchCount: 1,
      notificationId: "notification_1",
      skippedReason: null,
      failureReason: null,
      matchedBidIds: ["bid_1"],
      createdAt: "2026-05-30T00:00:00.000Z",
    },
  ],
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z",
};

describe("GET /api/search-alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "anonymous",
      userId: "anon_existing",
      role: "user",
      tier: "free",
      features: [],
    });
  });

  it("requires an authenticated principal", async () => {
    const response = await GET(new Request("http://localhost/api/search-alerts"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(listSearchAlerts).not.toHaveBeenCalled();
  });

  it("returns alerts for authenticated users without setting an anonymous cookie", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    listSearchAlerts.mockResolvedValueOnce([alert]);

    const response = await GET(new Request("http://localhost/api/search-alerts"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ alerts: [alert] });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(listSearchAlerts).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("returns a generic internal error without leaking details", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    listSearchAlerts.mockRejectedValueOnce(new Error("sqlite exploded"));

    const response = await GET(new Request("http://localhost/api/search-alerts"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
    expect(JSON.stringify(body)).not.toContain("sqlite exploded");
  });
});

describe("POST /api/search-alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "anonymous",
      userId: "anon_existing",
      role: "user",
      tier: "free",
      features: [],
    });
  });

  it("requires an authenticated principal before creating alerts", async () => {
    const input = {
      name: "Cloud bids",
      query: alert.query,
      frequency: "daily",
      isEnabled: true,
    };
    const response = await POST(
      new Request("http://localhost/api/search-alerts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(enforceUsageLimit).not.toHaveBeenCalled();
    expect(createSearchAlert).not.toHaveBeenCalled();
  });

  it("creates an alert for the current authenticated principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    createSearchAlert.mockResolvedValueOnce(alert);

    const input = {
      name: "Cloud bids",
      query: alert.query,
      frequency: "daily",
      isEnabled: true,
    };
    const response = await POST(
      new Request("http://localhost/api/search-alerts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ alert });
    expect(enforceUsageLimit).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      tier: "free",
      feature: "search_alerts",
    });
    expect(createSearchAlert).toHaveBeenCalledWith(expect.anything(), "user_1", input);
  });

  it("returns USAGE_LIMIT_REACHED when the principal exceeds the alert quota", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    enforceUsageLimit.mockImplementationOnce(() => {
      throw new UsageLimitError({
        feature: "search_alerts",
        tier: "free",
        used: 2,
        limit: 2,
        requiredTier: "pro",
      });
    });

    const response = await POST(
      new Request("http://localhost/api/search-alerts", {
        method: "POST",
        body: JSON.stringify({
          name: "More alerts",
          query: alert.query,
          frequency: "daily",
          isEnabled: true,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toEqual({
      code: "USAGE_LIMIT_REACHED",
      message: "Upgrade your plan to create more search alerts.",
      feature: "search_alerts",
      limit: 2,
      used: 2,
      requiredTier: "pro",
    });
    expect(createSearchAlert).not.toHaveBeenCalled();
  });

  it("returns INVALID_REQUEST for malformed JSON", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    const response = await POST(
      new Request("http://localhost/api/search-alerts", {
        method: "POST",
        body: "{",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(createSearchAlert).not.toHaveBeenCalled();
  });

  it("returns INVALID_REQUEST when required fields are missing", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    const response = await POST(
      new Request("http://localhost/api/search-alerts", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(createSearchAlert).not.toHaveBeenCalled();
  });
});
