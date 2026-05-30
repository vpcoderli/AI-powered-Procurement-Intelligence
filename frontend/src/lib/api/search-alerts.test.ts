import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createSearchAlert,
  deleteSearchAlert,
  listSearchAlerts,
  updateSearchAlert,
} from "./search-alerts";
import type { SearchAlert } from "@/server/search-alerts/types";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

const alert: SearchAlert = {
  id: "alert_1",
  userId: "anon_existing",
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
      userId: "anon_existing",
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

describe("search alerts API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists search alerts", async () => {
    const body = { alerts: [alert] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await listSearchAlerts();

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/search-alerts");
  });

  it("creates a search alert", async () => {
    const input = {
      name: "Cloud bids",
      query: alert.query,
      frequency: "daily" as const,
      isEnabled: true,
    };
    const body = { alert };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await createSearchAlert(input);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/search-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updates a search alert", async () => {
    const body = { alert: { ...alert, isEnabled: false } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateSearchAlert("alert 1", { isEnabled: false });

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/search-alerts/alert%201", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: false }),
    });
  });

  it("deletes a search alert", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    await deleteSearchAlert("alert 1");

    expect(mockFetch).toHaveBeenCalledWith("/api/search-alerts/alert%201", {
      method: "DELETE",
    });
  });

  it("throws ApiError from an API error response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "ALERT_NOT_FOUND", message: "Search alert not found" } },
        { status: 404 },
      ),
    );

    const promise = updateSearchAlert("missing", { isEnabled: false });

    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "ALERT_NOT_FOUND",
      message: "Search alert not found",
    });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });

  it("throws fallback ApiError for malformed error JSON", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{", { status: 500 }));

    await expect(listSearchAlerts()).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Request failed",
    });
  });
});
