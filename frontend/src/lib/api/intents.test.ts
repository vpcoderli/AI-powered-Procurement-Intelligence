import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./bids";
import { createIntent, fetchIntent, fetchIntents, updateIntentStatus } from "./intents";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

const intent = {
  id: "intent/with space",
  status: "intent_added",
  bid: { id: "bid/with space", title: "Cloud" },
};

describe("intent API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an intent with an encoded bid id", async () => {
    const body = { intent };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await createIntent("bid/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/bids/bid%2Fwith%20space/intent", {
      method: "POST",
    });
  });

  it("fetches intents", async () => {
    const body = { intents: [intent] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchIntents();

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents");
  });

  it("fetches an intent with an encoded id", async () => {
    const body = { intent };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchIntent("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space");
  });

  it("patches status with an encoded id", async () => {
    const body = { intent: { ...intent, status: "needs_review" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateIntentStatus("intent/with space", "needs_review");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "needs_review" }),
    });
  });

  it("throws ApiError from an API error payload", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "INTENT_NOT_FOUND", message: "Intent not found" } },
        { status: 404 },
      ),
    );

    const promise = fetchIntent("missing");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 404,
      code: "INTENT_NOT_FOUND",
      message: "Intent not found",
    });
  });

  it("throws fallback ApiError for malformed error JSON", async () => {
    mockFetch.mockResolvedValueOnce(new Response("failed", { status: 500 }));

    const promise = fetchIntents();

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Request failed",
    });
  });
});
