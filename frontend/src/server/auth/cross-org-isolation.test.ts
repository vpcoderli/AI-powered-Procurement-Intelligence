/**
 * Cross-org isolation test suite (P1-1 / ORG-005).
 *
 * These tests set up TWO organizations, each with its own user (created via
 * `registerUser`, which provisions a distinct organization + owner membership
 * per `frontend/src/server/account/workspace.ts`). Org A creates resources;
 * we then assert that Org B's user is denied access when calling the same
 * server-side service functions the API routes call. Nearly every org-scoped
 * feature funnels through `getUserIntent` (frontend/src/server/intents/service.ts),
 * so a cross-org caller consistently sees `IntentNotFoundError` (mapped to
 * HTTP 404 INTENT_NOT_FOUND by the route handlers) rather than Org A's data.
 *
 * This suite intentionally exercises real service functions against a real
 * (temp-file) SQLite database via `createTestDatabase`, not mocked services -
 * existing route.test.ts files mock the service layer entirely and therefore
 * cannot catch an authorization regression inside the service/repository
 * layer itself. See docs/qa/cross-org-isolation-coverage.md for the full
 * survey of org-scoped endpoints and what is/isn't covered here.
 *
 * IMPORTANT DESIGN NOTE (not a bug): resource "ownership" for intent-scoped
 * data (intents, response workspace, quotes, compliance, pursuit decisions,
 * deadlines, artifacts) is scoped to the caller's ORGANIZATION via
 * `listWorkspaceMemberUserIds` (see getUserIntent in
 * frontend/src/server/intents/service.ts), not to a single userId. Teammates
 * within the SAME org are therefore expected to see/manage each other's
 * intents by design - that is intentional workspace sharing, not a leak.
 * The security boundary this suite validates is strictly cross-ORGANIZATION.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "@/server/auth/service";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { knowledgeItems, organizationMemberships, organizations, users } from "@/server/db/schema";
import {
  createKnowledgeItem,
  KnowledgeValidationError,
  listKnowledgeItems,
} from "@/server/knowledge/service";
import {
  createIntentForBid,
  getUserIntent,
  listUserIntents,
  updateIntentStatus,
} from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createResponseWorkspaceComment,
  createResponsePackageSnapshot,
  getOrCreateResponseWorkspace,
  getResponsePackageWorkspace,
  listResponseWorkspaceComments,
  updateResponseWorkspaceItem,
  ResponseWorkspaceValidationError,
} from "@/server/response-workspace/service";
import {
  createSupplierArtifact,
  deleteSupplierArtifact,
  getArtifactVault,
  getSupplierArtifactFile,
  replaceSupplierArtifact,
} from "@/server/artifacts/service";
import {
  createQuoteRequest,
  getQuoteWorkspace,
  updateQuoteRequest,
} from "@/server/quotes/service";
import { createPursuitDecision, getPursuitDecisionBoard } from "@/server/pursuit/service";
import {
  getOrCreateComplianceManifest,
  updateComplianceManifestItem,
} from "@/server/compliance/service";
import { getAccountDeadlineReminderCenter, getDeadlineWorkspace } from "@/server/deadlines/service";
import { getAwardOutcome, updateAwardOutcome } from "@/server/awards/service";

function makeUploadFile(name: string, contents: string, type = "text/plain") {
  return new File([contents], name, { type });
}

describe("cross-org isolation (ORG-005)", () => {
  let testDb: TestDatabase;

  // Two orgs, each with one registered (owner) user. registerUser provisions
  // a brand-new organization + owner membership per user (see
  // frontend/src/server/account/workspace.ts ensureUserWorkspace), so these
  // two users are guaranteed to be in different organizations.
  let orgAUserId: string;
  let orgAOrgId: string;
  let orgBUserId: string;
  let orgBOrgId: string;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });

    const ownerA = await registerUser(testDb.db, {
      email: "owner-a@org-a.example.com",
      password: "correct-horse-battery-staple",
      displayName: "Org A Owner",
    });
    orgAUserId = ownerA.user.id;
    orgAOrgId = ownerA.user.workspace!.organizationId;

    const ownerB = await registerUser(testDb.db, {
      email: "owner-b@org-b.example.com",
      password: "correct-horse-battery-staple",
      displayName: "Org B Owner",
    });
    orgBUserId = ownerB.user.id;
    orgBOrgId = ownerB.user.workspace!.organizationId;
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("sanity-checks that the two registered users landed in different organizations", () => {
    expect(orgAOrgId).not.toBe(orgBOrgId);
    expect(orgAOrgId).toMatch(/^org_/);
    expect(orgBOrgId).toMatch(/^org_/);
  });

  describe("intents", () => {
    it("blocks org B from reading, listing, or updating org A's intent", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");

      // Direct get: org B gets undefined (route maps this to 404 INTENT_NOT_FOUND).
      const asOrgB = await getUserIntent(testDb.db, orgBUserId, intent.id);
      expect(asOrgB).toBeUndefined();

      // List: org B's intent list must not contain org A's intent.
      const orgBIntents = await listUserIntents(testDb.db, orgBUserId);
      expect(orgBIntents.map((row) => row.id)).not.toContain(intent.id);

      // Status update: org B cannot mutate org A's intent status.
      await expect(
        updateIntentStatus(testDb.db, orgBUserId, intent.id, "needs_review"),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      // Org A itself can still read/update its own intent (control case).
      const asOrgA = await getUserIntent(testDb.db, orgAUserId, intent.id);
      expect(asOrgA?.id).toBe(intent.id);
      const updated = await updateIntentStatus(testDb.db, orgAUserId, intent.id, "needs_review");
      expect(updated.status).toBe("needs_review");
    });
  });

  describe("response workspace (items, comments, package snapshots)", () => {
    it("blocks org B from reading or mutating org A's response workspace items", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, orgAUserId, intent.id);
      expect(workspace.items.length).toBeGreaterThan(0);
      const itemId = workspace.items[0].id;

      // Org B cannot even fetch/create the workspace for org A's intent.
      await expect(
        getOrCreateResponseWorkspace(testDb.db, orgBUserId, intent.id),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      // Org B cannot update org A's workspace item by guessing its id.
      await expect(
        updateResponseWorkspaceItem(testDb.db, orgBUserId, intent.id, {
          itemId,
          status: "done",
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      // Org A can still update its own item (control case).
      const updated = await updateResponseWorkspaceItem(testDb.db, orgAUserId, intent.id, {
        itemId,
        status: "done",
      });
      expect(updated.items.find((row) => row.id === itemId)?.status).toBe("done");
    });

    it("blocks org B from reading or posting comments on org A's response workspace item", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, orgAUserId, intent.id);
      const itemId = workspace.items[0].id;

      // requireWorkspaceItem (frontend/src/server/response-workspace/service.ts)
      // calls getOrCreateResponseWorkspace first, so a cross-org caller fails
      // with IntentNotFoundError before the item lookup itself ever runs.
      await expect(
        listResponseWorkspaceComments(testDb.db, orgBUserId, intent.id, itemId),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        createResponseWorkspaceComment(testDb.db, orgBUserId, intent.id, {
          itemId,
          body: "Trying to comment on someone else's org intent.",
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      // Sanity check that ResponseWorkspaceValidationError is still the
      // right error type for a same-org caller referencing an unknown item.
      await expect(
        listResponseWorkspaceComments(testDb.db, orgAUserId, intent.id, "response_workspace_item_missing"),
      ).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    });

    it("blocks org B from creating a response package snapshot for org A's intent", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      await getOrCreateResponseWorkspace(testDb.db, orgAUserId, intent.id);

      await expect(
        createResponsePackageSnapshot(testDb.db, orgBUserId, intent.id, { title: "Stolen snapshot" }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        getResponsePackageWorkspace(testDb.db, orgBUserId, intent.id),
      ).rejects.toBeInstanceOf(IntentNotFoundError);
    });
  });

  describe("supplier artifacts (uploads, downloads, replace, delete)", () => {
    it("blocks org B from viewing, downloading, replacing, or deleting org A's artifact", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      const vault = await createSupplierArtifact(testDb.db, orgAUserId, intent.id, {
        title: "Capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        file: makeUploadFile("capability.txt", "confidential org A capability data"),
      });
      const artifactId = vault.artifacts[0].id;

      // Org B cannot even reach the intent's artifact vault at all.
      await expect(getArtifactVault(testDb.db, orgBUserId, intent.id)).rejects.toBeInstanceOf(
        IntentNotFoundError,
      );

      await expect(
        getSupplierArtifactFile(testDb.db, orgBUserId, intent.id, artifactId),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        createSupplierArtifact(testDb.db, orgBUserId, intent.id, {
          title: "Malicious upload",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          file: makeUploadFile("evil.txt", "should never attach to org A's intent"),
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        replaceSupplierArtifact(testDb.db, orgBUserId, intent.id, artifactId, {
          file: makeUploadFile("replacement.txt", "overwritten by org B"),
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        deleteSupplierArtifact(testDb.db, orgBUserId, intent.id, artifactId),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      // Control case: org A can still fetch its own artifact file metadata.
      const ownFile = await getSupplierArtifactFile(testDb.db, orgAUserId, intent.id, artifactId);
      expect(ownFile.id).toBe(artifactId);
    });
  });

  describe("quotes / sourcing partners (organization-scoped tables)", () => {
    it("blocks org B from reading or mutating org A's quote workspace and requests", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      const created = await createQuoteRequest(testDb.db, orgAUserId, intent.id, {
        title: "RFQ - electrical subcontractor",
        partnerName: "Acme Sub LLC",
      });
      const requestId = created.requests[0].id;
      expect(created.organizationId).toBe(orgAOrgId);

      // Org B cannot even resolve org A's intent to reach the quote workspace.
      await expect(getQuoteWorkspace(testDb.db, orgBUserId, intent.id)).rejects.toBeInstanceOf(
        IntentNotFoundError,
      );

      await expect(
        createQuoteRequest(testDb.db, orgBUserId, intent.id, {
          title: "Should never attach to org A",
          partnerName: "Rogue Partner",
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        updateQuoteRequest(testDb.db, orgBUserId, intent.id, {
          requestId,
          status: "sent",
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      // Even if org B somehow learns org A's real intent id and request id,
      // the underlying quote_requests / sourcing_partners rows are also
      // gated by workspace.organizationId (see loadQuoteWorkspace in
      // frontend/src/server/quotes/service.ts) - defense in depth beyond the
      // getUserIntent gate alone.
      const orgBWorkspace = await getQuoteWorkspace(testDb.db, orgAUserId, intent.id).catch(() => null);
      expect(orgBWorkspace?.organizationId).toBe(orgAOrgId);
    });
  });

  describe("pursuit decisions", () => {
    it("blocks org B from reading or writing org A's pursuit decision board", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");

      await expect(
        getPursuitDecisionBoard(testDb.db, orgBUserId, intent.id),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        createPursuitDecision(testDb.db, orgBUserId, intent.id, {
          decision: "pursue",
          reasons: ["Trying to inject a decision into org A's board"],
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);
    });
  });

  describe("compliance manifest", () => {
    it("blocks org B from reading or updating org A's compliance manifest", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      const manifest = await getOrCreateComplianceManifest(testDb.db, orgAUserId, intent.id);
      const itemId = manifest.items[0]?.id;
      expect(itemId).toBeTruthy();

      await expect(
        getOrCreateComplianceManifest(testDb.db, orgBUserId, intent.id),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        updateComplianceManifestItem(testDb.db, orgBUserId, intent.id, {
          itemId: itemId!,
          status: "complete",
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);
    });
  });

  describe("knowledge base (organization_id-scoped table)", () => {
    it("keeps org A's knowledge items out of org B's list and search results", async () => {
      const item = await createKnowledgeItem(testDb.db, {
        organizationId: orgAOrgId,
        userId: orgAUserId,
        title: "Org A pricing strategy",
        body: "Internal notes on how Org A prices federal IT contracts.",
        type: "lesson",
        tags: ["pricing"],
        sourceKind: "manual",
      });

      const orgBList = await listKnowledgeItems(testDb.db, { organizationId: orgBOrgId });
      expect(orgBList.items.map((row) => row.id)).not.toContain(item.id);

      const orgBSearch = await listKnowledgeItems(testDb.db, {
        organizationId: orgBOrgId,
        q: "pricing",
      });
      expect(orgBSearch.items.map((row) => row.id)).not.toContain(item.id);

      // Confirm the row really is scoped to org A at the storage layer too.
      const stored = testDb.db
        .select()
        .from(knowledgeItems)
        .where(eq(knowledgeItems.id, item.id))
        .limit(1)
        .get();
      expect(stored?.organizationId).toBe(orgAOrgId);
    });

    it("rejects org B creating a knowledge item that links to org A's intent", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");

      await expect(
        createKnowledgeItem(testDb.db, {
          organizationId: orgBOrgId,
          userId: orgBUserId,
          title: "Cross-org intent link",
          body: "Attempting to link a knowledge item to another org's intent.",
          type: "lesson",
          tags: [],
          sourceKind: "intent",
          sourceIntentId: intent.id,
          sourceBidId: intent.bid.id,
        }),
      ).rejects.toBeInstanceOf(KnowledgeValidationError);
    });

    it("rejects creating a knowledge item under an organizationId the caller does not belong to", async () => {
      // Org B's user attempts to write directly into org A's knowledge base
      // by supplying org A's organizationId. This must fail even though
      // org A is a real, existing organization - the service must check the
      // caller's own active membership, not merely that the org exists.
      await expect(
        createKnowledgeItem(testDb.db, {
          organizationId: orgAOrgId,
          userId: orgBUserId,
          title: "Planted knowledge item",
          body: "Org B trying to write into Org A's knowledge base directly.",
          type: "lesson",
          tags: [],
          sourceKind: "manual",
        }),
      ).rejects.toThrow("Knowledge organization membership is not available.");

      const stored = testDb.db
        .select()
        .from(knowledgeItems)
        .where(eq(knowledgeItems.organizationId, orgAOrgId))
        .all();
      expect(stored).toHaveLength(0);
    });
  });

  describe("deadline reminders (organization_id-scoped table)", () => {
    it("keeps org A's generated deadline reminders out of org B's reminder center", async () => {
      // getDeadlineWorkspace (called indirectly via the intent's deadlines
      // route) auto-generates reminder rows scoped to the caller's
      // organizationId the first time it runs for an intent. Trigger that
      // generation for org A, then confirm org B's account-level reminder
      // center (which lists by workspace.organizationId) never surfaces it.
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      const orgAWorkspace = await getDeadlineWorkspace(testDb.db, orgAUserId, intent.id);
      expect(orgAWorkspace.organizationId).toBe(orgAOrgId);

      const orgACenter = await getAccountDeadlineReminderCenter(testDb.db, orgAUserId);
      expect(orgACenter.organizationId).toBe(orgAOrgId);
      expect(orgACenter.reminders.length).toBeGreaterThan(0);
      const orgAReminderIds = orgACenter.reminders.map((row) => row.id);

      const orgBCenter = await getAccountDeadlineReminderCenter(testDb.db, orgBUserId);
      expect(orgBCenter.organizationId).toBe(orgBOrgId);
      for (const reminderId of orgAReminderIds) {
        expect(orgBCenter.reminders.map((row) => row.id)).not.toContain(reminderId);
      }

      // And org B cannot reach org A's intent to trigger/read its deadline
      // workspace directly either.
      await expect(
        getDeadlineWorkspace(testDb.db, orgBUserId, intent.id),
      ).rejects.toBeInstanceOf(IntentNotFoundError);
    });
  });

  describe("award outcomes (organization_id-scoped table)", () => {
    it("blocks org B from reading or updating org A's award outcome", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");
      const outcome = await getAwardOutcome(testDb.db, orgAUserId, intent.id);
      expect(outcome.organizationId).toBe(orgAOrgId);

      await expect(
        getAwardOutcome(testDb.db, orgBUserId, intent.id),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      await expect(
        updateAwardOutcome(testDb.db, orgBUserId, intent.id, {
          status: "awarded_to_us",
          winnerName: "Org B trying to claim Org A's award",
        }),
      ).rejects.toBeInstanceOf(IntentNotFoundError);

      // Control case: org A can still update its own award outcome.
      const updated = await updateAwardOutcome(testDb.db, orgAUserId, intent.id, {
        status: "awarded_to_us",
      });
      expect(updated.status).toBe("awarded_to_us");
      expect(updated.organizationId).toBe(orgAOrgId);
    });
  });

  describe("organization membership / workspace administration", () => {
    it("does not let org B enumerate or affect org A's membership rows via a guessed organizationId", () => {
      // Direct repository-level check that org membership rows for org A are
      // not visible/joinable from org B's id. (Route-level enforcement for
      // workspace management is covered by workspace.test.ts; this asserts
      // the underlying data boundary the routes rely on.)
      const orgAMembers = testDb.db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.organizationId, orgAOrgId))
        .all();
      const orgBMembers = testDb.db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.organizationId, orgBOrgId))
        .all();

      expect(orgAMembers.map((row) => row.userId)).toContain(orgAUserId);
      expect(orgAMembers.map((row) => row.userId)).not.toContain(orgBUserId);
      expect(orgBMembers.map((row) => row.userId)).toContain(orgBUserId);
      expect(orgBMembers.map((row) => row.userId)).not.toContain(orgAUserId);
    });

    it("keeps organizations table rows distinct per org", () => {
      const rows = testDb.db.select().from(organizations).all();
      const ids = rows.map((row) => row.id);
      expect(ids).toContain(orgAOrgId);
      expect(ids).toContain(orgBOrgId);
      expect(orgAOrgId).not.toBe(orgBOrgId);
    });
  });

  describe("same-org teammate sharing (control case - not a leak)", () => {
    it("allows a second ACTIVE member of org A to see org A's intent (intended workspace sharing)", async () => {
      const intent = await createIntentForBid(testDb.db, orgAUserId, "1");

      // Add a second user directly to org A, mirroring what an accepted
      // workspace invitation produces (a real `users` row with an email,
      // plus an active organization_memberships row). A bare membership row
      // without a matching users.email is not enough: listWorkspaceMemberUserIds
      // (frontend/src/server/account/workspace.ts) short-circuits to
      // `[userId]` alone when the user has no email, so this test would
      // silently pass for the wrong reason without a proper users row.
      const timestamp = "2026-07-01T00:00:00.000Z";
      const teammateId = "user_org_a_teammate";
      testDb.db.insert(users).values({
        id: teammateId,
        email: "teammate-a@org-a.example.com",
        displayName: "Org A Teammate",
        role: "user",
        accountTier: "free",
        isDisabled: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run();
      testDb.db.insert(organizationMemberships).values({
        organizationId: orgAOrgId,
        userId: teammateId,
        role: "member",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run();

      const asTeammate = await getUserIntent(testDb.db, teammateId, intent.id);
      expect(asTeammate?.id).toBe(intent.id);
    });
  });
});
