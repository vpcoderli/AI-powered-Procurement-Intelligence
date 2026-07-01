import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchProcurementIntelligence,
  ProcurementIntelligenceApiError,
} from "./intelligence";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("procurement intelligence API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the deterministic local intelligence summary", async () => {
    const intelligence = {
      generatedAt: "2026-06-03T00:00:00.000Z",
      mode: "deterministic_local",
      modelVersion: "product-6-intelligence-lite@2026-06-30",
      sourcePolicy: {
        llm: "not_used",
        embeddings: "not_used",
        vectorDb: "not_used",
        billing: "dry_run_only",
      },
      scope: { userId: "user_1", intentCount: 0 },
      cockpit: {
        activePursuits: 0,
        needsAction: 0,
        decisionQueue: 0,
        staleOrAtRisk: 0,
        averageMatchScore: 0,
      },
      topSignals: [],
      summaryBullets: ["0 active local pursuits reviewed."],
      limitations: ["Local deterministic read model only; no live LLM, embeddings, vector database, or external enrichment."],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ intelligence }));

    const result = await fetchProcurementIntelligence();

    expect(result).toEqual(intelligence);
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/intelligence");
  });

  it("throws ProcurementIntelligenceApiError for API errors", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication is required",
      },
    }, { status: 401 }));

    const request = fetchProcurementIntelligence();

    await expect(request).rejects.toMatchObject({
      name: "ProcurementIntelligenceApiError",
      status: 401,
      message: "Authentication is required",
    });
    await expect(request).rejects.toBeInstanceOf(ProcurementIntelligenceApiError);
  });
});
