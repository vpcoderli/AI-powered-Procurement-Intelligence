import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchBid,
  fetchBids,
  fetchSavedBids,
  removeSavedBid,
  saveBid,
} from "./bids";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("bid API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches bids with query parameters", async () => {
    const body = { bids: [], total: 0, filters: {} };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchBids({
      q: "cloud",
      states: ["sam", "ca"],
      issuerType: "federal",
      deadline: "next30",
      published: "last7",
      sort: "newest",
    });

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/bids?q=cloud&states=sam%2Cca&issuerType=federal&deadline=next30&published=last7&sort=newest",
    );
  });

  it("fetches a bid by id", async () => {
    const body = { bid: { id: "1" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchBid("1");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/bids/1");
  });

  it("fetches saved bids", async () => {
    const body = { savedBidIds: ["1"], bids: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchSavedBids();

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/saved-bids");
  });

  it("saves a bid", async () => {
    const body = { savedBidIds: ["1"], bids: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await saveBid("1");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/saved-bids", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidId: "1" }),
    });
  });

  it("parses usage limit errors when saving a bid", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "USAGE_LIMIT_REACHED",
        message: "Pro plan is required to save more bids.",
        feature: "saved_bids",
        limit: 5,
        used: 5,
        requiredTier: "pro",
      },
    }, { status: 402 }));

    await expect(saveBid("6")).rejects.toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      status: 402,
      message: "Pro plan is required to save more bids.",
    });
  });

  it("removes a saved bid", async () => {
    const body = { savedBidIds: [], bids: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await removeSavedBid("1");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/saved-bids/1", {
      method: "DELETE",
    });
  });

  it("throws ApiError from an API error response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
        { status: 404 },
      ),
    );

    const promise = fetchBid("missing");

    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "BID_NOT_FOUND",
      message: "Bid not found",
    });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });

  it("throws fallback ApiError when error response JSON is malformed", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{", { status: 500 }));

    await expect(fetchBid("1")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Request failed",
    });
  });

  it("throws fallback ApiError when error response has no API error shape", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: "nope" }, { status: 500 }));

    await expect(fetchBid("1")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Request failed",
    });
  });
});
