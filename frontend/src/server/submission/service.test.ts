import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  awardOutcomes,
  organizationMemberships,
  organizations,
  responsePackageExports,
  responsePackageSnapshots,
  responseWorkspaceItemArtifacts,
  responseWorkspaceItems,
  submissionConfirmations,
  submissionPaths,
  supplierArtifacts,
  users,
} from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  createResponsePackageExport,
  createResponsePackageSnapshot,
  getOrCreateResponseWorkspace,
  updateResponsePackageExportReview,
  updateResponseWorkspaceItem,
} from "@/server/response-workspace/service";
import {
  createSubmissionConfirmation,
  getSubmissionEvidenceLinks,
  getSubmissionReadinessGate,
  getOrCreateSubmissionGuidance,
  listSubmissionConfirmations,
  updateSubmissionGuidance,
} from "./service";

const timestamp = "2026-06-10T00:00:00.000Z";

function readinessJson() {
  return JSON.stringify({
    ready: true,
    totalOutlineSections: 1,
    completedOutlineSections: 1,
    blockedItems: 0,
    artifactPlaceholders: 1,
    artifactPlaceholdersWithLinks: 1,
    missingArtifactLinks: 0,
    openItems: 0,
  });
}

function seedSubmissionEvidence(
  testDb: Awaited<ReturnType<typeof createTestDatabase>>,
  intent: Awaited<ReturnType<typeof createIntentForBid>>,
) {
  testDb.db.insert(organizations).values({
    id: "org_submission_evidence",
    name: "Submission Evidence Org",
    accountTier: "enterprise",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing().run();
  testDb.db.insert(organizationMemberships).values({
    organizationId: "org_submission_evidence",
    userId: "anon_seed",
    role: "owner",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing().run();
  testDb.db.insert(responsePackageSnapshots).values({
    id: "response_package_snapshot_evidence",
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: "anon_seed",
    createdByUserId: "anon_seed",
    title: "Final response package",
    outlineJson: "[]",
    readinessJson: readinessJson(),
    createdAt: timestamp,
  }).run();
  testDb.db.insert(responsePackageExports).values({
    id: "response_package_export_evidence",
    snapshotId: "response_package_snapshot_evidence",
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: "anon_seed",
    requestedByUserId: "anon_seed",
    status: "ready",
    format: "zip",
    fileName: "final-response.zip",
    contentType: "application/zip",
    byteSize: 4096,
    storagePath: "data/response-package-exports/final-response.zip",
    checksumSha256: "hash_response_package_export_evidence",
    readinessJson: readinessJson(),
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewStatus: "approved",
    reviewNotes: "",
  }).run();
  testDb.db.insert(responsePackageSnapshots).values({
    id: "response_package_snapshot_later",
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: "anon_seed",
    createdByUserId: "anon_seed",
    title: "Later response package",
    outlineJson: "[]",
    readinessJson: readinessJson(),
    createdAt: "2026-06-10T01:00:00.000Z",
  }).run();
  testDb.db.insert(responseWorkspaceItems).values({
    id: "response_workspace_item_evidence",
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: "anon_seed",
    kind: "artifact",
    title: "Attach signed response",
    status: "done",
    notes: "",
    sortOrder: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
  testDb.db.insert(supplierArtifacts).values({
    id: "supplier_artifact_evidence",
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: "anon_seed",
    title: "Signed capability statement",
    artifactType: "capability_statement",
    purpose: "response_workspace",
    fileName: "capability.pdf",
    contentType: "application/pdf",
    byteSize: 1024,
    storagePath: "data/artifact-vault/capability.pdf",
    checksumSha256: "hash_supplier_artifact_evidence",
    reviewStatus: "approved",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
  testDb.db.insert(responseWorkspaceItemArtifacts).values({
    itemId: "response_workspace_item_evidence",
    artifactId: "supplier_artifact_evidence",
    createdAt: timestamp,
  }).run();
  testDb.db.insert(awardOutcomes).values({
    id: "award_outcome_evidence",
    organizationId: "org_submission_evidence",
    intentId: intent.id,
    bidId: intent.bid.id,
    userId: "anon_seed",
    status: "awarded_to_us",
    awardNoticeUrl: "https://sam.gov/award/notice",
    tabulationArtifactUrl: "",
    winnerName: "Demo Supply Co.",
    currency: "USD",
    lossReason: "unknown",
    lossReasonNotes: "",
    nextAction: "archive_lessons",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
}

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
      expect(updated.status).toBe("draft");
      expect(updated.portalUrl).toBe("https://procurement.example.gov");
      expect(updated.contactEmail).toBe("buyer@example.gov");
      expect(updated.requiresRegistration).toBe(false);
    } finally {
      await testDb.cleanup();
    }
  });

  it("allows manual submission guidance to move between draft and ready only", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const ready = await updateSubmissionGuidance(testDb.db, "anon_seed", intent.id, {
        status: "ready",
      });
      const draft = await updateSubmissionGuidance(testDb.db, "anon_seed", intent.id, {
        status: "draft",
      });

      expect(ready.status).toBe("ready");
      expect(draft.status).toBe("draft");
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects manual submitted and needs_recovery status updates", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      await expect(updateSubmissionGuidance(testDb.db, "anon_seed", intent.id, {
        status: "submitted",
      })).rejects.toThrow("Submission status can only be manually set to draft or ready.");
      await expect(updateSubmissionGuidance(testDb.db, "anon_seed", intent.id, {
        status: "needs_recovery",
      })).rejects.toThrow("Submission status can only be manually set to draft or ready.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("stores manual external submission confirmation records", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      seedSubmissionEvidence(testDb, intent);
      const result = await createSubmissionConfirmation(testDb.db, "anon_seed", intent.id, {
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

      expect(result.confirmation.id).toMatch(/^submission_confirmation_/);
      expect(result.confirmation.confirmationReference).toBe("CONF-123");
      expect(result.submission.status).toBe("submitted");
      expect(result.confirmations).toHaveLength(1);
      expect(result.confirmations[0].confirmationReference).toBe("CONF-123");
      expect(rows).toHaveLength(1);

      const event = testDb.db.$client
        .prepare("SELECT * FROM event_log WHERE event_name = ? AND target_id = ?")
        .get("submission.confirmed", result.confirmation.id) as Record<string, unknown> | undefined;
      const metadata = JSON.parse(String(event?.metadata_json ?? "{}"));

      expect(event).toEqual(expect.objectContaining({
        actor_id: "anon_seed",
        target_type: "submission_confirmation",
        target_id: result.confirmation.id,
        outcome: "success",
      }));
      expect(metadata).toEqual({
        intentId: intent.id,
        method: "external_portal",
        status: "submitted",
        hasConfirmationReference: true,
        packageExportCount: 1,
        linkedArtifactCount: 1,
        hasAwardOutcome: true,
        readinessGateCanSubmit: true,
        readinessBlockers: [],
      });
      expect(JSON.stringify(metadata)).not.toContain("Receipt downloaded.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("marks confirmations without references as needs_recovery and returns history", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const result = await createSubmissionConfirmation(testDb.db, "anon_seed", intent.id, {
        submittedAt: "2026-05-29T15:30:00.000Z",
        method: "external_portal",
        confirmationNotes: "Portal accepted but no receipt yet.",
      });

      expect(result.confirmation.confirmationReference).toBe("");
      expect(result.submission.status).toBe("needs_recovery");
      expect(result.confirmations).toHaveLength(1);
      expect(result.confirmations[0].confirmationNotes).toBe("Portal accepted but no receipt yet.");
    } finally {
      await testDb.cleanup();
    }
  });

  it("hydrates submission evidence links from response package exports, linked artifacts, and award outcome", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      seedSubmissionEvidence(testDb, intent);

      const result = await createSubmissionConfirmation(testDb.db, "anon_seed", intent.id, {
        submittedAt: "2026-06-10T12:00:00.000Z",
        method: "external_portal",
        confirmationReference: "CONF-EVIDENCE",
      });

      expect(result.evidenceLinks).toEqual({
        responsePackageExports: [{
          id: "response_package_export_evidence",
          format: "zip",
          downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/response-workspace/package/exports/response_package_export_evidence`,
          snapshotId: "response_package_snapshot_evidence",
          snapshotTitle: "Final response package",
          snapshotVersionNumber: 1,
          exportedAt: timestamp,
          reviewStatus: "approved",
        }],
        linkedSupplierArtifacts: [{
          id: "supplier_artifact_evidence",
          name: "Signed capability statement",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          evidenceLinks: [{
            complianceCategory: "eligibility",
            evidenceRole: "eligibility_evidence",
            submissionEvidenceKey: "supplier_artifact:supplier_artifact_evidence",
            label: "Signed capability statement",
          }],
        }],
        awardOutcome: {
          status: "awarded_to_us",
          awardNoticeUrl: "https://sam.gov/award/notice",
        },
      });
      expect(result.confirmation.evidenceSnapshot).toEqual({
        capturedAt: result.confirmation.createdAt,
        responsePackageExports: [{
          id: "response_package_export_evidence",
          format: "zip",
          downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/response-workspace/package/exports/response_package_export_evidence`,
          snapshotId: "response_package_snapshot_evidence",
          snapshotTitle: "Final response package",
          snapshotVersionNumber: 1,
          exportedAt: timestamp,
          reviewStatus: "approved",
        }],
        linkedSupplierArtifacts: [{
          id: "supplier_artifact_evidence",
          name: "Signed capability statement",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          evidenceLinks: [{
            complianceCategory: "eligibility",
            evidenceRole: "eligibility_evidence",
            submissionEvidenceKey: "supplier_artifact:supplier_artifact_evidence",
            label: "Signed capability statement",
          }],
        }],
        awardOutcome: {
          status: "awarded_to_us",
          awardNoticeUrl: "https://sam.gov/award/notice",
        },
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("reports explicit readiness gate blockers before a submission can be marked submitted", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      const gate = await getSubmissionReadinessGate(testDb.db, "anon_seed", intent.id, {
        confirmationReference: " ",
      });

      expect(gate).toEqual(expect.objectContaining({
        canSubmit: false,
        approvedResponsePackageExportCount: 0,
        linkedSupplierArtifactCount: 0,
        confirmationReferencePresent: false,
      }));
      expect(gate.blockers).toEqual([
        {
          code: "approved_response_package_export_required",
          message: "Approve at least one response package export before confirming submission.",
        },
        {
          code: "confirmation_reference_required",
          message: "Add a confirmation reference or receipt number before marking the submission submitted.",
        },
        {
          code: "required_artifact_missing",
          message: "Link at least one required supplier artifact to the response workspace before submission.",
        },
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("keeps a business paid user ready through package export approval and submission confirmation", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db.insert(users).values({
        id: "business_paid_user",
        email: "business-paid@example.com",
        displayName: "Business Paid",
        accountTier: "business",
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run();
      const intent = await createIntentForBid(testDb.db, "business_paid_user", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "business_paid_user", intent.id);

      testDb.db.insert(supplierArtifacts).values({
        id: "business_required_artifact",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "business_paid_user",
        title: "Signed response package",
        artifactType: "signed_response",
        purpose: "response_workspace",
        fileName: "signed-response.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
        storagePath: "data/artifact-vault/signed-response.pdf",
        checksumSha256: "hash_business_required_artifact",
        reviewStatus: "approved",
        createdAt: timestamp,
        updatedAt: timestamp,
      }).run();

      for (const item of workspace.items) {
        await updateResponseWorkspaceItem(testDb.db, "business_paid_user", intent.id, {
          itemId: item.id,
          status: "done",
          linkedArtifactIds: item.kind === "artifact" ? ["business_required_artifact"] : undefined,
        });
      }

      const { snapshot } = await createResponsePackageSnapshot(testDb.db, "business_paid_user", intent.id, {
        title: "Business-ready response package",
      });
      const { exportRecord } = await createResponsePackageExport(testDb.db, "business_paid_user", intent.id, {
        snapshotId: snapshot.id,
        format: "zip",
      }, {
        storageRoot: testDb.directory,
      });
      await updateResponsePackageExportReview(testDb.db, "business_paid_user", intent.id, exportRecord.id, {
        reviewStatus: "approved",
        reviewNotes: "Approved by owner.",
      }, {
        now: new Date("2026-06-10T12:00:00.000Z"),
      });

      const gate = await getSubmissionReadinessGate(testDb.db, "business_paid_user", intent.id, {
        confirmationReference: "CONF-BUSINESS-1",
      });
      const result = await createSubmissionConfirmation(testDb.db, "business_paid_user", intent.id, {
        submittedAt: "2026-06-10T12:30:00.000Z",
        method: "external_portal",
        confirmationReference: "CONF-BUSINESS-1",
      });

      expect(snapshot.readiness.ready).toBe(true);
      expect(gate.canSubmit).toBe(true);
      expect(gate.blockers).toEqual([]);
      expect(result.submission.status).toBe("submitted");
      expect(result.readinessGate.canSubmit).toBe(true);
      expect(result.confirmation.evidenceSnapshot.responsePackageExports).toEqual([
        expect.objectContaining({
          id: exportRecord.id,
          reviewStatus: "approved",
        }),
      ]);
    } finally {
      await testDb.cleanup();
    }
  });

  it("keeps confirmation evidence snapshots immutable when later package exports are added", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      seedSubmissionEvidence(testDb, intent);
      const result = await createSubmissionConfirmation(testDb.db, "anon_seed", intent.id, {
        submittedAt: "2026-06-10T12:00:00.000Z",
        method: "external_portal",
        confirmationReference: "CONF-FROZEN",
      });

      testDb.db.insert(responsePackageExports).values({
        id: "response_package_export_later",
        snapshotId: "response_package_snapshot_later",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        requestedByUserId: "anon_seed",
        status: "ready",
        format: "pdf",
        fileName: "later-response.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
        storagePath: "data/response-package-exports/later-response.pdf",
        checksumSha256: "hash_response_package_export_later",
        readinessJson: readinessJson(),
        createdAt: "2026-06-10T02:00:00.000Z",
        updatedAt: "2026-06-10T02:00:00.000Z",
        reviewStatus: "pending_review",
        reviewNotes: "",
      }).run();

      const confirmations = await listSubmissionConfirmations(testDb.db, "anon_seed", intent.id);
      const latestEvidence = await getSubmissionEvidenceLinks(testDb.db, "anon_seed", intent.id);

      expect(confirmations[0].id).toBe(result.confirmation.id);
      expect(confirmations[0].evidenceSnapshot.responsePackageExports).toHaveLength(1);
      expect(confirmations[0].evidenceSnapshot.responsePackageExports[0]).toEqual(expect.objectContaining({
        id: "response_package_export_evidence",
        snapshotId: "response_package_snapshot_evidence",
        snapshotVersionNumber: 1,
      }));
      expect(latestEvidence.responsePackageExports.map((record) => record.id)).toEqual([
        "response_package_export_later",
        "response_package_export_evidence",
      ]);
      expect(latestEvidence.responsePackageExports[0]).toEqual(expect.objectContaining({
        snapshotId: "response_package_snapshot_later",
        snapshotVersionNumber: 2,
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("returns empty submission evidence links when no downstream artifacts exist", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      await expect(getSubmissionEvidenceLinks(testDb.db, "anon_seed", intent.id)).resolves.toEqual({
        responsePackageExports: [],
        linkedSupplierArtifacts: [],
        awardOutcome: null,
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("does not leak submission evidence links across intents", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const first = await createIntentForBid(testDb.db, "anon_seed", "1");
      const second = await createIntentForBid(testDb.db, "anon_seed", "2");
      seedSubmissionEvidence(testDb, first);

      await expect(getSubmissionEvidenceLinks(testDb.db, "anon_seed", second.id)).resolves.toEqual({
        responsePackageExports: [],
        linkedSupplierArtifacts: [],
        awardOutcome: null,
      });
    } finally {
      await testDb.cleanup();
    }
  });
});
