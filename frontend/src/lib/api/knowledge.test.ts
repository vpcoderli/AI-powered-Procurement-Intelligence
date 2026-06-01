import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createKnowledgeItem,
  fetchKnowledgeItems,
  KnowledgeApiError,
} from "./knowledge";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("knowledge API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches knowledge items with query params", async () => {
    const body = { items: [{ id: "knowledge_1", title: "Snippet" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchKnowledgeItems({
      intentId: "intent/1",
      q: "past performance",
      type: "template_snippet",
      limit: 10,
    });

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/knowledge?intentId=intent%2F1&q=past+performance&type=template_snippet&limit=10",
    );
  });

  it("creates knowledge items", async () => {
    const input = {
      title: "Snippet",
      body: "Reuse this.",
      type: "template_snippet",
      tags: ["past performance"],
      sourceKind: "manual",
    };
    const body = { item: { id: "knowledge_1", ...input } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    const result = await createKnowledgeItem(input);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("throws KnowledgeApiError for feature gate responses", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "FEATURE_NOT_AVAILABLE",
        message: "Enterprise plan is required for this feature.",
        feature: "knowledge_station",
      },
    }, { status: 403 }));

    const request = fetchKnowledgeItems();

    await expect(request).rejects.toMatchObject({
      name: "KnowledgeApiError",
      status: 403,
      code: "FEATURE_NOT_AVAILABLE",
      message: "Enterprise plan is required for this feature.",
    });
    await expect(request).rejects.toBeInstanceOf(KnowledgeApiError);
  });
});
