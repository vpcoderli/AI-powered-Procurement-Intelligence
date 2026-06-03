import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as searchAlertService from "@/server/search-alerts/service";
import { SearchAlertNotFoundError, type SearchAlert, type SearchAlertDigestRun } from "@/server/search-alerts/types";
import { DELETE, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/search-alerts/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/search-alerts/service")>();

  return {
    ...actual,
    updateSearchAlert: vi.fn(),
    deleteSearchAlert: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const updateSearchAlert = vi.mocked(searchAlertService.updateSearchAlert);
const deleteSearchAlert = vi.mocked(searchAlertService.deleteSearchAlert);

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
  isEnabled: false,
  lastMatchedAt: null,
  lastNotifiedAt: null,
  digestHistory: [],
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:01.000Z",
};

describe("PATCH /api/search-alerts/[id]", () => {
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

  it("requires an authenticated principal before updating alerts", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/search-alerts/alert_1", {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: false }),
      }),
      { params: Promise.resolve({ id: "alert_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(updateSearchAlert).not.toHaveBeenCalled();
  });

  it("toggles isEnabled for the current authenticated principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    updateSearchAlert.mockResolvedValueOnce(alert);

    const response = await PATCH(
      new Request("http://localhost/api/search-alerts/alert_1", {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: false }),
      }),
      { params: Promise.resolve({ id: "alert_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ alert });
    expect(updateSearchAlert).toHaveBeenCalledWith(expect.anything(), "user_1", "alert_1", {
      isEnabled: false,
    });
  });

  it("returns INVALID_REQUEST for malformed body", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    const response = await PATCH(
      new Request("http://localhost/api/search-alerts/alert_1", {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: "nope" }),
      }),
      { params: Promise.resolve({ id: "alert_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateSearchAlert).not.toHaveBeenCalled();
  });

  it("returns ALERT_NOT_FOUND for missing alerts", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    updateSearchAlert.mockRejectedValueOnce(new SearchAlertNotFoundError());

    const response = await PATCH(
      new Request("http://localhost/api/search-alerts/missing", {
        method: "PATCH",
        body: JSON.stringify({ isEnabled: false }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toEqual({
      code: "ALERT_NOT_FOUND",
      message: "Search alert not found",
    });
  });
});

describe("DELETE /api/search-alerts/[id]", () => {
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

  it("requires an authenticated principal before deleting alerts", async () => {
    const response = await DELETE(new Request("http://localhost/api/search-alerts/alert_1"), {
      params: Promise.resolve({ id: "alert_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(deleteSearchAlert).not.toHaveBeenCalled();
  });

  it("deletes an alert for the current authenticated principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    deleteSearchAlert.mockResolvedValueOnce(undefined);

    const response = await DELETE(new Request("http://localhost/api/search-alerts/alert_1"), {
      params: Promise.resolve({ id: "alert_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({});
    expect(deleteSearchAlert).toHaveBeenCalledWith(expect.anything(), "user_1", "alert_1");
  });

  it("returns ALERT_NOT_FOUND for missing alerts", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    deleteSearchAlert.mockRejectedValueOnce(new SearchAlertNotFoundError());

    const response = await DELETE(new Request("http://localhost/api/search-alerts/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("ALERT_NOT_FOUND");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns a generic internal error without leaking details", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: [],
    });
    deleteSearchAlert.mockRejectedValueOnce(new Error("private stack detail"));

    const response = await DELETE(new Request("http://localhost/api/search-alerts/alert_1"), {
      params: Promise.resolve({ id: "alert_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private stack detail");
  });
});
