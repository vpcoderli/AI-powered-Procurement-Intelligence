import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { getSupplierProfile, upsertSupplierProfile } from "./service";

describe("supplier profile service", () => {
  it("returns an empty profile shape when the user has no profile", async () => {
    const testDb = await createTestDatabase({ seed: false });

    try {
      const profile = await getSupplierProfile(testDb.db, "user_profile_empty");

      expect(profile.userId).toBe("user_profile_empty");
      expect(profile.companyName).toBe("");
      expect(profile.keywords).toEqual([]);
      expect(profile.completionScore).toBe(0);
    } finally {
      testDb.cleanup();
    }
  });

  it("upserts a supplier profile and computes completion", async () => {
    const testDb = await createTestDatabase({ seed: false });

    try {
      const profile = await upsertSupplierProfile(testDb.db, "user_profile_full", {
        companyName: "Acme Supply",
        businessTypes: ["distributor"],
        categories: ["cloud", "security"],
        keywords: ["cloud", "cybersecurity"],
        certifications: ["SBE"],
        serviceStates: ["CA", "TX"],
        minContractValue: 10000,
        maxContractValue: 250000,
        riskPreferences: ["short deadlines"],
      });

      expect(profile.companyName).toBe("Acme Supply");
      expect(profile.completionScore).toBeGreaterThanOrEqual(80);
    } finally {
      testDb.cleanup();
    }
  });
});
