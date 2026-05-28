import { describe, expect, it } from "vitest";
import { canUseFeature, lockedFeatureMessage } from "./useFeature";

describe("client feature helpers", () => {
  it("allows enabled user features", () => {
    expect(
      canUseFeature(
        {
          id: "user_pro",
          email: "buyer@example.com",
          displayName: null,
          role: "user",
          tier: "pro",
          features: ["bid_search", "submission_guidance"],
        },
        "submission_guidance",
      ),
    ).toBe(true);
  });

  it("treats missing users as locked", () => {
    expect(canUseFeature(null, "submission_guidance")).toBe(false);
  });

  it("returns a tier-specific upgrade message", () => {
    expect(lockedFeatureMessage("submission_guidance")).toContain("Pro");
    expect(lockedFeatureMessage("compliance_manifest")).toContain("Business");
  });
});
