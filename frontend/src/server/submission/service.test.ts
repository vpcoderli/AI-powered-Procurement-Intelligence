import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { submissionConfirmations, submissionPaths } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  createSubmissionConfirmation,
  getOrCreateSubmissionGuidance,
  updateSubmissionGuidance,
} from "./service";

describe("submission service", () => {
  it("creates one generated submission guidance row per intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const first = await getOrCreateSubmissionGuidance(testDb.db, "anon_seed", intent.id);
      const second = await getOrCreateSubmissionGuidance(testDb.db, "anon_seed", intent.id);
      const rows = testDb.db
        .select()
        .from(submissionPaths)
        .where(eq(submissionPaths.intentId, intent.id))
        .all();

      expect(first.id).toMatch(/^submission_path_/);
      expect(second.id).toBe(first.id);
      expect(rows).toHaveLength(1);
      expect(first.bidId).toBe(intent.bid.id);
      expect(first.method).toBe("external_portal");
      expect(first.readinessChecklist.length).toBeGreaterThan(0);
    } finally {
      await testDb.cleanup();
    }
  });

  it("updates manual submission guidance fields", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const updated = await updateSubmissionGuidance(testDb.db, "anon_seed", intent.id, {
        method: "email",
        portalUrl: "https://procurement.example.gov",
        contactEmail: "buyer@example.gov",
        requiresRegistration: false,
      });

      expect(updated.method).toBe("email");
      expect(updated.portalUrl).toBe("https://procurement.example.gov");
      expect(updated.contactEmail).toBe("buyer@example.gov");
      expect(updated.requiresRegistration).toBe(false);
    } finally {
      await testDb.cleanup();
    }
  });

  it("stores manual external submission confirmation records", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const confirmation = await createSubmissionConfirmation(testDb.db, "anon_seed", intent.id, {
        submittedAt: "2026-05-29T15:30:00.000Z",
        method: "external_portal",
        confirmationReference: "CONF-123",
        confirmationNotes: "Receipt downloaded.",
      });
      const rows = testDb.db
        .select()
        .from(submissionConfirmations)
        .where(eq(submissionConfirmations.intentId, intent.id))
        .all();

      expect(confirmation.id).toMatch(/^submission_confirmation_/);
      expect(confirmation.confirmationReference).toBe("CONF-123");
      expect(rows).toHaveLength(1);
    } finally {
      await testDb.cleanup();
    }
  });
});
