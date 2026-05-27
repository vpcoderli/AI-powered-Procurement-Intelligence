import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./bids";
import { fetchBidMatch } from "./match";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

const match = {
  bidId: "bid/with space",
  score: 72,
  confidence: "high",
  components: {
    geography: 20,
    keywords: 20,
    category: 15,
    certifications: 0,
    contractValue: 10,
    deadline: 7,
  },
  explanation: "This bid matches your service states.",
  riskNotes: [],
  missingProfileHints: [],
} as const;

describe("bid match API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches bid match with an encoded id", async () => {
    const body = { match };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchBidMatch("bid/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/bids/bid%2Fwith%20space/match");
  });

  it("throws ApiError when the API returns an error payload", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
        { status: 404 },
      ),
    );

    const promise = fetchBidMatch("missing");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "BID_NOT_FOUND",
      message: "Bid not found",
    });
  });
});
