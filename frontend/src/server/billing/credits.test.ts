import { describe, expect, it } from "vitest";
import {
  CREDIT_ACTIONS,
  CREDIT_EVENT_TYPES,
  creditAllowanceForTier,
  creditCostForFeature,
  creditSummaryForTier,
} from "./credits";

describe("billing credits", () => {
  it("defines tier allowances for the updated commercial plans", () => {
    expect(creditAllowanceForTier("free")).toBe(0);
    expect(creditAllowanceForTier("pro")).toBe(25);
    expect(creditAllowanceForTier("business")).toBe(150);
    expect(creditAllowanceForTier("enterprise")).toBeNull();
  });

  it("maps premium PRD feature slugs to credit costs and refund behavior", () => {
    expect(CREDIT_ACTIONS["bid.brief.full.generate"]).toMatchObject({
      creditCost: 1,
      refundOnSystemFailure: true,
    });
    expect(creditCostForFeature("package.review.run")).toBe(4);
    expect(creditCostForFeature("bid_search")).toBe(0);
    expect(CREDIT_EVENT_TYPES).toContain("system_refund");
  });

  it("returns a display-ready credit summary without requiring paid credit packs", () => {
    expect(creditSummaryForTier("business")).toEqual({
      includedMonthlyCredits: 150,
      purchasedCredits: 0,
      availableCredits: 150,
      resetsAt: null,
    });
    expect(creditSummaryForTier("enterprise")).toEqual({
      includedMonthlyCredits: null,
      purchasedCredits: 0,
      availableCredits: null,
      resetsAt: null,
    });
  });
});
