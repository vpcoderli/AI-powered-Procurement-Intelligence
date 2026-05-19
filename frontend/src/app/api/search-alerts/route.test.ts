import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as searchAlertService from "@/server/search-alerts/service";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/search-alerts/service", () => ({
  listSearchAlerts: vi.fn(),
  createSearchAlert: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
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
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_existing" });
  });

  it("returns alerts and sets an anonymous cookie for a new anonymous user", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_new",
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
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1" });
    listSearchAlerts.mockResolvedValueOnce([]);

    const response = await GET(new Request("http://localhost/api/search-alerts"));

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(listSearchAlerts).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("returns a generic internal error without leaking details", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "anonymous", userId: "anon_existing" });
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
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_existing" });
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
    expect(createSearchAlert).toHaveBeenCalledWith(expect.anything(), "anon_existing", input);
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
