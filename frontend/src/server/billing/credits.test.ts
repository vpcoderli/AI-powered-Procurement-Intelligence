import { describe, expect, it } from "vitest";
import {
  CREDIT_ACTIONS,
  CREDIT_EVENT_TYPES,
  creditAllowanceForTier,
  creditCostForFeature,
  creditSummaryForTier,
  quoteAiCreditDryRun,
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
    expect(creditCostForFeature("bid.brief.full.generate")).toBe(1);
    expect(creditCostForFeature("bid_search")).toBe(0);
    expect(CREDIT_EVENT_TYPES).toContain("premium_action");
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

  it("quotes AI credit usage as dry-run without charging real credits", () => {
    expect(quoteAiCreditDryRun({
      featureKey: "bid.brief.full.generate",
      actionId: "qualification_qa:intent_1",
      aiRun: {
        id: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
        provider: "deterministic",
        model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
        estimatedCostUsd: 0,
      },
    })).toEqual({
      mode: "dry_run_quote",
      billable: false,
      billingEnforcement: false,
      featureKey: "bid.brief.full.generate",
      actionId: "qualification_qa:intent_1",
      aiRunId: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
      provider: "deterministic",
      model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
      creditCost: 1,
      estimatedCredits: 1,
      chargedAmount: 0,
      balanceAfter: null,
      estimatedCost: { currency: "USD", total: 0, estimatedUsd: 0 },
    });
  });
});
