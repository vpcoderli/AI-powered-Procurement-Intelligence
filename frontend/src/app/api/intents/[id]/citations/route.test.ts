import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as citationService from "@/server/qualification/citations";
import { IntentNotFoundError } from "@/server/intents/types";
import type { QualificationCitationsResponse } from "@/server/qualification/types";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/qualification/citations", () => ({
  getOrCreateQualificationCitations: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getOrCreateQualificationCitations = vi.mocked(citationService.getOrCreateQualificationCitations);

const principalUser = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "intent_workspace"] as const,
};

const citationsResponse: QualificationCitationsResponse = {
  intentId: "intent_1",
  bidId: "bid_1",
  citations: [{
    id: "citation_1",
    section: "brief",
    sourceType: "bid_field",
    sourceLabel: "Solicitation title",
    excerpt: "Cloud migration services",
    url: "https://sam.gov/example",
    confidence: "high",
    generatedAt: "2026-05-30T00:00:00.000Z",
  }],
};

describe("GET /api/intents/[id]/citations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(principalUser);
  });

  it("returns persisted/generated qualification citations", async () => {
    getOrCreateQualificationCitations.mockResolvedValueOnce(citationsResponse);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/citations"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(citationsResponse);
    expect(getOrCreateQualificationCitations).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns INTENT_NOT_FOUND when citations cannot access the intent", async () => {
    getOrCreateQualificationCitations.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/citations"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});
