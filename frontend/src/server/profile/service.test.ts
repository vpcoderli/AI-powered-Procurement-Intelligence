import { describe, expect, it } from "vitest";
import { ensureUser } from "@/server/bids/repository";
import { supplierProfiles } from "@/server/db/schema";
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
      await testDb.cleanup();
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
      await testDb.cleanup();
    }
  });

  it("rejects corrupt profile JSON instead of silently erasing it", async () => {
    const testDb = await createTestDatabase({ seed: false });

    try {
      await ensureUser(testDb.db, "user_profile_corrupt");

      testDb.db
        .insert(supplierProfiles)
        .values({
          userId: "user_profile_corrupt",
          companyName: "Broken Profile",
          businessTypes: "{",
          categories: JSON.stringify([]),
          keywords: JSON.stringify([]),
          certifications: JSON.stringify([]),
          serviceStates: JSON.stringify([]),
          minContractValue: null,
          maxContractValue: null,
          riskPreferences: JSON.stringify([]),
          createdAt: "2026-05-27T00:00:00.000Z",
          updatedAt: "2026-05-27T00:00:00.000Z",
        })
        .run();

      await expect(getSupplierProfile(testDb.db, "user_profile_corrupt")).rejects.toThrow(
        "businessTypes",
      );
    } finally {
      await testDb.cleanup();
    }
  });
});
