import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { users } from "@/server/db/schema";
import { createSupplierArtifact, deleteSupplierArtifact } from "@/server/artifacts/service";
import { createIntentForBid } from "@/server/intents/service";
import {
  createQuoteRequest,
  getQuoteWorkspace,
  QuoteWorkflowValidationError,
  updateQuoteRequest,
} from "./service";

describe("quote workflow service", () => {
  const userId = "quote_user_1";

  function seedRegisteredUser(testDb: Awaited<ReturnType<typeof createTestDatabase>>) {
    testDb.db.insert(users).values({
      id: userId,
      email: "quote-user@example.com",
      displayName: "Quote User",
      accountTier: "business",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }).run();
  }

  it("creates an organization partner and quote request linked to intent artifacts", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      const vault = await createSupplierArtifact(testDb.db, userId, intent.id, {
        title: "Pricing workbook",
        artifactType: "quote",
        purpose: "quote_support",
        file: new File(["pricing"], "pricing.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      }, { storageRoot: testDb.directory });

      const workspace = await createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "Acme Distribution",
        contactName: "Riley Adams",
        contactEmail: "quotes@acme.example",
        title: "Cloud migration hardware quote",
        description: "Need pricing for secure migration appliances.",
        requestedDueAt: "2026-06-10",
        lineItems: "4 secure appliances\n2 support engineers",
        artifactIds: [vault.artifacts[0].id],
      });

      expect(workspace.summary).toMatchObject({
        partners: 1,
        requests: 1,
        draft: 1,
        sent: 0,
        received: 0,
        accepted: 0,
      });
      expect(workspace.partners[0]).toMatchObject({
        organizationId: expect.stringMatching(/^org_/),
        name: "Acme Distribution",
        contactName: "Riley Adams",
        contactEmail: "quotes@acme.example",
        status: "active",
      });
      expect(workspace.requests[0]).toMatchObject({
        intentId: intent.id,
        bidId: "1",
        partnerName: "Acme Distribution",
        title: "Cloud migration hardware quote",
        status: "draft",
        requestedDueAt: "2026-06-10",
        lineItems: ["4 secure appliances", "2 support engineers"],
        artifacts: [
          expect.objectContaining({
            id: vault.artifacts[0].id,
            title: "Pricing workbook",
            fileName: "pricing.xlsx",
          }),
        ],
      });

      await expect(getQuoteWorkspace(testDb.db, userId, intent.id)).resolves.toMatchObject({
        summary: { partners: 1, requests: 1, draft: 1 },
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("updates quote status and comparison fields", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      const workspace = await createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "Delta Partner",
        title: "Initial RFQ",
      });
      const requestId = workspace.requests[0].id;

      const updated = await updateQuoteRequest(testDb.db, userId, intent.id, {
        requestId,
        status: "received",
        quotedAmountCents: 125000,
        responseNotes: "Includes support.",
      });

      expect(updated.summary).toMatchObject({ requests: 1, received: 1 });
      expect(updated.requests[0]).toMatchObject({
        id: requestId,
        status: "received",
        quotedAmountCents: 125000,
        responseNotes: "Includes support.",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("summarizes received quote comparison with low median high variance and review flags", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      let workspace = await createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "Low Partner",
        title: "RFQ low",
      });
      workspace = await createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "Median Partner",
        title: "RFQ median",
      });
      workspace = await createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "High Partner",
        title: "RFQ high",
      });

      const [low, median, high] = workspace.requests;
      await updateQuoteRequest(testDb.db, userId, intent.id, {
        requestId: low.id,
        status: "received",
        quotedAmountCents: 100000,
      });
      await updateQuoteRequest(testDb.db, userId, intent.id, {
        requestId: median.id,
        status: "received",
        quotedAmountCents: 130000,
      });
      const compared = await updateQuoteRequest(testDb.db, userId, intent.id, {
        requestId: high.id,
        status: "received",
        quotedAmountCents: 190000,
      });

      expect(compared.summary.comparison).toEqual({
        quotedCount: 3,
        currency: "USD",
        lowAmountCents: 100000,
        medianAmountCents: 130000,
        highAmountCents: 190000,
        spreadAmountCents: 90000,
        variancePercent: 69,
        lowestRequestId: low.id,
        highestRequestId: high.id,
        recommendedReviewFlags: [{
          code: "high_variance",
          message: "Quote spread is 69% of the median; review scope assumptions before award.",
          requestIds: [low.id, high.id],
        }],
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("hides deleted quote artifacts and rejects deleted artifact reuse", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      const vault = await createSupplierArtifact(testDb.db, userId, intent.id, {
        title: "Deleted pricing workbook",
        artifactType: "quote",
        purpose: "quote_support",
        file: new File(["pricing"], "deleted-pricing.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      }, { storageRoot: testDb.directory });
      const artifactId = vault.artifacts[0].id;

      await createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "Acme Distribution",
        title: "Cloud migration hardware quote",
        artifactIds: [artifactId],
      });
      await deleteSupplierArtifact(testDb.db, userId, intent.id, artifactId, {
        now: new Date("2026-06-02T00:00:00.000Z"),
      });

      const workspace = await getQuoteWorkspace(testDb.db, userId, intent.id);

      expect(workspace.requests[0].artifacts).toEqual([]);
      await expect(createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "Deleted Artifact Partner",
        title: "RFQ",
        artifactIds: [artifactId],
      })).rejects.toBeInstanceOf(QuoteWorkflowValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects invalid quote input and artifacts outside the intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const first = await createIntentForBid(testDb.db, userId, "1");
      const second = await createIntentForBid(testDb.db, userId, "2");
      const otherVault = await createSupplierArtifact(testDb.db, userId, second.id, {
        title: "Other quote",
        artifactType: "quote",
        purpose: "quote_support",
        file: new File(["other"], "other.txt", { type: "text/plain" }),
      }, { storageRoot: testDb.directory });

      await expect(createQuoteRequest(testDb.db, userId, first.id, {
        partnerName: "",
        title: "RFQ",
      })).rejects.toBeInstanceOf(QuoteWorkflowValidationError);

      await expect(createQuoteRequest(testDb.db, userId, first.id, {
        partnerName: "Wrong Artifact Partner",
        title: "RFQ",
        artifactIds: [otherVault.artifacts[0].id],
      })).rejects.toBeInstanceOf(QuoteWorkflowValidationError);
    } finally {
      await testDb.cleanup();
    }
  });
});
