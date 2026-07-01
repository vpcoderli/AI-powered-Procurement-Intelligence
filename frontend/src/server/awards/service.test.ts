import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "@/server/db/test-utils";
import { awardOutcomes, users } from "@/server/db/schema";
import { createSupplierArtifact, deleteSupplierArtifact } from "@/server/artifacts/service";
import { createIntentForBid } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  AwardOutcomeValidationError,
  getAwardOutcome,
  getAwardLearningSummary,
  updateAwardOutcome,
} from "./service";

describe("award outcome service", () => {
  const userId = "award_service_user_1";

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("MYSQL_DATABASE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function seedRegisteredUser(testDb: Awaited<ReturnType<typeof createTestDatabase>>) {
    testDb.db.insert(users).values({
      id: userId,
      email: "award-service@example.com",
      displayName: "Award Service User",
      accountTier: "enterprise",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
    }).run();
  }

  it("creates an awaiting_award outcome on first access", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      const outcome = await getAwardOutcome(testDb.db, userId, intent.id);

      expect(outcome).toMatchObject({
        intentId: intent.id,
        bidId: "1",
        userId,
        status: "awaiting_award",
        awardNoticeUrl: "",
        tabulationArtifactId: null,
        winnerName: "",
        awardAmountCents: null,
        currency: "USD",
        lossReason: "unknown",
        nextAction: "capture_tabulation",
      });
      expect(testDb.db.select().from(awardOutcomes).all()).toHaveLength(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns an existing outcome without overwriting manual fields", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      await updateAwardOutcome(testDb.db, userId, intent.id, {
        status: "awarded_to_us",
        winnerName: "Acme Federal Team",
        awardAmountCents: 450000,
        notes: "Award notice confirmed.",
      });

      const outcome = await getAwardOutcome(testDb.db, userId, intent.id);

      expect(outcome).toMatchObject({
        status: "awarded_to_us",
        winnerName: "Acme Federal Team",
        awardAmountCents: 450000,
        notes: "Award notice confirmed.",
      });
      expect(testDb.db.select().from(awardOutcomes).where(eq(awardOutcomes.intentId, intent.id)).all()).toHaveLength(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("persists an awarded_to_us outcome with amount and notice URL", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");

      const outcome = await updateAwardOutcome(testDb.db, userId, intent.id, {
        status: "awarded_to_us",
        winnerName: "Acme Federal Team",
        awardAmountCents: 1250000,
        awardNoticeUrl: "https://sam.gov/award/notice",
        decidedAt: "2026-06-10",
      });

      expect(outcome).toMatchObject({
        status: "awarded_to_us",
        winnerName: "Acme Federal Team",
        awardAmountCents: 1250000,
        awardNoticeUrl: "https://sam.gov/award/notice",
        decidedAt: "2026-06-10",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("persists competitor loss details and next action", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");

      const outcome = await updateAwardOutcome(testDb.db, userId, intent.id, {
        status: "awarded_to_competitor",
        winnerName: "Delta Integrators",
        lossReason: "price_uncompetitive",
        lossReasonNotes: "Published pricing was 8% below our response.",
        nextAction: "request_debrief",
        nextActionDueAt: "2026-06-17",
      });

      expect(outcome).toMatchObject({
        status: "awarded_to_competitor",
        winnerName: "Delta Integrators",
        lossReason: "price_uncompetitive",
        lossReasonNotes: "Published pricing was 8% below our response.",
        nextAction: "request_debrief",
        nextActionDueAt: "2026-06-17",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("builds a deterministic win/loss learning summary from the award outcome", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");

      const outcome = await updateAwardOutcome(testDb.db, userId, intent.id, {
        status: "awarded_to_competitor",
        winnerName: "Delta Integrators",
        awardAmountCents: 900000,
        lossReason: "price_uncompetitive",
        lossReasonNotes: "Published tabulation was 8% below our response.",
        nextAction: "request_debrief",
        nextActionDueAt: "2026-06-17",
        tabulationArtifactUrl: "https://agency.example.gov/tabulation.pdf",
        decidedAt: "2026-06-10",
      });
      const summary = await getAwardLearningSummary(testDb.db, userId, intent.id);

      expect(outcome.learningSummary).toEqual(summary);
      expect(summary).toEqual({
        outcomeClass: "loss",
        headline: "Lost to Delta Integrators: price_uncompetitive",
        primaryDriver: "price_uncompetitive",
        lessons: [
          "Recorded loss driver: price_uncompetitive.",
          "Published tabulation was 8% below our response.",
        ],
        recommendedActions: ["request_debrief", "update_pricing"],
        evidence: {
          awardNoticeUrl: "",
          tabulationArtifactId: null,
          tabulationArtifactUrl: "https://agency.example.gov/tabulation.pdf",
          decidedAt: "2026-06-10",
        },
        amountCents: 900000,
        currency: "USD",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects invalid enums, invalid URLs, and negative amounts", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");

      await expect(updateAwardOutcome(testDb.db, userId, intent.id, {
        status: "won",
      } as Parameters<typeof updateAwardOutcome>[3])).rejects.toBeInstanceOf(AwardOutcomeValidationError);
      await expect(updateAwardOutcome(testDb.db, userId, intent.id, {
        lossReason: "too_slow",
      } as Parameters<typeof updateAwardOutcome>[3])).rejects.toBeInstanceOf(AwardOutcomeValidationError);
      await expect(updateAwardOutcome(testDb.db, userId, intent.id, {
        nextAction: "call_buyer",
      } as Parameters<typeof updateAwardOutcome>[3])).rejects.toBeInstanceOf(AwardOutcomeValidationError);
      await expect(updateAwardOutcome(testDb.db, userId, intent.id, {
        awardNoticeUrl: "ftp://example.com/award",
      })).rejects.toBeInstanceOf(AwardOutcomeValidationError);
      await expect(updateAwardOutcome(testDb.db, userId, intent.id, {
        tabulationArtifactUrl: "not a url",
      })).rejects.toBeInstanceOf(AwardOutcomeValidationError);
      await expect(updateAwardOutcome(testDb.db, userId, intent.id, {
        awardAmountCents: -1,
      })).rejects.toBeInstanceOf(AwardOutcomeValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects tabulation artifacts from another intent or deleted artifacts", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const first = await createIntentForBid(testDb.db, userId, "1");
      const second = await createIntentForBid(testDb.db, userId, "2");
      const otherVault = await createSupplierArtifact(testDb.db, userId, second.id, {
        title: "Other tabulation",
        artifactType: "other",
        purpose: "response_workspace",
        file: new File(["other"], "other-tabulation.pdf", { type: "application/pdf" }),
      }, { storageRoot: testDb.directory });
      const ownVault = await createSupplierArtifact(testDb.db, userId, first.id, {
        title: "Own tabulation",
        artifactType: "other",
        purpose: "response_workspace",
        file: new File(["own"], "own-tabulation.pdf", { type: "application/pdf" }),
      }, { storageRoot: testDb.directory });

      await expect(updateAwardOutcome(testDb.db, userId, first.id, {
        tabulationArtifactId: otherVault.artifacts[0].id,
      })).rejects.toBeInstanceOf(AwardOutcomeValidationError);

      await deleteSupplierArtifact(testDb.db, userId, first.id, ownVault.artifacts[0].id, {
        now: new Date("2026-06-10T00:10:00.000Z"),
      });

      await expect(updateAwardOutcome(testDb.db, userId, first.id, {
        tabulationArtifactId: ownVault.artifacts[0].id,
      })).rejects.toBeInstanceOf(AwardOutcomeValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("throws IntentNotFoundError for missing or inaccessible intents", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);

      await expect(getAwardOutcome(testDb.db, userId, "missing_intent")).rejects.toBeInstanceOf(IntentNotFoundError);
      await expect(updateAwardOutcome(testDb.db, userId, "missing_intent", {
        status: "no_award",
      })).rejects.toBeInstanceOf(IntentNotFoundError);
    } finally {
      await testDb.cleanup();
    }
  });
});
