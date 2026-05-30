import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { RequestPrincipal } from "@/server/auth/principal";
import * as freshnessService from "@/server/qualification/freshness";
import { IntentNotFoundError } from "@/server/intents/types";
import type { QualificationFreshnessResponse, QualificationRefreshResponse } from "@/server/qualification/types";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/qualification/freshness", () => ({
  getQualificationFreshness: vi.fn(),
  refreshQualificationEvidence: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getQualificationFreshness = vi.mocked(freshnessService.getQualificationFreshness);
const refreshQualificationEvidence = vi.mocked(freshnessService.refreshQualificationEvidence);

const principalUser: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "intent_workspace"],
};

const freshness: QualificationFreshnessResponse = {
  intentId: "intent_1",
  bidId: "bid_1",
  status: "stale",
  needsRefresh: true,
  lastRefreshedAt: "2026-05-30T01:00:00.000Z",
  latestSignalAt: "2026-05-30T03:00:00.000Z",
  latestSignal: {
    sourceType: "attachment",
    label: "Addendum_02.pdf",
    excerpt: "Addendum_02.pdf",
    detectedAt: "2026-05-30T03:00:00.000Z",
    url: "https://example.gov/addendum-02.pdf",
  },
  signalCount: 1,
  signals: [{
    sourceType: "attachment",
    label: "Addendum_02.pdf",
    excerpt: "Addendum_02.pdf",
    detectedAt: "2026-05-30T03:00:00.000Z",
    url: "https://example.gov/addendum-02.pdf",
  }],
};

const refreshResponse: QualificationRefreshResponse = {
  intent: {
    id: "intent_1",
    userId: "user_1",
    bid: {
      id: "bid_1",
      title: "Cloud services",
      source: "SAM.gov",
      sourceUrl: "https://sam.gov/example",
      issuerName: "GSA",
      issuerType: "federal",
      stateCode: "US",
      originalCategory: "IT",
      description: "Cloud services",
      fullDescription: "",
      amount: "",
      publishedDate: "2026-05-01",
      deadlineDate: "2026-06-01",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      attachments: [],
      tags: [],
      sourceConfidence: "high",
      qualityFlags: [],
      adminReviewStatus: "unreviewed",
      detailArchiveStatus: "not_archived",
      detailArchivePath: "",
      detailFetchedAt: "",
      detailChecksumSha256: "",
      detailArchiveError: "",
      saved: false,
      isActive: true,
    },
    status: "intent_added",
    generated: {
      aiBidBrief: "GSA is seeking Cloud services.",
      keyDates: { publishedDate: "2026-05-01", deadlineDate: "2026-06-01" },
      initialChecklist: ["Read the full solicitation and all attachments."],
      riskFlags: [],
    },
    match: {
      bidId: "bid_1",
      score: 75,
      confidence: "medium",
      components: {
        geography: 10,
        keywords: 20,
        category: 15,
        certifications: 10,
        contractValue: 10,
        deadline: 10,
      },
      explanation: "Match refreshed.",
      riskNotes: [],
      missingProfileHints: [],
    },
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T06:00:00.000Z",
  },
  citations: {
    intentId: "intent_1",
    bidId: "bid_1",
    citations: [],
  },
  freshness: {
    ...freshness,
    status: "current",
    needsRefresh: false,
    lastRefreshedAt: "2026-05-30T06:00:00.000Z",
  },
};

describe("GET /api/intents/[id]/qualification/freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(principalUser);
  });

  it("returns qualification freshness state", async () => {
    getQualificationFreshness.mockResolvedValueOnce(freshness);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/qualification/freshness"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(freshness);
    expect(getQualificationFreshness).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getQualificationFreshness.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/qualification/freshness"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});

describe("POST /api/intents/[id]/qualification/freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(principalUser);
  });

  it("refreshes qualification evidence", async () => {
    refreshQualificationEvidence.mockResolvedValueOnce(refreshResponse);

    const response = await POST(new Request("http://localhost/api/intents/intent_1/qualification/freshness", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(refreshResponse);
    expect(refreshQualificationEvidence).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns INTENT_NOT_FOUND when refresh cannot access the intent", async () => {
    refreshQualificationEvidence.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await POST(new Request("http://localhost/api/intents/missing/qualification/freshness", {
      method: "POST",
    }), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});
