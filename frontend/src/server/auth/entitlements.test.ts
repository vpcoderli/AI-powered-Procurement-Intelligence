import { describe, expect, it } from "vitest";
import { listSubscriptionPlans } from "@/server/billing/subscriptions";
import {
  ACCOUNT_TIER_LABELS,
  ACCOUNT_TIERS,
  FEATURE_KEYS,
  PRODUCT_PLAN_BY_TIER,
  PRODUCT_PLAN_LABELS,
  PRODUCT_PLAN_KEYS,
  applyFeatureOverrides,
  featuresForUser,
  hasFeature,
  isAccountTier,
  isFeatureKey,
  isUserRole,
  minimumTierLabelForFeature,
  productPlanForTier,
} from "./entitlements";

describe("auth entitlements", () => {
  it("validates roles and account tiers", () => {
    expect(isUserRole("user")).toBe(true);
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("operator")).toBe(true);
    expect(isUserRole("support")).toBe(true);
    expect(isUserRole("owner")).toBe(false);
    expect(isAccountTier("free")).toBe(true);
    expect(isAccountTier("enterprise")).toBe(true);
    expect(isAccountTier("gold")).toBe(false);
  });

  it("maps tiers to enabled feature keys", () => {
    expect(featuresForUser({ role: "user", tier: "free" })).toContain("bid_search");
    expect(featuresForUser({ role: "user", tier: "free" })).not.toContain("compliance_manifest");
    expect(featuresForUser({ role: "user", tier: "business" })).toContain("compliance_manifest");
    expect(featuresForUser({ role: "admin", tier: "free" })).toContain("admin_console");
    expect(featuresForUser({ role: "operator", tier: "free" })).toContain("admin_console");
    expect(featuresForUser({ role: "support", tier: "free" })).toContain("admin_console");
  });

  it("keeps the paid feature entitlement matrix aligned with product tiers", () => {
    const matrix: Array<[feature: (typeof FEATURE_KEYS)[number], free: boolean, pro: boolean, business: boolean, enterprise: boolean]> = [
      ["bid_search", true, true, true, true],
      ["saved_bids", true, true, true, true],
      ["supplier_profile", true, true, true, true],
      ["match_score", true, true, true, true],
      ["intent_workspace", true, true, true, true],
      ["submission_guidance", false, true, true, true],
      ["pursue_no_bid", false, true, true, true],
      ["bid.brief.full.generate", false, true, true, true],
      ["readiness.review.run", false, true, true, true],
      ["compliance_manifest", false, false, true, true],
      ["compliance.manifest.generate", false, false, true, true],
      ["quote_workflow", false, false, true, true],
      ["deadline_notifications", false, false, true, true],
      ["response.workspace.create", false, false, true, true],
      ["artifact.vault.upload", false, false, true, true],
      ["response.section.draft", false, false, true, true],
      ["package.review.run", false, false, true, true],
      ["team.member.invite", false, false, true, true],
      ["knowledge_station", false, false, false, true],
      ["award.tabulation.analyze", false, false, false, true],
      ["price.to.win.run", false, false, false, true],
    ];

    for (const [feature, free, pro, business, enterprise] of matrix) {
      expect(hasFeature({ role: "user", tier: "free" }, feature)).toBe(free);
      expect(hasFeature({ role: "user", tier: "pro" }, feature)).toBe(pro);
      expect(hasFeature({ role: "user", tier: "business" }, feature)).toBe(business);
      expect(hasFeature({ role: "user", tier: "enterprise" }, feature)).toBe(enterprise);
    }
  });

  it("keeps Knowledge Station Enterprise-only by default", () => {
    expect(featuresForUser({ role: "user", tier: "free" })).not.toContain("knowledge_station");
    expect(featuresForUser({ role: "user", tier: "pro" })).not.toContain("knowledge_station");
    expect(featuresForUser({ role: "user", tier: "business" })).not.toContain("knowledge_station");
    expect(featuresForUser({ role: "user", tier: "enterprise" })).toContain("knowledge_station");
    expect(minimumTierLabelForFeature("knowledge_station")).toBe("Enterprise");
  });

  it("allows non-expired organization overrides to enable or disable Knowledge Station", () => {
    const now = new Date("2026-06-02T00:00:00.000Z");

    expect(applyFeatureOverrides(featuresForUser({ role: "user", tier: "business" }), [
      {
        featureKey: "knowledge_station",
        isEnabled: 1,
        expiresAt: "2026-06-03T00:00:00.000Z",
      },
    ], now)).toContain("knowledge_station");

    expect(applyFeatureOverrides(featuresForUser({ role: "user", tier: "enterprise" }), [
      {
        featureKey: "knowledge_station",
        isEnabled: 0,
        expiresAt: "2026-06-03T00:00:00.000Z",
      },
    ], now)).not.toContain("knowledge_station");
  });

  it("ignores expired organization overrides for Knowledge Station", () => {
    const now = new Date("2026-06-02T00:00:00.000Z");

    expect(applyFeatureOverrides(featuresForUser({ role: "user", tier: "business" }), [
      {
        featureKey: "knowledge_station",
        isEnabled: 1,
        expiresAt: "2026-06-01T23:59:59.000Z",
      },
    ], now)).not.toContain("knowledge_station");

    expect(applyFeatureOverrides(featuresForUser({ role: "user", tier: "enterprise" }), [
      {
        featureKey: "knowledge_station",
        isEnabled: 0,
        expiresAt: "2026-06-01T23:59:59.000Z",
      },
    ], now)).toContain("knowledge_station");
  });

  it("maps internal tiers to updated product-facing plan labels", () => {
    expect(ACCOUNT_TIER_LABELS).toMatchObject({
      free: "Free",
      pro: "Pursuit Starter",
      business: "Response Builder",
      enterprise: "Enterprise",
    });
    expect(PRODUCT_PLAN_LABELS.growth).toBe("Growth");
    expect(productPlanForTier("pro")).toBe("pursuit_starter");
    expect(productPlanForTier("business")).toBe("response_builder");
  });

  it("keeps Growth as a planned product plan rather than an active account tier", () => {
    expect(PRODUCT_PLAN_KEYS).toContain("growth");
    expect(ACCOUNT_TIERS).not.toContain("growth");
    expect(isAccountTier("growth")).toBe(false);
    expect(Object.values(PRODUCT_PLAN_BY_TIER)).not.toContain("growth");

    const growthPlan = listSubscriptionPlans().find((plan) => plan.productPlanKey === "growth");

    expect(growthPlan).toMatchObject({
      tier: null,
      productPlanKey: "growth",
      label: "Growth",
      isAvailable: false,
      isSelfServe: false,
    });
  });

  it("supports PRD feature slugs alongside legacy feature keys", () => {
    expect(FEATURE_KEYS).toContain("bid.brief.full.generate");
    expect(FEATURE_KEYS).toContain("response.workspace.create");
    expect(isFeatureKey("compliance.manifest.generate")).toBe(true);
    expect(hasFeature({ role: "user", tier: "free" }, "bid.brief.full.generate")).toBe(false);
    expect(hasFeature({ role: "user", tier: "pro" }, "bid.brief.full.generate")).toBe(true);
    expect(hasFeature({ role: "user", tier: "business" }, "response.workspace.create")).toBe(true);
    expect(minimumTierLabelForFeature("response.workspace.create")).toBe("Response Builder");
  });

  it("checks individual feature access", () => {
    expect(hasFeature({ role: "user", tier: "free" }, "submission_guidance")).toBe(false);
    expect(hasFeature({ role: "user", tier: "pro" }, "submission_guidance")).toBe(true);
    expect(hasFeature({ role: "admin", tier: "free" }, "admin_console")).toBe(true);
    expect(hasFeature({ role: "operator", tier: "free" }, "admin_console")).toBe(true);
    expect(hasFeature({ role: "support", tier: "free" }, "admin_console")).toBe(true);
  });
});
