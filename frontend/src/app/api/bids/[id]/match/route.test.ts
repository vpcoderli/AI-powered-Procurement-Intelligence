import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as principal from "@/server/auth/principal";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import * as bidRepository from "@/server/bids/repository";
import * as matchService from "@/server/match/service";
import type { BidMatchResult } from "@/server/match/types";
import * as profileService from "@/server/profile/service";
import type { SupplierProfile } from "@/server/profile/types";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/bids/repository", () => ({
  getBidByIdFromRepository: vi.fn(),
}));
vi.mock("@/server/profile/service", () => ({
  getSupplierProfile: vi.fn(),
}));
vi.mock("@/server/match/service", () => ({
  calculateBidMatch: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getBidByIdFromRepository = vi.mocked(bidRepository.getBidByIdFromRepository);
const getSupplierProfile = vi.mocked(profileService.getSupplierProfile);
const calculateBidMatch = vi.mocked(matchService.calculateBidMatch);

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
      userId: "anon_match",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_match; Path=/`,
    });
  });

  it("returns a match score for the current principal", async () => {
    const bid = MOCK_BIDS[1];
    getBidByIdFromRepository.mockResolvedValueOnce(bid);
    getSupplierProfile.mockResolvedValueOnce(profile);
    calculateBidMatch.mockReturnValueOnce(match);

    const response = await GET(new Request("http://localhost/api/bids/2/match"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ match });
    expect(getBidByIdFromRepository).toHaveBeenCalledWith(expect.anything(), "2");
    expect(getSupplierProfile).toHaveBeenCalledWith(expect.anything(), "anon_match");
    expect(calculateBidMatch).toHaveBeenCalledWith(bid, profile);
    expect(response.headers.get("set-cookie")).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=anon_match`,
    );
  });

  it("returns BID_NOT_FOUND when the bid is missing", async () => {
    getBidByIdFromRepository.mockResolvedValueOnce(undefined);

    const response = await GET(new Request("http://localhost/api/bids/missing/match"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BID_NOT_FOUND");
    expect(getSupplierProfile).not.toHaveBeenCalled();
  });

  it("returns JSON internal error and preserves anonymous cookie when lookup fails", async () => {
    getBidByIdFromRepository.mockRejectedValueOnce(new Error("database failed"));

    const response = await GET(new Request("http://localhost/api/bids/2/match"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(response.headers.get("set-cookie")).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=anon_match`,
    );
  });
});
