import { describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { users } from "@/server/db/schema";
import { createSupplierArtifact } from "@/server/artifacts/service";
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

      expect(workspace.summary).toEqual({
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
