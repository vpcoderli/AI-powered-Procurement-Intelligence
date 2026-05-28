import { describe, expect, it } from "vitest";
import { FeatureAccessError, requireFeature } from "./feature-gate";

describe("server feature gate", () => {
  it("allows principals with the requested feature", () => {
    const principal = {
      kind: "authenticated" as const,
      userId: "user_pro",
      role: "user" as const,
      tier: "pro" as const,
      features: ["bid_search", "submission_guidance"] as const,
    };

    expect(requireFeature(principal, "submission_guidance")).toBe(principal);
  });

  it("rejects principals without the requested feature", () => {
    expect(() =>
      requireFeature(
        {
          kind: "authenticated",
          userId: "user_free",
          role: "user",
          tier: "free",
          features: ["bid_search"],
        },
        "submission_guidance",
      ),
    ).toThrow(FeatureAccessError);
  });

  it("returns a stable API error payload", () => {
    const error = new FeatureAccessError("submission_guidance", "pro");

    expect(error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(error.status).toBe(403);
    expect(error.message).toContain("Pro");
  });
});
