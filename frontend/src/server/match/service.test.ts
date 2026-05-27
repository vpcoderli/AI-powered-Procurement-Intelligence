import { describe, expect, it } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import { calculateBidMatch } from "./service";

describe("match score service", () => {
  it("scores a bid higher when profile state and keywords match", () => {
    const bid = MOCK_BIDS.find((item) => item.stateCode === "CA")!;

    const result = calculateBidMatch(bid, {
      userId: "user_match",
      companyName: "Cloud Supply",
      businessTypes: ["distributor"],
      categories: ["cloud infrastructure"],
      keywords: ["cloud", "infrastructure"],
      certifications: [],
      serviceStates: ["CA"],
      minContractValue: null,
      maxContractValue: null,
      riskPreferences: [],
      completionScore: 75,
      createdAt: null,
      updatedAt: null,
    });

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.explanation).toContain("matches your service states");
  });

  it("returns missing-profile hints for an empty profile", () => {
    const result = calculateBidMatch(MOCK_BIDS[0], {
      userId: "user_empty",
      companyName: "",
      businessTypes: [],
      categories: [],
      keywords: [],
      certifications: [],
      serviceStates: [],
      minContractValue: null,
      maxContractValue: null,
      riskPreferences: [],
      completionScore: 0,
      createdAt: null,
      updatedAt: null,
    });

    expect(result.score).toBeLessThan(50);
    expect(result.missingProfileHints).toContain("Add keywords to improve bid matching.");
  });
});
