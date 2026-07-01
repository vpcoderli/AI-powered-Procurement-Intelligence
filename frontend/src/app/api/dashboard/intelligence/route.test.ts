import { afterEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { ProcurementIntelligenceSummary } from "@/server/intelligence/types";
import { createDashboardIntelligenceGet } from "./route";

vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);

describe("GET /api/dashboard/intelligence", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication for the local intelligence summary", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anonymous",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    const createSummary = vi.fn();
    const GET = createDashboardIntelligenceGet({
      database: {},
      createSummary,
      now: () => new Date("2026-06-03T00:00:00.000Z"),
    });

    const response = await GET(new Request("http://localhost/api/dashboard/intelligence"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(createSummary).not.toHaveBeenCalled();
  });

  it("returns deterministic intelligence for the resolved principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "enterprise",
      features: ["bid_search"],
    });
    const intelligence: ProcurementIntelligenceSummary = {
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
    const createSummary = vi.fn(async () => intelligence);
    const GET = createDashboardIntelligenceGet({
      database: {},
      createSummary,
      now: () => new Date("2026-06-03T00:00:00.000Z"),
    });

    const response = await GET(new Request("http://localhost/api/dashboard/intelligence"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.intelligence).toEqual(intelligence);
    expect(createSummary).toHaveBeenCalledWith(
      {},
      "user_1",
      new Date("2026-06-03T00:00:00.000Z"),
    );
  });
});
