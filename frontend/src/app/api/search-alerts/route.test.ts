import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as usageLimits from "@/server/auth/usage-limits";
import { UsageLimitError } from "@/server/auth/usage-limits";
import * as searchAlertService from "@/server/search-alerts/service";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
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

const alert = {
  id: "alert_1",
  userId: "anon_new",
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
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z",
} as const;

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

  it("returns alerts and sets an anonymous cookie for a new anonymous user", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_new",
      role: "user",
      tier: "free",
      features: [],
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_new; Path=/`,
    });
    listSearchAlerts.mockResolvedValueOnce([alert]);

    const response = await GET(new Request("http://localhost/api/search-alerts"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ alerts: [alert] });
    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_new`);
    expect(listSearchAlerts).toHaveBeenCalledWith(expect.anything(), "anon_new");
  });

  it("does not set a cookie for authenticated users", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    listSearchAlerts.mockResolvedValueOnce([]);

    const response = await GET(new Request("http://localhost/api/search-alerts"));

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(listSearchAlerts).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("returns a generic internal error without leaking details", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_existing",
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

  it("creates an alert for the current principal", async () => {
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
      userId: "anon_existing",
      tier: "free",
      feature: "search_alerts",
    });
    expect(createSearchAlert).toHaveBeenCalledWith(expect.anything(), "anon_existing", input);
  });

  it("returns USAGE_LIMIT_REACHED when the principal exceeds the alert quota", async () => {
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
