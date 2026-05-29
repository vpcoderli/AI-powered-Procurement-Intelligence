import type { AccountTier, FeatureKey } from "@/server/auth/entitlements";

export const CREDIT_EVENT_TYPES = [
  "monthly_grant",
  "purchased_grant",
  "manual_adjustment",
  "premium_action",
  "system_refund",
] as const;

export type CreditEventType = (typeof CREDIT_EVENT_TYPES)[number];

export interface CreditActionMetadata {
  feature: FeatureKey;
  creditCost: number;
  refundOnSystemFailure: boolean;
  label: string;
}

export interface CreditSummary {
  includedMonthlyCredits: number | null;
  purchasedCredits: number;
  availableCredits: number | null;
  resetsAt: string | null;
}

const INCLUDED_MONTHLY_CREDITS_BY_TIER: Record<AccountTier, number | null> = {
  free: 0,
  pro: 25,
  business: 150,
  enterprise: null,
};

export const CREDIT_ACTIONS: Partial<Record<FeatureKey, CreditActionMetadata>> = {
  "bid.brief.full.generate": {
    feature: "bid.brief.full.generate",
    creditCost: 1,
    refundOnSystemFailure: true,
    label: "Full bid brief generation",
  },
  "compliance.manifest.generate": {
    feature: "compliance.manifest.generate",
    creditCost: 2,
    refundOnSystemFailure: true,
    label: "Compliance manifest generation",
  },
  "readiness.review.run": {
    feature: "readiness.review.run",
    creditCost: 2,
    refundOnSystemFailure: true,
    label: "Readiness review",
  },
  "response.section.draft": {
    feature: "response.section.draft",
    creditCost: 3,
    refundOnSystemFailure: true,
    label: "Response section draft",
  },
  "package.review.run": {
    feature: "package.review.run",
    creditCost: 4,
    refundOnSystemFailure: true,
    label: "Package review",
  },
  "amendment.delta.run": {
    feature: "amendment.delta.run",
    creditCost: 2,
    refundOnSystemFailure: true,
    label: "Amendment delta review",
  },
  "award.tabulation.analyze": {
    feature: "award.tabulation.analyze",
    creditCost: 5,
    refundOnSystemFailure: true,
    label: "Award tabulation analysis",
  },
  "price.to.win.run": {
    feature: "price.to.win.run",
    creditCost: 5,
    refundOnSystemFailure: true,
    label: "Price-to-win analysis",
  },
};

export function creditAllowanceForTier(tier: AccountTier) {
  return INCLUDED_MONTHLY_CREDITS_BY_TIER[tier];
}

export function creditCostForFeature(feature: FeatureKey) {
  return CREDIT_ACTIONS[feature]?.creditCost ?? 0;
}

export function creditSummaryForTier(tier: AccountTier): CreditSummary {
  const includedMonthlyCredits = creditAllowanceForTier(tier);

  return {
    includedMonthlyCredits,
    purchasedCredits: 0,
    availableCredits: includedMonthlyCredits,
    resetsAt: null,
  };
}
