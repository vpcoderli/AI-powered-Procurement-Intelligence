import { describe, expect, it } from "vitest";
import {
  featuresForUser,
  hasFeature,
  isAccountTier,
  isUserRole,
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

  it("checks individual feature access", () => {
    expect(hasFeature({ role: "user", tier: "free" }, "submission_guidance")).toBe(false);
    expect(hasFeature({ role: "user", tier: "pro" }, "submission_guidance")).toBe(true);
    expect(hasFeature({ role: "admin", tier: "free" }, "admin_console")).toBe(true);
    expect(hasFeature({ role: "operator", tier: "free" }, "admin_console")).toBe(true);
    expect(hasFeature({ role: "support", tier: "free" }, "admin_console")).toBe(true);
  });
});
