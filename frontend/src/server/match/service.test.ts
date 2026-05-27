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
    expect(result.missingProfileHints).toContain(
      "Add certifications to improve bid matching.",
    );
  });

  it("matches contract values when the amount contains comma separators", () => {
    const result = calculateBidMatch(
      {
        ...MOCK_BIDS[0],
        amount: "$1,000,000",
      },
      {
        userId: "user_contract",
        companyName: "Capital Supply",
        businessTypes: [],
        categories: [],
        keywords: [],
        certifications: [],
        serviceStates: [],
        minContractValue: 500_000,
        maxContractValue: 2_000_000,
        riskPreferences: [],
        completionScore: 30,
        createdAt: null,
        updatedAt: null,
      },
    );

    expect(result.components.contractValue).toBe(10);
  });

  it("explains certification matches", () => {
    const result = calculateBidMatch(
      {
        ...MOCK_BIDS[0],
        title: "SBE supplier opportunity",
        description: "",
        fullDescription: "",
        originalCategory: "",
        issuerName: "",
        stateCode: "WA",
        tags: [],
        amount: "",
        deadlineDate: "",
      },
      {
        userId: "user_cert",
        companyName: "Certified Supply",
        businessTypes: [],
        categories: [],
        keywords: [],
        certifications: ["SBE"],
        serviceStates: [],
        minContractValue: null,
        maxContractValue: null,
        riskPreferences: [],
        completionScore: 25,
        createdAt: null,
        updatedAt: null,
      },
    );

    expect(result.components.certifications).toBe(10);
    expect(result.explanation).toContain("matches your certifications");
  });
});
