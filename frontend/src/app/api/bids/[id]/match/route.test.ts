import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as principal from "@/server/auth/principal";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import * as bidService from "@/server/bids/service";
import * as matchService from "@/server/match/service";
import * as marketingFunnel from "@/server/marketing/funnel";
import type { BidMatchResult } from "@/server/match/types";
import * as profileService from "@/server/profile/service";
import type { SupplierProfile } from "@/server/profile/types";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/bids/service", () => ({
  getBidById: vi.fn(),
}));
vi.mock("@/server/profile/service", () => ({
  getSupplierProfile: vi.fn(),
}));
vi.mock("@/server/match/service", () => ({
  calculateBidMatch: vi.fn(),
}));
vi.mock("@/server/marketing/funnel", () => ({
  recordMarketingFunnelEvent: vi.fn(),
  recordMarketingFunnelEventFromMysql: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getBidById = vi.mocked(bidService.getBidById);
const getSupplierProfile = vi.mocked(profileService.getSupplierProfile);
const calculateBidMatch = vi.mocked(matchService.calculateBidMatch);
const recordMarketingFunnelEvent = vi.mocked(marketingFunnel.recordMarketingFunnelEvent);

const profile: SupplierProfile = {
  userId: "anon_match",
  companyName: "Cloud Supply",
  businessTypes: ["distributor"],
  categories: ["cloud infrastructure"],
  keywords: ["cloud"],
  certifications: [],
  serviceStates: ["CA"],
  minContractValue: null,
  maxContractValue: null,
  riskPreferences: [],
  completionScore: 75,
  createdAt: null,
  updatedAt: null,
};

const match: BidMatchResult = {
  bidId: "2",
  score: 80,
  confidence: "high",
  components: {
    geography: 20,
    keywords: 20,
    category: 15,
    certifications: 0,
    contractValue: 10,
    deadline: 15,
  },
  explanation: "This bid matches your service states and keywords.",
  riskNotes: [],
  missingProfileHints: [],
};

describe("GET /api/bids/[id]/match", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "anonymous",
      userId: "anonymous",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_match; Path=/`,
    });
  });

  it("returns a public anonymous match without reading or persisting a profile", async () => {
    const bid = MOCK_BIDS[1];
    getBidById.mockResolvedValueOnce(bid);
    calculateBidMatch.mockReturnValueOnce(match);

    const response = await GET(new Request("http://localhost/api/bids/2/match"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ match });
    expect(getBidById).toHaveBeenCalledWith("2");
    expect(getSupplierProfile).not.toHaveBeenCalled();
    expect(calculateBidMatch).toHaveBeenCalledWith(bid, expect.objectContaining({
      userId: "anonymous",
      companyName: "",
      completionScore: 0,
    }));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns a match score for the current authenticated principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_match",
      role: "user",
      tier: "free",
      features: [],
    });
    const bid = MOCK_BIDS[1];
    getBidById.mockResolvedValueOnce(bid);
    getSupplierProfile.mockResolvedValueOnce(profile);
    calculateBidMatch.mockReturnValueOnce(match);

    const response = await GET(new Request("http://localhost/api/bids/2/match"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ match });
    expect(getBidById).toHaveBeenCalledWith("2");
    expect(getSupplierProfile).toHaveBeenCalledWith(expect.anything(), "user_match");
    expect(calculateBidMatch).toHaveBeenCalledWith(bid, profile);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("records the first matched bid viewed funnel event for authenticated principals", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_match",
      role: "user",
      tier: "free",
      features: [],
    });
    const bid = MOCK_BIDS[1];
    getBidById.mockResolvedValueOnce(bid);
    getSupplierProfile.mockResolvedValueOnce(profile);
    calculateBidMatch.mockReturnValueOnce(match);

    const response = await GET(new Request("http://localhost/api/bids/2/match"), {
      params: Promise.resolve({ id: "2" }),
    });

    expect(response.status).toBe(200);
    expect(recordMarketingFunnelEvent).toHaveBeenCalledWith(expect.anything(), {
      eventName: "marketing.first_matched_bid_viewed",
      actorId: "user_match",
      targetType: "bid",
      targetId: "2",
      source: "marketing.bid-match",
      idempotencyKey: "marketing:first_matched_bid_viewed:user_match:2",
      metadata: {
        bidId: "2",
        score: 80,
        confidence: "high",
      },
    });
  });

  it("returns BID_NOT_FOUND when the bid is missing", async () => {
    getBidById.mockResolvedValueOnce(undefined);

    const response = await GET(new Request("http://localhost/api/bids/missing/match"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BID_NOT_FOUND");
    expect(getSupplierProfile).not.toHaveBeenCalled();
  });

  it("returns JSON internal error without setting an anonymous cookie when lookup fails", async () => {
    getBidById.mockRejectedValueOnce(new Error("database failed"));

    const response = await GET(new Request("http://localhost/api/bids/2/match"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
