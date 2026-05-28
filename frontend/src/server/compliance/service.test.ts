import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { complianceManifestItems } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  getOrCreateComplianceManifest,
  updateComplianceManifestItem,
} from "./service";

describe("compliance manifest service", () => {
  it("creates one generated compliance manifest per intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const first = await getOrCreateComplianceManifest(testDb.db, "anon_seed", intent.id);
      const second = await getOrCreateComplianceManifest(testDb.db, "anon_seed", intent.id);
      const rows = testDb.db
        .select()
        .from(complianceManifestItems)
        .where(eq(complianceManifestItems.intentId, intent.id))
        .all();

      expect(first.intentId).toBe(intent.id);
      expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
      expect(rows).toHaveLength(first.items.length);
      expect(first.items.length).toBeGreaterThan(2);
      expect(first.summary.total).toBe(first.items.length);
    } finally {
      await testDb.cleanup();
    }
  });

  it("updates item status, notes, and evidence state", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const manifest = await getOrCreateComplianceManifest(testDb.db, "anon_seed", intent.id);
      const updated = await updateComplianceManifestItem(testDb.db, "anon_seed", intent.id, {
        itemId: manifest.items[0].id,
        status: "complete",
        evidenceStatus: "attached",
        notes: "Capability statement uploaded.",
      });

      expect(updated.items[0]).toMatchObject({
        status: "complete",
        evidenceStatus: "attached",
        notes: "Capability statement uploaded.",
      });
      expect(updated.summary.completed).toBe(1);
    } finally {
      await testDb.cleanup();
    }
  });
});
