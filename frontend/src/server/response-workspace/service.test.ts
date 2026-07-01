import crypto from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { organizationMemberships, organizations, supplierArtifacts, users } from "@/server/db/schema";
import { createTestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  createResponseWorkspaceComment,
  createResponsePackageExport,
  createResponsePackageSnapshot,
  getResponsePackageExportFile,
  getResponsePackageWorkspace,
  getOrCreateResponseWorkspace,
  listResponseWorkspaceComments,
  markResponsePackageExportDownloaded,
  ResponseWorkspaceValidationError,
  updateResponsePackageExportReview,
  updateResponseWorkspaceItem,
} from "./service";

const objectStorageEnvKeys = [
  "OBJECT_STORAGE_PROVIDER",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_BASE_URL",
  "OBJECT_STORAGE_CREDENTIALS_REF",
] as const;

function setObjectStorageEnv(values: Record<typeof objectStorageEnvKeys[number], string>) {
  const previous = new Map<string, string | undefined>();

  for (const key of objectStorageEnvKeys) {
    previous.set(key, process.env[key]);
    process.env[key] = values[key];
  }

  return () => {
    for (const key of objectStorageEnvKeys) {
      const oldValue = previous.get(key);
      if (oldValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = oldValue;
      }
    }
  };
}

function readStoredZipEntries(bytes: Buffer) {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 30 <= bytes.byteLength && bytes.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const fileNameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    const fileName = bytes.subarray(nameStart, nameEnd).toString("utf8");
    const entryBytes = bytes.subarray(dataStart, dataEnd);

    if (compressionMethod !== 0) {
      throw new Error(`Unsupported ZIP compression method in test fixture: ${compressionMethod}`);
    }

    entries.set(fileName, Buffer.from(entryBytes));
    offset = dataEnd;
  }

  return entries;
}

describe("response workspace service", () => {
  it("seeds grouped response workspace items for an intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      expect(workspace.intentId).toBe(intent.id);
      expect(workspace.bidId).toBe(intent.bid.id);
      expect(workspace.items.length).toBeGreaterThanOrEqual(10);
      expect(workspace.summary.total).toBe(workspace.items.length);
      expect(workspace.summary.tasks).toBeGreaterThan(0);
      expect(workspace.summary.checkpoints).toBeGreaterThan(0);
      expect(workspace.summary.artifacts).toBeGreaterThan(0);
      expect(workspace.summary.outlineSections).toBeGreaterThan(0);
      expect(workspace.items.map((item) => item.kind)).toEqual(expect.arrayContaining([
        "task",
        "checkpoint",
        "artifact",
        "outline_section",
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("updates status and notes for existing workspace items", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "task")!;

      const updated = await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        status: "done",
        notes: "Initial draft finished.",
      });
      const updatedItem = updated.items.find((item) => item.id === target.id);

      expect(updatedItem).toEqual(expect.objectContaining({
        status: "done",
        notes: "Initial draft finished.",
      }));
      expect(updatedItem?.activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: "status_changed",
          actorUserId: "anon_seed",
          fromValue: target.status,
          toValue: "done",
        }),
        expect.objectContaining({
          eventType: "notes_updated",
          actorUserId: "anon_seed",
          fromValue: target.notes,
          toValue: "Initial draft finished.",
        }),
      ]));
      expect(updated.summary.done).toBe(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("links supplier artifacts that belong to the same response workspace intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "artifact") ?? workspace.items[0];

      testDb.db.insert(supplierArtifacts).values({
        id: "response_artifact_1",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        title: "Capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/capability.pdf",
        checksumSha256: "hash_response_artifact_1",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      const updated = await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        linkedArtifactIds: ["response_artifact_1"],
      });
      const updatedItem = updated.items.find((item) => item.id === target.id);

      expect(updatedItem?.linkedArtifacts).toEqual([
        expect.objectContaining({
          id: "response_artifact_1",
          title: "Capability statement",
          fileName: "capability.pdf",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          contentType: "application/pdf",
          byteSize: 1024,
          checksumSha256: "hash_response_artifact_1",
          reviewStatus: "pending_review",
          downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/artifacts/response_artifact_1`,
          evidenceLinks: [{
            complianceCategory: "eligibility",
            evidenceRole: "eligibility_evidence",
            submissionEvidenceKey: "supplier_artifact:response_artifact_1",
            label: "Capability statement",
          }],
        }),
      ]);
      expect(updatedItem?.activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: "linked_artifacts_updated",
          actorUserId: "anon_seed",
          toValue: "response_artifact_1",
        }),
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("does not link or show supplier artifacts after they are soft deleted", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "artifact") ?? workspace.items[0];

      testDb.db.insert(supplierArtifacts).values({
        id: "deleted_response_artifact_1",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        title: "Deleted capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        fileName: "deleted-capability.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/deleted-capability.pdf",
        checksumSha256: "hash_deleted_response_artifact_1",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        linkedArtifactIds: ["deleted_response_artifact_1"],
      });

      testDb.db.update(supplierArtifacts)
        .set({
          deletedAt: "2026-06-02T00:00:00.000Z",
          deletedByUserId: "anon_seed",
          updatedAt: "2026-06-02T00:00:00.000Z",
        })
        .run();

      const refreshed = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const refreshedItem = refreshed.items.find((item) => item.id === target.id);

      expect(refreshedItem?.linkedArtifacts).toEqual([]);
      await expect(updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        linkedArtifactIds: ["deleted_response_artifact_1"],
      })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects linked supplier artifacts outside the same response workspace intent", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const otherIntent = await createIntentForBid(testDb.db, "anon_seed", "2");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      testDb.db.insert(supplierArtifacts).values({
        id: "other_intent_artifact_1",
        intentId: otherIntent.id,
        bidId: otherIntent.bid.id,
        userId: "anon_seed",
        title: "Wrong intent artifact",
        artifactType: "response_asset",
        purpose: "response_workspace",
        fileName: "wrong.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/wrong.pdf",
        checksumSha256: "hash_wrong_artifact_1",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      await expect(updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: workspace.items[0].id,
        linkedArtifactIds: ["other_intent_artifact_1"],
      })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("assigns response workspace items to active workspace members", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db.insert(users).values({
        id: "response_member_1",
        email: "response-member@example.com",
        displayName: "Response Member",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizations).values({
        id: "response_org_1",
        name: "Response Org",
        accountTier: "business",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizationMemberships).values([
        {
          organizationId: "response_org_1",
          userId: "anon_seed",
          role: "owner",
          status: "active",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          organizationId: "response_org_1",
          userId: "response_member_1",
          role: "member",
          status: "active",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ]).run();

      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "task")!;

      const updated = await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        assignedUserId: "response_member_1",
      });
      const updatedItem = updated.items.find((item) => item.id === target.id);

      expect(updatedItem).toEqual(expect.objectContaining({
        assignedUserId: "response_member_1",
        assignedUser: expect.objectContaining({
          userId: "response_member_1",
          displayName: "Response Member",
          email: "response-member@example.com",
        }),
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("rejects assignment to users outside the active workspace", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      testDb.db.insert(users).values({
        id: "external_user_1",
        email: "external@example.com",
        displayName: "External User",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      await expect(updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: workspace.items[0].id,
        assignedUserId: "external_user_1",
      })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    } finally {
      await testDb.cleanup();
    }
  });

  it("adds and lists comments for a response workspace item", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const target = workspace.items.find((item) => item.kind === "task")!;

      const created = await createResponseWorkspaceComment(testDb.db, "anon_seed", intent.id, {
        itemId: target.id,
        body: "Please confirm technical staffing assumptions.",
      });
      const comments = await listResponseWorkspaceComments(testDb.db, "anon_seed", intent.id, target.id);

      expect(created).toEqual(expect.objectContaining({
        itemId: target.id,
        authorUserId: "anon_seed",
        body: "Please confirm technical staffing assumptions.",
      }));
      expect(comments).toHaveLength(1);
      expect(comments[0]).toEqual(expect.objectContaining({
        id: created.id,
        author: expect.objectContaining({ userId: "anon_seed" }),
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("summarizes response package readiness from outline sections and artifacts", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outline = workspace.items.find((item) => item.kind === "outline_section")!;
      const artifact = workspace.items.find((item) => item.kind === "artifact")!;

      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outline.id,
        status: "done",
        notes: "Section content drafted.",
      });

      const packageWorkspace = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);

      expect(packageWorkspace.outline.map((section) => section.id)).toContain(outline.id);
      expect(packageWorkspace.readiness.totalOutlineSections).toBeGreaterThan(0);
      expect(packageWorkspace.readiness.completedOutlineSections).toBe(1);
      expect(packageWorkspace.readiness.artifactPlaceholders).toBeGreaterThan(0);
      expect(packageWorkspace.readiness.missingArtifactLinks).toBeGreaterThanOrEqual(1);
      expect(packageWorkspace.readiness.ready).toBe(false);
      expect(packageWorkspace.readiness.openItems).toBe(
        packageWorkspace.workspace.items.filter((item) => item.status !== "done").length,
      );
      expect(packageWorkspace.workspace.items.map((item) => item.id)).toContain(artifact.id);
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates versioned response package snapshots from the current workspace state", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outline = workspace.items.find((item) => item.kind === "outline_section")!;

      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outline.id,
        status: "done",
        notes: "Snapshot-ready technical section.",
      });

      const created = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 1",
      });
      const refreshed = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);

      expect(created.snapshot).toEqual(expect.objectContaining({
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        createdByUserId: "anon_seed",
        title: "Draft package 1",
      }));
      expect(created.snapshot.outline).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: outline.id,
          title: outline.title,
          notes: "Snapshot-ready technical section.",
          status: "done",
        }),
      ]));
      expect(created.snapshot.readiness.completedOutlineSections).toBe(1);
      expect(created.snapshot.version).toEqual(expect.objectContaining({
        versionNumber: 1,
        previousSnapshotId: null,
        changeCount: 1,
      }));
      expect(created.snapshot.version.changes).toEqual([
        expect.objectContaining({
          kind: "created",
          label: "Snapshot created",
          fromValue: null,
          toValue: "Draft package 1",
        }),
      ]);
      expect(refreshed.snapshots[0]).toEqual(expect.objectContaining({
        id: created.snapshot.id,
        title: "Draft package 1",
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("summarizes response package changes against the previous snapshot", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outline = workspace.items.find((item) => item.kind === "outline_section")!;

      testDb.db.insert(supplierArtifacts).values({
        id: "response_version_artifact_1",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        title: "Capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
        storagePath: "data/artifact-vault/capability.pdf",
        checksumSha256: "hash_response_version_artifact_1",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      const first = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 1",
      });
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outline.id,
        status: "done",
      });
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outline.id,
        linkedArtifactIds: ["response_version_artifact_1"],
      });
      const second = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 2",
      });
      const refreshed = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);
      const latest = refreshed.snapshots.find((snapshot) => snapshot.id === second.snapshot.id)!;
      const previous = refreshed.snapshots.find((snapshot) => snapshot.id === first.snapshot.id)!;

      expect(latest.version).toEqual(expect.objectContaining({
        versionNumber: 2,
        previousSnapshotId: first.snapshot.id,
      }));
      expect(latest.version.changeCount).toBeGreaterThanOrEqual(2);
      expect(latest.version.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "outline_status_changed",
          label: outline.title,
          fromValue: outline.status,
          toValue: "done",
        }),
        expect.objectContaining({
          kind: "linked_artifacts_changed",
          label: outline.title,
          fromValue: "",
          toValue: "response_version_artifact_1",
        }),
      ]));
      expect(previous.version).toEqual(expect.objectContaining({
        versionNumber: 1,
        previousSnapshotId: null,
      }));
    } finally {
      await testDb.cleanup();
    }
  });

  it("builds a full response package version history summary for all snapshots", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outlineItems = workspace.items.filter((item) => item.kind === "outline_section");
      const firstOutline = outlineItems[0]!;
      const secondOutline = outlineItems[1] ?? firstOutline;

      const first = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 1",
      });
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: firstOutline.id,
        status: "done",
      });
      const second = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 2",
      });
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: secondOutline.id,
        status: "blocked",
      });
      const third = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 3",
      });
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: secondOutline.id,
        status: "done",
      });
      const fourth = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 4",
      });
      const refreshed = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);

      expect(refreshed.versionHistory).toEqual(expect.objectContaining({
        totalVersions: 4,
        latestVersionNumber: 4,
      }));
      expect(refreshed.versionHistory.totalChanges).toBe(
        refreshed.snapshots.reduce((total, snapshot) => total + snapshot.version.changeCount, 0),
      );
      expect(refreshed.versionHistory.entries.map((entry) => entry.snapshotId)).toEqual([
        fourth.snapshot.id,
        third.snapshot.id,
        second.snapshot.id,
        first.snapshot.id,
      ]);
      expect(refreshed.versionHistory.entries[0]).toEqual(expect.objectContaining({
        snapshotId: fourth.snapshot.id,
        title: "Draft package 4",
        versionNumber: 4,
        previousSnapshotId: third.snapshot.id,
      }));
      expect(refreshed.versionHistory.entries[0].changes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "outline_status_changed",
          label: secondOutline.title,
          fromValue: "blocked",
          toValue: "done",
        }),
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("builds side-by-side comparisons for response package version pairs", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outlineItems = workspace.items.filter((item) => item.kind === "outline_section");
      const firstOutline = outlineItems[0]!;
      const secondOutline = outlineItems[1] ?? firstOutline;

      const first = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 1",
      });
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: firstOutline.id,
        status: "done",
        notes: "Technical narrative completed.",
      });
      const second = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 2",
      });
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: secondOutline.id,
        status: "blocked",
        notes: "Waiting for supplier quote.",
      });
      const third = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Draft package 3",
      });

      const refreshed = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);
      const firstToThirdKey = `${first.snapshot.id}:${third.snapshot.id}`;
      const firstToThird = refreshed.versionComparisons.find((comparison) =>
        comparison.comparisonKey === firstToThirdKey
      );

      expect(refreshed.defaultVersionComparison).toEqual(expect.objectContaining({
        fromSnapshotId: second.snapshot.id,
        toSnapshotId: third.snapshot.id,
        fromVersionNumber: 2,
        toVersionNumber: 3,
      }));
      expect(refreshed.versionComparisons).toHaveLength(3);
      expect(firstToThird).toEqual(expect.objectContaining({
        comparisonKey: firstToThirdKey,
        fromSnapshotId: first.snapshot.id,
        toSnapshotId: third.snapshot.id,
        fromTitle: "Draft package 1",
        toTitle: "Draft package 3",
        fromVersionNumber: 1,
        toVersionNumber: 3,
      }));
      expect(firstToThird?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "outline_status",
          label: firstOutline.title,
          fromValue: firstOutline.status,
          toValue: "done",
        }),
        expect.objectContaining({
          kind: "outline_notes",
          label: firstOutline.title,
          fromValue: firstOutline.notes,
          toValue: "Technical narrative completed.",
        }),
        expect.objectContaining({
          kind: "outline_status",
          label: secondOutline.title,
          fromValue: secondOutline.status,
          toValue: "blocked",
        }),
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("exports a response package snapshot to a downloadable markdown file", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-export-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outlineItem = workspace.items.find((item) => item.kind === "outline_section") ?? workspace.items[0];
      testDb.db.insert(supplierArtifacts).values({
        id: "response_export_artifact_1",
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        title: "Signed capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
        storagePath: "data/artifact-vault/capability.pdf",
        checksumSha256: "hash_response_export_artifact_1",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outlineItem.id,
        linkedArtifactIds: ["response_export_artifact_1"],
      });
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Exportable package",
      });

      const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      }, { storageRoot: directory });
      const file = await getResponsePackageExportFile(testDb.db, "anon_seed", intent.id, result.exportRecord.id);
      const markdown = await readFile(file.storagePath, "utf8");

      expect(result.exportRecord).toEqual(expect.objectContaining({
        snapshotId: snapshotResult.snapshot.id,
        intentId: intent.id,
        bidId: intent.bid.id,
        userId: "anon_seed",
        status: "ready",
        contentType: "text/markdown; charset=utf-8",
        downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/response-workspace/package/exports/${result.exportRecord.id}`,
      }));
      expect(markdown).toContain("# Exportable package");
      expect(markdown).toContain("## Package Manifest");
      expect(markdown).toContain(`- Intent ID: ${intent.id}`);
      expect(markdown).toContain("## Artifact Manifest");
      expect(markdown).toContain("Signed capability statement");
      expect(markdown).toContain("response_export_artifact_1");
      expect(markdown).toContain("hash_response_export_artifact_1");
      expect(markdown).toContain("## Readiness");
      expect(markdown).toContain("## Outline");
      expect(file.fileName.endsWith(".md")).toBe(true);

      const event = testDb.db.$client
        .prepare("SELECT * FROM event_log WHERE event_name = ? AND target_id = ?")
        .get("response_package.export_created", result.exportRecord.id) as Record<string, unknown> | undefined;
      const metadata = JSON.parse(String(event?.metadata_json ?? "{}"));

      expect(event).toEqual(expect.objectContaining({
        actor_id: "anon_seed",
        target_type: "response_package_export",
        target_id: result.exportRecord.id,
        outcome: "success",
      }));
      expect(metadata).toEqual({
        intentId: intent.id,
        snapshotId: snapshotResult.snapshot.id,
        format: "markdown",
        byteSize: result.exportRecord.byteSize,
        checksumSha256: result.exportRecord.checksumSha256,
      });
      expect(JSON.stringify(metadata)).not.toContain(file.storagePath);
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed instead of writing local response package exports when S3-compatible credentials are not injected", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const exportRoot = await mkdtemp(path.join(os.tmpdir(), "response-package-s3-stub-"));
    const restoreEnv = setObjectStorageEnv({
      OBJECT_STORAGE_PROVIDER: "s3",
      OBJECT_STORAGE_BUCKET: "prod-artifacts",
      OBJECT_STORAGE_REGION: "us-east-1",
      OBJECT_STORAGE_BASE_URL: "https://s3.us-east-1.amazonaws.com",
      OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
    });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "S3 stub package",
      });

      await expect(createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
      }, { storageRoot: exportRoot })).rejects.toThrow(/OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY are required/);
      await expect(readdir(exportRoot)).resolves.toEqual([]);
    } finally {
      restoreEnv();
      await rm(exportRoot, { recursive: true, force: true });
      await testDb.cleanup();
    }
  });

  it("defaults response package exports to markdown format", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const exportRoot = await mkdtemp(path.join(os.tmpdir(), "response-package-format-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Default markdown package",
      });

      const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
      }, { storageRoot: exportRoot });

      expect(result.exportRecord.format).toBe("markdown");
      expect(result.exportRecord.fileName).toMatch(/\.md$/);
      expect(result.exportRecord.contentType).toBe("text/markdown; charset=utf-8");
    } finally {
      await rm(exportRoot, { recursive: true, force: true });
      await testDb.cleanup();
    }
  });

  it("exports a response package snapshot to a local zip with manifest and readable artifacts", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "response-package-zip-artifacts-"));
    const exportRoot = await mkdtemp(path.join(os.tmpdir(), "response-package-zip-export-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);
      const outlineItem = workspace.items.find((item) => item.kind === "outline_section") ?? workspace.items[0];
      const readableArtifactBytes = Buffer.from("signed capability statement");
      const readableArtifactPath = path.join(artifactRoot, "capability.txt");
      await writeFile(readableArtifactPath, readableArtifactBytes);
      const readableChecksum = crypto.createHash("sha256").update(readableArtifactBytes).digest("hex");

      testDb.db.insert(supplierArtifacts).values([
        {
          id: "response_zip_artifact_1",
          intentId: intent.id,
          bidId: intent.bid.id,
          userId: "anon_seed",
          title: "Signed capability statement",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          fileName: "capability.txt",
          contentType: "text/plain",
          byteSize: readableArtifactBytes.byteLength,
          storagePath: readableArtifactPath,
          checksumSha256: readableChecksum,
          reviewStatus: "pending_review",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "response_zip_artifact_missing",
          intentId: intent.id,
          bidId: intent.bid.id,
          userId: "anon_seed",
          title: "Missing supplier certificate",
          artifactType: "certification",
          purpose: "response_workspace",
          fileName: "missing-certificate.txt",
          contentType: "text/plain",
          byteSize: 128,
          storagePath: path.join(artifactRoot, "missing-certificate.txt"),
          checksumSha256: "missing_checksum",
          reviewStatus: "pending_review",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ]).run();
      await updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: outlineItem.id,
        linkedArtifactIds: ["response_zip_artifact_1", "response_zip_artifact_missing"],
      });
      const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Zip package",
      });

      const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
        format: "zip",
      }, {
        now: new Date("2026-06-04T12:00:00.000Z"),
        storageRoot: exportRoot,
      });
      const file = await getResponsePackageExportFile(testDb.db, "anon_seed", intent.id, result.exportRecord.id);
      const zipBytes = await readFile(file.storagePath);
      const entries = readStoredZipEntries(zipBytes);
      const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8")) as {
        intentId: string;
        bidId: string;
        generatedAt: string;
        artifacts: Array<{
          id: string;
          path: string;
          byteSize: number;
          checksumSha256: string;
          missing?: boolean;
        }>;
      };
      const readableArtifact = manifest.artifacts.find((artifact) => artifact.id === "response_zip_artifact_1")!;
      const missingArtifact = manifest.artifacts.find((artifact) => artifact.id === "response_zip_artifact_missing")!;

      expect(result.exportRecord).toEqual(expect.objectContaining({
        format: "zip",
        fileName: expect.stringMatching(/\.zip$/),
        contentType: "application/zip",
        byteSize: zipBytes.byteLength,
        checksumSha256: crypto.createHash("sha256").update(zipBytes).digest("hex"),
      }));
      expect(entries.get("README.md")?.toString("utf8")).toContain("# Zip package");
      expect(manifest).toEqual(expect.objectContaining({
        intentId: intent.id,
        bidId: intent.bid.id,
        generatedAt: "2026-06-04T12:00:00.000Z",
      }));
      expect(readableArtifact).toEqual(expect.objectContaining({
        path: expect.stringMatching(/^artifacts\/response_zip_artifact_1-capability\.txt$/),
        byteSize: readableArtifactBytes.byteLength,
        checksumSha256: readableChecksum,
        missing: false,
      }));
      expect(entries.get(readableArtifact.path)?.toString("utf8")).toBe("signed capability statement");
      expect(missingArtifact).toEqual(expect.objectContaining({
        byteSize: 128,
        checksumSha256: "missing_checksum",
        missing: true,
      }));
      expect(entries.has(missingArtifact.path)).toBe(false);
    } finally {
      await testDb.cleanup();
      await rm(artifactRoot, { recursive: true, force: true });
      await rm(exportRoot, { recursive: true, force: true });
    }
  });

  it("exports response package snapshots to lightweight PDF and DOCX files", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const exportRoot = await mkdtemp(path.join(os.tmpdir(), "response-package-rich-export-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Production format package",
      });

      const pdfResult = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
        format: "pdf",
      }, {
        now: new Date("2026-06-10T08:00:00.000Z"),
        storageRoot: exportRoot,
      });
      const docxResult = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
        format: "docx",
      }, {
        now: new Date("2026-06-10T08:05:00.000Z"),
        storageRoot: exportRoot,
      });
      const pdfFile = await getResponsePackageExportFile(testDb.db, "anon_seed", intent.id, pdfResult.exportRecord.id);
      const docxFile = await getResponsePackageExportFile(testDb.db, "anon_seed", intent.id, docxResult.exportRecord.id);
      const pdfBytes = await readFile(pdfFile.storagePath);
      const docxBytes = await readFile(docxFile.storagePath);
      const docxEntries = readStoredZipEntries(docxBytes);

      expect(pdfResult.exportRecord).toEqual(expect.objectContaining({
        format: "pdf",
        fileName: expect.stringMatching(/\.pdf$/),
        contentType: "application/pdf",
        byteSize: pdfBytes.byteLength,
        checksumSha256: crypto.createHash("sha256").update(pdfBytes).digest("hex"),
      }));
      expect(pdfBytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
      expect(pdfBytes.toString("latin1")).toContain("Production format package");

      expect(docxResult.exportRecord).toEqual(expect.objectContaining({
        format: "docx",
        fileName: expect.stringMatching(/\.docx$/),
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: docxBytes.byteLength,
        checksumSha256: crypto.createHash("sha256").update(docxBytes).digest("hex"),
      }));
      expect(docxEntries.get("[Content_Types].xml")?.toString("utf8")).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      );
      expect(docxEntries.get("word/document.xml")?.toString("utf8")).toContain("Production format package");
    } finally {
      await testDb.cleanup();
      await rm(exportRoot, { recursive: true, force: true });
    }
  });

  it("marks response package exports as pending review before approval", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-export-review-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Review package",
      });

      const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      }, { storageRoot: directory });

      expect(result.exportRecord.reviewStatus).toBe("pending_review");
      expect(result.exportRecord.reviewedAt).toBeNull();
      expect(result.exportRecord.reviewedByUserId).toBeNull();
      expect(result.exportRecord.reviewNotes).toBe("");
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records package export download timestamps for audit review", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-export-audit-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Audit package",
      });
      const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      }, { storageRoot: directory });

      await markResponsePackageExportDownloaded(testDb.db, "anon_seed", intent.id, result.exportRecord.id, {
        now: new Date("2026-06-03T12:00:00.000Z"),
      });
      const packageWorkspace = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);
      const exportRecord = packageWorkspace.snapshots
        .flatMap((snapshot) => snapshot.exports)
        .find((item) => item.id === result.exportRecord.id);
      const event = testDb.db.$client
        .prepare("SELECT * FROM event_log WHERE event_name = ? AND target_id = ?")
        .get("response_package.export_downloaded", result.exportRecord.id) as Record<string, unknown> | undefined;
      const metadata = JSON.parse(String(event?.metadata_json ?? "{}"));

      expect(exportRecord?.downloadedAt).toBe("2026-06-03T12:00:00.000Z");
      expect(event).toEqual(expect.objectContaining({
        actor_id: "anon_seed",
        target_type: "response_package_export",
        target_id: result.exportRecord.id,
        outcome: "success",
      }));
      expect(metadata).toEqual({
        intentId: intent.id,
        downloadedAt: "2026-06-03T12:00:00.000Z",
      });
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("updates response package export review status and records a redacted audit event", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-review-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Reviewable package",
      });
      const exportResult = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      }, { storageRoot: directory });

      const result = await updateResponsePackageExportReview(testDb.db, "anon_seed", intent.id, exportResult.exportRecord.id, {
        reviewStatus: "approved",
        reviewNotes: "Approved for submission after legal review.",
      }, {
        now: new Date("2026-06-10T14:00:00.000Z"),
      });
      const packageWorkspace = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);
      const exportRecord = packageWorkspace.snapshots
        .flatMap((snapshot) => snapshot.exports)
        .find((item) => item.id === exportResult.exportRecord.id);
      const event = testDb.db.$client
        .prepare("SELECT * FROM event_log WHERE event_name = ? AND target_id = ?")
        .get("response_package.review_updated", exportResult.exportRecord.id) as Record<string, unknown> | undefined;
      const metadata = JSON.parse(String(event?.metadata_json ?? "{}"));

      expect(result.exportRecord).toEqual(expect.objectContaining({
        reviewStatus: "approved",
        reviewedAt: "2026-06-10T14:00:00.000Z",
        reviewedByUserId: "anon_seed",
        reviewNotes: "Approved for submission after legal review.",
      }));
      expect(result.exportRecord.reviewHistory).toEqual([
        expect.objectContaining({
          exportId: exportResult.exportRecord.id,
          fromReviewStatus: "pending_review",
          toReviewStatus: "approved",
          actorUserId: "anon_seed",
          reviewNotes: "Approved for submission after legal review.",
          createdAt: "2026-06-10T14:00:00.000Z",
        }),
      ]);
      expect(exportRecord).toEqual(expect.objectContaining({
        reviewStatus: "approved",
        reviewedAt: "2026-06-10T14:00:00.000Z",
        reviewedByUserId: "anon_seed",
      }));
      expect(exportRecord?.reviewHistory).toEqual(result.exportRecord.reviewHistory);
      expect(event).toEqual(expect.objectContaining({
        actor_id: "anon_seed",
        target_type: "response_package_export",
        target_id: exportResult.exportRecord.id,
        outcome: "success",
      }));
      expect(metadata).toEqual({
        intentId: intent.id,
        previousReviewStatus: "pending_review",
        reviewStatus: "approved",
        hasReviewNotes: true,
      });
      expect(JSON.stringify(metadata)).not.toContain("Approved for submission");
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps chronological review history across repeated package export reviews", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-review-history-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Review history package",
      });
      const exportResult = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      }, { storageRoot: directory });

      await updateResponsePackageExportReview(testDb.db, "anon_seed", intent.id, exportResult.exportRecord.id, {
        reviewStatus: "needs_changes",
        reviewNotes: "Clarify pricing assumptions.",
      }, {
        now: new Date("2026-06-10T14:00:00.000Z"),
      });
      const finalResult = await updateResponsePackageExportReview(testDb.db, "anon_seed", intent.id, exportResult.exportRecord.id, {
        reviewStatus: "approved",
        reviewNotes: "Pricing clarification accepted.",
      }, {
        now: new Date("2026-06-10T15:00:00.000Z"),
      });
      const packageWorkspace = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);
      const exportRecord = packageWorkspace.snapshots
        .flatMap((snapshot) => snapshot.exports)
        .find((item) => item.id === exportResult.exportRecord.id);

      expect(finalResult.exportRecord.reviewStatus).toBe("approved");
      expect(finalResult.exportRecord.reviewHistory).toEqual([
        expect.objectContaining({
          fromReviewStatus: "pending_review",
          toReviewStatus: "needs_changes",
          reviewNotes: "Clarify pricing assumptions.",
          createdAt: "2026-06-10T14:00:00.000Z",
        }),
        expect.objectContaining({
          fromReviewStatus: "needs_changes",
          toReviewStatus: "approved",
          reviewNotes: "Pricing clarification accepted.",
          createdAt: "2026-06-10T15:00:00.000Z",
        }),
      ]);
      expect(exportRecord?.reviewHistory).toEqual(finalResult.exportRecord.reviewHistory);
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires review notes when requesting response package changes", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-review-notes-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Needs notes package",
      });
      const exportResult = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      }, { storageRoot: directory });

      await expect(updateResponsePackageExportReview(testDb.db, "anon_seed", intent.id, exportResult.exportRecord.id, {
        reviewStatus: "needs_changes",
        reviewNotes: " ",
      })).rejects.toThrow("Review notes are required when requesting package changes.");
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("summarizes package export governance from review state and history", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-governance-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Governance package",
      });

      await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
        format: "markdown",
      }, {
        now: new Date("2026-06-07T12:00:00.000Z"),
        storageRoot: directory,
      });
      const approvedExport = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
        format: "pdf",
      }, {
        now: new Date("2026-06-09T13:00:00.000Z"),
        storageRoot: directory,
      });
      const changesExport = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
        format: "docx",
      }, {
        now: new Date("2026-06-10T01:00:00.000Z"),
        storageRoot: directory,
      });

      await updateResponsePackageExportReview(testDb.db, "anon_seed", intent.id, approvedExport.exportRecord.id, {
        reviewStatus: "approved",
        reviewNotes: "Ready for the submission packet.",
      }, {
        now: new Date("2026-06-10T08:00:00.000Z"),
      });
      await updateResponsePackageExportReview(testDb.db, "anon_seed", intent.id, changesExport.exportRecord.id, {
        reviewStatus: "needs_changes",
        reviewNotes: "Add the missing pricing appendix.",
      }, {
        now: new Date("2026-06-10T11:00:00.000Z"),
      });

      const packageWorkspace = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);

      expect(packageWorkspace.governanceSummary).toEqual(expect.objectContaining({
        pendingReviewCount: 1,
        approvedCount: 1,
        needsChangesCount: 1,
        latestReviewerUserId: "anon_seed",
        canSubmitWithReviewedExport: true,
      }));
      expect(packageWorkspace.governanceSummary.longestPendingAgeHours).toBeGreaterThanOrEqual(0);
      expect(packageWorkspace.governanceSummary.reviewerSummary).toEqual({
        reviewerCount: 1,
        reviewers: [{
          userId: "anon_seed",
          reviewCount: 2,
          approvedCount: 1,
          needsChangesCount: 1,
          latestReviewedAt: "2026-06-10T11:00:00.000Z",
        }],
      });
      expect(packageWorkspace.governanceSummary.reviewTimeline).toEqual([
        expect.objectContaining({
          exportId: approvedExport.exportRecord.id,
          fromReviewStatus: "pending_review",
          toReviewStatus: "approved",
          actorUserId: "anon_seed",
          createdAt: "2026-06-10T08:00:00.000Z",
        }),
        expect.objectContaining({
          exportId: changesExport.exportRecord.id,
          fromReviewStatus: "pending_review",
          toReviewStatus: "needs_changes",
          actorUserId: "anon_seed",
          createdAt: "2026-06-10T11:00:00.000Z",
        }),
      ]);
      expect(packageWorkspace.governanceSummary.approvalThreshold).toEqual({
        requiredApprovedExports: 1,
        approvedExports: 1,
        met: true,
      });
      expect(packageWorkspace.governanceSummary.readinessReason).toBe("Approved export threshold met.");
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("explains when package export approval threshold is not met", async () => {
    const testDb = await createTestDatabase({ seed: true });
    const directory = await mkdtemp(path.join(os.tmpdir(), "response-package-governance-threshold-"));

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const { snapshot } = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Pending governance package",
      });

      await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshot.id,
      }, {
        now: new Date("2026-06-10T00:00:00.000Z"),
        storageRoot: directory,
      });

      const packageWorkspace = await getResponsePackageWorkspace(testDb.db, "anon_seed", intent.id);

      expect(packageWorkspace.governanceSummary.approvalThreshold).toEqual({
        requiredApprovedExports: 1,
        approvedExports: 0,
        met: false,
      });
      expect(packageWorkspace.governanceSummary.readinessReason).toBe(
        "At least 1 approved response package export is required before submission.",
      );
      expect(packageWorkspace.governanceSummary.reviewTimeline).toEqual([]);
    } finally {
      await testDb.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("stores default response package exports under the project data directory", async () => {
    const testDb = await createTestDatabase({ seed: true });
    let cleanupDirectory: string | null = null;

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      cleanupDirectory = path.join(process.cwd(), "data", "response-package-exports", "anon_seed", intent.id);
      const snapshotResult = await createResponsePackageSnapshot(testDb.db, "anon_seed", intent.id, {
        title: "Default storage package",
      });

      const result = await createResponsePackageExport(testDb.db, "anon_seed", intent.id, {
        snapshotId: snapshotResult.snapshot.id,
      });
      const file = await getResponsePackageExportFile(testDb.db, "anon_seed", intent.id, result.exportRecord.id);

      expect(path.isAbsolute(file.storagePath)).toBe(true);
      expect(file.storagePath.startsWith(path.join(process.cwd(), "data", "response-package-exports"))).toBe(true);
    } finally {
      await testDb.cleanup();
      if (cleanupDirectory) {
        await rm(cleanupDirectory, { recursive: true, force: true });
      }
    }
  });

  it("rejects unsupported status values", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
      const workspace = await getOrCreateResponseWorkspace(testDb.db, "anon_seed", intent.id);

      await expect(updateResponseWorkspaceItem(testDb.db, "anon_seed", intent.id, {
        itemId: workspace.items[0].id,
        status: "waiting" as never,
      })).rejects.toBeInstanceOf(ResponseWorkspaceValidationError);
    } finally {
      await testDb.cleanup();
    }
  });
});
